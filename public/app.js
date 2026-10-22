'use strict';

// ---------- utils ----------

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
const icon = name => `<svg><use href="#i-${name}"/></svg>`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
const hue = id => (id * 47 + 20) % 360;
const SITE = 'https://dharmaseed.org';

async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function fmtLen(sec) {
  const m = Math.round((sec || 0) / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} hr ${m % 60 ? `${m % 60} min` : ''}`.trim();
}
function fmtHours(sec) {
  const h = sec / 3600;
  return h < 10 ? `${h.toFixed(1)} hrs` : `${Math.round(h).toLocaleString()} hrs`;
}
const DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtDate = sec => sec ? DATE_FMT.format(new Date(sec * 1000)) : '';
const year = sec => sec ? new Date(sec * 1000).getFullYear() : '';
function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}
function initials(name) {
  const parts = (name || '?').replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  el.style.animation = 'none'; el.offsetHeight; el.style.animation = '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

// ---------- data ----------

const DB = { talks: new Map(), teachers: new Map(), retreats: new Map(), venues: new Map(), sorted: [], syncedAt: 0 };
let lib = null;
let dl = { done: {}, active: {} };

async function loadCatalog() {
  const c = await getJSON('/api/catalog');
  const talks = new Map(), teachers = new Map(), retreats = new Map(), venues = new Map();
  for (const [id, v] of Object.entries(c.venues)) if (v) venues.set(+id, { id: +id, ...v });
  for (const [id, t] of Object.entries(c.teachers)) if (t) teachers.set(+id, { id: +id, ...t, talks: [], secs: 0 });
  for (const [id, r] of Object.entries(c.retreats)) if (r) retreats.set(+id, { id: +id, ...r, talks: [], latest: 0, teacherIds: new Set() });
  for (const [id, t] of Object.entries(c.talks)) {
    if (!t) continue;
    const talk = { id: +id, ...t };
    talks.set(talk.id, talk);
    const teacher = teachers.get(talk.teacher);
    if (teacher) { teacher.talks.push(talk); teacher.secs += talk.dur; }
    const r = retreats.get(talk.retreat);
    if (r) { r.talks.push(talk); r.latest = Math.max(r.latest, talk.date); r.teacherIds.add(talk.teacher); }
  }
  for (const t of teachers.values()) t.talks.sort((a, b) => b.date - a.date);
  for (const r of retreats.values()) r.talks.sort((a, b) => a.date - b.date || a.id - b.id);
  Object.assign(DB, { talks, teachers, retreats, venues, syncedAt: c.syncedAt,
    sorted: [...talks.values()].sort((a, b) => b.date - a.date) });
}

const teacherOf = talk => DB.teachers.get(talk.teacher);
const teacherName = id => DB.teachers.get(id)?.name || 'Unknown teacher';
function hay(talk) {
  if (!talk.hay) {
    const r = DB.retreats.get(talk.retreat), v = DB.venues.get(talk.venue);
    talk.ntitle = norm(talk.title);
    talk.hay = norm([talk.title, teacherName(talk.teacher), r?.name, v?.name, talk.type, talk.desc].join(' '));
  }
  return talk.hay;
}
function progressOf(id) {
  const p = lib.progress[id];
  const talk = DB.talks.get(id);
  if (!p || !talk) return null;
  return { pos: p.p, frac: talk.dur ? Math.min(1, p.p / talk.dur) : 0, done: !!p.f };
}
const dlState = id => dl.active[id] ? 'active' : dl.done[id] ? 'done' : null;

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 800);
}
function flush() {
  clearTimeout(saveTimer);
  const { downloads, ...rest } = lib;
  const body = JSON.stringify(rest);
  fetch('/api/library', { method: 'PUT', headers: { 'content-type': 'application/json' }, body, keepalive: body.length < 60000 }).catch(() => {});
}

// ---------- shared html ----------

function avatar(tid, cls = '') {
  const t = DB.teachers.get(tid);
  const img = t?.photo ? `<img src="https://media.dharmaseed.org/uploads/photos/teacher_${tid}_125_0.png" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<div class="avatar ${cls}" style="--h:${hue(tid)}">${esc(initials(t?.name))}${img}</div>`;
}
const isPinned = id => lib.pins.includes(+id);
function pinButton(tid, style = '') {
  const on = isPinned(tid);
  return `<button class="outline-btn${on ? ' on' : ''}" data-action="follow" data-teacher="${tid}"${style ? ` style="${style}"` : ''} title="${on ? 'Unpin' : 'Pin to sidebar'}">${icon(on ? 'pin-fill' : 'pin')}<span>${on ? 'Pinned' : 'Pin'}</span></button>`;
}
const retreatArt = r => `<div class="retreat-art" style="--h:${hue(r.id * 7)}"><span>${esc(r.name)}</span></div>`;

function teacherCard(t) {
  const pinned = isPinned(t.id);
  return `<div class="card" data-href="#/teacher/${t.id}">
    <div class="art-wrap">${avatar(t.id)}<button class="card-play" data-action="play-teacher" data-teacher="${t.id}" title="Play latest">${icon('play')}</button>
      <button class="card-pin${pinned ? ' on' : ''}" data-action="follow" data-teacher="${t.id}" title="${pinned ? 'Unpin' : 'Pin to sidebar'}">${icon(pinned ? 'pin-fill' : 'pin')}</button></div>
    <div class="card-title">${esc(t.name)}</div>
    <div class="card-sub">${plural(t.talks.length, 'talk')}</div>
  </div>`;
}
function talkCard(talk) {
  const p = progressOf(talk.id);
  return `<div class="card" data-href="#/talk/${talk.id}" data-id="${talk.id}">
    <div class="art-wrap"><div class="art"><div class="talk-art">${avatar(talk.teacher, 'sq')}</div>
      ${p && !p.done ? `<div class="progress-line"><div style="width:${p.frac * 100}%"></div></div>` : ''}</div>
      <button class="card-play" data-action="play-talk" title="Play">${icon('play')}</button></div>
    <div class="card-title">${esc(talk.title)}</div>
    <div class="card-sub">${esc(teacherName(talk.teacher))}${p && !p.done ? ` · ${fmtLen(talk.dur - p.pos)} left` : ''}</div>
  </div>`;
}
function retreatCard(r) {
  const v = DB.venues.get(r.venue);
  return `<div class="card" data-href="#/retreat/${r.id}">
    <div class="art-wrap"><div class="art">${retreatArt(r)}</div><button class="card-play" data-action="play-retreat" data-retreat="${r.id}" title="Play">${icon('play')}</button></div>
    <div class="card-title">${esc(r.name)}</div>
    <div class="card-sub">${esc([v?.name, year(r.latest)].filter(Boolean).join(' · '))}</div>
  </div>`;
}
function section(title, body, more) {
  return `<section class="section"><div class="section-head"><h2>${esc(title)}</h2>${more ? `<a href="${more}">Show all</a>` : ''}</div>${body}</section>`;
}

// ---------- incremental lists ----------

const lists = new Map();
let listSeq = 0;
let observer = null;

function talkRow(talk, i, opts) {
  const r = DB.retreats.get(talk.retreat);
  const p = progressOf(talk.id);
  const d = dlState(talk.id);
  const sub = [`<a href="#/teacher/${talk.teacher}">${esc(teacherName(talk.teacher))}</a>`];
  if (talk.type && talk.type !== 'Talk') sub.push(esc(talk.type));
  let dur = fmtLen(talk.dur);
  if (p?.done) dur = `<span class="done" title="Finished">${icon('check')}${dur}</span>`;
  else if (p && p.pos > 5) dur = `${fmtLen(talk.dur - p.pos)} left<div class="bar"><div style="width:${p.frac * 100}%"></div></div>`;
  return `<div class="trow${current === talk.id ? ' playing' : ''}" data-id="${talk.id}" data-i="${i}">
    <div class="num"><span class="n">${opts.numbered ? i + 1 : ''}</span><button class="play" data-action="play-row" title="Play">${icon('play')}</button><span class="eq"><i></i><i></i><i></i></span></div>
    <div class="tmain">${avatar(talk.teacher, 'sq')}<div class="ttext"><a class="title" href="#/talk/${talk.id}">${esc(talk.title)}</a><div class="tsub">${sub.join(' · ')}</div></div></div>
    ${opts.retreat !== false ? `<div class="tret">${r ? `<a href="#/retreat/${r.id}">${esc(r.name)}</a>` : ''}</div>` : ''}
    <div class="tdate">${fmtDate(talk.date)}</div>
    <div class="tacts">
      <button class="icon-btn${lib.likes[talk.id] ? ' on' : ''}" data-action="like" title="${lib.likes[talk.id] ? 'Unlike' : 'Like'}">${icon(lib.likes[talk.id] ? 'heart-fill' : 'heart')}</button>
      <button class="icon-btn" data-action="enqueue" title="Add to queue">${icon('add-queue')}</button>
      <button class="icon-btn${d === 'done' ? ' on' : d ? ' busy' : ''}" data-action="download" title="${d === 'done' ? 'Downloaded — click to remove' : d ? 'Downloading…' : 'Download for offline'}">${icon(d === 'done' ? 'downloaded' : 'download')}</button>
    </div>
    <div class="tdur">${dur}</div>
  </div>`;
}

function talkList(ids, opts = {}) {
  const key = `l${++listSeq}`;
  const o = { numbered: false, ...opts };
  lists.set(key, { ids, render: (id, i) => talkRow(DB.talks.get(id), i, o), opts: o, n: 0 });
  return `<div class="tlist${o.retreat === false ? ' no-retreat' : ''}" data-list="${key}">
    <div class="thead"><div class="r">#</div><div>Title</div>${o.retreat === false ? '' : '<div class="h-ret">Retreat</div>'}<div class="h-date">Recorded</div><div></div><div class="r">Length</div></div>
    <div class="tbody"></div>${ids.length ? '' : `<div class="empty-state">${o.empty || 'Nothing here yet.'}</div>`}<div class="sentinel"></div></div>`;
}

function retreatList(ids) {
  const key = `l${++listSeq}`;
  lists.set(key, { ids, render: id => {
    const r = DB.retreats.get(id), v = DB.venues.get(r.venue);
    const span = r.talks.length ? [fmtDate(r.talks[0].date), fmtDate(r.latest)] : [];
    return `<div class="trow" data-href="#/retreat/${id}">
      <div class="mini-art">${retreatArt(r)}</div>
      <div class="ttext"><div class="title">${esc(r.name)}</div><div class="tsub">${esc([...r.teacherIds].slice(0, 3).map(teacherName).join(', '))}</div></div>
      <div class="tret">${esc(v?.name || '')}</div>
      <div class="tdate">${span[0] === span[1] ? span[0] || '' : `${span[0]} – ${span[1]}`}</div>
      <div class="tdur">${plural(r.talks.length, 'talk')}</div></div>`;
  }, n: 0 });
  return `<div class="rlist" data-list="${key}"><div class="thead"><div></div><div>Retreat</div><div>Venue</div><div>Dates</div><div class="r">Talks</div></div><div class="tbody"></div><div class="sentinel"></div></div>`;
}

function renderMore(el, count = 120) {
  const L = lists.get(el.dataset.list);
  if (!L || L.n >= L.ids.length) return;
  const end = Math.min(L.ids.length, L.n + count);
  let html = '';
  for (let i = L.n; i < end; i++) html += L.render(L.ids[i], i);
  $('.tbody', el).insertAdjacentHTML('beforeend', html);
  L.n = end;
}

function mountLists(root) {
  observer?.disconnect();
  observer = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) renderMore(e.target.closest('[data-list]'));
  }, { root: $('#main'), rootMargin: '800px' });
  for (const el of $$('[data-list]', root)) {
    renderMore(el);
    observer.observe($('.sentinel', el));
  }
}

function resetList(el, ids) {
  const L = lists.get(el.dataset.list);
  L.ids = ids; L.n = 0;
  $('.tbody', el).innerHTML = '';
  $('.empty-state', el)?.remove();
  if (!ids.length) $('.tbody', el).insertAdjacentHTML('afterend', `<div class="empty-state">${L.opts?.empty || 'No matches.'}</div>`);
  renderMore(el);
}

function refreshTalk(id) {
  for (const row of $$(`.trow[data-id="${id}"]`)) {
    const L = lists.get(row.closest('[data-list]')?.dataset.list);
    if (L) row.outerHTML = L.render(id, +row.dataset.i);
  }
}

// ---------- views ----------

const view = () => $('#view');

function setView(html, cls = '') {
  const v = view();
  v.className = `view ${cls}`;
  v.innerHTML = html;
  mountLists(v);
}

function homeView() {
  const inProgress = lib.history.map(h => h.id).filter(id => { const p = progressOf(id); return p && !p.done && p.pos > 15; });
  const follows = lib.pins.map(id => DB.teachers.get(id)).filter(Boolean);
  const popular = [...DB.teachers.values()].sort((a, b) => b.talks.length - a.talks.length);
  // Pinned teachers own the top of the page; fall back to popular teachers until something is pinned.
  const quick = [
    ...follows.map(t => ({ teacher: t })),
    ...inProgress.slice(0, 4).map(id => ({ talk: DB.talks.get(id) })),
    ...(follows.length ? [] : popular.slice(0, 8).map(t => ({ teacher: t }))),
  ].filter((q, i, a) => a.findIndex(o => (o.teacher?.id ?? -o.talk.id) === (q.teacher?.id ?? -q.talk.id)) === i).slice(0, 8);

  const quickHTML = quick.map(q => q.talk
    ? `<div class="quick-item" data-href="#/talk/${q.talk.id}" data-id="${q.talk.id}">${avatar(q.talk.teacher, 'sq')}<span>${esc(q.talk.title)}</span><button class="mini-play" data-action="play-talk" title="Resume">${icon('play')}</button></div>`
    : `<div class="quick-item" data-href="#/teacher/${q.teacher.id}">${avatar(q.teacher.id, 'sq')}<span>${esc(q.teacher.name)}</span><button class="mini-play" data-action="play-teacher" data-teacher="${q.teacher.id}" title="Play latest">${icon('play')}</button></div>`).join('');

  const pinnedRows = follows.slice(0, 8).map(t => section(`Latest from ${t.name}`,
    `<div class="cards one-row">${t.talks.slice(0, 12).map(talkCard).join('')}</div>`, `#/teacher/${t.id}`)).join('');
  const recentRetreats = [...DB.retreats.values()].filter(r => r.talks.length > 2).sort((a, b) => b.latest - a.latest).slice(0, 12);
  const now = new Date();

  setView(`
    <div class="home-hero">
      <div class="hero-kicker faint">${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      <h1>Listen</h1>
      <p>${follows.length ? 'Your teachers' : 'Pin your favorite teachers and they\'ll live up here.'}</p>
      <div class="quick">${quickHTML}</div>
    </div>
    <div class="pad" style="padding:0 32px">
      ${inProgress.length ? section('Continue listening', `<div class="cards one-row">${inProgress.slice(0, 12).map(id => talkCard(DB.talks.get(id))).join('')}</div>`, '#/history') : ''}
      ${pinnedRows}
      ${section('Recent retreats', `<div class="cards one-row">${recentRetreats.map(retreatCard).join('')}</div>`, '#/retreats')}
      ${section(follows.length ? 'Discover more teachers' : 'Most recorded teachers', `<div class="cards one-row">${popular.filter(t => !isPinned(t.id)).slice(0, 14).map(teacherCard).join('')}</div>`, '#/teachers')}
    </div>`, 'flush');
}

