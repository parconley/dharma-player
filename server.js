// Dharma Player — a local, zero-dependency server for listening to dharmaseed.org talks.
// Syncs and caches the Dharma Seed catalog, stores your library, and handles offline downloads.

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const PORT = Number(process.env.PORT) || 4747;
const DATA = path.join(__dirname, 'data');
const AUDIO = path.join(DATA, 'audio');
const PUBLIC = path.join(__dirname, 'public');
const CATALOG_FILE = path.join(DATA, 'catalog.json');
const LIBRARY_FILE = path.join(DATA, 'library.json');
const API = 'https://dharmaseed.org/api/1';
const SITE = 'https://dharmaseed.org';
const BATCH = 400;
const INCREMENTAL_AFTER = 6 * 3600e3;   // look for new talks after 6h
const FULL_AFTER = 30 * 24 * 3600e3;    // re-fetch everything monthly to pick up edits

fs.mkdirSync(AUDIO, { recursive: true });

// ---------- catalog ----------

let catalog = null;
let catalogGz = null;
let sync = { running: false, phase: 'idle', done: 0, total: 0, error: null };

function setCatalog(c) {
  catalog = c;
  catalogGz = zlib.gzipSync(JSON.stringify(c));
}

try {
  setCatalog(JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8')));
  console.log(`Loaded catalog (${Object.keys(catalog.talks).length} talks)`);
} catch { /* first run */ }

async function api(kind, body) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${API}/${kind}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body),
      });
      if (!res.ok) throw new Error(`${kind}: HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

async function fetchDetails(kind, ids, onBatch) {
  const out = {};
  const batches = [];
  for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH));
  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const batch = batches[next++];
      const r = await api(kind, { detail: 1, items: batch.join(',') });
      Object.assign(out, r.items);
      onBatch(batch.length);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return out;
}

const clean = s => (s || '').replace(/\r\n/g, '\n').trim();

// Compactors return 0 for items we never want (so we don't re-fetch them every sync).
const compact = {
  talks: t => t.audio_url ? {
    title: clean(t.title),
    teacher: t.teacher_id,
    retreat: t.retreat_id || null,
    venue: t.venue_id || null,
    date: t.recording_date_in_seconds || (Date.parse(t.rec_date) / 1000) || 0,
    dur: Math.round((t.duration_in_minutes || 0) * 60),
    url: t.audio_url,
    type: t.recording_type || '',
    desc: clean(t.description),
  } : 0,
  teachers: t => ({ name: clean(t.name), bio: clean(t.bio), photo: !!t.photo, website: t.website || '' }),
  retreats: r => ({ name: clean(r.name), desc: clean(r.description), venue: r.venue_id || null, start: r.start_date, end: r.end_date }),
  venues: v => ({ name: clean(v.name) }),
};

async function runSync(full = false) {
  if (sync.running) return;
  sync = { running: true, phase: 'Checking Dharma Seed for new talks', done: 0, total: 0, error: null };
  try {
    const prev = (!full && catalog) || { talks: {}, teachers: {}, retreats: {}, venues: {} };
    const next = { syncedAt: Date.now(), fullSyncAt: full || !catalog ? Date.now() : catalog.fullSyncAt,
      talks: {}, teachers: {}, retreats: {}, venues: {} };
    const kinds = Object.keys(compact);
    const lists = {};
    for (const kind of kinds) lists[kind] = (await api(kind, { detail: 0 })).items.map(String);
    const missing = {};
    for (const kind of kinds) missing[kind] = lists[kind].filter(id => !(id in prev[kind]));
    sync.total = kinds.reduce((n, k) => n + missing[k].length, 0);
    sync.phase = sync.total ? 'Downloading the catalog' : 'Up to date';
    for (const kind of kinds) {
      for (const id of lists[kind]) if (id in prev[kind]) next[kind][id] = prev[kind][id];
      const got = await fetchDetails(kind, missing[kind], n => { sync.done += n; });
      for (const [id, item] of Object.entries(got)) next[kind][id] = compact[kind](item);
    }
    setCatalog(next);
    await fsp.writeFile(CATALOG_FILE, JSON.stringify(next));
    console.log(`Catalog synced: ${sync.total} new items`);
    sync.phase = 'Up to date';
  } catch (e) {
    sync.error = e.message;
    console.error('Sync failed:', e);
  } finally {
    sync.running = false;
  }
}

function maybeSync() {
  if (!catalog) return runSync(true);
  if (Date.now() - (catalog.fullSyncAt || 0) > FULL_AFTER) return runSync(true);
  if (Date.now() - catalog.syncedAt > INCREMENTAL_AFTER) return runSync(false);
}

// ---------- library ----------

const emptyLibrary = () => ({ likes: {}, follows: {}, progress: {}, history: [], queue: [], qi: -1, prefs: {}, downloads: {} });
let library = emptyLibrary();
try { library = { ...library, ...JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8')) }; } catch { /* first run */ }

let saveTimer = null;
function saveLibrary() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fsp.writeFile(LIBRARY_FILE + '.tmp', JSON.stringify(library))
      .then(() => fsp.rename(LIBRARY_FILE + '.tmp', LIBRARY_FILE))
      .catch(e => console.error('Library save failed:', e));
  }, 300);
}

// ---------- downloads ----------

const active = {}; // id -> { received, total }

async function download(id) {
  const talk = catalog && catalog.talks[id];
  if (!talk || active[id] || library.downloads[id]) return;
  active[id] = { received: 0, total: 0 };
  const file = path.join(AUDIO, `${id}.mp3`);
  try {
    const res = await fetch(SITE + talk.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    active[id].total = Number(res.headers.get('content-length')) || 0;
    const body = Readable.fromWeb(res.body);
    body.on('data', chunk => { active[id].received += chunk.length; });
    await pipeline(body, fs.createWriteStream(file + '.part'));
    await fsp.rename(file + '.part', file);
    library.downloads[id] = { size: active[id].received, at: Date.now() };
    saveLibrary();
  } catch (e) {
    console.error(`Download ${id} failed:`, e.message);
    fsp.unlink(file + '.part').catch(() => {});
  } finally {
    delete active[id];
  }
}

// ---------- http ----------

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 20e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

async function serveFile(req, res, file, type) {
  let stat;
  try { stat = await fsp.stat(file); } catch { res.writeHead(404); return res.end('Not found'); }
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    const end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${stat.size}` });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': stat.size, 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  let m;
  try {
    if (p === '/api/status') {
      return json(res, 200, { ready: !!catalog, syncedAt: catalog && catalog.syncedAt, sync,
        talkCount: catalog ? Object.values(catalog.talks).filter(Boolean).length : 0 });
    }
    if (p === '/api/sync' && req.method === 'POST') {
      runSync(url.searchParams.get('full') === '1');
      return json(res, 202, { ok: true });
    }
    if (p === '/api/catalog') {
      if (!catalog) return json(res, 503, { error: 'syncing' });
      const etag = `"${catalog.syncedAt}"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', etag, 'cache-control': 'no-cache' });
      return res.end(catalogGz);
    }
    if (p === '/api/library') {
      if (req.method === 'GET') return json(res, 200, library);
      const body = await readBody(req);
      const { downloads, ...rest } = body; // downloads are owned by the server
      library = { ...library, ...rest };
      saveLibrary();
      return json(res, 200, { ok: true });
    }
    if (p === '/api/downloads') return json(res, 200, { done: library.downloads, active });
    if ((m = /^\/api\/downloads\/(\d+)$/.exec(p))) {
      const id = m[1];
      if (req.method === 'POST') { download(id); return json(res, 202, { ok: true }); }
      if (req.method === 'DELETE') {
        delete library.downloads[id];
        saveLibrary();
        await fsp.unlink(path.join(AUDIO, `${id}.mp3`)).catch(() => {});
        return json(res, 200, { ok: true });
      }
    }
    if ((m = /^\/audio\/(\d+)$/.exec(p))) {
      const id = m[1];
      if (library.downloads[id]) return serveFile(req, res, path.join(AUDIO, `${id}.mp3`), 'audio/mpeg');
      const talk = catalog && catalog.talks[id];
      if (!talk) { res.writeHead(404); return res.end(); }
      res.writeHead(302, { location: SITE + talk.url });
      return res.end();
    }
    // static
    const rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    return serveFile(req, res, file, TYPES[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Dharma Player running at http://localhost:${PORT}`);
  maybeSync();
  setInterval(maybeSync, 3600e3);
});
