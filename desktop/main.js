'use strict';

// Game Together para o computador: uma janela própria com o site dentro.
// O conteúdo vem do site, então o app se atualiza sozinho junto com ele.

const { app, BrowserWindow, shell, Menu, dialog, net } = require('electron');
const path = require('path');

const SITE = process.env.GT_SITE || 'https://gametogether.com.br/';
const SITE_ORIGIN = new URL(SITE).origin;
const RETRY_MS = 5000;

app.setAppUserModelId('br.com.gametogether.desktop');

// uma janela só: abrir o app de novo traz a que já existe
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let retryTimer = null;

  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });

  function clearRetry() { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } }

  const log = (...a) => { if (process.env.GT_DEBUG) { try { require('fs').appendFileSync(process.env.GT_DEBUG, new Date().toISOString() + ' ' + a.join(' ') + '\n'); } catch (_) {} } };
  // O site é um PWA: depois da primeira visita o navegador guarda a página e a mostra
  // mesmo com o servidor dormindo. Por isso, antes de abrir, perguntamos ao servidor
  // se ele está de pé; se não estiver, fica a tela de espera e tentamos de novo.
  async function serverUp() {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await net.fetch(SITE + 'api/version', { signal: ctl.signal, cache: 'no-store' });
      return r.ok;
    } catch (_) { return false; } finally { clearTimeout(t); }
  }

  let waitingShown = false;
  async function loadSite() {
    clearRetry();
    if (!win) return;
    log('conferindo', SITE);
    const up = await serverUp();
    if (!win) return;
    if (!up) { log('servidor não respondeu'); showWaiting('down'); return; }
    waitingShown = false;
    log('abrindo', SITE);
    win.loadURL(SITE).catch((err) => log('loadURL falhou', err && err.message));
  }

  function showWaiting(reason) {
    if (!win) return;
    if (!waitingShown) {
      waitingShown = true;
      win.loadFile(path.join(__dirname, 'loading.html'), { query: { reason: reason || '' } }).catch(() => {});
    }
    clearRetry();
    retryTimer = setTimeout(loadSite, RETRY_MS);
  }

  function createWindow() {
    win = new BrowserWindow({
      width: 1120,
      height: 760,
      minWidth: 420,
      minHeight: 600,
      title: 'Game Together',
      icon: path.join(__dirname, 'icon.png'),
      backgroundColor: '#15130f',
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    Menu.setApplicationMenu(null);

    // o site precisa do microfone; nada mais é liberado
    const ses = win.webContents.session;
    const allow = (permission, origin) => {
      const sameSite = !origin || origin.startsWith(SITE_ORIGIN) || origin.startsWith('file://');
      return sameSite && (permission === 'media' || permission === 'notifications' || permission === 'clipboard-sanitized-write');
    };
    ses.setPermissionRequestHandler((wc, permission, cb, details) => cb(allow(permission, details && details.requestingUrl)));
    ses.setPermissionCheckHandler((wc, permission, origin) => allow(permission, origin));

    // links para fora (GitHub, lojas) abrem no navegador do sistema
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (!url.startsWith(SITE)) shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (url.startsWith('gt://')) { e.preventDefault(); loadSite(); return; } // botão "tentar agora" da tela de espera
      if (!url.startsWith(SITE) && !url.startsWith('file://')) { e.preventDefault(); shell.openExternal(url).catch(() => {}); }
    });

    // servidor acordando ou sem internet: tela de espera e nova tentativa sozinha
    win.webContents.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
      log('did-fail-load', code, desc, url, isMainFrame);
      if (!isMainFrame || code === -3 /* abortado por outra navegação */) return;
      waitingShown = false;
      showWaiting(desc);
    });
    win.webContents.on('did-finish-load', () => {
      const url = win.webContents.getURL();
      if (url.startsWith(SITE)) clearRetry();
    });
    win.webContents.on('render-process-gone', () => { waitingShown = false; showWaiting('render'); });
    win.on('closed', () => { clearRetry(); win = null; });

    loadSite();
  }

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch((err) => { dialog.showErrorBox('Game Together', String(err && err.message || err)); app.quit(); });

  app.on('window-all-closed', () => app.quit());
}
