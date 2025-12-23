const { ipcMain, dialog, BrowserWindow, screen } = require('electron');
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

  ipcMain.handle('window:applySnapLayout', (event, payload) => {
    const win = getWindowFromEvent(event);
    if (!win) return { ok: false, error: 'window not found' };
    const layoutId = payload && payload.layoutId ? String(payload.layoutId) : '';
    const zoneIndex = Number(payload && payload.zoneIndex);
    if (!layoutId || Number.isNaN(zoneIndex)) {
      return { ok: false, error: 'invalid snap payload' };
    }

    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const area = display.workArea;
    const layouts = {
      halves: (workArea) => {
        const leftWidth = Math.floor(workArea.width / 2);
        return [
          { x: workArea.x, y: workArea.y, width: leftWidth, height: workArea.height },
          { x: workArea.x + leftWidth, y: workArea.y, width: workArea.width - leftWidth, height: workArea.height },
        ];
      },
      thirds: (workArea) => {
        const first = Math.floor(workArea.width / 3);
        const second = Math.floor(workArea.width / 3);
        const third = workArea.width - first - second;
        return [
          { x: workArea.x, y: workArea.y, width: first, height: workArea.height },
          { x: workArea.x + first, y: workArea.y, width: second, height: workArea.height },
          { x: workArea.x + first + second, y: workArea.y, width: third, height: workArea.height },
        ];
      },
      grid: (workArea) => {
        const halfWidth = Math.floor(workArea.width / 2);
        const halfHeight = Math.floor(workArea.height / 2);
        return [
          { x: workArea.x, y: workArea.y, width: halfWidth, height: halfHeight },
          { x: workArea.x + halfWidth, y: workArea.y, width: workArea.width - halfWidth, height: halfHeight },
          { x: workArea.x, y: workArea.y + halfHeight, width: halfWidth, height: workArea.height - halfHeight },
          { x: workArea.x + halfWidth, y: workArea.y + halfHeight, width: workArea.width - halfWidth, height: workArea.height - halfHeight },
        ];
      },
    };
    const zones = layouts[layoutId] ? layouts[layoutId](area) : null;
    const zone = zones && zones[zoneIndex];
    if (!zone) return { ok: false, error: 'unknown snap layout' };
    if (win.isMaximized()) win.unmaximize();
    win.setBounds(zone);
    return { ok: true, bounds: zone, displayId: display.id };
  });

  ipcMain.handle('window:close', (event) => {
    const win = getWindowFromEvent(event);
    if (win) win.close();
    return { ok: true };
  });
}

module.exports = { registerIpcHandlers };