function newView() {
  setView(`<h1 class="page-title">Just added</h1>${talkList(DB.sorted.map(t => t.id))}`);
}

const TOPICS = [
  ['Mettā', 'metta'], ['Jhāna', 'jhana'], ['Ānāpānasati', 'anapanasati'], ['Satipaṭṭhāna', 'satipatthana'],
  ['Brahmavihāras', 'brahmavihara'], ['Equanimity', 'equanimity'], ['Dependent origination', 'dependent origination'],
  ['Not-self', 'not-self'], ['Hindrances', 'hindrances'], ['Guided meditation', 'guided'], ['Compassion', 'compassion'],
  ['Death & dying', 'death'], ['Impermanence', 'impermanence'], ['Emptiness', 'emptiness'], ['Nibbāna', 'nibbana'],
  ['Joy', 'joy'], ['Sīla & ethics', 'ethics'], ['Wise effort', 'effort'], ['Grief', 'grief'], ['Q&A', 'questions'],
];

const searchState = { q: '', tab: 'all', len: 'any' };

function searchView(params) {
  searchState.q = params.get('q') || '';
  searchState.tab = params.get('tab') || 'all';
  setView(`
    <div class="searchbar">
      <input id="search-input" type="search" placeholder="Search talks, teachers, retreats…" value="${esc(searchState.q)}" autocomplete="off" spellcheck="false">
      <div class="chips" id="search-chips"></div>
    </div>
    <div id="search-results"></div>`);
  const input = $('#search-input');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      searchState.q = input.value;
      history.replaceState(null, '', `#/search${input.value ? `?q=${encodeURIComponent(input.value)}${searchState.tab !== 'all' ? `&tab=${searchState.tab}` : ''}` : ''}`);
      renderSearch();
    }, 120);
  });
  renderSearch();
}

