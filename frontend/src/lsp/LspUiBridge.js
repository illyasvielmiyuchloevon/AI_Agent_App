export class LspUiBridge {
  constructor(api) {
    this.api = api || globalThis?.window?.electronAPI?.lsp || null;
  }

  isAvailable() {
    return !!this.api;
  }

  ensureServer(workspaceId, languageId, serverConfig, workspace) {
    if (!this.api?.ensureServer) throw new Error('electronAPI.lsp.ensureServer unavailable');
    return this.api.ensureServer(workspaceId, languageId, serverConfig, workspace);
  }

  ensureServerForDocument(workspaceId, languageId, filePath, workspace) {
    if (!this.api?.ensureServerForDocument) throw new Error('electronAPI.lsp.ensureServerForDocument unavailable');
    return this.api.ensureServerForDocument(workspaceId, languageId, filePath, workspace);
  }

  openDocument(serverId, doc) {
    if (!this.api?.openDocument) throw new Error('electronAPI.lsp.openDocument unavailable');
    return this.api.openDocument(serverId, doc);
  }

  changeDocument(serverId, change) {
    if (!this.api?.changeDocument) throw new Error('electronAPI.lsp.changeDocument unavailable');
    return this.api.changeDocument(serverId, change);
  }

  closeDocument(serverId, uri) {
    if (!this.api?.closeDocument) throw new Error('electronAPI.lsp.closeDocument unavailable');
    return this.api.closeDocument(serverId, uri);
  }

  completion(serverId, params, options) {
    if (!this.api?.completion) throw new Error('electronAPI.lsp.completion unavailable');
    return this.api.completion(serverId, params, options);
  }

  completionResolve(serverId, item, docUri, options) {
    if (!this.api?.completionResolve) throw new Error('electronAPI.lsp.completionResolve unavailable');
    return this.api.completionResolve(serverId, item, docUri, options);
  }

  hover(serverId, params, options) {
    if (!this.api?.hover) throw new Error('electronAPI.lsp.hover unavailable');
    return this.api.hover(serverId, params, options);
  }

  definition(serverId, params, options) {
    if (!this.api?.definition) throw new Error('electronAPI.lsp.definition unavailable');
    return this.api.definition(serverId, params, options);
  }

  declaration(serverId, params, options) {
    if (!this.api?.declaration) throw new Error('electronAPI.lsp.declaration unavailable');
    return this.api.declaration(serverId, params, options);
  }

  rename(serverId, params, options) {
    if (!this.api?.rename) throw new Error('electronAPI.lsp.rename unavailable');
    return this.api.rename(serverId, params, options);
  }

  format(serverId, params, options) {
    if (!this.api?.format) throw new Error('electronAPI.lsp.format unavailable');
    return this.api.format(serverId, params, options);
  }

  references(serverId, params, options) {
    if (!this.api?.references) throw new Error('electronAPI.lsp.references unavailable');
    return this.api.references(serverId, params, options);
  }

  codeAction(serverId, params, options) {
    if (!this.api?.codeAction) throw new Error('electronAPI.lsp.codeAction unavailable');
    return this.api.codeAction(serverId, params, options);
  }

  codeActionResolve(serverId, action, docUri, options) {
    if (!this.api?.codeActionResolve) throw new Error('electronAPI.lsp.codeActionResolve unavailable');
    return this.api.codeActionResolve(serverId, action, docUri, options);
  }

  signatureHelp(serverId, params, options) {
    if (!this.api?.signatureHelp) throw new Error('electronAPI.lsp.signatureHelp unavailable');
    return this.api.signatureHelp(serverId, params, options);
  }

  rangeFormat(serverId, params, options) {
    if (!this.api?.rangeFormat) throw new Error('electronAPI.lsp.rangeFormat unavailable');
    return this.api.rangeFormat(serverId, params, options);
  }

  executeCommand(serverId, params, options) {
    if (!this.api?.executeCommand) throw new Error('electronAPI.lsp.executeCommand unavailable');
    return this.api.executeCommand(serverId, params, options);
  }

  workspaceSymbol(serverId, params, options) {
    if (!this.api?.workspaceSymbol) throw new Error('electronAPI.lsp.workspaceSymbol unavailable');
    return this.api.workspaceSymbol(serverId, params, options);
  }

  documentSymbol(serverId, params, options) {
    if (!this.api?.documentSymbol) throw new Error('electronAPI.lsp.documentSymbol unavailable');
    return this.api.documentSymbol(serverId, params, options);
  }

  documentColor(serverId, params, options) {
    if (!this.api?.documentColor) throw new Error('electronAPI.lsp.documentColor unavailable');
    return this.api.documentColor(serverId, params, options);
  }

  colorPresentation(serverId, params, options) {
    if (!this.api?.colorPresentation) throw new Error('electronAPI.lsp.colorPresentation unavailable');
    return this.api.colorPresentation(serverId, params, options);
  }

  saveDocument(serverId, params) {
    if (!this.api?.saveDocument) throw new Error('electronAPI.lsp.saveDocument unavailable');
    return this.api.saveDocument(serverId, params);
  }

  documentLink(serverId, params, options) {
    if (!this.api?.documentLink) throw new Error('electronAPI.lsp.documentLink unavailable');
    return this.api.documentLink(serverId, params, options);
  }

  documentLinkResolve(serverId, link, docUri, options) {
    if (!this.api?.documentLinkResolve) throw new Error('electronAPI.lsp.documentLinkResolve unavailable');
    return this.api.documentLinkResolve(serverId, link, docUri, options);
  }

  codeLens(serverId, params, options) {
    if (!this.api?.codeLens) throw new Error('electronAPI.lsp.codeLens unavailable');
    return this.api.codeLens(serverId, params, options);
  }

  codeLensResolve(serverId, lens, docUri, options) {
    if (!this.api?.codeLensResolve) throw new Error('electronAPI.lsp.codeLensResolve unavailable');
    return this.api.codeLensResolve(serverId, lens, docUri, options);
  }

  documentHighlight(serverId, params, options) {
    if (!this.api?.documentHighlight) throw new Error('electronAPI.lsp.documentHighlight unavailable');
    return this.api.documentHighlight(serverId, params, options);
  }

  selectionRange(serverId, params, options) {
    if (!this.api?.selectionRange) throw new Error('electronAPI.lsp.selectionRange unavailable');
    return this.api.selectionRange(serverId, params, options);
  }

  linkedEditingRange(serverId, params, options) {
    if (!this.api?.linkedEditingRange) throw new Error('electronAPI.lsp.linkedEditingRange unavailable');
    return this.api.linkedEditingRange(serverId, params, options);
  }

  getServerCapabilities(serverId) {
    if (!this.api?.getServerCapabilities) throw new Error('electronAPI.lsp.getServerCapabilities unavailable');
    return this.api.getServerCapabilities(serverId);
  }

  semanticTokensFull(serverId, params, options) {
    if (!this.api?.semanticTokensFull) throw new Error('electronAPI.lsp.semanticTokensFull unavailable');
    return this.api.semanticTokensFull(serverId, params, options);
  }

  semanticTokensFullDelta(serverId, params, options) {
    if (!this.api?.semanticTokensFullDelta) throw new Error('electronAPI.lsp.semanticTokensFullDelta unavailable');
    return this.api.semanticTokensFullDelta(serverId, params, options);
  }

  semanticTokensRange(serverId, params, options) {
    if (!this.api?.semanticTokensRange) throw new Error('electronAPI.lsp.semanticTokensRange unavailable');
    return this.api.semanticTokensRange(serverId, params, options);
  }

  inlayHint(serverId, params, options) {
    if (!this.api?.inlayHint) throw new Error('electronAPI.lsp.inlayHint unavailable');
    return this.api.inlayHint(serverId, params, options);
  }

  foldingRange(serverId, params, options) {
    if (!this.api?.foldingRange) throw new Error('electronAPI.lsp.foldingRange unavailable');
    return this.api.foldingRange(serverId, params, options);
  }

  typeDefinition(serverId, params, options) {
    if (!this.api?.typeDefinition) throw new Error('electronAPI.lsp.typeDefinition unavailable');
    return this.api.typeDefinition(serverId, params, options);
  }

  implementation(serverId, params, options) {
    if (!this.api?.implementation) throw new Error('electronAPI.lsp.implementation unavailable');
    return this.api.implementation(serverId, params, options);
  }

  callHierarchyPrepare(serverId, params, options) {
    if (!this.api?.callHierarchyPrepare) throw new Error('electronAPI.lsp.callHierarchyPrepare unavailable');
    return this.api.callHierarchyPrepare(serverId, params, options);
  }

  callHierarchyIncoming(serverId, params, options) {
    if (!this.api?.callHierarchyIncoming) throw new Error('electronAPI.lsp.callHierarchyIncoming unavailable');
    return this.api.callHierarchyIncoming(serverId, params, options);
  }

  callHierarchyOutgoing(serverId, params, options) {
    if (!this.api?.callHierarchyOutgoing) throw new Error('electronAPI.lsp.callHierarchyOutgoing unavailable');
    return this.api.callHierarchyOutgoing(serverId, params, options);
  }

  didChangeConfiguration(workspaceId, settings) {
    if (!this.api?.didChangeConfiguration) throw new Error('electronAPI.lsp.didChangeConfiguration unavailable');
    return this.api.didChangeConfiguration(workspaceId, settings);
  }

  willCreateFiles(workspaceId, params, options) {
    if (!this.api?.willCreateFiles) throw new Error('electronAPI.lsp.willCreateFiles unavailable');
    return this.api.willCreateFiles(workspaceId, params, options);
  }

  didCreateFiles(workspaceId, params) {
    if (!this.api?.didCreateFiles) throw new Error('electronAPI.lsp.didCreateFiles unavailable');
    return this.api.didCreateFiles(workspaceId, params);
  }

  willRenameFiles(workspaceId, params, options) {
    if (!this.api?.willRenameFiles) throw new Error('electronAPI.lsp.willRenameFiles unavailable');
    return this.api.willRenameFiles(workspaceId, params, options);
  }

  didRenameFiles(workspaceId, params) {
    if (!this.api?.didRenameFiles) throw new Error('electronAPI.lsp.didRenameFiles unavailable');
    return this.api.didRenameFiles(workspaceId, params);
  }

  willDeleteFiles(workspaceId, params, options) {
    if (!this.api?.willDeleteFiles) throw new Error('electronAPI.lsp.willDeleteFiles unavailable');
    return this.api.willDeleteFiles(workspaceId, params, options);
  }

  didDeleteFiles(workspaceId, params) {
    if (!this.api?.didDeleteFiles) throw new Error('electronAPI.lsp.didDeleteFiles unavailable');
    return this.api.didDeleteFiles(workspaceId, params);
  }

  cancel(token) {
    if (!this.api?.cancel) return Promise.resolve({ ok: false });
    return this.api.cancel(token);
  }

  applyEditResponse(requestId, result) {
    if (!this.api?.applyEditResponse) throw new Error('electronAPI.lsp.applyEditResponse unavailable');
    return this.api.applyEditResponse(requestId, result);
  }

  onApplyEditRequest(handler) {
    if (!this.api?.onApplyEditRequest) return () => {};
    return this.api.onApplyEditRequest(handler);
  }

  onDiagnostics(handler) {
    if (!this.api?.onDiagnostics) return () => {};
    return this.api.onDiagnostics(handler);
  }

  onLog(handler) {
    if (!this.api?.onLog) return () => {};
    return this.api.onLog(handler);
  }

  onServerStatus(handler) {
    if (!this.api?.onServerStatus) return () => {};
    return this.api.onServerStatus(handler);
  }

  onServerCapabilities(handler) {
    if (!this.api?.onServerCapabilities) return () => {};
    return this.api.onServerCapabilities(handler);
  }
}
