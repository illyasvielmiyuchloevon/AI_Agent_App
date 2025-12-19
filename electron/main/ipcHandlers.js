const { ipcMain, dialog, BrowserWindow } = require('electron');
const recentStore = require('./recentStore');
const { createWorkspaceService } = require('./workspaceService');

const workspaceService = createWorkspaceService();

function registerIpcHandlers() {
  const getWindowFromEvent = (event) => {
    try {
      return BrowserWindow.fromWebContents(event.sender);
    } catch {
      return null;
    }
  };

  ipcMain.handle('recent:list', async () => {
    return { ok: true, items: recentStore.list() };
  });

  ipcMain.handle('recent:remove', async (_event, id) => {
    recentStore.remove(String(id || ''));
    return { ok: true };
  });

  ipcMain.handle('workspace:pickFolder', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths.length) {
      return { ok: true, canceled: true, fsPath: '' };
    }
    return { ok: true, canceled: false, fsPath: res.filePaths[0] };
  });

  ipcMain.handle('workspace:pickFile', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths.length) {
      return { ok: true, canceled: true, fsPath: '' };
    }
    return { ok: true, canceled: false, fsPath: res.filePaths[0] };
  });

  ipcMain.handle('workspace:open', async (_event, payload) => {
    const id = payload && payload.id ? String(payload.id) : '';
    if (!id) return { ok: false, error: 'workspace:open missing id' };
    const fsPath = payload && payload.fsPath ? String(payload.fsPath) : '';
    const name = payload && payload.name ? String(payload.name) : '';
    try {
      await workspaceService.start({ fsPath });
    } catch {
      // ignore lifecycle errors (placeholder service)
    }
    const recent = recentStore.touch({ id, fsPath, name });
    return { ok: true, recent };
  });

  ipcMain.handle('workspace:close', async () => {
    try {
      await workspaceService.stop();
    } catch {
      // ignore lifecycle errors
    }
    return { ok: true };
  });

  ipcMain.handle('window:minimize', (event) => {
    const win = getWindowFromEvent(event);
    if (win) win.minimize();
    return { ok: true };
  });

  ipcMain.handle('window:toggleMaximize', (event) => {
    const win = getWindowFromEvent(event);
    if (!win) return { ok: true, maximized: false };
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
    return { ok: true, maximized: win.isMaximized() };
  });

  ipcMain.handle('window:isMaximized', (event) => {
    const win = getWindowFromEvent(event);
    return { ok: true, maximized: !!win?.isMaximized?.() };
  });

  ipcMain.handle('window:close', (event) => {
    const win = getWindowFromEvent(event);
    if (win) win.close();
    return { ok: true };
  });
}

module.exports = { registerIpcHandlers };