const LENGTHS = { any: [0, 1e9], short: [0, 20 * 60], mid: [20 * 60, 45 * 60], long: [45 * 60, 1e9] };

function runSearch(q) {
  const qn = norm(q).trim();
  const tokens = qn.split(/\s+/).filter(Boolean);
  const [lo, hi] = LENGTHS[searchState.len];
  const talks = [];
  for (const talk of DB.sorted) {
    if (talk.dur < lo || talk.dur >= hi) continue;
    const h = hay(talk);
    if (!tokens.every(tok => h.includes(tok))) continue;
    let score = talk.ntitle.includes(qn) ? 100 : 0;
    for (const tok of tokens) if (talk.ntitle.includes(tok)) score += 10;
    if (tokens.every(tok => norm(teacherName(talk.teacher)).includes(tok))) score += 30;
    talks.push([score, talk]);
  }
  talks.sort((a, b) => b[0] - a[0] || b[1].date - a[1].date);
  const teachers = [...DB.teachers.values()].filter(t => t.talks.length && tokens.every(tok => norm(t.name).includes(tok)))
    .sort((a, b) => b.talks.length - a.talks.length);
  const retreats = [...DB.retreats.values()].filter(r => r.talks.length && tokens.every(tok => norm(r.name).includes(tok)))
    .sort((a, b) => b.latest - a.latest);
  return { talks: talks.map(x => x[1]), teachers, retreats };
}

function renderSearch() {
  const { q, tab, len } = searchState;
  const chip = (action, val, label, on) => `<button class="chip${on ? ' on' : ''}" data-action="${action}" data-val="${val}">${label}</button>`;
  $('#search-chips').innerHTML = q.trim()
    ? [['all', 'All'], ['talks', 'Talks'], ['teachers', 'Teachers'], ['retreats', 'Retreats']].map(([v, l]) => chip('search-tab', v, l, tab === v)).join('')
      + '<span style="width:12px"></span>'
      + [['any', 'Any length'], ['short', 'Under 20 min'], ['mid', '20–45 min'], ['long', '45 min +']].map(([v, l]) => chip('search-len', v, l, len === v)).join('')
    : '';
  const out = $('#search-results');
  if (!q.trim()) {
    out.innerHTML = section('Browse', `<div class="topic-grid">${TOPICS.map(([label, query], i) =>
      `<div class="topic" style="--h:${(i * 37 + 10) % 360}" data-action="topic" data-q="${esc(query)}">${esc(label)}</div>`).join('')}</div>`);
    return;
  }
  const res = runSearch(q);
  let html = '';
  if (tab === 'all') {
    const top = res.teachers[0];
    const topTalk = res.talks[0];
    if (!res.talks.length && !res.teachers.length && !res.retreats.length) {
      html = `<div class="empty-state"><h3>No results for “${esc(q)}”</h3>Try fewer words or a different spelling.</div>`;
    } else {
      const topCard = top
        ? `<div class="top-card" data-href="#/teacher/${top.id}">${avatar(top.id)}<h3>${esc(top.name)}</h3><span class="muted">Teacher</span><span class="badge">${plural(top.talks.length, 'talk')}</span>
            <button class="card-play on" data-action="play-teacher" data-teacher="${top.id}">${icon('play')}</button></div>`
        : topTalk ? `<div class="top-card" data-href="#/talk/${topTalk.id}" data-id="${topTalk.id}">${avatar(topTalk.teacher, 'sq')}<h3>${esc(topTalk.title)}</h3><span class="muted">${esc(teacherName(topTalk.teacher))}</span><span class="badge">${fmtLen(topTalk.dur)}</span>
            <button class="card-play on" data-action="play-talk">${icon('play')}</button></div>` : '';
      html += `<div class="top-result">
        ${topCard ? section('Top result', topCard) : ''}
        ${res.talks.length ? section('Talks', talkList(res.talks.slice(0, 5).map(t => t.id), { retreat: false }), `#/search?q=${encodeURIComponent(q)}&tab=talks`) : ''}
      </div>`;
      if (res.teachers.length) html += section('Teachers', `<div class="cards one-row">${res.teachers.slice(0, 12).map(teacherCard).join('')}</div>`, res.teachers.length > 6 ? `#/search?q=${encodeURIComponent(q)}&tab=teachers` : '');
      if (res.retreats.length) html += section('Retreats', `<div class="cards one-row">${res.retreats.slice(0, 12).map(retreatCard).join('')}</div>`, res.retreats.length > 6 ? `#/search?q=${encodeURIComponent(q)}&tab=retreats` : '');
    }
  } else if (tab === 'talks') {
    html = `<div class="list-tools"><span class="list-count">${plural(res.talks.length, 'talk')}</span>
      ${res.talks.length ? `<button class="text-btn" data-action="play-search">Play all</button>` : ''}</div>${talkList(res.talks.map(t => t.id), { empty: 'No talks match.' })}`;
  } else if (tab === 'teachers') {
    html = res.teachers.length ? `<div class="cards">${res.teachers.map(teacherCard).join('')}</div>` : `<div class="empty-state">No teachers match.</div>`;
  } else {
    html = res.retreats.length ? retreatList(res.retreats.map(r => r.id)) : `<div class="empty-state">No retreats match.</div>`;
  }
  searchState.lastTalks = res.talks.map(t => t.id);
  out.innerHTML = html;
  mountLists(out);
}

function teachersView() {
  setView(`<h1 class="page-title">Teachers</h1>
    <div class="list-tools">
      <input class="filter-input" id="tf" placeholder="Filter teachers" autocomplete="off">
      <select class="select" id="ts"><option value="count">Most talks</option><option value="recent">Recently active</option><option value="name">A–Z</option></select>
      <span class="list-count" id="tc"></span>
    </div>
    <div class="cards" id="tgrid"></div>`);
  const draw = () => {
    const f = norm($('#tf').value).trim();
    const sort = $('#ts').value;
    const ts = [...DB.teachers.values()].filter(t => t.talks.length && (!f || norm(t.name).includes(f)));
    ts.sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name)
      : sort === 'recent' ? (a, b) => (b.talks[0]?.date || 0) - (a.talks[0]?.date || 0)
      : (a, b) => b.talks.length - a.talks.length);
    $('#tc').textContent = plural(ts.length, 'teacher');
    $('#tgrid').innerHTML = ts.map(teacherCard).join('');
  };
  $('#tf').addEventListener('input', draw);
  $('#ts').addEventListener('change', draw);
  draw();
}

function retreatsView() {
  const all = [...DB.retreats.values()].filter(r => r.talks.length).sort((a, b) => b.latest - a.latest);
  setView(`<h1 class="page-title">Retreats</h1>
    <div class="list-tools"><input class="filter-input" id="rf" placeholder="Filter by name, venue, or teacher" autocomplete="off"><span class="list-count" id="rc">${plural(all.length, 'retreat')}</span></div>
    ${retreatList(all.map(r => r.id))}`);
  $('#rf').addEventListener('input', e => {
    const tokens = norm(e.target.value).split(/\s+/).filter(Boolean);
    const ids = all.filter(r => {
      r.hay ||= norm([r.name, DB.venues.get(r.venue)?.name, ...[...r.teacherIds].map(teacherName)].join(' '));
      return tokens.every(t => r.hay.includes(t));
    }).map(r => r.id);
    $('#rc').textContent = plural(ids.length, 'retreat');
    resetList($('[data-list]', view()), ids);
  });
}

