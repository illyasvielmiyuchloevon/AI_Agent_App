const { ipcMain, dialog, BrowserWindow, screen, app, shell } = require('electron');
const path = require('path');
const recentStore = require('./recentStore');
const { createWorkspaceService } = require('./workspaceService');
const { createLspBroadcaster, createLspMainService } = require('./lsp');
const { LanguagePluginRegistry } = require('./lsp/plugins/LanguagePluginRegistry');
const { PluginInstaller } = require('./lsp/plugins/PluginInstaller');
const { LanguagePluginManager } = require('./lsp/plugins/LanguagePluginManager');
const { OfficialCatalogProvider } = require('./lsp/plugins/providers/OfficialCatalogProvider');
const { OpenVsxProvider } = require('./lsp/plugins/providers/OpenVsxProvider');
const { GitHubReleasesProvider } = require('./lsp/plugins/providers/GitHubReleasesProvider');
const { createPluginIpcService } = require('./lsp/plugins/PluginIpcService');
const { registerIdeBus } = require('./ideBus/registerIdeBus');
const { ExtensionHostService } = require('./extensions/ExtensionHostService');
const { createDapMainService } = require('./dap/DapMainService');

const workspaceService = createWorkspaceService();
const lspBroadcaster = createLspBroadcaster();
const extensionHostService = new ExtensionHostService({ workspaceService, recentStore });

