const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  app: {
    getInfo: () => ipcRenderer.invoke('app:getInfo'),
  },
  openFolder: () => ipcRenderer.invoke('open-folder'),
  recent: {
    list: () => ipcRenderer.invoke('recent:list'),
    remove: (id) => ipcRenderer.invoke('recent:remove', id),
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    applySnapLayout: (layoutId, zoneIndex) => ipcRenderer.invoke('window:applySnapLayout', { layoutId, zoneIndex }),
    openNewWindow: (payload) => ipcRenderer.invoke('window:openNewWindow', payload),
    openTerminalWindow: (payload) => ipcRenderer.invoke('window:openTerminalWindow', payload),
    close: () => ipcRenderer.invoke('window:close'),
  },
  shell: {
    showItemInFolder: (fsPath) => ipcRenderer.invoke('shell:showItemInFolder', fsPath),
    openPath: (fsPath) => ipcRenderer.invoke('shell:openPath', fsPath),
  },
  workspace: {
    pickFolder: () => ipcRenderer.invoke('workspace:pickFolder'),
    pickFile: () => ipcRenderer.invoke('workspace:pickFile'),
    open: (payload) => ipcRenderer.invoke('workspace:open', payload),
    close: () => ipcRenderer.invoke('workspace:close'),
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
    openDocument: (serverId, doc) => ipcRenderer.invoke('lsp:openDocument', serverId, doc),
    changeDocument: (serverId, change) => ipcRenderer.invoke('lsp:changeDocument', serverId, change),
    closeDocument: (serverId, uri) => ipcRenderer.invoke('lsp:closeDocument', serverId, uri),
    completion: (serverId, params, options) => ipcRenderer.invoke('lsp:completion', serverId, params, options),
    completionResolve: (serverId, item, docUri, options) => ipcRenderer.invoke('lsp:completionResolve', serverId, item, docUri, options),
    hover: (serverId, params, options) => ipcRenderer.invoke('lsp:hover', serverId, params, options),
    definition: (serverId, params, options) => ipcRenderer.invoke('lsp:definition', serverId, params, options),
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
    saveDocument: (serverId, params) => ipcRenderer.invoke('lsp:saveDocument', serverId, params),
    documentLink: (serverId, params, options) => ipcRenderer.invoke('lsp:documentLink', serverId, params, options),
    documentLinkResolve: (serverId, link, docUri, options) => ipcRenderer.invoke('lsp:documentLinkResolve', serverId, link, docUri, options),
    codeLens: (serverId, params, options) => ipcRenderer.invoke('lsp:codeLens', serverId, params, options),
    codeLensResolve: (serverId, lens, docUri, options) => ipcRenderer.invoke('lsp:codeLensResolve', serverId, lens, docUri, options),
    documentHighlight: (serverId, params, options) => ipcRenderer.invoke('lsp:documentHighlight', serverId, params, options),
    selectionRange: (serverId, params, options) => ipcRenderer.invoke('lsp:selectionRange', serverId, params, options),
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
    cancel: (token) => ipcRenderer.invoke('lsp:cancel', token),
    applyEditResponse: (requestId, result) => ipcRenderer.invoke('lsp:applyEditResponse', requestId, result),
    onApplyEditRequest: (handler) => {
      const fn = (_e, payload) => handler(payload);
      ipcRenderer.on('lsp:applyEditRequest', fn);
      return () => ipcRenderer.off('lsp:applyEditRequest', fn);
    },
    onDiagnostics: (handler) => {
      const fn = (_e, payload) => handler(payload);
      ipcRenderer.on('lsp:diagnostics', fn);
      return () => ipcRenderer.off('lsp:diagnostics', fn);
    },
    onLog: (handler) => {
      const fn = (_e, payload) => handler(payload);
      ipcRenderer.on('lsp:log', fn);
      return () => ipcRenderer.off('lsp:log', fn);
    },
    onProgress: (handler) => {
      const fn = (_e, payload) => handler(payload);
      ipcRenderer.on('lsp:progress', fn);
      return () => ipcRenderer.off('lsp:progress', fn);
    },
    onServerStatus: (handler) => {
      const fn = (_e, payload) => handler(payload);
      ipcRenderer.on('lsp:serverStatus', fn);
      return () => ipcRenderer.off('lsp:serverStatus', fn);
    },
    onServerCapabilities: (handler) => {
      const fn = (_e, payload) => handler(payload);
      ipcRenderer.on('lsp:serverCapabilities', fn);
      return () => ipcRenderer.off('lsp:serverCapabilities', fn);
    },
  },
  plugins: {
    search: (query, providerIds) => ipcRenderer.invoke('plugins:search', query, providerIds),
    listInstalled: () => ipcRenderer.invoke('plugins:listInstalled'),
    listUpdates: () => ipcRenderer.invoke('plugins:listUpdates'),
    install: (ref) => ipcRenderer.invoke('plugins:install', ref),
    uninstall: (id) => ipcRenderer.invoke('plugins:uninstall', id),
    enable: (id, trust) => ipcRenderer.invoke('plugins:enable', id, trust),
    disable: (id) => ipcRenderer.invoke('plugins:disable', id),
    doctor: (id) => ipcRenderer.invoke('plugins:doctor', id),
    listEnabledLanguages: () => ipcRenderer.invoke('plugins:listEnabledLanguages'),
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
});