function teacherView([, id], params) {
  const t = DB.teachers.get(+id);
  if (!t) return notFound();
  const tab = params.get('tab') || 'talks';
  const years = t.talks.length ? [year(t.talks[t.talks.length - 1].date), year(t.talks[0].date)] : [];
  const retreats = [...new Set(t.talks.map(x => x.retreat))].map(rid => DB.retreats.get(rid)).filter(Boolean).sort((a, b) => b.latest - a.latest);
  setView(`
    <div class="hero" style="--h:${hue(t.id)}">
      ${avatar(t.id)}
      <div class="hero-meta">
        <div class="hero-kicker">Teacher</div>
        <h1${t.name.length > 28 ? ' class="long"' : ''}>${esc(t.name)}</h1>
        <div class="hero-sub"><span>${plural(t.talks.length, 'talk')}</span><span class="dot"></span><span>${fmtHours(t.secs)}</span>
          ${years.length ? `<span class="dot"></span><span>${years[0] === years[1] ? years[0] : `${years[0]}–${years[1]}`}</span>` : ''}</div>
      </div>
    </div>
    <div class="actionbar">
      <button class="big-play" data-action="play-teacher" data-teacher="${t.id}" title="Play newest">${icon('play')}</button>
      <button class="icon-btn" data-action="shuffle-teacher" data-teacher="${t.id}" title="Shuffle">${icon('shuffle')}</button>
      ${pinButton(t.id)}
      ${t.website ? `<a class="icon-btn" href="${esc(t.website)}" target="_blank" rel="noopener" title="Website">${icon('external')}</a>` : ''}
    </div>
    <div class="pad">
      ${t.bio ? `<div class="section"><div class="prose clamp" id="bio">${esc(t.bio)}</div><button class="text-btn" data-action="bio" style="margin-top:6px">Read more</button></div>` : ''}
      <div class="chips" style="margin:28px 0 20px">
        <a class="chip${tab === 'talks' ? ' on' : ''}" href="#/teacher/${t.id}">Talks</a>
        <a class="chip${tab === 'retreats' ? ' on' : ''}" href="#/teacher/${t.id}?tab=retreats">Retreats · ${retreats.length}</a>
      </div>
      ${tab === 'retreats' ? retreatList(retreats.map(r => r.id)) : `
        <div class="list-tools">
          <input class="filter-input" id="tf" placeholder="Filter ${esc(t.name.split(' ')[0])}'s talks" autocomplete="off">
          <select class="select" id="ts"><option value="new">Newest</option><option value="old">Oldest</option><option value="long">Longest</option><option value="short">Shortest</option></select>
          <span class="list-count" id="tc">${plural(t.talks.length, 'talk')}</span>
        </div>
        ${talkList(t.talks.map(x => x.id), { empty: 'No talks match.' })}`}
    </div>`, 'flush');
  if (tab !== 'talks') return;
  const draw = () => {
    const tokens = norm($('#tf').value).split(/\s+/).filter(Boolean);
    const sort = $('#ts').value;
    const talks = t.talks.filter(x => tokens.every(tok => hay(x).includes(tok)));
    if (sort === 'old') talks.reverse();
    if (sort === 'long') talks.sort((a, b) => b.dur - a.dur);
    if (sort === 'short') talks.sort((a, b) => a.dur - b.dur);
    $('#tc').textContent = plural(talks.length, 'talk');
    resetList($('.tlist', view()), talks.map(x => x.id));
  };
  $('#tf').addEventListener('input', draw);
  $('#ts').addEventListener('change', draw);
}

function retreatView([, id]) {
  const r = DB.retreats.get(+id);
  if (!r) return notFound();
  const v = DB.venues.get(r.venue);
  const teachers = [...r.teacherIds];
  const secs = r.talks.reduce((n, t) => n + t.dur, 0);
  const span = r.talks.length ? [fmtDate(r.talks[0].date), fmtDate(r.latest)] : [];
  const teacherLinks = teachers.slice(0, 3).map(tid => `<a href="#/teacher/${tid}">${esc(teacherName(tid))}</a>`).join(', ')
    + (teachers.length > 3 ? ` and ${teachers.length - 3} more` : '');
  setView(`
    <div class="hero" style="--h:${hue(r.id * 7)}">
      <div class="art">${retreatArt(r)}</div>
      <div class="hero-meta">
        <div class="hero-kicker">Retreat</div>
        <h1${r.name.length > 30 ? ' class="long"' : ''}>${esc(r.name)}</h1>
        <div class="hero-sub">${teacherLinks}${v ? `<span class="dot"></span><span>${esc(v.name)}</span>` : ''}
          ${span.length ? `<span class="dot"></span><span>${span[0] === span[1] ? span[0] : `${span[0]} – ${span[1]}`}</span>` : ''}
          <span class="dot"></span><span>${plural(r.talks.length, 'talk')}, ${fmtHours(secs)}</span></div>
      </div>
    </div>
    <div class="actionbar">
      <button class="big-play" data-action="play-retreat" data-retreat="${r.id}" title="Play from the start">${icon('play')}</button>
      <button class="icon-btn" data-action="download-retreat" data-retreat="${r.id}" title="Download all">${icon('download')}</button>
    </div>
    <div class="pad">
      ${r.desc ? `<div class="prose" style="margin-bottom:28px">${esc(r.desc)}</div>` : ''}
      ${talkList(r.talks.map(t => t.id), { numbered: true, retreat: false })}
    </div>`, 'flush');
}

