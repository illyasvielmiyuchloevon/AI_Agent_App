const { app, BrowserWindow, dialog, screen, shell } = require('electron');
const path = require('path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');
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

function registerIdeBus({ ipcMain, workspaceService, recentStore, extensionHostService, dapService, lspService, plugins, vscodeExtensions } = {}) {
  if (!ipcMain) throw new Error('registerIdeBus: ipcMain is required');

  const connections = new Map();
  const runningTasks = new Map();
  let didWireWorkspaceConfig = false;
  let didWireWorkspaceState = false;

  const notifyAll = (method, params) => {
    const m = String(method || '').trim();
    if (!m) return;
    for (const entry of Array.from(connections.values())) {
      try {
        entry?.transport?.send?.({ jsonrpc: '2.0', method: m, ...(params !== undefined ? { params } : {}) });
      } catch {}
    }
  };

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
        'workspace/getState': 100,
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
        'window/openExternalUrl': 800,
        'window/openNewWindow': 300,
        'window/openTerminalWindow': 300,
        'window/close': 150,
        'shell/showItemInFolder': 250,
        'shell/openPath': 800,
        'shell/openExternal': 800,
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
      let workspaceId = '';
      try {
        workspaceId = String(workspaceService?.getWorkspace?.()?.workspaceId || '').trim();
      } catch {
        workspaceId = '';
      }
      const shortWs = workspaceId ? workspaceId.slice(-8) : '';
      const parts = ['[idebus]', method, outcome || 'done', `${dur}ms`];
      if (shortWs) parts.push(`ws=${shortWs}`);
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
        'workspace/getState',
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
        'window/openExternalUrl',
        'window/openNewWindow',
        'window/openTerminalWindow',
        'window/close',
        'window/showInputBoxResponse',
        'window/showQuickPickResponse',
        'shell/showItemInFolder',
        'shell/openPath',
        'shell/openExternal',
        'lsp/applyEditResponse',
        'workspace/applyEditResponse',
        'tasks/list',
        'tasks/run',
        'tasks/terminate',
      ];
      if (dapService) {
        methods.push('debug/startSession', 'debug/stopSession', 'debug/sendRequest', 'debug/listSessions');
      }
	      if (plugins?.manager) {
	        methods.push(
	          'plugins/search',
	          'plugins/listInstalled',
	          'plugins/getDetails',
	          'plugins/listUpdates',
	          'plugins/install',
	          'plugins/uninstall',
	          'plugins/enable',
          'plugins/disable',
          'plugins/doctor',
          'plugins/listEnabledLanguages',
          'plugins/getDetail',
        );
      }
      if (vscodeExtensions?.manager) {
        methods.push(
          'vscodeExtensions/search',
          'vscodeExtensions/install',
          'vscodeExtensions/installFromOpenVsx',
          'vscodeExtensions/listInstalled',
          'vscodeExtensions/enable',
          'vscodeExtensions/disable',
          'vscodeExtensions/uninstall',
          'vscodeExtensions/getDetail',
        );
      }

	      const notifications = [
	        'workspace/configurationChanged',
          'workspace/stateChanged',
          'workspace/trustChanged',
	        'workspace/didCreateFiles',
	        'workspace/didDeleteFiles',
	        'workspace/didRenameFiles',
	        'commands/changed',
	        'window/showInformationMessage',
	        'window/showTextDocument',
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
        'vscodeExtensions/changed',
        'vscodeExtensions/progress',
        'vscodeExtensions/error',
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

  const ensureVscodeExtensionsReady = async () => {
    try {
      await vscodeExtensions?.ready;
    } catch {
    }
  };

  const notifyVscodeExtensions = (method, params) => {
    if (typeof vscodeExtensions?.notify === 'function') {
      try {
        vscodeExtensions.notify(String(method || ''), params);
        return;
      } catch {
      }
    }
    try {
      transport.send({ jsonrpc: '2.0', method: String(method || ''), ...(params !== undefined ? { params } : {}) });
    } catch {}
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
      if (!didWireWorkspaceConfig && typeof workspaceService?.onDidChangeConfiguration === 'function') {
        didWireWorkspaceConfig = true;
        workspaceService.onDidChangeConfiguration((settings) => {
          const payload = { settings: settings && typeof settings === 'object' ? settings : {}, ts: Date.now() };
          notifyAll('workspace/configurationChanged', payload);
          try {
            extensionHostService?.connection?.sendNotification?.('workspace/setConfiguration', payload);
          } catch {}
          try {
            const wid = String(workspaceService?.getWorkspace?.()?.workspaceId || '').trim();
            if (wid && lspService?.manager?.didChangeConfiguration) {
              lspService.manager.didChangeConfiguration(wid, payload.settings).catch?.(() => {});
            }
          } catch {}
        });
      }
    } catch {}

    try {
      if (!didWireWorkspaceState && typeof workspaceService?.onDidChangeWorkspace === 'function') {
        didWireWorkspaceState = true;
        workspaceService.onDidChangeWorkspace((ws) => {
          const payload = { workspace: ws || null, ts: Date.now() };
          notifyAll('workspace/stateChanged', payload);
        });
      }
    } catch {}

	  try {
	    connection.onNotification('editor/textDocumentDidOpen', async (payload) => {
	      try {
	        if (extensionHostService?.handleTextDocumentDidOpen) {
	          await extensionHostService.handleTextDocumentDidOpen(payload);
	          return;
	        }
	      } catch {
	        // ignore
	      }
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
	    connection.onNotification('workspace/didCreateFiles', (payload) => {
	      try { extensionHostService?.connection?.sendNotification?.('workspace/didCreateFiles', payload); } catch {}
        try { extensionHostService?.handleWorkspaceDidCreateFiles?.(payload).catch(() => {}); } catch {}
	    });
	    connection.onNotification('workspace/didDeleteFiles', (payload) => {
	      try { extensionHostService?.connection?.sendNotification?.('workspace/didDeleteFiles', payload); } catch {}
	    });
	    connection.onNotification('workspace/didRenameFiles', (payload) => {
	      try { extensionHostService?.connection?.sendNotification?.('workspace/didRenameFiles', payload); } catch {}
        try { extensionHostService?.handleWorkspaceDidRenameFiles?.(payload).catch(() => {}); } catch {}
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
      try {
        const result = await (extensionHostService?.executeCommand
          ? extensionHostService.executeCommand(command, args)
          : commandsService.executeCommand(command, args));
        return { ok: true, result };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    const getWorkspaceFsPath = () => String(workspaceService?.getCurrent?.()?.fsPath || '').trim();
    const isWorkspaceTrusted = (fsPath) => {
      const p = String(fsPath || '').trim();
      if (!p) return false;
      return !!recentStore?.getTrustedByFsPath?.(p);
    };

    const resolveTaskCwd = (workspaceFsPath, cwd) => {
      const base = String(workspaceFsPath || '').trim();
      const raw = cwd != null ? String(cwd || '').trim() : '';
      if (!raw) return base || process.cwd();
      if (path.isAbsolute(raw)) return raw;
      if (!base) return raw;
      return path.join(base, raw);
    };

    const loadTasksJson = async (workspaceFsPath) => {
      const root = String(workspaceFsPath || '').trim();
      if (!root) return { ok: true, exists: false, version: '2.0.0', tasks: [] };
      const filePath = path.join(root, '.vscode', 'tasks.json');
      try {
        const st = await fsp.stat(filePath).catch(() => null);
        if (!st || !st.isFile()) return { ok: true, exists: false, version: '2.0.0', tasks: [] };
      } catch {
        return { ok: true, exists: false, version: '2.0.0', tasks: [] };
      }

      try {
        const raw = await fsp.readFile(filePath, 'utf8');
        const json = JSON.parse(String(raw || ''));
        const version = json?.version != null ? String(json.version) : '2.0.0';
        const arr = Array.isArray(json?.tasks) ? json.tasks : [];
        const tasks = arr.map((t) => {
          const label = t?.label != null ? String(t.label) : '';
          const command = t?.command != null ? String(t.command) : '';
          const args = Array.isArray(t?.args) ? t.args.map((a) => String(a)) : [];
          const type = t?.type != null ? String(t.type) : '';
          const cwd = t?.options?.cwd != null ? String(t.options.cwd) : '';
          const env = t?.options?.env && typeof t.options.env === 'object' ? t.options.env : null;
          return {
            label,
            command,
            args,
            type,
            options: {
              cwd,
              env,
            },
          };
        }).filter((t) => t.label || t.command);
        return { ok: true, exists: true, version, tasks, filePath };
      } catch (err) {
        return { ok: false, error: err?.message || String(err), exists: true, version: '2.0.0', tasks: [] };
      }
    };

    const sendTaskOutput = (text) => {
      const line = text == null ? '' : String(text);
      if (!line) return;
      transport.send({
        jsonrpc: '2.0',
        method: 'output/append',
        params: { channelId: 'Tasks', label: '任务', text: line, ts: Date.now() },
      });
    };

    const watchTaskStream = (stream, onLine) => {
      if (!stream || typeof stream.on !== 'function') return () => {};
      let buf = '';
      const flush = () => {
        const rest = buf;
        buf = '';
        if (rest) onLine(rest);
      };
      const onData = (chunk) => {
        const s = chunk == null ? '' : chunk.toString('utf8');
        if (!s) return;
        buf += s;
        const parts = buf.split(/\r?\n/);
        buf = parts.pop() || '';
        for (const p of parts) {
          if (p) onLine(p);
        }
      };
      const onEnd = () => flush();
      stream.on('data', onData);
      stream.on('end', onEnd);
      stream.on('close', onEnd);
      stream.on('error', onEnd);
      return () => {
        try { stream.off('data', onData); } catch {}
        try { stream.off('end', onEnd); } catch {}
        try { stream.off('close', onEnd); } catch {}
        try { stream.off('error', onEnd); } catch {}
      };
    };

    connection.onRequest('tasks/list', async () => {
      const fsPath = getWorkspaceFsPath();
      return await loadTasksJson(fsPath);
    });

    connection.onRequest('tasks/run', async (payload) => {
      const fsPath = getWorkspaceFsPath();
      if (!isWorkspaceTrusted(fsPath)) return { ok: false, error: 'workspace not trusted' };

      const p = payload && typeof payload === 'object' ? payload : {};
      const requestedLabel = p?.label != null ? String(p.label) : '';
      const requestedCommand = p?.command != null ? String(p.command) : '';
      const requestedArgs = Array.isArray(p?.args) ? p.args.map((a) => String(a)) : [];
      const requestedType = p?.type != null ? String(p.type) : '';
      const requestedCwd = p?.cwd != null ? String(p.cwd) : '';
      const requestedEnv = p?.env && typeof p.env === 'object' ? p.env : null;

      let task = null;
      if (requestedLabel && !requestedCommand) {
        const listed = await loadTasksJson(fsPath);
        if (listed?.ok) {
          const tasksArr = Array.isArray(listed?.tasks) ? listed.tasks : [];
          task = tasksArr.find((t) => String(t?.label || '') === requestedLabel) || null;
        }
      }

      const label = requestedLabel || (task?.label ? String(task.label) : '');
      const command = requestedCommand || (task?.command ? String(task.command) : '');
      const args = requestedArgs.length ? requestedArgs : (Array.isArray(task?.args) ? task.args.map((a) => String(a)) : []);
      const type = requestedType || (task?.type ? String(task.type) : '');
      const cwd = resolveTaskCwd(fsPath, requestedCwd || task?.options?.cwd);
      const envPatch = requestedEnv || task?.options?.env || null;
      const env = envPatch ? { ...(process.env || {}), ...envPatch } : process.env;

      if (!command) return { ok: false, error: 'missing command' };

      const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

      const shouldUseShell = type ? (String(type).toLowerCase() !== 'process') : args.length === 0;
      let child = null;
      try {
        if (shouldUseShell) {
          const cmdStr = [command, ...args].filter(Boolean).join(' ');
          child = spawn(cmdStr, {
            cwd,
            env,
            shell: true,
            windowsHide: true,
          });
        } else {
          child = spawn(command, args, {
            cwd,
            env,
            shell: false,
            windowsHide: true,
          });
        }
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }

      if (!child || typeof child.pid !== 'number') return { ok: false, error: 'failed to start task' };

      runningTasks.set(taskId, { senderId, child, startedAt: Date.now(), label: label || command });

      const prefix = label || command;
      sendTaskOutput(`[task] started ${taskId} ${prefix}`);

      const disposeStdout = watchTaskStream(child.stdout, (line) => sendTaskOutput(`[task] ${prefix} ${line}`));
      const disposeStderr = watchTaskStream(child.stderr, (line) => sendTaskOutput(`[task] ${prefix} ${line}`));

      const cleanup = () => {
        disposeStdout();
        disposeStderr();
        runningTasks.delete(taskId);
      };

      child.on('exit', (code, signal) => {
        sendTaskOutput(`[task] exited ${taskId} ${prefix} code=${code == null ? '' : String(code)} signal=${signal || ''}`.trim());
        cleanup();
      });
      child.on('error', (err) => {
        sendTaskOutput(`[task] error ${taskId} ${prefix} ${err?.message || String(err)}`.trim());
        cleanup();
      });

      return { ok: true, taskId, pid: child.pid, cwd };
    });

    connection.onRequest('tasks/terminate', async (payload) => {
      const taskId = payload?.taskId != null ? String(payload.taskId) : '';
      if (!taskId) return { ok: false, error: 'missing taskId' };
      const entry = runningTasks.get(taskId);
      if (!entry) return { ok: false, error: 'task not found' };
      if (entry.senderId !== senderId) return { ok: false, error: 'task not owned by sender' };

      const child = entry.child;
      try {
        child.kill();
      } catch {
        // ignore
      }

      return { ok: true, taskId };
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

    connection.onRequest('vscodeExtensions/listInstalled', async () => {
      if (!vscodeExtensions?.manager?.listInstalled) return { ok: false, error: 'vscode extensions service unavailable' };
      await ensureVscodeExtensionsReady();
      const items = vscodeExtensions.manager.listInstalled();
      return { ok: true, items };
    });

    connection.onRequest('vscodeExtensions/search', async (payload) => {
      if (!vscodeExtensions?.manager?.search) return { ok: false, error: 'vscode extensions service unavailable' };
      await ensureVscodeExtensionsReady();
      const query = payload?.query != null ? String(payload.query) : '';
      const providerIds = Array.isArray(payload?.providerIds) ? payload.providerIds : undefined;
      const options = payload?.options && typeof payload.options === 'object' ? payload.options : undefined;
      try {
        const items = await vscodeExtensions.manager.search({ query, providerIds, options });
        return { ok: true, items };
      } catch (err) {
        notifyVscodeExtensions('vscodeExtensions/error', { action: 'search', query, message: err?.message || String(err), ts: Date.now() });
        return { ok: false, error: err?.message || String(err) };
      }
    });

    connection.onRequest('vscodeExtensions/getDetail', async (payload) => {
      if (!vscodeExtensions?.manager?.getDetail) return { ok: false, error: 'vscode extensions service unavailable' };
      await ensureVscodeExtensionsReady();
      const id = payload?.id != null ? String(payload.id) : String(payload || '');
      return vscodeExtensions.manager.getDetail(id);
    });

    connection.onRequest('vscodeExtensions/install', async (payload) => {
      if (!vscodeExtensions?.manager?.installFromVsixFile) return { ok: false, error: 'vscode extensions service unavailable' };
      await ensureVscodeExtensionsReady();
      const filePath = payload?.filePath != null ? String(payload.filePath) : String(payload || '');
      if (!filePath) return { ok: false, error: 'missing filePath' };
      try {
        const res = await vscodeExtensions.manager.installFromVsixFile(filePath, {
          onProgress: (p) => notifyVscodeExtensions('vscodeExtensions/progress', { ...(p || {}), ts: Date.now() }),
        });
        notifyVscodeExtensions('vscodeExtensions/changed', { items: vscodeExtensions.manager.listInstalled?.() || [], ts: Date.now() });
        if (res?.needsRestart) {
          try { await extensionHostService?.restart?.('vscodeExtensions:install'); } catch {}
        }
        return res;
      } catch (err) {
        notifyVscodeExtensions('vscodeExtensions/error', { action: 'install', filePath, message: err?.message || String(err), ts: Date.now() });
        return { ok: false, error: err?.message || String(err) };
      }
    });

    connection.onRequest('vscodeExtensions/installFromOpenVsx', async (payload) => {
      if (!vscodeExtensions?.manager?.installFromOpenVsxRef) return { ok: false, error: 'vscode extensions service unavailable' };
      await ensureVscodeExtensionsReady();
      const namespace = payload?.namespace != null ? String(payload.namespace) : '';
      const name = payload?.name != null ? String(payload.name) : '';
      const version = payload?.version != null ? String(payload.version) : '';
      if (!namespace || !name) return { ok: false, error: 'missing namespace/name' };
      try {
        const res = await vscodeExtensions.manager.installFromOpenVsxRef({ namespace, name, version }, {
          onProgress: (p) => notifyVscodeExtensions('vscodeExtensions/progress', { ...(p || {}), ts: Date.now() }),
        });
        notifyVscodeExtensions('vscodeExtensions/changed', { items: vscodeExtensions.manager.listInstalled?.() || [], ts: Date.now() });
        if (res?.needsRestart) {
          try { await extensionHostService?.restart?.('vscodeExtensions:installFromOpenVsx'); } catch {}
        }
        return res;
      } catch (err) {
        notifyVscodeExtensions('vscodeExtensions/error', { action: 'installFromOpenVsx', namespace, name, version, message: err?.message || String(err), ts: Date.now() });
        return { ok: false, error: err?.message || String(err) };
      }
    });

    connection.onRequest('vscodeExtensions/enable', async (payload) => {
      if (!vscodeExtensions?.manager?.enable) return { ok: false, error: 'vscode extensions service unavailable' };
      await ensureVscodeExtensionsReady();
      const id = payload?.id != null ? String(payload.id) : String(payload || '');
      try {
        const res = await vscodeExtensions.manager.enable(id);
        notifyVscodeExtensions('vscodeExtensions/changed', { items: vscodeExtensions.manager.listInstalled?.() || [], ts: Date.now() });
        if (res?.needsRestart) {
          try { await extensionHostService?.restart?.('vscodeExtensions:enable'); } catch {}
        }
        return res;
      } catch (err) {
        notifyVscodeExtensions('vscodeExtensions/error', { action: 'enable', id, message: err?.message || String(err), ts: Date.now() });
        return { ok: false, error: err?.message || String(err) };
      }
    });

    connection.onRequest('vscodeExtensions/disable', async (payload) => {
      if (!vscodeExtensions?.manager?.disable) return { ok: false, error: 'vscode extensions service unavailable' };
      await ensureVscodeExtensionsReady();
      const id = payload?.id != null ? String(payload.id) : String(payload || '');
      try {
        const res = await vscodeExtensions.manager.disable(id);
        notifyVscodeExtensions('vscodeExtensions/changed', { items: vscodeExtensions.manager.listInstalled?.() || [], ts: Date.now() });
        if (res?.needsRestart) {
          try { await extensionHostService?.restart?.('vscodeExtensions:disable'); } catch {}
        }
        return res;
      } catch (err) {
        notifyVscodeExtensions('vscodeExtensions/error', { action: 'disable', id, message: err?.message || String(err), ts: Date.now() });
        return { ok: false, error: err?.message || String(err) };
      }
    });

    connection.onRequest('vscodeExtensions/uninstall', async (payload) => {
      if (!vscodeExtensions?.manager?.uninstall) return { ok: false, error: 'vscode extensions service unavailable' };
      await ensureVscodeExtensionsReady();
      const id = payload?.id != null ? String(payload.id) : String(payload || '');
      try {
        const res = await vscodeExtensions.manager.uninstall(id);
        notifyVscodeExtensions('vscodeExtensions/changed', { items: vscodeExtensions.manager.listInstalled?.() || [], ts: Date.now() });
        if (res?.needsRestart) {
          try { await extensionHostService?.restart?.('vscodeExtensions:uninstall'); } catch {}
        }
        return res;
      } catch (err) {
        notifyVscodeExtensions('vscodeExtensions/error', { action: 'uninstall', id, message: err?.message || String(err), ts: Date.now() });
        return { ok: false, error: err?.message || String(err) };
      }
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

	    connection.onRequest('plugins/getDetails', async (payload) => {
	      if (!plugins?.manager?.getDetails) return { ok: false, error: 'plugins service unavailable' };
	      await ensurePluginsReady();
	      const id = payload?.id != null ? String(payload.id) : String(payload || '');
	      return await plugins.manager.getDetails(id);
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

    connection.onRequest('plugins/getDetail', async (payload) => {
      if (!plugins?.manager?.getDetail) return { ok: false, error: 'plugins service unavailable' };
      await ensurePluginsReady();
      const id = payload?.id != null ? String(payload.id) : '';
      const providerId = payload?.providerId != null ? String(payload.providerId) : undefined;
      const version = payload?.version != null ? String(payload.version) : undefined;
      const forceRefresh = !!payload?.forceRefresh;

      if (!id) return { ok: false, error: 'plugin id is required' };

      // Implement 30 second timeout (Requirement 3.3)
      const timeoutMs = 30000;
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('request timeout')), timeoutMs);
      });

      try {
        const result = await Promise.race([
          plugins.manager.getDetail({ id, providerId, version, forceRefresh }),
          timeoutPromise,
        ]);
        return result;
      } catch (err) {
        const message = err?.message || String(err);
        return { ok: false, error: message };
      }
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
        const r = await workspaceService?.start?.({ fsPath, workspaceId: id, name });
        const prevWid = String(r?.prev?.workspaceId || '').trim();
        if (prevWid && prevWid !== id) {
          try { await dapService?.stopAllSessions?.(); } catch {}
          try { await lspService?.manager?.shutdownWorkspace?.(prevWid); } catch {}
        }
      } catch {}
      const recent = recentStore?.touch ? recentStore.touch({ id, fsPath, name }) : null;
      try { await extensionHostService?.restart?.('workspace/open'); } catch {}
      return { ok: true, recent };
    });

    connection.onRequest('workspace/getState', async () => {
      const ws = workspaceService?.getWorkspace?.() || null;
      const fsPath = String(ws?.fsPath || '').trim();
      const trusted = fsPath ? !!recentStore?.getTrustedByFsPath?.(fsPath) : false;
      return { ok: true, workspace: ws, trusted };
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
      try {
        const wid = String(workspaceService?.getWorkspace?.()?.workspaceId || '').trim();
        notifyAll('workspace/trustChanged', { workspaceId: wid, fsPath, trusted: !!trusted, ts: Date.now() });
      } catch {}
      try { await extensionHostService?.restart?.('workspace/setTrust'); } catch {}
      return { ok: true, fsPath, trusted };
    });

    connection.onRequest('workspace/close', async () => {
      try { await dapService?.stopAllSessions?.(); } catch {}
      try {
        const wid = String(workspaceService?.getWorkspace?.()?.workspaceId || '').trim();
        if (wid) await lspService?.manager?.shutdownWorkspace?.(wid);
      } catch {}
      for (const [taskId, entry] of Array.from(runningTasks.entries())) {
        try { entry?.child?.kill?.(); } catch {}
        runningTasks.delete(taskId);
      }
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

    connection.onRequest('shell/openExternal', async (url) => {
      const target = String(url || '').trim();
      if (!target) return { ok: false, error: 'missing url' };
      try {
        const ok = await shell.openExternal(target);
        return { ok: !!ok };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    connection.onRequest('window/openExternalUrl', async (payload) => {
      const raw = payload && payload.url ? String(payload.url) : '';
      const target = raw.trim();
      if (!target) return { ok: false, error: 'missing url' };

      let parsed = null;
      try {
        parsed = new URL(target);
      } catch {
        return { ok: false, error: 'invalid url' };
      }
      const protocol = String(parsed.protocol || '').toLowerCase();
      if (protocol !== 'http:' && protocol !== 'https:') return { ok: false, error: 'unsupported protocol' };

      const preloadPath = resolvePreloadPath(path.join(__dirname, '..', '..'));
      const win = new BrowserWindow({
        width: 1100,
        height: 800,
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
        try {
          win.webContents.on('will-navigate', (evt, url) => {
            try {
              const u = new URL(String(url || ''));
              if (u.protocol === 'http:' || u.protocol === 'https:') return;
            } catch {}
            try {
              evt.preventDefault();
            } catch {}
          });
        } catch {}

        try {
          win.webContents.setWindowOpenHandler(({ url }) => {
            try {
              const u = new URL(String(url || ''));
              if (u.protocol === 'http:' || u.protocol === 'https:') {
                win.loadURL(u.toString()).catch(() => {});
              }
            } catch {}
            return { action: 'deny' };
          });
        } catch {}

        await win.loadURL(parsed.toString());
        win.focus();
        return { ok: true };
      } catch (err) {
        try {
          win.close();
        } catch {}
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
      for (const [taskId, entry] of Array.from(runningTasks.entries())) {
        if (entry?.senderId !== senderId) continue;
        try { entry.child?.kill?.(); } catch {}
        runningTasks.delete(taskId);
      }
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
