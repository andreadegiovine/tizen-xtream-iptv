/*
 * Electron main process of the desktop app: one window showing the built app (dist/, served as app://xtream/ so that workers and
 * IndexedDB have a normal origin), full screen, the 1920x1080 interface scaled to the window.
 *
 * Network: the Xtream servers send no CORS headers and are often plain http, so the page runs with webSecurity off (no CORS, no mixed
 * content block), as a TV app does. The page only ever comes from the app's own files: navigation elsewhere is blocked and window.open
 * (trailers, links) goes to the system browser.
 */
const path = require('path');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, protocol, net, shell, screen } = require('electron');

const SCHEME = 'app';
const ORIGIN = `${SCHEME}://xtream`;
// Packaged: the build sits next to this file (app/); from the repository: dist/.
const ROOT = app.isPackaged ? path.join(__dirname, 'app') : path.resolve(__dirname, '..', '..', '..', 'dist');
const DESIGN = { width: 1920, height: 1080 };

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

/** app://xtream/<path> → the file under ROOT (never outside it). */
function serveFile(request) {
  const { pathname } = new URL(request.url);
  const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return new Response('Not found', { status: 404 });
  return net.fetch(pathToFileURL(file).toString());
}

function createWindow() {
  // As large as the screen from the start (full screen): the first zoom is already the right one.
  const { width, height } = screen.getPrimaryDisplay().size;
  const win = new BrowserWindow({
    width,
    height,
    fullscreen: true,
    backgroundColor: '#0c0c12',
    autoHideMenuBar: true,
    icon: path.join(ROOT, 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: false },
  });
  win.removeMenu();
  // The interface is drawn for 1920x1080: the zoom makes it fit the window (and the screen in full screen).
  const fit = () => {
    const [width, height] = win.getContentSize();
    win.webContents.setZoomFactor(Math.max(0.25, Math.min(width / DESIGN.width, height / DESIGN.height)));
  };
  win.on('resize', fit);
  win.on('resized', fit);
  win.on('enter-full-screen', fit);
  win.on('leave-full-screen', fit);
  win.webContents.on('did-finish-load', fit);
  // F11 switches full screen; F12 opens the developer tools.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'F12') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault();
  });
  win.loadURL(`${ORIGIN}/index.html`);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    protocol.handle(SCHEME, serveFile);
    createWindow();
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });
  app.on('window-all-closed', () => app.quit());
}