function talkView([, id]) {
  const talk = DB.talks.get(+id);
  if (!talk) return notFound();
  const t = teacherOf(talk);
  const r = DB.retreats.get(talk.retreat);
  const v = DB.venues.get(talk.venue);
  const p = progressOf(talk.id);
  const d = dlState(talk.id);
  const isCur = current === talk.id;
  const playLabel = isCur && !audio.paused ? 'Pause' : p && !p.done && p.pos > 15 ? `Resume · ${fmtLen(talk.dur - p.pos)} left` : 'Play';
  const siblings = r ? r.talks.map(x => x.id) : [];
  const more = t ? t.talks.filter(x => x.id !== talk.id && x.retreat !== talk.retreat).slice(0, 6).map(x => x.id) : [];
  setView(`
    <div class="hero" style="--h:${hue(talk.teacher)}">
      <div class="art">${avatar(talk.teacher, 'sq')}</div>
      <div class="hero-meta">
        <div class="hero-kicker">${esc(talk.type || 'Talk')}</div>
        <h1 class="${talk.title.length > 30 ? 'long' : ''}">${esc(talk.title)}</h1>
        <div class="hero-sub"><a href="#/teacher/${talk.teacher}">${esc(t?.name || 'Unknown')}</a>
          ${r ? `<span class="dot"></span><a href="#/retreat/${r.id}">${esc(r.name)}</a>` : ''}
          <span class="dot"></span><span>${fmtDate(talk.date)}</span><span class="dot"></span><span>${fmtLen(talk.dur)}</span></div>
      </div>
    </div>
    <div class="actionbar">
      <button class="big-play with-label" data-action="play-talk" data-id="${talk.id}">${icon(isCur && !audio.paused ? 'pause' : 'play')}<span>${playLabel}</span></button>
      <button class="icon-btn${lib.likes[talk.id] ? ' on' : ''}" data-action="like" data-id="${talk.id}" title="Like">${icon(lib.likes[talk.id] ? 'heart-fill' : 'heart')}</button>
      <button class="icon-btn${d === 'done' ? ' on' : d ? ' busy' : ''}" data-action="download" data-id="${talk.id}" title="${d === 'done' ? 'Downloaded — click to remove' : 'Download for offline'}">${icon(d === 'done' ? 'downloaded' : 'download')}</button>
      <button class="icon-btn" data-action="enqueue" data-id="${talk.id}" title="Add to queue">${icon('add-queue')}</button>
      <a class="icon-btn" href="${SITE}/talks/${talk.id}/" target="_blank" rel="noopener" title="Open on dharmaseed.org">${icon('external')}</a>
    </div>
    <div class="talk-details">
      <div>
        ${talk.desc ? `<div class="prose" style="margin-bottom:12px">${esc(talk.desc)}</div>` : ''}
        ${siblings.length > 1 ? section(`From ${r.name}`, talkList(siblings, { numbered: true, retreat: false })) : ''}
        ${more.length ? section(`More from ${t.name}`, talkList(more), `#/teacher/${t.id}`) : ''}
      </div>
      <div>
        ${t ? `<div class="info-card">
          <a href="#/teacher/${t.id}">${avatar(t.id)}</a>
          <h4><a class="link" href="#/teacher/${t.id}">${esc(t.name)}</a></h4>
          <div class="muted" style="font-size:13px">${plural(t.talks.length, 'talk')}</div>
          ${t.bio ? `<div class="prose clamp" style="margin-top:10px">${esc(t.bio)}</div>` : ''}
          ${pinButton(t.id, 'margin-top:14px')}
          <dl class="kv">
            <dt>Recorded</dt><dd>${fmtDate(talk.date)}</dd>
            ${v ? `<dt>Venue</dt><dd>${esc(v.name)}</dd>` : ''}
            ${r ? `<dt>Retreat</dt><dd><a href="#/retreat/${r.id}">${esc(r.name)}</a></dd>` : ''}
            <dt>Length</dt><dd>${fmtClock(talk.dur)}</dd>
          </dl>
        </div>` : ''}
      </div>
    </div>`, 'flush');
}

function likedView() {
  const ids = Object.entries(lib.likes).sort((a, b) => b[1] - a[1]).map(([id]) => +id).filter(id => DB.talks.has(id));
  libraryPage('Liked talks', 'heart-fill', ids, 'Tap the heart on any talk to save it here.');
}
function downloadsView() {
  const ids = [...Object.keys(dl.active), ...Object.entries(dl.done).sort((a, b) => b[1].at - a[1].at).map(([id]) => id)].map(Number).filter(id => DB.talks.has(id));
  const bytes = Object.values(dl.done).reduce((n, d) => n + (d.size || 0), 0);
  libraryPage('Downloads', 'download', ids, 'Downloaded talks play offline. Use the arrow icon on any talk.',
    ids.length ? `${(bytes / 1e9).toFixed(2)} GB on disk` : '');
}
function historyView() {
  const ids = lib.history.map(h => h.id).filter(id => DB.talks.has(id));
  libraryPage('History', 'clock', ids, 'Talks you play will show up here.');
}
function libraryPage(title, ic, ids, empty, extra = '') {
  setView(`
    <div class="hero" style="--h:35">
      <div class="art" style="display:grid;place-items:center;background:linear-gradient(135deg,#e3a33b,#7a4b16)"><svg style="width:72px;height:72px;color:#1a1206"><use href="#i-${ic}"/></svg></div>
      <div class="hero-meta"><div class="hero-kicker">Library</div><h1>${esc(title)}</h1>
        <div class="hero-sub"><span>${plural(ids.length, 'talk')}</span>${extra ? `<span class="dot"></span><span>${extra}</span>` : ''}</div></div>
    </div>
    <div class="actionbar">${ids.length ? `<button class="big-play" data-action="play-page" title="Play all">${icon('play')}</button>` : ''}</div>
    <div class="pad">${talkList(ids, { empty })}</div>`, 'flush');
}

function notFound() {
  setView(`<div class="empty-state"><h3>Not found</h3>That page doesn't exist. <a class="link" href="#/">Go home</a></div>`);
}

const ROUTES = [
  [/^$/, homeView], [/^search$/, searchView], [/^teachers$/, teachersView], [/^retreats$/, retreatsView],
  [/^teacher\/(\d+)$/, teacherView], [/^retreat\/(\d+)$/, retreatView], [/^talk\/(\d+)$/, talkView],
  [/^liked$/, likedView], [/^downloads$/, downloadsView], [/^history$/, historyView], [/^new$/, newView],
];
const scrolls = new Map();
let lastHash = null;

function route() {
  const main = $('#main');
  if (lastHash !== null) scrolls.set(lastHash, main.scrollTop);
  const hash = location.hash.replace(/^#\/?/, '');
  const [path, qs] = hash.split('?');
  lists.clear();
  const hit = ROUTES.find(([re]) => re.test(path));
  if (hit) hit[1](hit[0].exec(path), new URLSearchParams(qs));
  else notFound();
  main.scrollTop = scrolls.get(hash) || 0;
  lastHash = hash;
  const section = path.split('/')[0] || 'home';
  for (const a of $$('.nav a')) a.classList.toggle('active', a.dataset.nav === section);
  for (const a of $$('.following a')) a.classList.toggle('active', a.getAttribute('href') === `#/${path}`);
}

function rerender() {
  const main = $('#main');
  const top = main.scrollTop;
  if (location.hash.startsWith('#/search')) return renderSearch();
  lastHash = null;
  route();
  main.scrollTop = top;
}

function renderFollowing() {
  const ts = lib.pins.map(id => DB.teachers.get(id)).filter(Boolean);
  $('#following').innerHTML = ts.length
    ? ts.map(t => `<a href="#/teacher/${t.id}" data-pin="${t.id}" draggable="true" title="${esc(t.name)} — drag to reorder">${avatar(t.id)}<span>${esc(t.name)}</span></a>`).join('')
    : '<div class="empty label">Pin teachers to keep them here.</div>';
}

// Drag pinned teachers in the sidebar to reorder them.
function initPinDrag() {
  const box = $('#following');
  let dragging = null;
  box.addEventListener('dragstart', e => {
    dragging = e.target.closest('[data-pin]');
    if (!dragging) return;
    dragging.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  });
  box.addEventListener('dragover', e => {
    if (!dragging) return;
    e.preventDefault();
    const over = e.target.closest('[data-pin]');
    if (!over || over === dragging) return;
    const r = over.getBoundingClientRect();
    over[e.clientY > r.top + r.height / 2 ? 'after' : 'before'](dragging);
  });
  box.addEventListener('dragend', () => {
    if (!dragging) return;
    dragging.classList.remove('dragging');
    dragging = null;
    lib.pins = $$('[data-pin]', box).map(a => +a.dataset.pin);
    save();
  });
}

function renderCatalogInfo() {
  $('#catalog-info').innerHTML = `<span>Synced ${ago(DB.syncedAt)} · <a href="${SITE}" target="_blank" rel="noopener">Support Dharma Seed</a></span>
    <button class="icon-btn" data-action="resync" title="Check for new talks">${icon('refresh')}</button>`;
}

// ---------- player ----------

const audio = new Audio();
audio.preload = 'auto';
let current = null;
let pendingSeek = 0;
let seeking = false;
let lastSaved = 0;
const MIN_RATE = 0.5, MAX_RATE = 3;
let sleepAt = null; // timestamp, 'end', or null
let pip = null;     // Document Picture-in-Picture mini player window

const durOf = () => isFinite(audio.duration) ? audio.duration : curTalk()?.dur || 0;
const fmtRate = r => `${+r.toFixed(2)}×`;
const pipQ = (sel, fn) => { const el = pip?.document.querySelector(sel); if (el) fn(el); };

let osdTimer;
function osd(text) {
  const el = $('#osd');
  el.textContent = text;
  el.hidden = false;
  el.style.animation = 'none'; el.offsetHeight; el.style.animation = '';
  clearTimeout(osdTimer);
  osdTimer = setTimeout(() => { el.hidden = true; }, 750);
}

function curTalk() { return DB.talks.get(current); }

function startQueue(ids, i = 0) {
  lib.queue = ids.slice(0, 2000);
  lib.qi = Math.min(i, lib.queue.length - 1);
  loadTrack(true);
}

function loadTrack(autoplay, record = true) {
  const id = lib.queue[lib.qi];
  const talk = DB.talks.get(id);
  if (!talk) return;
  saveProgress();
  const prev = current;
  current = id;
  audio.src = `/audio/${id}`;
  audio.defaultPlaybackRate = audio.playbackRate = lib.prefs.rate || 1;
  const p = lib.progress[id];
  pendingSeek = p && !p.f && p.p > 15 && p.p < talk.dur - 30 ? p.p - 3 : 0;
  if (autoplay) audio.play().catch(() => {});
  if (record) {
    lib.history = [{ id, t: Date.now() }, ...lib.history.filter(h => h.id !== id)].slice(0, 500);
  }
  renderNowPlaying();
  markPlaying(prev);
  renderQueue();
  setMediaSession(talk);
  save();
}

function togglePlay() {
  if (!current) {
    const first = $('[data-list]');
    if (first) startQueue(lists.get(first.dataset.list).ids, 0);
    return;
  }
  audio.paused ? audio.play().catch(() => {}) : audio.pause();
}

function next() {
  if (lib.qi < lib.queue.length - 1) { lib.qi++; loadTrack(true); }
}
function prev() {
  if (audio.currentTime > 5 || lib.qi <= 0) audio.currentTime = 0;
  else { lib.qi--; loadTrack(true); }
}
function skip(s) {
  if (!current) return;
  audio.currentTime = Math.max(0, Math.min((audio.duration || 1e9) - 1, audio.currentTime + s));
  osd(`${s > 0 ? '+' : '−'}${Math.abs(s)}s`);
}

function saveProgress(force) {
  const talk = curTalk();
  if (!talk || !audio.src) return;
  const dur = isFinite(audio.duration) ? audio.duration : talk.dur;
  const pos = audio.currentTime;
  if (pos < 1 && !force) return;
  const prevDone = lib.progress[current]?.f;
  lib.progress[current] = { p: Math.round(pos), t: Date.now(), f: prevDone || pos >= dur - 45 ? 1 : 0 };
  if (pos < 30 && prevDone) lib.progress[current].f = 1;
  save();
}

function markPlaying(prevId) {
  if (prevId) for (const r of $$(`.trow[data-id="${prevId}"]`)) r.classList.remove('playing');
  for (const r of $$(`.trow[data-id="${current}"]`)) r.classList.add('playing');
}

function renderNowPlaying() {
  const talk = curTalk();
  const np = $('#np');
  renderMini();
  if (!talk) { np.innerHTML = ''; document.title = 'Dharma Player'; return; }
  const liked = !!lib.likes[talk.id];
  np.innerHTML = `<a href="#/talk/${talk.id}">${avatar(talk.teacher, 'sq')}</a>
    <div class="np-text"><a class="np-title" href="#/talk/${talk.id}" title="${esc(talk.title)}">${esc(talk.title)}</a>
      <div class="np-sub"><a href="#/teacher/${talk.teacher}">${esc(teacherName(talk.teacher))}</a></div></div>
    <button class="icon-btn${liked ? ' on' : ''}" data-action="like" data-id="${talk.id}" title="Like">${icon(liked ? 'heart-fill' : 'heart')}</button>`;
  document.title = `${talk.title} · ${teacherName(talk.teacher)}`;
  $('#t-dur').textContent = fmtClock(talk.dur);
}

function paintScrub(frac) {
  const pct = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  $('#sc-played').style.width = pct;
  $('#sc-thumb').style.left = pct;
  pipQ('.played', el => { el.style.width = pct; });
}

function bufferedFrac() {
  const b = audio.buffered, t = audio.currentTime, dur = durOf();
  for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 1 && b.end(i) >= t) return dur ? b.end(i) / dur : 0;
  return 0;
}

function updateTime() {
  const dur = durOf();
  if (!seeking) {
    paintScrub(dur ? audio.currentTime / dur : 0);
    $('#t-cur').textContent = fmtClock(audio.currentTime);
  }
  $('#sc-buf').style.width = `${Math.min(1, bufferedFrac()) * 100}%`;
  $('#t-dur').textContent = fmtClock(dur);
  pipQ('.cur', el => { el.textContent = fmtClock(audio.currentTime); });
  pipQ('.dur', el => { el.textContent = fmtClock(dur); });
}

function initScrubber() {
  const sc = $('#scrubber'), tip = $('#sc-hover');
  const fracAt = e => { const r = sc.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  const preview = f => { paintScrub(f); $('#t-cur').textContent = fmtClock(f * durOf()); };
  sc.addEventListener('pointerdown', e => {
    if (!current) return;
    seeking = true;
    sc.setPointerCapture(e.pointerId);
    sc.classList.add('dragging');
    preview(fracAt(e));
  });
  sc.addEventListener('pointermove', e => {
    const f = fracAt(e);
    tip.hidden = !current;
    tip.textContent = fmtClock(f * durOf());
    tip.style.left = `${f * 100}%`;
    if (seeking) preview(f);
  });
  sc.addEventListener('pointerleave', () => { if (!seeking) tip.hidden = true; });
  sc.addEventListener('pointerup', e => {
    if (!seeking) return;
    seeking = false;
    sc.classList.remove('dragging');
    audio.currentTime = fracAt(e) * durOf();
  });
  sc.addEventListener('pointercancel', () => { seeking = false; sc.classList.remove('dragging'); updateTime(); });
}

function setPlayIcon() {
  const playing = !audio.paused;
  $('#play-icon use').setAttribute('href', `#i-${playing ? 'pause' : 'play'}`);
  document.body.classList.toggle('paused', !playing);
  pipQ('.pip-play use', u => u.setAttribute('href', `#i-${playing ? 'pause' : 'play'}`));
  pip?.document.body.classList.toggle('paused', !playing);
  const bp = $(`.big-play.with-label[data-id="${current}"]`);
  if (bp) {
    $('use', bp).setAttribute('href', `#i-${playing ? 'pause' : 'play'}`);
    $('span', bp).textContent = playing ? 'Pause' : 'Play';
  }
}

function renderQueue() {
  if ($('#queue-panel').hidden) return;
  const item = (id, qi, now) => {
    const t = DB.talks.get(id);
    if (!t) return '';
    return `<div class="q-item${now ? ' now' : ''}" data-action="q-play" data-qi="${qi}">${avatar(t.teacher, 'sq')}
      <div class="ttext"><div class="title">${esc(t.title)}</div><div class="tsub">${esc(teacherName(t.teacher))} · ${fmtLen(t.dur)}</div></div>
      ${now ? '' : `<button class="icon-btn" data-action="q-remove" data-qi="${qi}" title="Remove">${icon('close')}</button>`}</div>`;
  };
  const upcoming = lib.queue.slice(lib.qi + 1, lib.qi + 101);
  const rest = lib.queue.length - lib.qi - 1 - upcoming.length;
  $('#queue-body').innerHTML = current
    ? `<div class="q-label">Now playing</div>${item(current, lib.qi, true)}
       <div class="q-label">Next up</div>${upcoming.length ? upcoming.map((id, i) => item(id, lib.qi + 1 + i)).join('') : '<div class="tsub" style="padding:0 8px">Nothing queued. Add talks with the queue icon.</div>'}
       ${rest > 0 ? `<div class="tsub" style="padding:8px">and ${rest} more</div>` : ''}`
    : '<div class="empty-state">Nothing playing yet.</div>';
}

function setMediaSession(talk) {
  if (!('mediaSession' in navigator)) return;
  const t = teacherOf(talk);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: talk.title,
    artist: t?.name || '',
    album: DB.retreats.get(talk.retreat)?.name || 'Dharma Seed',
    artwork: t?.photo ? [{ src: `https://media.dharmaseed.org/uploads/photos/teacher_${t.id}_125_0.png`, sizes: '125x125', type: 'image/png' }] : [],
  });
}

