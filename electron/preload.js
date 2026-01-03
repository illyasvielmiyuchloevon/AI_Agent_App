const { contextBridge, ipcRenderer } = require('electron');

let JsonRpcConnection = null;
try {
  // In Electron sandboxed renderer preloads, Node-style module loading for local files is restricted.
  // Prefer the shared implementation when available, but fall back to a minimal one so preload can load.
  // eslint-disable-next-line global-require
  ({ JsonRpcConnection } = require('./main/lsp/jsonrpc/JsonRpcConnection'));
} catch {
  JsonRpcConnection = class JsonRpcConnection {
    constructor(transport, { name } = {}) {
      this.transport = transport;
      this.name = name ? String(name) : '';
      this.nextId = 1;
      this.pending = new Map();
      this.notificationHandlers = new Map();

      transport.onMessage((msg) => this._onMessage(msg));
      transport.onClose?.(() => this._onClose());
    }

    _onClose() {
      for (const entry of this.pending.values()) {
        try { clearTimeout(entry.timer); } catch {}
        try { entry.reject(new Error('connection closed')); } catch {}
      }
      this.pending.clear();
    }

    _onMessage(msg) {
      if (!msg || typeof msg !== 'object') return;

      const id = msg.id;
      if (id != null) {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        try { clearTimeout(entry.timer); } catch {}

        if (msg.error) {
          const message = msg?.error?.message != null ? String(msg.error.message) : 'request failed';
          const err = new Error(message);
          err.code = msg?.error?.code;
          err.data = msg?.error?.data;
          entry.reject(err);
          return;
        }
        entry.resolve(msg.result);
        return;
      }

      const method = msg.method ? String(msg.method) : '';
      if (!method) return;
      const set = this.notificationHandlers.get(method);
      if (!set || set.size === 0) return;
      for (const handler of Array.from(set)) {
        try {
          handler(msg.params);
        } catch {}
      }
    }

    sendRequest(method, params, options) {
      const id = this.nextId++;
      const timeoutMs = options && typeof options === 'object' ? Number(options.timeoutMs) : 0;

      return new Promise((resolve, reject) => {
        const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error('request timeout'));
            }, timeoutMs)
          : null;

        this.pending.set(id, { resolve, reject, timer });
        this.transport.send({
          jsonrpc: '2.0',
          id,
          method: String(method || ''),
          ...(params === undefined ? {} : { params }),
        });
      });
    }

    sendNotification(method, params) {
      this.transport.send({
        jsonrpc: '2.0',
        method: String(method || ''),
        ...(params === undefined ? {} : { params }),
      });
    }

    onNotification(method, handler) {
      const m = String(method || '');
      if (!m || typeof handler !== 'function') return () => {};
      const set = this.notificationHandlers.get(m) || new Set();
      set.add(handler);
      this.notificationHandlers.set(m, set);
      return () => {
        const cur = this.notificationHandlers.get(m);
        if (!cur) return;
        cur.delete(handler);
        if (cur.size === 0) this.notificationHandlers.delete(m);
      };
    }

    dispose() {
      try { this.transport.close?.(); } catch {}
      this.notificationHandlers.clear();
      this._onClose();
    }
  };
}

class IpcRendererTransport {
  constructor() {
    this._onMessage = null;
    this._onClose = null;

    this._listener = (_e, msg) => {
      try {
        this._onMessage?.(msg);
      } catch {}
    };
    ipcRenderer.on('idebus:message', this._listener);
  }

  onMessage(handler) {
    this._onMessage = handler;
  }

  onClose(handler) {
    this._onClose = handler;
  }

  send(msg) {
    ipcRenderer.send('idebus:message', msg);
  }

  close() {
    try {
      ipcRenderer.off('idebus:message', this._listener);
    } catch {}
    try {
      this._onClose?.();
    } catch {}
  }
}

