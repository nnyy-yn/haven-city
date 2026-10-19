'use strict';

const { app, BrowserWindow, dialog, ipcMain, net, protocol, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { readReleaseConfig } = require('./release-settings.cjs');
const { createUpdateController } = require('./update-controller.cjs');
const { checkPortableRelease } = require('./portable-release.cjs');

const GAME_ROOT = path.join(__dirname, 'game');
const GAME_URL = 'haven://game/index.html';
const release = readReleaseConfig();
if (process.env.HAVEN_TEST_MODE === '1' && process.env.HAVEN_TEST_USER_DATA) app.setPath('userData', path.resolve(process.env.HAVEN_TEST_USER_DATA));
let mainWindow;
let updates;

protocol.registerSchemesAsPrivileged([{ scheme: 'haven', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setName('栖湾市');

function isGameUrl(value) {
  try { const url = new URL(value); return url.protocol === 'haven:' && url.hostname === 'game' && url.pathname === '/index.html' && !url.username && !url.password && !url.port; }
  catch { return false; }
}

function assertLocalSender(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || !isGameUrl(event.senderFrame.url)) {
    throw new Error('更新请求只允许来自本地游戏窗口。');
  }
}

function isReleaseUrl(value) {
  if (!release.configured) return false;
  try {
    const url = new URL(value);
    const rootPath = `/${release.owner}/${release.repo}/releases`;
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && !url.port && (url.pathname === rootPath || url.pathname.startsWith(`${rootPath}/`));
  } catch { return false; }
}

function registerGameProtocol() {
  protocol.handle('haven', request => {
    try {
      const url = new URL(request.url);
      if (request.method !== 'GET' || url.hostname !== 'game' || url.username || url.password || url.port) return new Response('Forbidden', { status: 403 });
      const pathname = decodeURIComponent(url.pathname);
      const target = path.resolve(GAME_ROOT, `.${pathname}`);
      const relative = path.relative(GAME_ROOT, target);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.statSync(target).isFile()) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(target).href);
    } catch { return new Response('Not found', { status: 404 }); }
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith('haven://game/')) return callback({ responseHeaders: details.responseHeaders });
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'"] } });
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(contents === mainWindow?.webContents && isGameUrl(details.requestingUrl || contents.getURL()) && ['pointerLock', 'fullscreen'].includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin) => contents === mainWindow?.webContents && requestingOrigin === 'haven://game' && ['pointerLock', 'fullscreen'].includes(permission));
}

async function createWindow() {
  if (!fs.existsSync(path.join(GAME_ROOT, 'index.html'))) {
    await dialog.showMessageBox({ type: 'error', title: '缺少游戏文件', message: '请先将离线游戏复制到 desktop/game/index.html，再运行或打包。' });
    app.quit(); return;
  }
  mainWindow = new BrowserWindow({
    title: '栖湾市 · HAVEN CITY', width: 1440, height: 960, minWidth: 1024, minHeight: 720,
    backgroundColor: '#172d43', show: false,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, navigateOnDragDrop: false,
      additionalArguments: [`--haven-version=${app.getVersion()}`]
    }
  });
  mainWindow.setMenu(null);
  mainWindow.once('ready-to-show', () => { if (process.env.HAVEN_TEST_MODE !== '1') mainWindow?.show(); });
  mainWindow.on('closed', () => { mainWindow = undefined; });
  mainWindow.webContents.on('will-navigate', (event, url) => { if (!isGameUrl(url)) event.preventDefault(); });
  mainWindow.webContents.on('will-redirect', event => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isReleaseUrl(url)) void shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11' && !input.isAutoRepeat) { event.preventDefault(); mainWindow.setFullScreen(!mainWindow.isFullScreen()); }
  });
  await mainWindow.loadURL(GAME_URL);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    registerGameProtocol();
    updates = createUpdateController({
      release, isPackaged: app.isPackaged, isPortable: !!process.env.PORTABLE_EXECUTABLE_FILE,
      // Node fetch exposes manual redirect headers for the public release-page fallback.
      checkPortableRelease: () => checkPortableRelease(release, app.getVersion(), globalThis.fetch.bind(globalThis)),
      createUpdater: options => { const { NsisUpdater } = require('electron-updater'); return new NsisUpdater(options); },
      publish: state => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('haven:update:state', state); },
      openRelease: url => { if (!isReleaseUrl(url)) throw new Error('无效的发行页地址。'); return shell.openExternal(url); },
      confirmInstall: async () => {
        if (!mainWindow || mainWindow.isDestroyed()) return false;
        const result = await dialog.showMessageBox(mainWindow, { type: 'question', title: '安装更新', message: '保存游戏并重启安装更新？', detail: '当前城市和居民进度会先保存。', buttons: ['保存并重启', '取消'], defaultId: 1, cancelId: 1, noLink: true });
        return result.response === 0;
      },
      prepareInstall: async () => {
        if (!mainWindow || mainWindow.isDestroyed() || !isGameUrl(mainWindow.webContents.getURL())) throw new Error('游戏窗口已关闭，更新尚未安装。');
        const saved = await mainWindow.webContents.executeJavaScript("window.dispatchEvent(new Event('haven:before-update-install', { cancelable: true }))", true);
        if (saved !== true) throw new Error('存档失败，更新尚未安装；请导出存档或释放存储空间后重试。');
      }
    });
    for (const [channel, method] of [['haven:update:get', 'getState'], ['haven:update:check', 'checkForUpdates'], ['haven:update:download', 'downloadUpdate'], ['haven:update:install', 'installUpdate']]) {
      ipcMain.handle(channel, (event) => { assertLocalSender(event); return updates[method](); });
    }
    await createWindow();
  }).catch(error => { dialog.showErrorBox('栖湾市启动失败', error.message); app.quit(); });
  app.on('activate', () => { if (!mainWindow) void createWindow(); });
  app.on('window-all-closed', () => app.quit());
}