function setRate(r, announce) {
  r = Math.round(Math.max(MIN_RATE, Math.min(MAX_RATE, r)) * 100) / 100;
  lib.prefs.rate = r;
  audio.playbackRate = audio.defaultPlaybackRate = r;
  const b = $('#speed-btn');
  b.textContent = fmtRate(r);
  b.classList.toggle('on', r !== 1);
  $('#speed-val').textContent = fmtRate(r);
  const range = $('#speed-range');
  range.value = r;
  range.style.setProperty('--fill', `${(r - MIN_RATE) / (MAX_RATE - MIN_RATE) * 100}%`);
  for (const p of $$('[data-action="speed-set"]')) p.classList.toggle('on', +p.dataset.r === r);
  pipQ('.mini-speed', el => { el.textContent = fmtRate(r); });
  if (announce) osd(fmtRate(r));
  save();
}
const nudgeRate = d => setRate((lib.prefs.rate || 1) + d, true);

function setVolume(v, announce) {
  v = Math.max(0, Math.min(1, v));
  lib.prefs.vol = v;
  if (v) lib.prefs.lastVol = v;
  audio.volume = v;
  const el = $('#volume');
  el.value = Math.round(v * 100);
  el.style.setProperty('--fill', `${v * 100}%`);
  $('#vol-icon use').setAttribute('href', v ? '#i-vol' : '#i-mute');
  if (announce) osd(v ? `Volume ${Math.round(v * 100)}%` : 'Muted');
  save();
}

// Always-on-top mini player (Chrome/Edge Document Picture-in-Picture).
async function toggleMini() {
  if (pip) return pip.close();
  if (!('documentPictureInPicture' in window)) return toast('Mini player needs Chrome or Edge');
  pip = await documentPictureInPicture.requestWindow({ width: 400, height: 176 });
  const d = pip.document;
  for (const sheet of document.styleSheets) {
    try {
      const style = d.createElement('style');
      style.textContent = [...sheet.cssRules].map(r => r.cssText).join('\n');
      d.head.append(style);
    } catch {
      const link = d.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      d.head.append(link);
    }
  }
  d.title = 'Dharma Player';
  d.body.className = `mini-body${audio.paused ? ' paused' : ''}`;
  d.body.append($('svg[aria-hidden]').cloneNode(true));
  const root = d.createElement('div');
  root.className = 'mini';
  d.body.append(root);
  d.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
  d.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (el) { e.preventDefault(); return handleAction(el, e); }
    const sc = e.target.closest('.mini-scrub');
    if (sc && current) {
      const r = sc.getBoundingClientRect();
      audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * durOf();
    }
  });
  d.addEventListener('keydown', onKey);
  pip.addEventListener('pagehide', () => { pip = null; $('#mini-btn').classList.remove('on'); });
  $('#mini-btn').classList.add('on');
  renderMini();
}