function registerIpcHandlers() {
  const isDev = process.env.VITE_DEV_SERVER_URL || !app.isPackaged;

  registerIdeBus({ ipcMain, workspaceService, recentStore, extensionHostService });
  extensionHostService.start().catch(() => {});

  const getWindowFromEvent = (event) => {
    try {
      return BrowserWindow.fromWebContents(event.sender);
    } catch {
      return null;
    }
  };

  ipcMain.handle('app:getInfo', async () => {
    return {
      ok: true,
      name: app.getName(),
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    };
  });

  // LSP (JSON-RPC over stdio) - main process owns I/O and protocol work.
  // Language plugins: marketplace + installer + registry (shared across windows).
  const pluginsRootDir = path.join(app.getPath('userData'), 'language-plugins');
  const registry = new LanguagePluginRegistry({ registryPath: path.join(pluginsRootDir, 'registry.json') });
  const installer = new PluginInstaller({ pluginsRootDir, downloadsDir: path.join(pluginsRootDir, 'downloads') });

  const githubProvider = new GitHubReleasesProvider({
    known: [
      {
        id: 'rust-analyzer',
        name: 'rust-analyzer',
        description: 'rust-analyzer from GitHub releases (binary).',
        repo: 'rust-lang/rust-analyzer',
        trust: 'community',
        languages: ['rust'],
        selectAsset: (release) => {
          const assets = Array.isArray(release?.assets) ? release.assets : [];
          const platform = process.platform;
          const arch = process.arch;
          const wantArch = arch === 'arm64' ? 'aarch64' : 'x86_64';

          const patterns = [];
          if (platform === 'win32') patterns.push(`${wantArch}-pc-windows-msvc`);
          else if (platform === 'darwin') patterns.push(`${wantArch}-apple-darwin`);
          else patterns.push(`${wantArch}-unknown-linux-gnu`);

          const pick = assets.find((a) => patterns.some((p) => String(a?.name || '').includes(p)) && String(a?.browser_download_url || '').startsWith('http'));
          if (!pick) return null;
          return { url: String(pick.browser_download_url), version: '' };
        },
        manifest: {
          servers: [
            {
              id: 'rust-analyzer',
              languageIds: ['rust'],
              fileExtensions: ['.rs'],
              transport: { kind: 'stdio', command: 'rust-analyzer${EXE}', args: [] },
            },
          ],
        },
      },
    ],
  });

  const pluginManager = new LanguagePluginManager({
    registry,
    installer,
    providers: [
      new OfficialCatalogProvider({ catalogPath: path.join(__dirname, 'lsp', 'plugins', 'officialCatalog.json') }),
      githubProvider,
      new OpenVsxProvider(),
    ],
  });

  const pluginsReady = pluginManager.init().catch(() => {});
  createPluginIpcService({ ipcMain, pluginManager, broadcast: lspBroadcaster.broadcast, ready: pluginsReady });

  createLspMainService({ ipcMain, broadcast: lspBroadcaster.broadcast, plugins: { manager: pluginManager, ready: pluginsReady } });
  createDapMainService({ ipcMain, broadcast: lspBroadcaster.broadcast, workspaceService, recentStore });

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
    try { await extensionHostService.restart('workspace:open'); } catch {}
    return { ok: true, recent };
  });

  ipcMain.handle('workspace:close', async () => {
    try {
      await workspaceService.stop();
    } catch {
      // ignore lifecycle errors
    }
    try { await extensionHostService.restart('workspace:close'); } catch {}
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

  ipcMain.handle('window:openDevTools', (event) => {
    const win = getWindowFromEvent(event);
    if (!win?.webContents) return { ok: false, error: 'window not found' };
    try {
      if (!win.webContents.isDevToolsOpened()) {
        win.webContents.openDevTools({ mode: 'right' });
      }
      return { ok: true, opened: win.webContents.isDevToolsOpened() };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('window:toggleDevTools', (event) => {
    const win = getWindowFromEvent(event);
    if (!win?.webContents) return { ok: false, error: 'window not found' };
    try {
      if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
      else win.webContents.openDevTools({ mode: 'right' });
      return { ok: true, opened: win.webContents.isDevToolsOpened() };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
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

  ipcMain.handle('shell:showItemInFolder', async (_event, fsPath) => {
    const target = String(fsPath || '').trim();
    if (!target) return { ok: false, error: 'missing path' };
    try {
      shell.showItemInFolder(target);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('shell:openPath', async (_event, fsPath) => {
    const target = String(fsPath || '').trim();
    if (!target) return { ok: false, error: 'missing path' };
    try {
      const res = await shell.openPath(target);
      if (res) return { ok: false, error: String(res) };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('window:openNewWindow', async (_event, payload) => {
    const openFile = payload && payload.openFile ? String(payload.openFile) : '';
    const openMode = payload && payload.openMode ? String(payload.openMode) : '';
    const workspaceFsPath = '';
    const newWindow = !openFile;

    const win = new BrowserWindow({
      width: 1400,
      height: 800,
      frame: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    try {
      if (isDev && process.env.VITE_DEV_SERVER_URL) {
        const url = new URL(process.env.VITE_DEV_SERVER_URL);
        if (openFile) url.searchParams.set('openFile', openFile);
        if (openMode) url.searchParams.set('openMode', openMode);
        if (workspaceFsPath) url.searchParams.set('workspaceFsPath', workspaceFsPath);
        if (newWindow) url.searchParams.set('newWindow', '1');
        await win.loadURL(url.toString());
      } else {
        const indexPath = path.join(__dirname, '../../frontend/dist/index.html');
        await win.loadFile(indexPath, {
          query: {
            ...(openFile ? { openFile } : {}),
            ...(openMode ? { openMode } : {}),
            ...(workspaceFsPath ? { workspaceFsPath } : {}),
            ...(newWindow ? { newWindow: '1' } : {}),
          },
        });
      }
      win.focus();
      return { ok: true };
    } catch (err) {
      try { win.close(); } catch {}
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('window:openTerminalWindow', async (_event, payload) => {
    const workspaceFsPath = payload && payload.workspaceFsPath ? String(payload.workspaceFsPath) : '';
    const terminalProfile = payload && payload.terminalProfile ? String(payload.terminalProfile) : '';

    const win = new BrowserWindow({
      width: 980,
      height: 620,
      frame: true,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    try {
      if (isDev && process.env.VITE_DEV_SERVER_URL) {
        const url = new URL(process.env.VITE_DEV_SERVER_URL);
        url.searchParams.set('terminalWindow', '1');
        if (workspaceFsPath) url.searchParams.set('workspaceFsPath', workspaceFsPath);
        if (terminalProfile) url.searchParams.set('terminalProfile', terminalProfile);
        await win.loadURL(url.toString());
      } else {
        const indexPath = path.join(__dirname, '../../frontend/dist/index.html');
        await win.loadFile(indexPath, {
          query: {
            terminalWindow: '1',
            ...(workspaceFsPath ? { workspaceFsPath } : {}),
            ...(terminalProfile ? { terminalProfile } : {}),
          },
        });
      }
      win.focus();
      return { ok: true };
    } catch (err) {
      try { win.close(); } catch {}
      return { ok: false, error: err?.message || String(err) };
    }
  });
}

module.exports = { registerIpcHandlers };
