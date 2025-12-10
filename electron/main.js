const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } = require('electron');
const path = require('path');

const isDev = process.env.VITE_DEV_SERVER_URL || !app.isPackaged;

const getOverlayColors = (theme = 'light') => {
  const isDark = theme === 'dark';
  return {
    color: isDark ? '#252526' : '#ffffff',
    symbolColor: isDark ? '#e5e7eb' : '#111827',
    height: 40,
  };
};

const applyOverlayTheme = (win, theme) => {
  if (!win?.setTitleBarOverlay) return;
  const overlay = getOverlayColors(theme);
  win.setTitleBarOverlay(overlay);
};

// Remove native application menu
Menu.setApplicationMenu(null);

function createWindow() {
  const initialTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  const overlay = getOverlayColors(initialTheme);

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    titleBarStyle: 'hidden',
    titleBarOverlay: overlay,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  applyOverlayTheme(win, initialTheme);

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.join(__dirname, '../frontend/dist/index.html');
    win.loadFile(indexPath);
  }
}

app.whenReady().then(() => {
  ipcMain.handle('open-folder', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return '';
    return res.filePaths[0];
  });

  ipcMain.on('renderer-theme-updated', (event, theme) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const nextTheme = theme === 'dark' ? 'dark' : 'light';
    nativeTheme.themeSource = nextTheme;
    applyOverlayTheme(win, nextTheme);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