function renderMini() {
  if (!pip) return;
  const talk = curTalk();
  pip.document.querySelector('.mini').innerHTML = talk ? `
    <div class="mini-top">${avatar(talk.teacher, 'sq')}
      <div class="np-text"><div class="np-title">${esc(talk.title)}</div><div class="np-sub">${esc(teacherName(talk.teacher))}</div></div></div>
    <div class="mini-scrub"><div class="track"><div class="played"></div></div></div>
    <div class="mini-row">
      <span class="time"><span class="cur">0:00</span> / <span class="dur">0:00</span></span>
      <div class="buttons">
        <button class="icon-btn skip" data-action="back" title="Back 15s">${icon('back15')}</button>
        <button class="play-main" data-action="toggle" title="Play / pause"><svg class="pip-play"><use href="#i-${audio.paused ? 'play' : 'pause'}"/></svg></button>
        <button class="icon-btn skip" data-action="fwd" title="Forward 30s">${icon('fwd30')}</button>
      </div>
      <div class="mini-speed-row">
        <button data-action="speed-step" data-d="-0.1" title="Slower (−)">−</button>
        <span class="mini-speed">${fmtRate(lib.prefs.rate || 1)}</span>
        <button data-action="speed-step" data-d="0.1" title="Faster (+)">+</button>
      </div>
    </div>` : '<div class="empty-state">Nothing playing</div>';
  updateTime();
}

function setSleep(val) {
  sleepAt = val === 'off' ? null : val === 'end' ? 'end' : Date.now() + Number(val) * 60000;
  $('#sleep-btn').classList.toggle('on', !!sleepAt);
  updateSleepLabel();
  toast(val === 'off' ? 'Sleep timer off' : val === 'end' ? 'Stopping at end of talk' : `Sleeping in ${val} minutes`);
}
function updateSleepLabel() {
  $('#sleep-label').textContent = !sleepAt ? '' : sleepAt === 'end' ? 'End' : fmtClock((sleepAt - Date.now()) / 1000);
}
async function fadeOutAndPause() {
  const vol = audio.volume;
  for (let i = 20; i >= 0; i--) { audio.volume = vol * i / 20; await sleep(400); }
  audio.pause();
  audio.volume = vol;
}

function initPlayer() {
  audio.addEventListener('loadedmetadata', () => {
    if (pendingSeek) { audio.currentTime = pendingSeek; pendingSeek = 0; }
    audio.playbackRate = lib.prefs.rate || 1;
    updateTime();
  });
  audio.addEventListener('timeupdate', () => {
    updateTime();
    if (Date.now() - lastSaved > 5000) { lastSaved = Date.now(); saveProgress(); }
    if ('mediaSession' in navigator && isFinite(audio.duration)) {
      try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: audio.currentTime, playbackRate: audio.playbackRate }); } catch {}
    }
  });
  audio.addEventListener('play', setPlayIcon);
  audio.addEventListener('pause', () => { setPlayIcon(); saveProgress(); refreshTalk(current); });
  audio.addEventListener('ended', () => {
    saveProgress(true);
    refreshTalk(current);
    if (sleepAt === 'end') { setSleep('off'); return; }
    next();
  });
  audio.addEventListener('error', () => { if (audio.src) toast("Couldn't load this talk's audio"); });

  initScrubber();
  audio.addEventListener('progress', updateTime);
  $('#volume').addEventListener('input', e => setVolume(e.target.value / 100));
  $('.volume').addEventListener('wheel', e => { e.preventDefault(); setVolume(audio.volume - Math.sign(e.deltaY) * 0.05, true); }, { passive: false });
  $('#speed-range').addEventListener('input', e => setRate(+e.target.value));
  $('#speed-btn').addEventListener('wheel', e => { e.preventDefault(); nudgeRate(-Math.sign(e.deltaY) * 0.05); }, { passive: false });

  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => audio.play());
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('seekbackward', () => skip(-15));
    ms.setActionHandler('seekforward', () => skip(30));
    ms.setActionHandler('previoustrack', prev);
    ms.setActionHandler('nexttrack', next);
    ms.setActionHandler('seekto', e => { audio.currentTime = e.seekTime; });
  }

  setInterval(() => {
    if (!sleepAt) return;
    if (sleepAt !== 'end' && Date.now() >= sleepAt) { sleepAt = null; $('#sleep-btn').classList.remove('on'); fadeOutAndPause(); }
    updateSleepLabel();
  }, 1000);

  setRate(lib.prefs.rate || 1);
  setVolume(lib.prefs.vol ?? 1);
  setPlayIcon();
  if (lib.queue[lib.qi]) loadTrack(false, false);
}

// ---------- actions ----------

function toggleLike(id) {
  if (lib.likes[id]) delete lib.likes[id];
  else lib.likes[id] = Date.now();
  save();
  refreshTalk(id);
  for (const b of $$(`[data-action="like"][data-id="${id}"]`)) {
    b.classList.toggle('on', !!lib.likes[id]);
    $('use', b).setAttribute('href', `#i-${lib.likes[id] ? 'heart-fill' : 'heart'}`);
  }
  toast(lib.likes[id] ? 'Added to Liked talks' : 'Removed from Liked talks');
}

function toggleFollow(tid) {
  const on = !isPinned(tid);
  lib.pins = on ? [...lib.pins, tid] : lib.pins.filter(id => id !== tid);
  save();
  renderFollowing();
  for (const b of $$(`[data-action="follow"][data-teacher="${tid}"]`)) {
    if (b.classList.contains('card-pin')) {
      b.classList.toggle('on', on);
      b.title = on ? 'Unpin' : 'Pin to sidebar';
      $('use', b).setAttribute('href', `#i-${on ? 'pin-fill' : 'pin'}`);
    } else {
      b.outerHTML = pinButton(tid, b.getAttribute('style') || '');
    }
  }
  toast(`${on ? 'Pinned' : 'Unpinned'} ${teacherName(tid)}`);
}

function enqueue(id) {
  if (!current) return startQueue([id], 0);
  lib.queue.push(id);
  save();
  renderQueue();
  toast('Added to queue');
}

let dlPoll = null;
async function refreshDownloads() {
  const before = dl;
  dl = await getJSON('/api/downloads');
  const changed = new Set([...Object.keys(before.active), ...Object.keys(dl.active)]);
  for (const id of changed) if (!!before.active[id] !== !!dl.active[id]) refreshTalk(+id);
  for (const id of Object.keys(before.active)) {
    if (!dl.active[id]) {
      updateDownloadButtons(+id);
      toast(dl.done[id] ? `Downloaded “${DB.talks.get(+id)?.title}”` : 'Download failed');
    }
  }
  if (Object.keys(dl.active).length && !dlPoll) dlPoll = setInterval(refreshDownloads, 1200);
  if (!Object.keys(dl.active).length && dlPoll) { clearInterval(dlPoll); dlPoll = null; }
}
function updateDownloadButtons(id) {
  const d = dlState(id);
  for (const b of $$(`.actionbar [data-action="download"][data-id="${id}"]`)) {
    b.classList.toggle('on', d === 'done');
    b.classList.toggle('busy', d === 'active');
    $('use', b).setAttribute('href', `#i-${d === 'done' ? 'downloaded' : 'download'}`);
  }
}
async function toggleDownload(id) {
  if (dl.active[id]) return;
  if (dl.done[id]) {
    await fetch(`/api/downloads/${id}`, { method: 'DELETE' });
    delete dl.done[id];
    toast('Removed download');
  } else {
    await fetch(`/api/downloads/${id}`, { method: 'POST' });
    dl.active[id] = { received: 0 };
    toast('Downloading…');
  }
  refreshTalk(id);
  updateDownloadButtons(id);
  refreshDownloads();
}

async function resync() {
  toast('Checking Dharma Seed for new talks…');
  await fetch('/api/sync', { method: 'POST' });
  let s;
  do { await sleep(1000); s = await getJSON('/api/status'); } while (s.sync.running);
  if (s.sync.error) return toast(`Sync failed: ${s.sync.error}`);
  const before = DB.talks.size;
  await loadCatalog();
  renderCatalogInfo();
  rerender();
  const added = DB.talks.size - before;
  toast(added > 0 ? `${plural(added, 'new talk')} added` : 'Already up to date');
}