const ideBus = (() => {
  const transport = new IpcRendererTransport();
  const connection = new JsonRpcConnection(transport, { name: 'idebus:renderer', traceMeta: true });

  let initPromise = null;
  const ensureInit = async () => {
    if (!initPromise) {
      initPromise = connection
        .sendRequest('initialize', {
          protocolVersion: '1.0',
          clientCapabilities: {
            kind: 'renderer-preload',
          },
        })
        .catch(() => null);
    }
    return initPromise;
  };

  const request = async (method, params, options) => {
    await ensureInit();
    return connection.sendRequest(method, params, options);
  };

  const notify = async (method, params) => {
    await ensureInit();
    connection.sendNotification(method, params);
  };

  const onNotification = (method, handler) => connection.onNotification(method, handler);

  const ready = () => ensureInit();

  return { request, notify, onNotification, ready };
})();

const tryBus = async (busMethod, params, fallback) => {
  try {
    return await ideBus.request(busMethod, params);
  } catch {
    return await fallback();
  }
};

contextBridge.exposeInMainWorld('electronAPI', {
  ideBus: {
    request: (method, params, options) => ideBus.request(String(method || ''), params, options),
    notify: (method, params) => ideBus.notify(String(method || ''), params),
    onNotification: (method, handler) => ideBus.onNotification(String(method || ''), handler),
    ready: () => ideBus.ready(),
  },
  app: {
    getInfo: () => tryBus('app/getInfo', undefined, () => ipcRenderer.invoke('app:getInfo')),
  },
  openFolder: () => ipcRenderer.invoke('open-folder'),
  recent: {
    list: () => ipcRenderer.invoke('recent:list'),
    remove: (id) => ipcRenderer.invoke('recent:remove', id),
  },
  window: {
    minimize: () => tryBus('window/minimize', undefined, () => ipcRenderer.invoke('window:minimize')),
    toggleMaximize: () => tryBus('window/toggleMaximize', undefined, () => ipcRenderer.invoke('window:toggleMaximize')),
    isMaximized: () => tryBus('window/isMaximized', undefined, () => ipcRenderer.invoke('window:isMaximized')),
    openDevTools: () => tryBus('window/openDevTools', undefined, () => ipcRenderer.invoke('window:openDevTools')),
    toggleDevTools: () => tryBus('window/toggleDevTools', undefined, () => ipcRenderer.invoke('window:toggleDevTools')),
    applySnapLayout: (layoutId, zoneIndex) =>
      tryBus('window/applySnapLayout', { layoutId, zoneIndex }, () => ipcRenderer.invoke('window:applySnapLayout', { layoutId, zoneIndex })),
    openNewWindow: (payload) => tryBus('window/openNewWindow', payload, () => ipcRenderer.invoke('window:openNewWindow', payload)),
    openTerminalWindow: (payload) =>
      tryBus('window/openTerminalWindow', payload, () => ipcRenderer.invoke('window:openTerminalWindow', payload)),
    close: () => tryBus('window/close', undefined, () => ipcRenderer.invoke('window:close')),
  },
  shell: {
    showItemInFolder: (fsPath) => tryBus('shell/showItemInFolder', fsPath, () => ipcRenderer.invoke('shell:showItemInFolder', fsPath)),
    openPath: (fsPath) => tryBus('shell/openPath', fsPath, () => ipcRenderer.invoke('shell:openPath', fsPath)),
  },
  workspace: {
    pickFolder: () => tryBus('workspace/pickFolder', undefined, () => ipcRenderer.invoke('workspace:pickFolder')),
    pickFile: () => tryBus('workspace/pickFile', undefined, () => ipcRenderer.invoke('workspace:pickFile')),
    open: (payload) => tryBus('workspace/open', payload, () => ipcRenderer.invoke('workspace:open', payload)),
    close: () => tryBus('workspace/close', undefined, () => ipcRenderer.invoke('workspace:close')),
    getTrust: (fsPath) => tryBus('workspace/getTrust', { fsPath }, async () => ({ ok: false, fsPath: String(fsPath || ''), trusted: false })),
    setTrust: (fsPath, trusted) => tryBus('workspace/setTrust', { fsPath, trusted: !!trusted }, async () => ({ ok: false, fsPath: String(fsPath || ''), trusted: !!trusted })),
    getConfiguration: (section, fsPath) =>
      tryBus('workspace/getConfiguration', { section: section == null ? '' : String(section), fsPath: fsPath == null ? '' : String(fsPath) }, async () => ({ ok: false, settings: {}, section: section == null ? '' : String(section) })),
    openTextDocument: (uriOrPath) =>
      tryBus('workspace/openTextDocument', { uriOrPath }, async () => ({ ok: false, error: 'workspace/openTextDocument unavailable' })),
  },
  extensions: {
    getStatus: () => tryBus('extensions/getStatus', undefined, async () => ({ ok: false, running: false, trusted: false })),
    restart: (reason) => tryBus('extensions/restart', { reason }, async () => ({ ok: false })),
    listExtensions: () => tryBus('extensions/listExtensions', undefined, async () => ({ ok: false, items: [] })),
  },
  setTitlebarTheme: (theme) => ipcRenderer.send('renderer-theme-updated', theme),
  git: {
    status: (cwd) => ipcRenderer.invoke('git:status', cwd),
    stage: (cwd, files) => ipcRenderer.invoke('git:stage', { cwd, files }),
    unstage: (cwd, files) => ipcRenderer.invoke('git:unstage', { cwd, files }),
    restore: (cwd, files) => ipcRenderer.invoke('git:restore', { cwd, files }),
    commit: (cwd, message) => ipcRenderer.invoke('git:commit', { cwd, message }),
    push: (cwd) => ipcRenderer.invoke('git:push', cwd),
    pull: (cwd) => ipcRenderer.invoke('git:pull', cwd),
    fetch: (cwd) => ipcRenderer.invoke('git:fetch', cwd),
    branch: (cwd) => ipcRenderer.invoke('git:branch', cwd),
    createBranch: (cwd, name) => ipcRenderer.invoke('git:createBranch', { cwd, name }),
    deleteBranch: (cwd, branch) => ipcRenderer.invoke('git:deleteBranch', { cwd, branch }),
    checkout: (cwd, branch) => ipcRenderer.invoke('git:checkout', { cwd, branch }),
    log: (cwd) => ipcRenderer.invoke('git:log', cwd),
    logFile: (cwd, file) => ipcRenderer.invoke('git:logFile', { cwd, file }),
    diff: (cwd, file) => ipcRenderer.invoke('git:diff', { cwd, file }),
    clone: (parentDir, url, folderName) => ipcRenderer.invoke('git:clone', { parentDir, url, folderName }),
    init: (cwd) => ipcRenderer.invoke('git:init', cwd),
    getRemotes: (cwd) => ipcRenderer.invoke('git:getRemotes', cwd),
    addRemote: (cwd, name, url) => ipcRenderer.invoke('git:addRemote', { cwd, name, url }),
    getCommitDetails: (cwd, hash) => ipcRenderer.invoke('git:getCommitDetails', { cwd, hash }),
    getCommitStats: (cwd, hash) => ipcRenderer.invoke('git:getCommitStats', { cwd, hash }),
    getCommitFileDiffs: (cwd, hash) => ipcRenderer.invoke('git:getCommitFileDiffs', { cwd, hash }),
    getFileContent: (cwd, hash, path) => ipcRenderer.invoke('git:getFileContent', { cwd, hash, path }),
    publishBranch: (cwd, branch) => ipcRenderer.invoke('git:publishBranch', { cwd, branch }),
    setUpstream: (cwd, branch) => ipcRenderer.invoke('git:setUpstream', { cwd, branch }),
  },
  lsp: {
    ensureServer: (workspaceId, languageId, serverConfig, workspace) =>
      ipcRenderer.invoke('lsp:ensureServer', workspaceId, languageId, serverConfig, workspace),
    ensureServerForDocument: (workspaceId, languageId, filePath, workspace) =>
      ipcRenderer.invoke('lsp:ensureServerForDocument', workspaceId, languageId, filePath, workspace),
    shutdownWorkspace: (workspaceId) => ipcRenderer.invoke('lsp:shutdownWorkspace', workspaceId),
    openDocument: (serverId, doc) => ipcRenderer.invoke('lsp:openDocument', serverId, doc),
    changeDocument: (serverId, change) => ipcRenderer.invoke('lsp:changeDocument', serverId, change),
    closeDocument: (serverId, uri) => ipcRenderer.invoke('lsp:closeDocument', serverId, uri),
    completion: (serverId, params, options) => ipcRenderer.invoke('lsp:completion', serverId, params, options),
    completionResolve: (serverId, item, docUri, options) => ipcRenderer.invoke('lsp:completionResolve', serverId, item, docUri, options),
    hover: (serverId, params, options) => ipcRenderer.invoke('lsp:hover', serverId, params, options),
    definition: (serverId, params, options) => ipcRenderer.invoke('lsp:definition', serverId, params, options),
    declaration: (serverId, params, options) => ipcRenderer.invoke('lsp:declaration', serverId, params, options),
    references: (serverId, params, options) => ipcRenderer.invoke('lsp:references', serverId, params, options),
    codeAction: (serverId, params, options) => ipcRenderer.invoke('lsp:codeAction', serverId, params, options),
    codeActionResolve: (serverId, action, docUri, options) => ipcRenderer.invoke('lsp:codeActionResolve', serverId, action, docUri, options),
    signatureHelp: (serverId, params, options) => ipcRenderer.invoke('lsp:signatureHelp', serverId, params, options),
    rename: (serverId, params, options) => ipcRenderer.invoke('lsp:rename', serverId, params, options),
    format: (serverId, params, options) => ipcRenderer.invoke('lsp:format', serverId, params, options),
    rangeFormat: (serverId, params, options) => ipcRenderer.invoke('lsp:rangeFormat', serverId, params, options),
    executeCommand: (serverId, params, options) => ipcRenderer.invoke('lsp:executeCommand', serverId, params, options),
    workspaceSymbol: (serverId, params, options) => ipcRenderer.invoke('lsp:workspaceSymbol', serverId, params, options),
    documentSymbol: (serverId, params, options) => ipcRenderer.invoke('lsp:documentSymbol', serverId, params, options),
    documentColor: (serverId, params, options) => ipcRenderer.invoke('lsp:documentColor', serverId, params, options),
    colorPresentation: (serverId, params, options) => ipcRenderer.invoke('lsp:colorPresentation', serverId, params, options),
    saveDocument: (serverId, params) => ipcRenderer.invoke('lsp:saveDocument', serverId, params),
    documentLink: (serverId, params, options) => ipcRenderer.invoke('lsp:documentLink', serverId, params, options),
    documentLinkResolve: (serverId, link, docUri, options) => ipcRenderer.invoke('lsp:documentLinkResolve', serverId, link, docUri, options),
    codeLens: (serverId, params, options) => ipcRenderer.invoke('lsp:codeLens', serverId, params, options),
    codeLensResolve: (serverId, lens, docUri, options) => ipcRenderer.invoke('lsp:codeLensResolve', serverId, lens, docUri, options),
    documentHighlight: (serverId, params, options) => ipcRenderer.invoke('lsp:documentHighlight', serverId, params, options),
    selectionRange: (serverId, params, options) => ipcRenderer.invoke('lsp:selectionRange', serverId, params, options),
    linkedEditingRange: (serverId, params, options) => ipcRenderer.invoke('lsp:linkedEditingRange', serverId, params, options),
    getServerCapabilities: (serverId) => ipcRenderer.invoke('lsp:getServerCapabilities', serverId),
    semanticTokensFull: (serverId, params, options) => ipcRenderer.invoke('lsp:semanticTokensFull', serverId, params, options),
    semanticTokensFullDelta: (serverId, params, options) => ipcRenderer.invoke('lsp:semanticTokensFullDelta', serverId, params, options),
    semanticTokensRange: (serverId, params, options) => ipcRenderer.invoke('lsp:semanticTokensRange', serverId, params, options),
    inlayHint: (serverId, params, options) => ipcRenderer.invoke('lsp:inlayHint', serverId, params, options),
    foldingRange: (serverId, params, options) => ipcRenderer.invoke('lsp:foldingRange', serverId, params, options),
    typeDefinition: (serverId, params, options) => ipcRenderer.invoke('lsp:typeDefinition', serverId, params, options),
    implementation: (serverId, params, options) => ipcRenderer.invoke('lsp:implementation', serverId, params, options),
    callHierarchyPrepare: (serverId, params, options) => ipcRenderer.invoke('lsp:callHierarchyPrepare', serverId, params, options),
    callHierarchyIncoming: (serverId, params, options) => ipcRenderer.invoke('lsp:callHierarchyIncoming', serverId, params, options),
    callHierarchyOutgoing: (serverId, params, options) => ipcRenderer.invoke('lsp:callHierarchyOutgoing', serverId, params, options),
    didChangeConfiguration: (workspaceId, settings) => ipcRenderer.invoke('lsp:didChangeConfiguration', workspaceId, settings),
    willCreateFiles: (workspaceId, params, options) => ipcRenderer.invoke('lsp:willCreateFiles', workspaceId, params, options),
    didCreateFiles: (workspaceId, params) => ipcRenderer.invoke('lsp:didCreateFiles', workspaceId, params),
    willRenameFiles: (workspaceId, params, options) => ipcRenderer.invoke('lsp:willRenameFiles', workspaceId, params, options),
    didRenameFiles: (workspaceId, params) => ipcRenderer.invoke('lsp:didRenameFiles', workspaceId, params),
    willDeleteFiles: (workspaceId, params, options) => ipcRenderer.invoke('lsp:willDeleteFiles', workspaceId, params, options),
    didDeleteFiles: (workspaceId, params) => ipcRenderer.invoke('lsp:didDeleteFiles', workspaceId, params),
    cancel: (token) => ipcRenderer.invoke('lsp:cancel', token),
    applyEditResponse: (requestId, result) =>
      tryBus('lsp/applyEditResponse', { requestId: String(requestId || ''), result: result && typeof result === 'object' ? result : {} }, () => ipcRenderer.invoke('lsp:applyEditResponse', requestId, result)),
    onApplyEditRequest: (handler) => {
      if (ideBus?.onNotification) {
        return ideBus.onNotification('lsp/applyEditRequest', (payload) => handler(payload));
      }
      const fn = (_e, payload) => handler(payload);
      ipcRenderer.on('lsp:applyEditRequest', fn);
      return () => ipcRenderer.off('lsp:applyEditRequest', fn);
    },
    onDiagnostics: (handler) => {
      if (ideBus?.onNotification) {
        return ideBus.onNotification('lsp/diagnostics', (payload) => handler(payload));
      }
      const fn = (_e, payload) => handler(payload);
      ipcRenderer.on('lsp:diagnostics', fn);
      return () => ipcRenderer.off('lsp:diagnostics', fn);
    },
    onLog: (handler) => {
      if (ideBus?.onNotification) {
        return ideBus.onNotification('lsp/log', (payload) => handler(payload));
      }
      const fn = (_e, payload) => handler(payload);
      ipcRenderer.on('lsp:log', fn);
      return () => ipcRenderer.off('lsp:log', fn);
    },
    onProgress: (handler) => {
      if (ideBus?.onNotification) {
        return ideBus.onNotification('lsp/progress', (payload) => handler(payload));
      }
      const fn = (_e, payload) => handler(payload);
      ipcRenderer.on('lsp:progress', fn);
      return () => ipcRenderer.off('lsp:progress', fn);
    },
    onServerStatus: (handler) => {
      if (ideBus?.onNotification) {
        return ideBus.onNotification('lsp/serverStatus', (payload) => handler(payload));
      }
      const fn = (_e, payload) => handler(payload);
      ipcRenderer.on('lsp:serverStatus', fn);
      return () => ipcRenderer.off('lsp:serverStatus', fn);
    },
    onServerCapabilities: (handler) => {
      if (ideBus?.onNotification) {
        return ideBus.onNotification('lsp/serverCapabilities', (payload) => handler(payload));
      }
      const fn = (_e, payload) => handler(payload);
      ipcRenderer.on('lsp:serverCapabilities', fn);
      return () => ipcRenderer.off('lsp:serverCapabilities', fn);
    },
  },
	  plugins: {
	    search: (query, providerIds, options) =>
	      tryBus('plugins/search', { query, providerIds, options }, () => ipcRenderer.invoke('plugins:search', query, providerIds, options)),
	    listInstalled: () => tryBus('plugins/listInstalled', undefined, () => ipcRenderer.invoke('plugins:listInstalled')),
	    getDetails: (id) => tryBus('plugins/getDetails', { id }, () => ipcRenderer.invoke('plugins:getDetails', id)),
	    listUpdates: () => tryBus('plugins/listUpdates', undefined, () => ipcRenderer.invoke('plugins:listUpdates')),
	    install: (ref) => tryBus('plugins/install', ref, () => ipcRenderer.invoke('plugins:install', ref)),
	    uninstall: (id) => tryBus('plugins/uninstall', { id }, () => ipcRenderer.invoke('plugins:uninstall', id)),
	    enable: (id, trust) => tryBus('plugins/enable', { id, trust }, () => ipcRenderer.invoke('plugins:enable', id, trust)),
    disable: (id) => tryBus('plugins/disable', { id }, () => ipcRenderer.invoke('plugins:disable', id)),
    doctor: (id) => tryBus('plugins/doctor', { id }, () => ipcRenderer.invoke('plugins:doctor', id)),
    listEnabledLanguages: () => tryBus('plugins/listEnabledLanguages', undefined, () => ipcRenderer.invoke('plugins:listEnabledLanguages')),
    getDetail: (id, providerId, options) => {
      const resolvedProviderId = typeof providerId === 'string' ? providerId : undefined;
      const resolvedOptions =
        providerId && typeof providerId === 'object' && !Array.isArray(providerId) ? providerId : options && typeof options === 'object' ? options : undefined;

      return tryBus(
        'plugins/getDetail',
        { id, ...(resolvedProviderId ? { providerId: resolvedProviderId } : {}), ...(resolvedOptions ? { forceRefresh: !!resolvedOptions.forceRefresh } : {}) },
        async () => ({ ok: false, error: 'plugins/getDetail unavailable' })
      );
    },
    onProgress: (handler) => {
      const fn = (_e, payload) => handler(payload);
      ipcRenderer.on('plugins:progress', fn);
      return () => ipcRenderer.off('plugins:progress', fn);
    },
    onChanged: (handler) => {
      const fn = (_e, payload) => handler(payload);
      ipcRenderer.on('plugins:changed', fn);
      return () => ipcRenderer.off('plugins:changed', fn);
    },
    onError: (handler) => {
      const fn = (_e, payload) => handler(payload);
      ipcRenderer.on('plugins:error', fn);
      return () => ipcRenderer.off('plugins:error', fn);
    },
  },
  dap: {
    startSession: (payload) => tryBus('debug/startSession', payload, () => ipcRenderer.invoke('dap:startSession', payload)),
    stopSession: (sessionId) => tryBus('debug/stopSession', { sessionId }, () => ipcRenderer.invoke('dap:stopSession', sessionId)),
    sendRequest: (sessionId, command, args, options) =>
      tryBus('debug/sendRequest', { sessionId, command, args, options }, () => ipcRenderer.invoke('dap:sendRequest', sessionId, command, args, options)),
    listSessions: () => tryBus('debug/listSessions', undefined, () => ipcRenderer.invoke('dap:listSessions')),
    onEvent: (handler) => {
      if (ideBus?.onNotification) {
        return ideBus.onNotification('debug/event', (payload) => handler(payload));
      }
      const fn = (_e, payload) => handler(payload);
      ipcRenderer.on('dap:event', fn);
      return () => ipcRenderer.off('dap:event', fn);
    },
    onStatus: (handler) => {
      if (ideBus?.onNotification) {
        return ideBus.onNotification('debug/status', (payload) => handler(payload));
      }
      const fn = (_e, payload) => handler(payload);
      ipcRenderer.on('dap:status', fn);
      return () => ipcRenderer.off('dap:status', fn);
    },
  },
});
