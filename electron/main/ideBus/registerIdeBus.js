const { app, BrowserWindow, dialog, screen, shell } = require('electron');
const path = require('path');
const { JsonRpcConnection } = require('../lsp/jsonrpc/JsonRpcConnection');
const commandsService = require('../commands/commandsService');
const { resolvePreloadPath } = require('../preloadPath');
const { readWorkspaceSettingsSync, openTextDocument } = require('../workspace/documentModel');

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

function registerIdeBus({ ipcMain, workspaceService, recentStore, extensionHostService, dapService, lspService, plugins } = {}) {
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
        'lsp/applyEditResponse': 250,
        'workspace/applyEditResponse': 250,
        'window/showInputBoxResponse': 250,
        'window/showQuickPickResponse': 250,
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
      const methods = [
        'app/getInfo',
        'workspace/pickFolder',
        'workspace/pickFile',
        'workspace/open',
        'workspace/close',
        'workspace/getTrust',
        'workspace/setTrust',
        'workspace/getWorkspaceFolders',
        'workspace/getConfiguration',
        'workspace/openTextDocument',
        'extensions/getStatus',
        'extensions/restart',
        'extensions/listExtensions',
        'languages/provideCompletionItems',
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
        'window/showInputBoxResponse',
        'window/showQuickPickResponse',
        'shell/showItemInFolder',
        'shell/openPath',
        'lsp/applyEditResponse',
        'workspace/applyEditResponse',
      ];
      if (dapService) {
        methods.push('debug/startSession', 'debug/stopSession', 'debug/sendRequest', 'debug/listSessions');
      }
      if (plugins?.manager) {
        methods.push(
          'plugins/search',
          'plugins/listInstalled',
          'plugins/listUpdates',
          'plugins/install',
          'plugins/uninstall',
          'plugins/enable',
          'plugins/disable',
          'plugins/doctor',
          'plugins/listEnabledLanguages',
        );
      }

      const notifications = [
        'workspace/configurationChanged',
        'commands/changed',
        'window/showInformationMessage',
        'window/showInputBoxRequest',
        'window/showQuickPickRequest',
        'output/append',
        'output/clear',
        'diagnostics/publish',
        'lsp/applyEditRequest',
        'workspace/applyEditRequest',
        'editor/activeTextEditorChanged',
        'editor/textDocumentDidOpen',
        'editor/textDocumentDidChange',
        'editor/textDocumentDidClose',
        'editor/textDocumentDidSave',
        'lsp/diagnostics',
        'lsp/log',
        'lsp/progress',
        'lsp/serverStatus',
        'lsp/serverCapabilities',
        'debug/event',
        'debug/status',
      ];
      return {
        serverVersion: app.getVersion(),
        serverCapabilities: {
          protocolVersion: '1.0',
          transport: 'electron-ipc',
          clientProtocolVersion: protocolVersion,
          clientCapabilities,
          traceMeta: true,
          methods,
          notifications,
        },
      };
    });

  const ensurePluginsReady = async () => {
    try {
      await plugins?.ready;
    } catch {
      // ignore
    }
  };

  const notifyPlugins = (method, params) => {
    if (typeof plugins?.notify === 'function') {
      try {
        plugins.notify(String(method || ''), params);
        return;
      } catch {
        // ignore
      }
    }
    try {
      transport.send({ jsonrpc: '2.0', method: String(method || ''), ...(params !== undefined ? { params } : {}) });
    } catch {}
  };

  try {
    workspaceService?.onDidChangeConfiguration?.((settings) => {
      const payload = { settings: settings && typeof settings === 'object' ? settings : {}, ts: Date.now() };
      notifyPlugins('workspace/configurationChanged', payload);
      try {
        extensionHostService?.connection?.sendNotification?.('workspace/setConfiguration', payload);
      } catch {}
    });
  } catch {
    // ignore
  }

  try {
    connection.onNotification('editor/textDocumentDidOpen', (payload) => {
      try { extensionHostService?.connection?.sendNotification?.('editor/textDocumentDidOpen', payload); } catch {}
    });
    connection.onNotification('editor/textDocumentDidChange', (payload) => {
      try { extensionHostService?.connection?.sendNotification?.('editor/textDocumentDidChange', payload); } catch {}
    });
    connection.onNotification('editor/textDocumentDidClose', (payload) => {
      try { extensionHostService?.connection?.sendNotification?.('editor/textDocumentDidClose', payload); } catch {}
    });
    connection.onNotification('editor/textDocumentDidSave', (payload) => {
      try { extensionHostService?.connection?.sendNotification?.('editor/textDocumentDidSave', payload); } catch {}
    });
    connection.onNotification('editor/activeTextEditorChanged', (payload) => {
      try { extensionHostService?.connection?.sendNotification?.('editor/activeTextEditorChanged', payload); } catch {}
    });
  } catch {
    // ignore
  }

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

    connection.onRequest('extensions/getStatus', async () => {
      if (!extensionHostService?.getStatus) return { ok: false, error: 'extension host service unavailable' };
      return extensionHostService.getStatus();
    });

    connection.onRequest('extensions/restart', async (payload) => {
      if (!extensionHostService?.restart) return { ok: false, error: 'extension host service unavailable' };
      const reason = payload?.reason != null ? String(payload.reason) : 'idebus';
      try {
        await extensionHostService.restart(reason);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    connection.onRequest('extensions/listExtensions', async () => {
      if (!extensionHostService?.listExtensions) return { ok: false, error: 'extension host service unavailable' };
      return extensionHostService.listExtensions();
    });

    connection.onRequest('debug/startSession', async (payload) => {
      if (!dapService?.startSession) return { ok: false, error: 'debug service unavailable' };
      try { dapService.touchSender?.(sender); } catch {}
      return dapService.startSession(payload || {});
    });

    connection.onRequest('debug/stopSession', async (payload) => {
      if (!dapService?.stopSession) return { ok: false, error: 'debug service unavailable' };
      const sessionId = payload?.sessionId ? String(payload.sessionId) : '';
      try { dapService.touchSender?.(sender); } catch {}
      return dapService.stopSession(sessionId);
    });

    connection.onRequest('debug/sendRequest', async (payload) => {
      if (!dapService?.sendRequest) return { ok: false, error: 'debug service unavailable' };
      const sessionId = payload?.sessionId ? String(payload.sessionId) : '';
      const command = payload?.command ? String(payload.command) : '';
      const args = payload?.args;
      const options = payload?.options;
      if (!sessionId) return { ok: false, error: 'missing sessionId' };
      if (!command) return { ok: false, error: 'missing command' };
      try { dapService.touchSender?.(sender); } catch {}
      return dapService.sendRequest(sessionId, command, args, options);
    });

    connection.onRequest('debug/listSessions', async () => {
      if (!dapService?.listSessions) return { ok: false, error: 'debug service unavailable' };
      try { dapService.touchSender?.(sender); } catch {}
      const items = Array.from(dapService.listSessions?.() || []);
      return { ok: true, items };
    });

    connection.onRequest('plugins/search', async (payload) => {
      if (!plugins?.manager?.search) return { ok: false, error: 'plugins service unavailable' };
      await ensurePluginsReady();
      const query = payload?.query != null ? String(payload.query) : '';
      const providerIds = Array.isArray(payload?.providerIds) ? payload.providerIds : undefined;
      const options = payload?.options && typeof payload.options === 'object' ? payload.options : undefined;
      const items = await plugins.manager.search({ query, providerIds, options });
      return { ok: true, items };
    });

    connection.onRequest('plugins/listInstalled', async () => {
      if (!plugins?.manager?.listInstalled) return { ok: false, error: 'plugins service unavailable' };
      await ensurePluginsReady();
      return { ok: true, items: plugins.manager.listInstalled() };
    });

    connection.onRequest('plugins/listUpdates', async () => {
      if (!plugins?.manager?.listUpdates) return { ok: false, error: 'plugins service unavailable' };
      await ensurePluginsReady();
      const items = await plugins.manager.listUpdates();
      return { ok: true, items };
    });

    connection.onRequest('plugins/install', async (payload) => {
      if (!plugins?.manager?.install) return { ok: false, error: 'plugins service unavailable' };
      await ensurePluginsReady();
      const ref = payload && typeof payload === 'object' ? payload : {};
      try {
        const res = await plugins.manager.install(ref, {
          onProgress: (p) => notifyPlugins('plugins/progress', { ...(p || {}), ts: Date.now() }),
        });
        notifyPlugins('plugins/changed', { items: plugins.manager.listInstalled?.() || [], ts: Date.now() });
        return res;
      } catch (err) {
        notifyPlugins('plugins/error', { action: 'install', pluginId: ref?.id, message: err?.message || String(err), ts: Date.now() });
        return { ok: false, error: err?.message || String(err) };
      }
    });

    connection.onRequest('plugins/uninstall', async (payload) => {
      if (!plugins?.manager?.uninstall) return { ok: false, error: 'plugins service unavailable' };
      await ensurePluginsReady();
      const id = payload?.id != null ? String(payload.id) : String(payload || '');
      try {
        const res = await plugins.manager.uninstall(id);
        notifyPlugins('plugins/changed', { items: plugins.manager.listInstalled?.() || [], ts: Date.now() });
        return res;
      } catch (err) {
        notifyPlugins('plugins/error', { action: 'uninstall', pluginId: id, message: err?.message || String(err), ts: Date.now() });
        return { ok: false, error: err?.message || String(err) };
      }
    });

    connection.onRequest('plugins/enable', async (payload) => {
      if (!plugins?.manager?.enable) return { ok: false, error: 'plugins service unavailable' };
      await ensurePluginsReady();
      const id = payload?.id != null ? String(payload.id) : '';
      const trust = payload?.trust != null ? String(payload.trust) : undefined;
      try {
        const res = await plugins.manager.enable(id, trust ? { trust } : undefined);
        notifyPlugins('plugins/changed', { items: plugins.manager.listInstalled?.() || [], ts: Date.now() });
        return res;
      } catch (err) {
        notifyPlugins('plugins/error', { action: 'enable', pluginId: id, message: err?.message || String(err), ts: Date.now() });
        return { ok: false, error: err?.message || String(err) };
      }
    });

    connection.onRequest('plugins/disable', async (payload) => {
      if (!plugins?.manager?.disable) return { ok: false, error: 'plugins service unavailable' };
      await ensurePluginsReady();
      const id = payload?.id != null ? String(payload.id) : '';
      try {
        const res = await plugins.manager.disable(id);
        notifyPlugins('plugins/changed', { items: plugins.manager.listInstalled?.() || [], ts: Date.now() });
        return res;
      } catch (err) {
        notifyPlugins('plugins/error', { action: 'disable', pluginId: id, message: err?.message || String(err), ts: Date.now() });
        return { ok: false, error: err?.message || String(err) };
      }
    });

    connection.onRequest('plugins/doctor', async (payload) => {
      if (!plugins?.manager?.doctor) return { ok: false, error: 'plugins service unavailable' };
      await ensurePluginsReady();
      const id = payload?.id != null ? String(payload.id) : String(payload || '');
      return plugins.manager.doctor(id);
    });

    connection.onRequest('plugins/listEnabledLanguages', async () => {
      if (!plugins?.manager?.listEnabledLanguages) return { ok: false, error: 'plugins service unavailable' };
      await ensurePluginsReady();
      return { ok: true, items: plugins.manager.listEnabledLanguages() };
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
      try { await extensionHostService?.restart?.('workspace/open'); } catch {}
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
      try { await extensionHostService?.restart?.('workspace/setTrust'); } catch {}
      return { ok: true, fsPath, trusted };
    });

    connection.onRequest('workspace/close', async () => {
      try {
        await workspaceService?.stop?.();
      } catch {}
      try { await extensionHostService?.restart?.('workspace/close'); } catch {}
      return { ok: true };
    });

    connection.onRequest('workspace/getWorkspaceFolders', async () => {
      const fsPath = String(workspaceService?.getCurrent?.()?.fsPath || '').trim();
      if (!fsPath) return { ok: true, folders: [] };
      let uri = '';
      try {
        // eslint-disable-next-line global-require
        const { pathToFileURL } = require('node:url');
        uri = pathToFileURL(fsPath).toString();
      } catch {
        uri = '';
      }
      const name = path.basename(fsPath.replace(/[\\\/]+$/, '')) || fsPath;
      return { ok: true, folders: [{ uri, fsPath, name, index: 0 }] };
    });

    connection.onRequest('workspace/getConfiguration', async (payload) => {
      const fsPath = payload?.fsPath ? String(payload.fsPath) : String(workspaceService?.getCurrent?.()?.fsPath || '');
      const section = payload?.section != null ? String(payload.section) : '';
      const currentFsPath = String(workspaceService?.getCurrent?.()?.fsPath || '');
      const settings = (fsPath && currentFsPath && fsPath === currentFsPath && typeof workspaceService?.getConfiguration === 'function')
        ? workspaceService.getConfiguration()
        : readWorkspaceSettingsSync(fsPath);
      if (!section) return { ok: true, settings, section: '' };
      const scoped = settings && typeof settings === 'object' && Object.prototype.hasOwnProperty.call(settings, section) ? settings[section] : settings;
      return { ok: true, settings: scoped, section };
    });

    connection.onRequest('workspace/openTextDocument', async (payload) => {
      const workspaceRootFsPath = String(workspaceService?.getCurrent?.()?.fsPath || '');
      const uriOrPath = payload?.uriOrPath != null ? payload.uriOrPath : (payload?.uri || payload?.path || payload?.fileName);
      return await openTextDocument({ workspaceRootFsPath, uriOrPath });
    });

    connection.onRequest('languages/provideCompletionItems', async (payload) => {
      const languageId = payload?.languageId ? String(payload.languageId) : '';
      const uri = payload?.uri ? String(payload.uri) : '';
      const text = payload?.text != null ? String(payload.text) : '';
      const version = Number.isFinite(payload?.version) ? payload.version : 1;
      const position = payload?.position && typeof payload.position === 'object' ? payload.position : null;
      if (!languageId) return { ok: true, items: [] };
      const res = await extensionHostService?.provideCompletionItems?.({ languageId, uri, text, version, position }) ?? { ok: true, items: [] };
      if (res && res.ok) return res;
      return { ok: true, items: [] };
    });

    connection.onRequest('lsp/applyEditResponse', async (payload) => {
      const requestId = payload?.requestId != null ? String(payload.requestId) : '';
      const result = payload?.result;
      if (!requestId) return { ok: false, error: 'missing requestId' };
      if (!lspService?.handleApplyEditResponse) return { ok: false, error: 'lsp service not available' };
      const senderWebContentsId = sender?.id || 0;
      return lspService.handleApplyEditResponse({ senderWebContentsId, requestId, result });
    });

    connection.onRequest('workspace/applyEditResponse', async (payload) => {
      const requestId = payload?.requestId != null ? String(payload.requestId) : '';
      const result = payload?.result;
      if (!requestId) return { ok: false, error: 'missing requestId' };
      if (!extensionHostService?.handleWorkspaceApplyEditResponse) return { ok: false, error: 'extension host not available' };
      const senderWebContentsId = sender?.id || 0;
      return extensionHostService.handleWorkspaceApplyEditResponse({ senderWebContentsId, requestId, result });
    });

    connection.onRequest('window/showInputBoxResponse', async (payload) => {
      const requestId = payload?.requestId != null ? String(payload.requestId) : '';
      const result = payload?.result && typeof payload.result === 'object' ? payload.result : {};
      if (!requestId) return { ok: false, error: 'missing requestId' };
      if (!extensionHostService?.handlePromptResponse) return { ok: false, error: 'extension host not available' };
      const senderWebContentsId = sender?.id || 0;
      return extensionHostService.handlePromptResponse({ senderWebContentsId, requestId, kind: 'inputBox', result });
    });

    connection.onRequest('window/showQuickPickResponse', async (payload) => {
      const requestId = payload?.requestId != null ? String(payload.requestId) : '';
      const result = payload?.result && typeof payload.result === 'object' ? payload.result : {};
      if (!requestId) return { ok: false, error: 'missing requestId' };
      if (!extensionHostService?.handlePromptResponse) return { ok: false, error: 'extension host not available' };
      const senderWebContentsId = sender?.id || 0;
      return extensionHostService.handlePromptResponse({ senderWebContentsId, requestId, kind: 'quickPick', result });
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
      const preloadPath = resolvePreloadPath(path.join(__dirname, '..', '..'));

      const win = new BrowserWindow({
        width: 1400,
        height: 800,
        frame: false,
        autoHideMenuBar: true,
        webPreferences: {
          preload: preloadPath,
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
      const preloadPath = resolvePreloadPath(path.join(__dirname, '..', '..'));

      const win = new BrowserWindow({
        width: 980,
        height: 620,
        frame: true,
        autoHideMenuBar: true,
        webPreferences: {
          preload: preloadPath,
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