function closeMenus() { $('#sleep-menu').hidden = true; $('#speed-menu').hidden = true; }
function toggleShortcuts() { const s = $('#shortcuts'); s.hidden = !s.hidden; }

function handleAction(el, e) {
  const a = el.dataset.action;
  const holder = el.closest('[data-id]');
  const id = Number(el.dataset.id || holder?.dataset.id);
  switch (a) {
    case 'play-row': {
      const L = lists.get(el.closest('[data-list]').dataset.list);
      if (current === id) return togglePlay();
      return startQueue(L.ids, L.ids.indexOf(id));
    }
    case 'play-talk': return current === id ? togglePlay() : startQueue([id], 0);
    case 'play-teacher': {
      const t = DB.teachers.get(+el.dataset.teacher);
      return t && startQueue(t.talks.map(x => x.id), 0);
    }
    case 'shuffle-teacher': {
      const ids = DB.teachers.get(+el.dataset.teacher).talks.map(x => x.id);
      for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      return startQueue(ids, 0);
    }
    case 'play-retreat': {
      const r = DB.retreats.get(+el.dataset.retreat);
      return r && startQueue(r.talks.map(x => x.id), 0);
    }
    case 'download-retreat': {
      const r = DB.retreats.get(+el.dataset.retreat);
      const todo = r.talks.filter(t => !dlState(t.id));
      toast(todo.length ? `Downloading ${plural(todo.length, 'talk')}…` : 'Already downloaded');
      return Promise.all(todo.map(t => fetch(`/api/downloads/${t.id}`, { method: 'POST' })))
        .then(() => { todo.forEach(t => { dl.active[t.id] = { received: 0 }; refreshTalk(t.id); }); return refreshDownloads(); });
    }
    case 'play-page': {
      const L = lists.get($('[data-list]', view()).dataset.list);
      return startQueue(L.ids, 0);
    }
    case 'play-search': return startQueue(searchState.lastTalks, 0);
    case 'like': return toggleLike(id);
    case 'follow': return toggleFollow(+el.dataset.teacher);
    case 'enqueue': return enqueue(id);
    case 'download': return toggleDownload(id);
    case 'toggle': return togglePlay();
    case 'prev': return prev();
    case 'next': return next();
    case 'back': return skip(-15);
    case 'fwd': return skip(30);
    case 'speed-menu':
    case 'sleep-menu': {
      const m = $(a === 'speed-menu' ? '#speed-menu' : '#sleep-menu');
      const open = m.hidden;
      closeMenus();
      m.hidden = !open;
      return;
    }
    case 'speed-step': return nudgeRate(+el.dataset.d);
    case 'speed-set': return setRate(+el.dataset.r, true);
    case 'mute': return setVolume(audio.volume ? 0 : (lib.prefs.lastVol || 1), true);
    case 'mini': return toggleMini();
    case 'shortcuts': return toggleShortcuts();
    case 'close-shortcuts': if (e.target === el || e.target.closest('.sc-close')) $('#shortcuts').hidden = true; return;
    case 'sleep': closeMenus(); return setSleep(el.dataset.min);
    case 'toggle-queue': {
      const p = $('#queue-panel');
      p.hidden = !p.hidden;
      $('#queue-btn').classList.toggle('on', !p.hidden);
      return renderQueue();
    }
    case 'clear-queue':
      lib.queue = current ? [current] : [];
      lib.qi = current ? 0 : -1;
      save();
      return renderQueue();
    case 'q-play': {
      if (e.target.closest('[data-action="q-remove"]')) return;
      lib.qi = +el.dataset.qi;
      return loadTrack(true);
    }
    case 'q-remove':
      lib.queue.splice(+el.dataset.qi, 1);
      save();
      return renderQueue();
    case 'bio': {
      const bio = $('#bio');
      bio.classList.toggle('clamp');
      el.textContent = bio.classList.contains('clamp') ? 'Read more' : 'Show less';
      return;
    }
    case 'search-tab':
      searchState.tab = el.dataset.val;
      history.replaceState(null, '', `#/search?q=${encodeURIComponent(searchState.q)}${searchState.tab !== 'all' ? `&tab=${searchState.tab}` : ''}`);
      return renderSearch();
    case 'search-len':
      searchState.len = el.dataset.val;
      return renderSearch();
    case 'topic':
      $('#search-input').value = el.dataset.q;
      searchState.q = el.dataset.q;
      history.replaceState(null, '', `#/search?q=${encodeURIComponent(el.dataset.q)}`);
      return renderSearch();
    case 'resync': return resync();
  }
}

document.addEventListener('click', e => {
  const actionEl = e.target.closest('[data-action]');
  if (!e.target.closest('.menu-wrap')) closeMenus();
  if (actionEl) { e.preventDefault(); return handleAction(actionEl, e); }
  if (e.target.closest('a')) return;
  const nav = e.target.closest('[data-href]');
  if (nav) location.hash = nav.dataset.href;
});

document.addEventListener('dblclick', e => {
  const row = e.target.closest('.trow[data-id]');
  if (row && !e.target.closest('button, a')) handleAction($('[data-action="play-row"]', row), e);
});

// Keep buttons from grabbing focus on click, so Space always means play/pause.
document.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });

function onKey(e) {
  const typing = e.target.matches?.('input:not([type=range]), textarea, select');
  if (e.key === 'Escape') { closeMenus(); $('#shortcuts').hidden = true; if (typing) e.target.blur(); return; }
  if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) {
    e.preventDefault();
    window.focus();
    if (!location.hash.startsWith('#/search')) location.hash = '#/search';
    else $('#search-input')?.focus();
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const actions = {
    ' ': togglePlay, k: togglePlay,
    ArrowLeft: () => e.shiftKey ? prev() : skip(-15), j: () => skip(-15),
    ArrowRight: () => e.shiftKey ? next() : skip(30), l: () => skip(30),
    '+': () => nudgeRate(0.1), '=': () => nudgeRate(0.1),
    '-': () => nudgeRate(-0.1), '_': () => nudgeRate(-0.1),
    '>': () => nudgeRate(0.25), '<': () => nudgeRate(-0.25),
    r: () => setRate(1, true),
    ArrowUp: () => setVolume(audio.volume + 0.05, true), ArrowDown: () => setVolume(audio.volume - 0.05, true),
    m: () => setVolume(audio.volume ? 0 : (lib.prefs.lastVol || 1), true),
    n: next, p: prev, i: toggleMini, '?': toggleShortcuts,
  };
  if (actions[key]) { e.preventDefault(); actions[key](); }
  else if (/^[0-9]$/.test(key) && current) { audio.currentTime = durOf() * key / 10; osd(`${key}0%`); }
}
document.addEventListener('keydown', onKey);
window.addEventListener('pagehide', () => { saveProgress(); flush(); });
window.addEventListener('hashchange', route);

// ---------- boot ----------

async function boot() {
  const phase = $('#boot-phase'), fill = $('#boot-fill');
  for (;;) {
    let s;
    try { s = await getJSON('/api/status'); } catch { phase.textContent = 'Waiting for the local server…'; await sleep(1000); continue; }
    if (s.ready) break;
    const { sync } = s;
    phase.textContent = sync.error ? `Sync error: ${sync.error} — retrying` :
      sync.total ? `${sync.phase} · ${sync.done.toLocaleString()} / ${sync.total.toLocaleString()}` : sync.phase || 'Starting…';
    fill.style.width = sync.total ? `${(sync.done / sync.total) * 100}%` : '4%';
    if (sync.error && !sync.running) fetch('/api/sync', { method: 'POST' });
    await sleep(sync.error ? 4000 : 600);
  }
  phase.textContent = 'Loading library…';
  fill.style.width = '100%';
  [lib] = await Promise.all([getJSON('/api/library'), loadCatalog()]);
  lib = { likes: {}, follows: {}, progress: {}, history: [], queue: [], qi: -1, prefs: {}, ...lib };
  lib.pins ||= Object.entries(lib.follows).sort((a, b) => a[1] - b[1]).map(([id]) => +id);
  dl = { done: lib.downloads || {}, active: {} };
  refreshDownloads();
  $('#boot').hidden = true;
  $('#app').hidden = false;
  renderFollowing();
  initPinDrag();
  renderCatalogInfo();
  setInterval(renderCatalogInfo, 60000);
  initPlayer();
  route();
}

boot();
