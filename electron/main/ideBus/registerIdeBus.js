const { app, BrowserWindow, dialog, screen, shell } = require('electron');
const path = require('path');
const { JsonRpcConnection } = require('../lsp/jsonrpc/JsonRpcConnection');
const commandsService = require('../commands/commandsService');

class IpcMainTransport {
  constructor(webContents) {
    this.webContents = webContents;
    this._onMessage = null;
    this._onClose = null;
  }

  onMessage(handler) {
    this._onMessage = handler;
  }

  onClose(handler) {
    this._onClose = handler;
  }

  emitMessage(msg) {
    try {
      this._onMessage?.(msg);
    } catch {}
  }

  send(msg) {
    try {
      this.webContents.send('idebus:message', msg);
    } catch {}
  }

  close() {
    try {
      this._onClose?.();
    } catch {}
  }
}

function registerIdeBus({ ipcMain, workspaceService, recentStore } = {}) {
  if (!ipcMain) throw new Error('registerIdeBus: ipcMain is required');

  const connections = new Map();

  const ensureConnection = (event) => {
    const sender = event?.sender;
    const senderId = sender?.id;
    if (!sender || typeof senderId !== 'number') throw new Error('idebus: missing sender');
    const existing = connections.get(senderId);
    if (existing) return existing;

    const transport = new IpcMainTransport(sender);
    const connection = new JsonRpcConnection(transport, { name: `idebus:main:${senderId}`, traceMeta: true });

    const rpcStats = new Map();
    let traceConfig = {
      mode: 'slow',
      sampleRate: 0.05,
      slowDefaultMs: 200,
      thresholds: {
        'app/getInfo': 100,
        'commands/list': 150,
        'commands/execute': 250,
        'workspace/getTrust': 100,
        'workspace/setTrust': 150,
        'workspace/open': 1200,
        'workspace/close': 800,
        'window/minimize': 100,
        'window/toggleMaximize': 100,
        'window/isMaximized': 100,
        'window/openDevTools': 500,
        'window/toggleDevTools': 500,
        'window/applySnapLayout': 150,
        'window/openNewWindow': 300,
        'window/openTerminalWindow': 300,
        'window/close': 150,
        'shell/showItemInFolder': 250,
        'shell/openPath': 800,
      },
      ignore: [
        'initialize',
        'workspace/pickFolder',
        'workspace/pickFile',
        'telemetry/getRpcStats',
        'telemetry/resetRpcStats',
        'telemetry/getRpcTraceConfig',
        'telemetry/setRpcTraceConfig',
      ],
    };

    const appendOutput = (text) => {
      const line = String(text ?? '').trim();
      if (!line) return;
      transport.send({
        jsonrpc: '2.0',
        method: 'output/append',
        params: { channelId: 'IdeBus', label: 'IDE Bus', text: line, ts: Date.now() },
      });
    };

    const getThresholdMs = (method) => {
      if (!method) return Number(traceConfig.slowDefaultMs) || 0;
      const ignore = Array.isArray(traceConfig.ignore) ? traceConfig.ignore : [];
      if (ignore.includes(method)) return 0;
      const thresholds = traceConfig.thresholds && typeof traceConfig.thresholds === 'object' ? traceConfig.thresholds : {};
      const ms = thresholds[method];
      return typeof ms === 'number' && Number.isFinite(ms) ? ms : (Number(traceConfig.slowDefaultMs) || 0);
    };

    const recordStat = (evt) => {
      const method = evt?.method ? String(evt.method) : '';
      if (!method) return;
      const prev = rpcStats.get(method) || {
        method,
        count: 0,
        ok: 0,
        error: 0,
        timeout: 0,
        cancelled: 0,
        notFound: 0,
        totalMs: 0,
        maxMs: 0,
        lastMs: 0,
        lastAt: 0,
      };
      const dur = Number(evt?.durationMs) || 0;
      const outcome = evt?.outcome ? String(evt.outcome) : '';
      const next = { ...prev };
      next.count += 1;
      next.totalMs += dur;
      if (dur > next.maxMs) next.maxMs = dur;
      next.lastMs = dur;
      next.lastAt = Date.now();
      if (outcome === 'ok') next.ok += 1;
      else if (outcome === 'timeout') next.timeout += 1;
      else if (outcome === 'cancelled') next.cancelled += 1;
      else if (outcome === 'not_found') next.notFound += 1;
      else next.error += 1;
      rpcStats.set(method, next);
    };

    const shouldLog = (evt, thresholdMs) => {
      const mode = traceConfig?.mode ? String(traceConfig.mode) : 'slow';
      if (mode === 'off') return false;

      const outcome = evt?.outcome ? String(evt.outcome) : '';
      if (outcome && outcome !== 'ok') return true;

      const dur = Number(evt?.durationMs) || 0;
      if (mode === 'slow') return thresholdMs > 0 && dur >= thresholdMs;

      if (mode === 'all') {
        const rate = Number(traceConfig?.sampleRate);
        const safeRate = Number.isFinite(rate) ? Math.max(0, Math.min(1, rate)) : 0.05;
        return Math.random() < safeRate;
      }

      return false;
    };

    connection.on('trace', (evt) => {
      if (!evt || evt.kind !== 'request') return;
      if (evt.direction !== 'incoming') return;

      const method = evt?.method ? String(evt.method) : '';
      const ignore = Array.isArray(traceConfig.ignore) ? traceConfig.ignore : [];
      if (!method || ignore.includes(method)) return;

      recordStat(evt);

      const thresholdMs = getThresholdMs(method);
      if (!shouldLog(evt, thresholdMs)) return;

      const dur = Math.max(0, Math.round(Number(evt.durationMs) || 0));
      const outcome = evt?.outcome ? String(evt.outcome) : '';
      const traceId = evt?.traceId ? String(evt.traceId) : '';
      const shortTrace = traceId ? traceId.slice(-8) : '';
      const parts = ['[idebus]', method, outcome || 'done', `${dur}ms`];
      if (shortTrace) parts.push(`trace=${shortTrace}`);
      if (thresholdMs > 0 && dur >= thresholdMs) parts.push(`slow>=${thresholdMs}ms`);
      if (evt?.errorMessage) parts.push(String(evt.errorMessage).slice(0, 240));
      appendOutput(parts.join(' '));
    });

    const getWindow = () => {
      try {
        return BrowserWindow.fromWebContents(sender);
      } catch {
        return null;
      }
    };

    connection.onRequest('initialize', async (params) => {
      const protocolVersion = params?.protocolVersion ? String(params.protocolVersion) : '';
      const clientCapabilities = params?.clientCapabilities && typeof params.clientCapabilities === 'object' ? params.clientCapabilities : {};
      return {
        serverVersion: app.getVersion(),
        serverCapabilities: {
          protocolVersion: '1.0',
          transport: 'electron-ipc',
          clientProtocolVersion: protocolVersion,
          clientCapabilities,
          methods: [
            'app/getInfo',
            'workspace/pickFolder',
            'workspace/pickFile',
            'workspace/open',
            'workspace/close',
            'workspace/getTrust',
            'workspace/setTrust',
            'commands/list',
            'commands/execute',
            'telemetry/getRpcStats',
            'telemetry/resetRpcStats',
            'telemetry/getRpcTraceConfig',
            'telemetry/setRpcTraceConfig',
            'window/minimize',
            'window/toggleMaximize',
            'window/isMaximized',
            'window/openDevTools',
            'window/toggleDevTools',
            'window/applySnapLayout',
            'window/openNewWindow',
            'window/openTerminalWindow',
            'window/close',
            'shell/showItemInFolder',
            'shell/openPath',
          ],
        },
      };
    });

    connection.onRequest('telemetry/getRpcStats', async () => {
      const items = Array.from(rpcStats.values()).map((s) => ({
        method: s.method,
        count: s.count,
        ok: s.ok,
        error: s.error,
        timeout: s.timeout,
        cancelled: s.cancelled,
        notFound: s.notFound,
        avgMs: s.count ? Math.round((s.totalMs / s.count) * 10) / 10 : 0,
        maxMs: s.maxMs,
        lastMs: s.lastMs,
        lastAt: s.lastAt,
      }));
      items.sort((a, b) => (b.count - a.count) || (b.maxMs - a.maxMs) || a.method.localeCompare(b.method));
      return { ok: true, items, config: traceConfig };
    });

    connection.onRequest('telemetry/resetRpcStats', async () => {
      rpcStats.clear();
      return { ok: true };
    });

    connection.onRequest('telemetry/getRpcTraceConfig', async () => {
      return { ok: true, config: traceConfig };
    });

    connection.onRequest('telemetry/setRpcTraceConfig', async (payload) => {
      const next = payload && typeof payload === 'object' ? payload : {};
      const mode = next?.mode ? String(next.mode) : traceConfig.mode;
      const sampleRate = next?.sampleRate != null ? Number(next.sampleRate) : traceConfig.sampleRate;
      const slowDefaultMs = next?.slowDefaultMs != null ? Number(next.slowDefaultMs) : traceConfig.slowDefaultMs;
      const thresholds = next?.thresholds && typeof next.thresholds === 'object' ? next.thresholds : traceConfig.thresholds;
      const ignore = Array.isArray(next?.ignore) ? next.ignore.map((m) => String(m || '').trim()).filter(Boolean) : traceConfig.ignore;

      traceConfig = {
        ...traceConfig,
        mode,
        sampleRate: Number.isFinite(sampleRate) ? Math.max(0, Math.min(1, sampleRate)) : traceConfig.sampleRate,
        slowDefaultMs: Number.isFinite(slowDefaultMs) ? Math.max(0, Math.min(120000, slowDefaultMs)) : traceConfig.slowDefaultMs,
        thresholds,
        ignore,
      };
      appendOutput(`[idebus] trace config updated mode=${traceConfig.mode} sampleRate=${traceConfig.sampleRate} slowDefaultMs=${traceConfig.slowDefaultMs}`);
      return { ok: true, config: traceConfig };
    });

    connection.onRequest('commands/list', async () => {
      return { ok: true, items: commandsService.listCommands() };
    });

    connection.onRequest('commands/execute', async (payload) => {
      const command = payload?.command ? String(payload.command) : '';
      const args = Array.isArray(payload?.args) ? payload.args : [];
      if (!command) return { ok: false, error: 'missing command' };
      const fsPath = String(workspaceService?.getCurrent?.()?.fsPath || '');
      const trusted = fsPath ? !!recentStore?.getTrustedByFsPath?.(fsPath) : false;
      const meta = commandsService.getCommandMeta(command);
      if (meta?.source === 'extension' && !trusted) {
        return { ok: false, error: 'workspace not trusted' };
      }
      const result = await commandsService.executeCommand(command, args);
      return { ok: true, result };
    });

    connection.onRequest('app/getInfo', async () => {
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

    connection.onRequest('workspace/pickFolder', async () => {
      const res = await dialog.showOpenDialog({
        properties: ['openDirectory'],
      });
      if (res.canceled || !res.filePaths.length) return { ok: true, canceled: true, fsPath: '' };
      return { ok: true, canceled: false, fsPath: res.filePaths[0] };
    });

    connection.onRequest('workspace/pickFile', async () => {
      const res = await dialog.showOpenDialog({
        properties: ['openFile'],
      });
      if (res.canceled || !res.filePaths.length) return { ok: true, canceled: true, fsPath: '' };
      return { ok: true, canceled: false, fsPath: res.filePaths[0] };
    });

    connection.onRequest('workspace/open', async (payload) => {
      const id = payload && payload.id ? String(payload.id) : '';
      if (!id) return { ok: false, error: 'workspace/open missing id' };
      const fsPath = payload && payload.fsPath ? String(payload.fsPath) : '';
      const name = payload && payload.name ? String(payload.name) : '';
      try {
        await workspaceService?.start?.({ fsPath });
      } catch {}
      const recent = recentStore?.touch ? recentStore.touch({ id, fsPath, name }) : null;
      return { ok: true, recent };
    });

    connection.onRequest('workspace/getTrust', async (payload) => {
      const fsPath = payload && payload.fsPath ? String(payload.fsPath) : String(workspaceService?.getCurrent?.()?.fsPath || '');
      const trusted = fsPath ? !!recentStore?.getTrustedByFsPath?.(fsPath) : false;
      return { ok: true, fsPath, trusted };
    });

    connection.onRequest('workspace/setTrust', async (payload) => {
      const fsPath = payload && payload.fsPath ? String(payload.fsPath) : String(workspaceService?.getCurrent?.()?.fsPath || '');
      const trusted = payload ? !!payload.trusted : false;
      if (!fsPath) return { ok: false, error: 'missing fsPath' };
      try {
        recentStore?.setTrustedByFsPath?.(fsPath, trusted);
      } catch {}
      return { ok: true, fsPath, trusted };
    });

    connection.onRequest('workspace/close', async () => {
      try {
        await workspaceService?.stop?.();
      } catch {}
      return { ok: true };
    });

    connection.onRequest('window/minimize', async () => {
      const win = getWindow();
      if (win) win.minimize();
      return { ok: true };
    });

    connection.onRequest('window/toggleMaximize', async () => {
      const win = getWindow();
      if (!win) return { ok: true, maximized: false };
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return { ok: true, maximized: win.isMaximized() };
    });

    connection.onRequest('window/isMaximized', async () => {
      const win = getWindow();
      return { ok: true, maximized: !!win?.isMaximized?.() };
    });

    connection.onRequest('window/openDevTools', async () => {
      const win = getWindow();
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

    connection.onRequest('window/toggleDevTools', async () => {
      const win = getWindow();
      if (!win?.webContents) return { ok: false, error: 'window not found' };
      try {
        if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
        else win.webContents.openDevTools({ mode: 'right' });
        return { ok: true, opened: win.webContents.isDevToolsOpened() };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    connection.onRequest('window/applySnapLayout', async (payload) => {
      const win = getWindow();
      if (!win) return { ok: false, error: 'window not found' };
      const layoutId = payload && payload.layoutId ? String(payload.layoutId) : '';
      const zoneIndex = Number(payload && payload.zoneIndex);
      if (!layoutId || Number.isNaN(zoneIndex)) return { ok: false, error: 'invalid snap payload' };

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

    connection.onRequest('window/close', async () => {
      const win = getWindow();
      if (win) win.close();
      return { ok: true };
    });

    connection.onRequest('shell/showItemInFolder', async (fsPath) => {
      const target = String(fsPath || '').trim();
      if (!target) return { ok: false, error: 'missing path' };
      try {
        shell.showItemInFolder(target);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    connection.onRequest('shell/openPath', async (fsPath) => {
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

    connection.onRequest('window/openNewWindow', async (payload) => {
      const isDev = process.env.VITE_DEV_SERVER_URL || !app.isPackaged;
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
          preload: path.join(__dirname, '..', '..', 'preload.js'),
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
          const indexPath = path.join(__dirname, '..', '..', '..', 'frontend', 'dist', 'index.html');
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
        try {
          win.close();
        } catch {}
        return { ok: false, error: err?.message || String(err) };
      }
    });

    connection.onRequest('window/openTerminalWindow', async (payload) => {
      const isDev = process.env.VITE_DEV_SERVER_URL || !app.isPackaged;
      const workspaceFsPath = payload && payload.workspaceFsPath ? String(payload.workspaceFsPath) : '';
      const terminalProfile = payload && payload.terminalProfile ? String(payload.terminalProfile) : '';

      const win = new BrowserWindow({
        width: 980,
        height: 620,
        frame: true,
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, '..', '..', 'preload.js'),
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
          const indexPath = path.join(__dirname, '..', '..', '..', 'frontend', 'dist', 'index.html');
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
        try {
          win.close();
        } catch {}
        return { ok: false, error: err?.message || String(err) };
      }
    });

    const dispose = () => {
      try {
        connection.dispose();
      } catch {}
      connections.delete(senderId);
    };

    sender.once('destroyed', dispose);
    connection.on('close', dispose);

    const entry = { transport, connection };
    connections.set(senderId, entry);
    return entry;
  };

  ipcMain.on('idebus:message', (event, msg) => {
    const { transport } = ensureConnection(event);
    transport.emitMessage(msg);
  });
}

module.exports = { registerIdeBus };

