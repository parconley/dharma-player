// Desktop shell: runs the local server in-process and shows the player in its own window.
const { app, BrowserWindow, Menu, nativeTheme, shell } = require('electron');
const path = require('path');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  process.env.DHARMA_DATA = path.join(app.getPath('userData'), 'data');
  process.env.PORT = process.env.PORT || '0';
  const server = require('../server.js');

  let win = null;
  let closing = false;

  function createWindow(port) {
    const origin = `http://127.0.0.1:${port}`;
    nativeTheme.themeSource = 'dark';
    win = new BrowserWindow({
      width: 1360,
      height: 880,
      minWidth: 720,
      minHeight: 520,
      title: 'Dharma Player',
      backgroundColor: '#0e0d0b',
      icon: path.join(__dirname, '..', 'public', 'icon.ico'),
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    win.once('ready-to-show', () => win.show());
    win.loadURL(`${origin}/`);

    // Links to dharmaseed.org, teacher websites, etc. open in the normal browser.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith(origin) || url === 'about:blank') return { action: 'allow' };
      if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (url.startsWith(origin)) return;
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    });

    // Let the page save the current position before the window goes away.
    win.on('close', e => {
      if (closing) return;
      e.preventDefault();
      closing = true;
      win.webContents.executeJavaScript('try { saveProgress(); flush(); } catch {}', true)
        .catch(() => {})
        .finally(() => setTimeout(() => win.destroy(), 400));
    });
  }

  Menu.setApplicationMenu(null);
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { try { server.flushSync(); } catch {} });
  app.whenReady().then(() => server.ready).then(createWindow);
}
