const path = require('path');
const { CancellationTokenSource } = require('./jsonrpc/Cancellation');
const { DocumentStore } = require('./DocumentStore');
const { DocumentSync } = require('./DocumentSync');
const { LspServerProcess } = require('./LspServerProcess');
const { toFileUri } = require('./util/uri');
const { serverKey, normalizeWorkspace, inferWorkspaceFromRootFsPath } = require('./util/workspace');
const { mergeDynamicCapabilities } = require('./capabilities/mergeDynamicCapabilities');
const { mapClientToServer, mapServerToClient } = require('./uri/uriMapper');
const { WorkspaceFileWatchHub } = require('./watch/WorkspaceFileWatchHub');
const { getByPath } = require('./util/objectPath');
const { convertPosition, convertRange, convertFoldingRange, convertSemanticTokensData } = require('./util/positionEncoding');

class LspManager {
  constructor({ logger, onDiagnostics, onLog, onProgress, onServerStatus, getConfiguration, applyWorkspaceEdit, onCapabilitiesChanged } = {}) {
    this.logger = logger;
    this.onDiagnostics = onDiagnostics;
    this.onLog = onLog;
    this.onProgress = onProgress;
    this.onServerStatus = onServerStatus;
    this.onCapabilitiesChanged = onCapabilitiesChanged;
    this.externalGetConfiguration = getConfiguration;
    this.externalApplyWorkspaceEdit = applyWorkspaceEdit;

    this.servers = new Map(); // serverId -> {proc, store, config, workspace, restart, uriMap}
    this.pendingByToken = new Map(); // token -> CancellationTokenSource
    this.workspaceSettings = new Map(); // workspaceId -> settings object

    this.watchHub = new WorkspaceFileWatchHub({
      logger: this.logger,
      notifyDidChangeWatchedFiles: (serverId, changes) => {
        const s = this._getServer(serverId);
        s.proc.sendNotification('workspace/didChangeWatchedFiles', { changes });
      },
    });

    this.documentSync = new DocumentSync({
      logger: this.logger,
      mapClientUriToServerUri: (state, clientUri) => this._mapClientUriToServerUri(state, clientUri),
    });
  }

  _effectiveServerCapabilities(state) {
    const s = state;
    if (!s) return {};
    const base = (s.proc?.serverCapabilities && typeof s.proc.serverCapabilities === 'object') ? s.proc.serverCapabilities : {};
    const regsByMethod = s.dynamicRegistrations?.byMethod;
    return mergeDynamicCapabilities(base, regsByMethod);
  }

  async _applyWorkspaceEditFromServer(state, params) {
    const s = state;
    if (!s) return { applied: false, failureReason: 'server state is missing' };
    const label = params?.label ? String(params.label) : '';
    const edit = params?.edit;

    if (!this.externalApplyWorkspaceEdit) {
      return { applied: false, failureReason: 'applyWorkspaceEdit is not configured' };
    }

    try {
      const fromEnc = this._serverPositionEncoding(s);
      const converted = await this._convertWorkspaceEdit(s, edit, fromEnc, 'utf-16');
      const res = await this.externalApplyWorkspaceEdit({
        serverId: String(s.serverId || ''),
        workspaceId: String(s.workspace?.workspaceId || ''),
        label,
        edit: converted,
      });

      if (res && typeof res === 'object' && typeof res.applied === 'boolean') {
        return { applied: !!res.applied, failureReason: res.failureReason ? String(res.failureReason) : undefined };
      }
      if (res === true) return { applied: true };
      if (res === false) return { applied: false, failureReason: 'applyWorkspaceEdit returned false' };
      return { applied: true };
    } catch (err) {
      this.logger?.exception?.('applyWorkspaceEdit failed', err, { serverId: String(s.serverId || '') });
      return { applied: false, failureReason: err?.message || String(err) };
    }
  }

  async _mapClientUriToServerUri(state, clientUri) {
    return mapClientToServer(state, clientUri);
  }

  _mapServerUriToClientUri(state, serverUri) {
    return mapServerToClient(state, serverUri);
  }

  _serverPositionEncoding(state) {
    return this.documentSync.serverPositionEncoding(state);
  }

  async _getTextForServerUri(state, serverUri) {
    return await this.documentSync.getTextForServerUri(state, serverUri);
  }

  _convertTextEdit(text, edit, fromEncoding, toEncoding) {
    if (!edit || typeof edit !== 'object') return edit;
    if (edit.range) return { ...edit, range: convertRange(text, edit.range, fromEncoding, toEncoding) };
    if (edit.insert && edit.replace) {
      return {
        ...edit,
        insert: convertRange(text, edit.insert, fromEncoding, toEncoding),
        replace: convertRange(text, edit.replace, fromEncoding, toEncoding),
      };
    }
    return edit;
  }

  async _convertWorkspaceEdit(state, workspaceEdit, fromEncoding, toEncoding) {
    const edit = workspaceEdit && typeof workspaceEdit === 'object' ? workspaceEdit : null;
    if (!edit) return edit;
    const out = { ...edit };

    const convertEditsForUri = async (uri, edits) => {
      const serverUri = String(uri || '');
      const clientUri = this._mapServerUriToClientUri(state, serverUri);
      const docText = await this._getTextForServerUri(state, serverUri);
      const converted = (Array.isArray(edits) ? edits : []).map((e) => this._convertTextEdit(docText, e, fromEncoding, toEncoding));
      return { clientUri, converted };
    };

    if (out.changes && typeof out.changes === 'object') {
      const next = {};
      for (const [uri, edits] of Object.entries(out.changes)) {
        const { clientUri, converted } = await convertEditsForUri(uri, edits);
        next[clientUri] = converted;
      }
      out.changes = next;
    }

    if (Array.isArray(out.documentChanges)) {
      const nextDocChanges = [];
      for (const dc of out.documentChanges) {
        if (dc && dc.textDocument && Array.isArray(dc.edits)) {
          const serverUri = String(dc.textDocument.uri || '');
          const clientUri = this._mapServerUriToClientUri(state, serverUri);
          const docText = await this._getTextForServerUri(state, serverUri);
          nextDocChanges.push({
            ...dc,
            textDocument: { ...dc.textDocument, uri: clientUri },
            edits: dc.edits.map((e) => this._convertTextEdit(docText, e, fromEncoding, toEncoding)),
          });
          continue;
        }
        if (dc && dc.kind === 'rename' && dc.oldUri && dc.newUri) {
          nextDocChanges.push({
            ...dc,
            oldUri: this._mapServerUriToClientUri(state, dc.oldUri),
            newUri: this._mapServerUriToClientUri(state, dc.newUri),
          });
          continue;
        }
        if (dc && dc.kind === 'create' && dc.uri) {
          nextDocChanges.push({ ...dc, uri: this._mapServerUriToClientUri(state, dc.uri) });
          continue;
        }
        if (dc && dc.kind === 'delete' && dc.uri) {
          nextDocChanges.push({ ...dc, uri: this._mapServerUriToClientUri(state, dc.uri) });
          continue;
        }
        nextDocChanges.push(dc);
      }
      out.documentChanges = nextDocChanges;
    }

    return out;
  }

  async _convertLocations(state, locs, fromEncoding, toEncoding, { originServerUri } = {}) {
    const list = Array.isArray(locs) ? locs : (locs ? [locs] : []);
    const converted = [];
    for (const loc of list) {
      if (!loc || typeof loc !== 'object') continue;
      const serverUri = String(loc.uri || loc.targetUri || '');
      const range = loc.range || loc.targetRange || loc.targetSelectionRange;
      if (!serverUri || !range) continue;
      const clientUri = this._mapServerUriToClientUri(state, serverUri);
      const docText = await this._getTextForServerUri(state, serverUri);
      if (loc.targetUri) {
        const originText = originServerUri ? await this._getTextForServerUri(state, originServerUri) : '';
        converted.push({
          ...loc,
          targetUri: clientUri,
          targetRange: loc.targetRange ? convertRange(docText, loc.targetRange, fromEncoding, toEncoding) : loc.targetRange,
          targetSelectionRange: loc.targetSelectionRange ? convertRange(docText, loc.targetSelectionRange, fromEncoding, toEncoding) : loc.targetSelectionRange,
          originSelectionRange: loc.originSelectionRange && originText ? convertRange(originText, loc.originSelectionRange, fromEncoding, toEncoding) : loc.originSelectionRange,
        });
        continue;
      }
      converted.push({ ...loc, uri: clientUri, range: convertRange(docText, loc.range, fromEncoding, toEncoding) });
    }
    return Array.isArray(locs) ? converted : (converted[0] || null);
  }

  setWorkspaceSettings(workspaceId, settings) {
    const id = String(workspaceId || '').trim();
    if (!id) return;
    const s = settings && typeof settings === 'object' ? settings : {};
    this.workspaceSettings.set(id, s);
  }

  getWorkspaceSetting(workspaceId, section) {
    const id = String(workspaceId || '').trim();
    const root = this.workspaceSettings.get(id) || {};
    const key = String(section || '').trim();
    if (!key) return root;
    if (Object.prototype.hasOwnProperty.call(root, key)) return root[key];
    return getByPath(root, key);
  }

  async didChangeConfiguration(workspaceId, settings) {
    const id = String(workspaceId || '').trim();
    if (!id) return;
    this.setWorkspaceSettings(id, settings);

    for (const [serverId, state] of this.servers.entries()) {
      if (String(state?.workspace?.workspaceId || '') !== id) continue;
      try {
        state.proc.sendNotification('workspace/didChangeConfiguration', { settings: this.workspaceSettings.get(id) || {} });
      } catch (err) {
        this.logger?.exception?.('workspace/didChangeConfiguration notify failed', err, { serverId });
      }
    }
  }

  _supportsWorkspaceFileOperation(state, kind) {
    const s = state;
    if (!s?.proc) return false;
    const caps = this._effectiveServerCapabilities(s);
    const fileOps = caps?.workspace?.fileOperations || {};
    const regs = s.dynamicRegistrations?.byMethod;
    const registered = (method) => {
      const map = regs?.get?.(method);
      return !!(map && map instanceof Map && map.size > 0);
    };

    if (kind === 'willCreateFiles') return !!fileOps.willCreate || registered('workspace/willCreateFiles');
    if (kind === 'didCreateFiles') return !!fileOps.didCreate || registered('workspace/didCreateFiles');
    if (kind === 'willRenameFiles') return !!fileOps.willRename || registered('workspace/willRenameFiles');
    if (kind === 'didRenameFiles') return !!fileOps.didRename || registered('workspace/didRenameFiles');
    if (kind === 'willDeleteFiles') return !!fileOps.willDelete || registered('workspace/willDeleteFiles');
    if (kind === 'didDeleteFiles') return !!fileOps.didDelete || registered('workspace/didDeleteFiles');
    return false;
  }

  async _mapWorkspaceFileOperationParams(state, kind, params) {
    const s = state;
    const p = (params && typeof params === 'object') ? params : {};
    const files = Array.isArray(p.files) ? p.files : [];
    if (!s || !files.length) return { ...p, files };

    const mapped = [];
    for (const f of files) {
      if (!f || typeof f !== 'object') continue;
      if (kind.includes('Rename')) {
        const oldUri = String(f.oldUri || '');
        const newUri = String(f.newUri || '');
        if (!oldUri || !newUri) continue;
        // eslint-disable-next-line no-await-in-loop
        const serverOldUri = await this._mapClientUriToServerUri(s, oldUri);
        // eslint-disable-next-line no-await-in-loop
        const serverNewUri = await this._mapClientUriToServerUri(s, newUri);
        mapped.push({ ...f, oldUri: serverOldUri, newUri: serverNewUri });
      } else {
        const uri = String(f.uri || '');
        if (!uri) continue;
        // eslint-disable-next-line no-await-in-loop
        const serverUri = await this._mapClientUriToServerUri(s, uri);
        mapped.push({ ...f, uri: serverUri });
      }
    }

    return { ...p, files: mapped };
  }

  async _runWorkspaceWillFileOperation(workspaceId, kind, method, params, { timeoutMs = 3000, cancelToken } = {}) {
    const wid = String(workspaceId || '').trim();
    if (!wid) return { ok: false, results: [] };

    const results = [];
    for (const [serverId, state] of this.servers.entries()) {
      if (String(state?.workspace?.workspaceId || '') !== wid) continue;
      if (!this._supportsWorkspaceFileOperation(state, kind)) continue;

      await state.proc.startAndInitialize();
      const serverParams = await this._mapWorkspaceFileOperationParams(state, kind, params);

      const cts = cancelToken ? new CancellationTokenSource() : null;
      if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
      try {
        // eslint-disable-next-line no-await-in-loop
        const edit = await state.proc.sendRequest(method, serverParams, { timeoutMs, cancelToken: cts?.token }).catch(() => null);
        let applied = false;
        let failureReason;
        if (edit && this.externalApplyWorkspaceEdit) {
          // eslint-disable-next-line no-await-in-loop
          const res = await this._applyWorkspaceEditFromServer(state, { label: method, edit });
          applied = !!res?.applied;
          failureReason = res?.failureReason;
        }
        results.push({ serverId, ok: true, applied, failureReason, hasEdit: !!edit });
      } catch (err) {
        results.push({ serverId, ok: false, error: err?.message || String(err) });
      } finally {
        if (cancelToken) this.pendingByToken.delete(String(cancelToken));
      }
    }

    return { ok: true, results };
  }

  async _runWorkspaceDidFileOperation(workspaceId, kind, method, params) {
    const wid = String(workspaceId || '').trim();
    if (!wid) return { ok: false };

    for (const [serverId, state] of this.servers.entries()) {
      if (String(state?.workspace?.workspaceId || '') !== wid) continue;
      if (!this._supportsWorkspaceFileOperation(state, kind)) continue;
      try {
        await state.proc.startAndInitialize();
        const serverParams = await this._mapWorkspaceFileOperationParams(state, kind, params);
        state.proc.sendNotification(method, serverParams);
      } catch (err) {
        this.logger?.exception?.(`${method} notify failed`, err, { serverId });
      }
    }
    return { ok: true };
  }

  async willCreateFiles(workspaceId, params, options) {
    return await this._runWorkspaceWillFileOperation(workspaceId, 'willCreateFiles', 'workspace/willCreateFiles', params, options);
  }

  async didCreateFiles(workspaceId, params) {
    return await this._runWorkspaceDidFileOperation(workspaceId, 'didCreateFiles', 'workspace/didCreateFiles', params);
  }

  async willRenameFiles(workspaceId, params, { timeoutMs = 3000, cancelToken } = {}) {
    return await this._runWorkspaceWillFileOperation(workspaceId, 'willRenameFiles', 'workspace/willRenameFiles', params, { timeoutMs, cancelToken });
  }

  async didRenameFiles(workspaceId, params) {
    return await this._runWorkspaceDidFileOperation(workspaceId, 'didRenameFiles', 'workspace/didRenameFiles', params);
  }

  async willDeleteFiles(workspaceId, params, { timeoutMs = 3000, cancelToken } = {}) {
    return await this._runWorkspaceWillFileOperation(workspaceId, 'willDeleteFiles', 'workspace/willDeleteFiles', params, { timeoutMs, cancelToken });
  }

  async didDeleteFiles(workspaceId, params) {
    return await this._runWorkspaceDidFileOperation(workspaceId, 'didDeleteFiles', 'workspace/didDeleteFiles', params);
  }

  async ensureServer({ workspaceId, languageId, serverConfig, workspace }) {
    const cfg = serverConfig || {};
    if (!cfg?.transport?.command) throw new Error('serverConfig.transport.command is required');

    const hasFolders = Array.isArray(workspace?.folders) && workspace.folders.length > 0;
    let ws;
    if (workspace?.rootUri || hasFolders) {
      const rootUri = String(workspace?.rootUri || '').trim();
      const fallbackRootUri = rootUri || (workspace?.rootFsPath ? toFileUri(workspace.rootFsPath) : (hasFolders ? String(workspace.folders[0]?.uri || '') : ''));
      ws = normalizeWorkspace({ ...workspace, rootUri: fallbackRootUri });
    } else {
      ws = inferWorkspaceFromRootFsPath({ workspaceId, rootFsPath: workspace?.rootFsPath });
    }

    const rootKey = ws?.rootUri || ws?.rootFsPath || '';
    const id = serverKey({ workspaceId, rootKey, languageId, serverConfigId: cfg.id });

    const existing = this.servers.get(id);
    if (existing) {
      try {
        await existing.proc.startAndInitialize();
        return { serverId: id };
      } catch (err) {
        this.logger?.warn?.('existing server failed to initialize; recreating', { serverId: id, error: err?.message || String(err) });
        try { await existing.proc.shutdown().catch(() => {}); } catch {}
        try { this._clearDynamicRegistrations(id); } catch {}
        this.servers.delete(id);
      }
    }
    const store = new DocumentStore({ logger: this.logger?.child?.(id) || this.logger });

    const state = {
      serverId: id,
      proc: null,
      store,
      serverConfig: cfg,
      workspace: ws,
      uriMap: { clientToServer: new Map(), serverToClient: new Map() },
      dynamicRegistrations: { byId: new Map(), byMethod: new Map() },
      restart: { attempts: 0, timer: null },
    };

    const proc = new LspServerProcess({
      serverId: id,
      serverConfig: cfg,
      workspace: ws,
      logger: this.logger?.child?.(`server:${id}`) || this.logger,
      onDiagnostics: (payload) => this._onDiagnosticsFromServer(payload),
      onLog: this.onLog,
      onProgress: this.onProgress,
      onServerStatus: this.onServerStatus,
      getConfiguration: async (section) => {
        try {
          const external = await this.externalGetConfiguration?.({ workspaceId, serverId: id, section });
          if (external !== undefined) return external;
        } catch {
          // ignore
        }
        const v = this.getWorkspaceSetting(workspaceId, section);
        return v === undefined ? null : v;
      },
      onRegisterCapability: (payload) => this._onRegisterCapability(payload),
      onUnregisterCapability: (payload) => this._onUnregisterCapability(payload),
      applyWorkspaceEdit: (p) => this._applyWorkspaceEditFromServer(state, p),
    });
    state.proc = proc;
    this.servers.set(id, state);

    proc.on('exit', () => {
      this._handleServerExit(id);
    });

    try {
      await proc.startAndInitialize();
    } catch (err) {
      try { await proc.shutdown().catch(() => {}); } catch {}
      try { this._clearDynamicRegistrations(id); } catch {}
      this.servers.delete(id);
      throw err;
    }

    // Best-effort push initial configuration snapshot (some servers rely on this).
    try {
      const initial = this.workspaceSettings.get(String(workspaceId)) || {};
      proc.sendNotification('workspace/didChangeConfiguration', { settings: initial });
    } catch {
      // ignore
    }

    return { serverId: id };
  }

  _handleServerExit(serverId) {
    try {
      this._clearStaleDiagnostics(serverId);
    } catch {
      // ignore
    }
    this._scheduleRestart(serverId);
  }

  _clearStaleDiagnostics(serverId) {
    const s = this.servers.get(String(serverId));
    if (!s) return;
    for (const doc of s.store.list()) {
      const clientUri = this._mapServerUriToClientUri(s, doc.uri);
      try {
        this.onDiagnostics?.({ serverId: String(serverId), uri: clientUri, diagnostics: [], stale: true });
      } catch {
        // ignore
      }
    }
  }

  _onDiagnosticsFromServer(payload) {
    const serverId = String(payload?.serverId || '');
    const s = this.servers.get(serverId);
    if (!s) return;
    const serverUri = String(payload?.uri || '');
    const clientUri = this._mapServerUriToClientUri(s, serverUri);
    const text = s.store.get(serverUri)?.text || '';
    const enc = this._serverPositionEncoding(s);

    const diags = (Array.isArray(payload?.diagnostics) ? payload.diagnostics : []).map((d) => {
      if (!d || typeof d !== 'object') return null;
      const range = d.range ? convertRange(text, d.range, enc, 'utf-16') : d.range;
      return { ...d, range };
    }).filter(Boolean);

    this.onDiagnostics?.({ serverId, uri: clientUri, diagnostics: diags });
  }

  _scheduleRestart(serverId) {
    const s = this.servers.get(serverId);
    if (!s) return;
    if (s.restart.timer) return;

    const attempt = s.restart.attempts;
    if (attempt >= 5) {
      this.logger?.error?.('restart limit reached', { serverId });
      this.onServerStatus?.({ serverId, status: 'restart_giveup' });
      return;
    }
    const delay = Math.min(8000, 1000 * Math.pow(2, attempt));
    s.restart.attempts += 1;
    this.onServerStatus?.({ serverId, status: 'restarting', attempt: s.restart.attempts, delayMs: delay });

    s.restart.timer = setTimeout(async () => {
      s.restart.timer = null;
      try {
        await s.proc.shutdown().catch(() => {});
      } catch {}

      try {
        this._clearDynamicRegistrations(serverId);
      } catch {
        // ignore
      }

      s.proc = new LspServerProcess({
        serverId,
        serverConfig: s.serverConfig,
        workspace: s.workspace,
        logger: this.logger?.child?.(`server:${serverId}`) || this.logger,
        onDiagnostics: (payload) => this._onDiagnosticsFromServer(payload),
        onLog: this.onLog,
        onProgress: this.onProgress,
        onServerStatus: this.onServerStatus,
        getConfiguration: async (section) => {
          try {
            const external = await this.externalGetConfiguration?.({ workspaceId: s.workspace.workspaceId, serverId, section });
            if (external !== undefined) return external;
          } catch {
            // ignore
          }
          const v = this.getWorkspaceSetting(s.workspace.workspaceId, section);
          return v === undefined ? null : v;
        },
        onRegisterCapability: (payload) => this._onRegisterCapability(payload),
        onUnregisterCapability: (payload) => this._onUnregisterCapability(payload),
        applyWorkspaceEdit: (p) => this._applyWorkspaceEditFromServer(s, p),
      });
      s.proc.on('exit', () => this._handleServerExit(serverId));

      try {
        await s.proc.startAndInitialize();
        s.restart.attempts = 0;
        this.documentSync.reopenAll(s);
      } catch (err) {
        this.logger?.exception?.('restart failed', err, { serverId });
        this._scheduleRestart(serverId);
      }
    }, delay);
  }

  _clearDynamicRegistrations(serverId) {
    const sid = String(serverId || '');
    const s = this.servers.get(sid);
    if (!s) return;

    try {
      this.watchHub?.disposeServer?.(sid);
    } catch {}

    // generic registrations
    try {
      s.dynamicRegistrations.byId.clear();
      s.dynamicRegistrations.byMethod.clear();
    } catch {}
  }

  _getServer(serverId) {
    const s = this.servers.get(String(serverId));
    if (!s) throw new Error(`Unknown serverId: ${serverId}`);
    return s;
  }

  trackPendingToken(token, cts) {
    if (!token) return;
    this.pendingByToken.set(String(token), cts);
  }

  cancel(token) {
    const t = String(token || '');
    const cts = this.pendingByToken.get(t);
    if (!cts) return false;
    this.pendingByToken.delete(t);
    try { cts.cancel(); } catch {}
    return true;
  }

  async openDocument(serverId, doc) {
    const s = this._getServer(serverId);
    return await this.documentSync.openDocument(s, doc);
  }

  async changeDocument(serverId, change) {
    const s = this._getServer(serverId);
    return await this.documentSync.changeDocument(s, change);
  }

  async closeDocument(serverId, uri) {
    const s = this._getServer(serverId);
    return await this.documentSync.closeDocument(s, uri);
  }

  async saveDocument(serverId, params) {
    const s = this._getServer(serverId);
    return await this.documentSync.saveDocument(s, params);
  }

  async completion(serverId, params, { timeoutMs = 2000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = {
      ...params,
      textDocument: { ...(params?.textDocument || {}), uri: serverUri },
      position: params?.position ? convertPosition(text, params.position, 'utf-16', serverEnc) : params?.position,
    };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/completion', serverParams, { timeoutMs, cancelToken: cts?.token });
      const convertItem = (it) => {
        if (!it || typeof it !== 'object') return it;
        const next = { ...it };
        if (next.textEdit) next.textEdit = this._convertTextEdit(text, next.textEdit, serverEnc, 'utf-16');
        if (Array.isArray(next.additionalTextEdits)) next.additionalTextEdits = next.additionalTextEdits.map((e) => this._convertTextEdit(text, e, serverEnc, 'utf-16'));
        return next;
      };
      if (Array.isArray(result)) return result.map(convertItem);
      if (result && typeof result === 'object' && Array.isArray(result.items)) return { ...result, items: result.items.map(convertItem) };
      return result;
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async completionResolve(serverId, completionItem, docUri, { timeoutMs = 2000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(docUri || '');
    const serverUri = clientUri ? await this._mapClientUriToServerUri(s, clientUri) : '';
    const serverEnc = this._serverPositionEncoding(s);
    const text = serverUri ? await this._getTextForServerUri(s, serverUri) : '';

    const item = completionItem && typeof completionItem === 'object' ? completionItem : {};
    const serverItem = { ...item };
    if (serverItem.textEdit) serverItem.textEdit = this._convertTextEdit(text, serverItem.textEdit, 'utf-16', serverEnc);
    if (Array.isArray(serverItem.additionalTextEdits)) {
      serverItem.additionalTextEdits = serverItem.additionalTextEdits.map((e) => this._convertTextEdit(text, e, 'utf-16', serverEnc));
    }

    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('completionItem/resolve', serverItem, { timeoutMs, cancelToken: cts?.token });
      if (!result || typeof result !== 'object') return result;
      const next = { ...result };
      if (next.textEdit) next.textEdit = this._convertTextEdit(text, next.textEdit, serverEnc, 'utf-16');
      if (Array.isArray(next.additionalTextEdits)) next.additionalTextEdits = next.additionalTextEdits.map((e) => this._convertTextEdit(text, e, serverEnc, 'utf-16'));
      return next;
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async hover(serverId, params, { timeoutMs = 2000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = {
      ...params,
      textDocument: { ...(params?.textDocument || {}), uri: serverUri },
      position: params?.position ? convertPosition(text, params.position, 'utf-16', serverEnc) : params?.position,
    };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/hover', serverParams, { timeoutMs, cancelToken: cts?.token });
      if (!result || typeof result !== 'object') return result;
      if (!result.range) return result;
      return { ...result, range: convertRange(text, result.range, serverEnc, 'utf-16') };
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async definition(serverId, params, { timeoutMs = 2000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = {
      ...params,
      textDocument: { ...(params?.textDocument || {}), uri: serverUri },
      position: params?.position ? convertPosition(text, params.position, 'utf-16', serverEnc) : params?.position,
    };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/definition', serverParams, { timeoutMs, cancelToken: cts?.token });
      return await this._convertLocations(s, result, serverEnc, 'utf-16', { originServerUri: serverUri });
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async declaration(serverId, params, { timeoutMs = 2000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = {
      ...params,
      textDocument: { ...(params?.textDocument || {}), uri: serverUri },
      position: params?.position ? convertPosition(text, params.position, 'utf-16', serverEnc) : params?.position,
    };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/declaration', serverParams, { timeoutMs, cancelToken: cts?.token });
      return await this._convertLocations(s, result, serverEnc, 'utf-16', { originServerUri: serverUri });
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async documentColor(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = { ...params, textDocument: { ...(params?.textDocument || {}), uri: serverUri } };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/documentColor', serverParams, { timeoutMs, cancelToken: cts?.token });
      const list = Array.isArray(result) ? result : [];
      return list.map((ci) => {
        if (!ci || typeof ci !== 'object') return ci;
        if (!ci.range) return ci;
        return { ...ci, range: convertRange(text, ci.range, serverEnc, 'utf-16') };
      });
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async colorPresentation(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = {
      ...params,
      textDocument: { ...(params?.textDocument || {}), uri: serverUri },
      range: params?.range ? convertRange(text, params.range, 'utf-16', serverEnc) : params?.range,
    };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/colorPresentation', serverParams, { timeoutMs, cancelToken: cts?.token });
      const list = Array.isArray(result) ? result : [];
      const out = [];
      for (const cp of list) {
        if (!cp || typeof cp !== 'object') {
          out.push(cp);
          continue;
        }
        const next = { ...cp };
        if (next.textEdit) next.textEdit = this._convertTextEdit(text, next.textEdit, serverEnc, 'utf-16');
        if (Array.isArray(next.additionalTextEdits)) next.additionalTextEdits = next.additionalTextEdits.map((e) => this._convertTextEdit(text, e, serverEnc, 'utf-16'));
        out.push(next);
      }
      return out;
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async linkedEditingRange(serverId, params, { timeoutMs = 2000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = {
      ...params,
      textDocument: { ...(params?.textDocument || {}), uri: serverUri },
      position: params?.position ? convertPosition(text, params.position, 'utf-16', serverEnc) : params?.position,
    };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/linkedEditingRange', serverParams, { timeoutMs, cancelToken: cts?.token });
      if (!result || typeof result !== 'object') return result;
      const ranges = Array.isArray(result.ranges) ? result.ranges : [];
      return {
        ...result,
        ranges: ranges.map((r) => (r ? convertRange(text, r, serverEnc, 'utf-16') : r)),
      };
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async workspaceSymbol(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const serverEnc = this._serverPositionEncoding(s);
      const result = await s.proc.sendRequest('workspace/symbol', params, { timeoutMs, cancelToken: cts?.token });
      const list = Array.isArray(result) ? result : [];
      const out = [];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const loc = item.location;
        if (!loc || typeof loc !== 'object' || !loc.uri || !loc.range) {
          out.push(item);
          continue;
        }
        const serverUri = String(loc.uri);
        const text = await this._getTextForServerUri(s, serverUri);
        out.push({
          ...item,
          location: {
            ...loc,
            uri: this._mapServerUriToClientUri(s, serverUri),
            range: convertRange(text, loc.range, serverEnc, 'utf-16'),
          },
        });
      }
      return out;
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async documentSymbol(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = { ...params, textDocument: { ...(params?.textDocument || {}), uri: serverUri } };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/documentSymbol', serverParams, { timeoutMs, cancelToken: cts?.token });
      const convertDocumentSymbol = (sym) => {
        if (!sym || typeof sym !== 'object') return sym;
        const next = { ...sym };
        if (next.range) next.range = convertRange(text, next.range, serverEnc, 'utf-16');
        if (next.selectionRange) next.selectionRange = convertRange(text, next.selectionRange, serverEnc, 'utf-16');
        if (Array.isArray(next.children)) next.children = next.children.map(convertDocumentSymbol);
        return next;
      };
      if (Array.isArray(result) && result.length && result[0] && typeof result[0] === 'object' && 'range' in result[0]) {
        return result.map(convertDocumentSymbol);
      }
      // SymbolInformation[]
      if (Array.isArray(result)) {
        const out = [];
        for (const item of result) {
          if (!item || typeof item !== 'object' || !item.location) {
            out.push(item);
            continue;
          }
          const loc = item.location;
          const locServerUri = String(loc.uri || '');
          const locText = locServerUri ? await this._getTextForServerUri(s, locServerUri) : '';
          out.push({
            ...item,
            location: {
              ...loc,
              uri: this._mapServerUriToClientUri(s, locServerUri),
              range: loc.range ? convertRange(locText, loc.range, serverEnc, 'utf-16') : loc.range,
            },
          });
        }
        return out;
      }
      return result;
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async getServerCapabilities(serverId) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    return this._effectiveServerCapabilities(s);
  }

  async documentLink(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = { ...params, textDocument: { ...(params?.textDocument || {}), uri: serverUri } };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/documentLink', serverParams, { timeoutMs, cancelToken: cts?.token });
      const list = Array.isArray(result) ? result : [];
      return list.map((l) => {
        if (!l || typeof l !== 'object') return l;
        const next = { ...l };
        if (next.range) next.range = convertRange(text, next.range, serverEnc, 'utf-16');
        return next;
      });
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async documentLinkResolve(serverId, link, docUri, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(docUri || '');
    const serverUri = clientUri ? await this._mapClientUriToServerUri(s, clientUri) : '';
    const serverEnc = this._serverPositionEncoding(s);
    const text = serverUri ? await this._getTextForServerUri(s, serverUri) : '';

    const l = link && typeof link === 'object' ? link : {};
    const serverLink = { ...l };
    if (serverLink.range) serverLink.range = convertRange(text, serverLink.range, 'utf-16', serverEnc);

    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('documentLink/resolve', serverLink, { timeoutMs, cancelToken: cts?.token });
      if (!result || typeof result !== 'object') return result;
      const next = { ...result };
      if (next.range) next.range = convertRange(text, next.range, serverEnc, 'utf-16');
      return next;
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async codeLens(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = { ...params, textDocument: { ...(params?.textDocument || {}), uri: serverUri } };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/codeLens', serverParams, { timeoutMs, cancelToken: cts?.token });
      const list = Array.isArray(result) ? result : [];
      return list.map((l) => {
        if (!l || typeof l !== 'object') return l;
        const next = { ...l };
        if (next.range) next.range = convertRange(text, next.range, serverEnc, 'utf-16');
        return next;
      });
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async codeLensResolve(serverId, lens, docUri, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(docUri || '');
    const serverUri = clientUri ? await this._mapClientUriToServerUri(s, clientUri) : '';
    const serverEnc = this._serverPositionEncoding(s);
    const text = serverUri ? await this._getTextForServerUri(s, serverUri) : '';

    const l = lens && typeof lens === 'object' ? lens : {};
    const serverLens = { ...l };
    if (serverLens.range) serverLens.range = convertRange(text, serverLens.range, 'utf-16', serverEnc);

    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('codeLens/resolve', serverLens, { timeoutMs, cancelToken: cts?.token });
      if (!result || typeof result !== 'object') return result;
      const next = { ...result };
      if (next.range) next.range = convertRange(text, next.range, serverEnc, 'utf-16');
      return next;
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async documentHighlight(serverId, params, { timeoutMs = 2000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = {
      ...params,
      textDocument: { ...(params?.textDocument || {}), uri: serverUri },
      position: params?.position ? convertPosition(text, params.position, 'utf-16', serverEnc) : params?.position,
    };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/documentHighlight', serverParams, { timeoutMs, cancelToken: cts?.token });
      const list = Array.isArray(result) ? result : [];
      return list.map((h) => {
        if (!h || typeof h !== 'object') return h;
        const next = { ...h };
        if (next.range) next.range = convertRange(text, next.range, serverEnc, 'utf-16');
        return next;
      });
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async selectionRange(serverId, params, { timeoutMs = 2000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = {
      ...params,
      textDocument: { ...(params?.textDocument || {}), uri: serverUri },
      positions: Array.isArray(params?.positions) ? params.positions.map((p) => convertPosition(text, p, 'utf-16', serverEnc)) : params?.positions,
    };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/selectionRange', serverParams, { timeoutMs, cancelToken: cts?.token });
      const list = Array.isArray(result) ? result : [];
      const convertOne = (sr) => {
        if (!sr || typeof sr !== 'object') return sr;
        const next = { ...sr };
        if (next.range) next.range = convertRange(text, next.range, serverEnc, 'utf-16');
        if (next.parent) next.parent = convertOne(next.parent);
        return next;
      };
      return list.map(convertOne);
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async semanticTokensFull(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = { ...params, textDocument: { ...(params?.textDocument || {}), uri: serverUri } };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/semanticTokens/full', serverParams, { timeoutMs, cancelToken: cts?.token });
      if (!result || typeof result !== 'object') return result;
      if (!Array.isArray(result.data)) return result;
      return { ...result, data: convertSemanticTokensData(text, result.data, serverEnc, 'utf-16') };
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async semanticTokensFullDelta(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = { ...params, textDocument: { ...(params?.textDocument || {}), uri: serverUri } };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/semanticTokens/full/delta', serverParams, { timeoutMs, cancelToken: cts?.token });
      if (!result || typeof result !== 'object') return result;
      if (Array.isArray(result.data)) return { ...result, data: convertSemanticTokensData(text, result.data, serverEnc, 'utf-16') };
      if (Array.isArray(result.edits)) {
        return {
          ...result,
          edits: result.edits.map((e) => {
            if (!e || typeof e !== 'object' || !Array.isArray(e.data)) return e;
            return { ...e, data: convertSemanticTokensData(text, e.data, serverEnc, 'utf-16') };
          }),
        };
      }
      return result;
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async semanticTokensRange(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = {
      ...params,
      textDocument: { ...(params?.textDocument || {}), uri: serverUri },
      range: params?.range ? convertRange(text, params.range, 'utf-16', serverEnc) : params?.range,
    };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/semanticTokens/range', serverParams, { timeoutMs, cancelToken: cts?.token });
      if (!result || typeof result !== 'object') return result;
      if (!Array.isArray(result.data)) return result;
      return { ...result, data: convertSemanticTokensData(text, result.data, serverEnc, 'utf-16') };
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async inlayHint(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = {
      ...params,
      textDocument: { ...(params?.textDocument || {}), uri: serverUri },
      range: params?.range ? convertRange(text, params.range, 'utf-16', serverEnc) : params?.range,
    };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/inlayHint', serverParams, { timeoutMs, cancelToken: cts?.token });
      const list = Array.isArray(result) ? result : [];
      const out = [];
      for (const h of list) {
        if (!h || typeof h !== 'object') continue;
        const next = { ...h };
        if (next.position) next.position = convertPosition(text, next.position, serverEnc, 'utf-16');
        if (Array.isArray(next.textEdits)) next.textEdits = next.textEdits.map((e) => this._convertTextEdit(text, e, serverEnc, 'utf-16'));
        const label = next.label;
        if (Array.isArray(label)) {
          next.label = await Promise.all(label.map(async (p) => {
            if (!p || typeof p !== 'object' || !p.location) return p;
            const loc = p.location;
            const locServerUri = String(loc.uri || '');
            const locText = locServerUri ? await this._getTextForServerUri(s, locServerUri) : '';
            return {
              ...p,
              location: {
                ...loc,
                uri: this._mapServerUriToClientUri(s, locServerUri),
                range: loc.range ? convertRange(locText, loc.range, serverEnc, 'utf-16') : loc.range,
              },
            };
          }));
        }
        out.push(next);
      }
      return out;
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async foldingRange(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = { ...params, textDocument: { ...(params?.textDocument || {}), uri: serverUri } };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/foldingRange', serverParams, { timeoutMs, cancelToken: cts?.token });
      const list = Array.isArray(result) ? result : [];
      return list.map((fr) => convertFoldingRange(text, fr, serverEnc, 'utf-16'));
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async typeDefinition(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = {
      ...params,
      textDocument: { ...(params?.textDocument || {}), uri: serverUri },
      position: params?.position ? convertPosition(text, params.position, 'utf-16', serverEnc) : params?.position,
    };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/typeDefinition', serverParams, { timeoutMs, cancelToken: cts?.token });
      return await this._convertLocations(s, result, serverEnc, 'utf-16', { originServerUri: serverUri });
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async implementation(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = {
      ...params,
      textDocument: { ...(params?.textDocument || {}), uri: serverUri },
      position: params?.position ? convertPosition(text, params.position, 'utf-16', serverEnc) : params?.position,
    };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/implementation', serverParams, { timeoutMs, cancelToken: cts?.token });
      return await this._convertLocations(s, result, serverEnc, 'utf-16', { originServerUri: serverUri });
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async callHierarchyPrepare(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = {
      ...params,
      textDocument: { ...(params?.textDocument || {}), uri: serverUri },
      position: params?.position ? convertPosition(text, params.position, 'utf-16', serverEnc) : params?.position,
    };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/prepareCallHierarchy', serverParams, { timeoutMs, cancelToken: cts?.token });
      const list = Array.isArray(result) ? result : [];
      const out = [];
      for (const it of list) {
        if (!it || typeof it !== 'object') {
          out.push(it);
          continue;
        }
        const itemServerUri = String(it.uri || '');
        const itemText = itemServerUri ? await this._getTextForServerUri(s, itemServerUri) : text;
        const next = { ...it, uri: this._mapServerUriToClientUri(s, itemServerUri) };
        if (next.range) next.range = convertRange(itemText, next.range, serverEnc, 'utf-16');
        if (next.selectionRange) next.selectionRange = convertRange(itemText, next.selectionRange, serverEnc, 'utf-16');
        out.push(next);
      }
      return out;
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async callHierarchyIncoming(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const item = params?.item || {};
    const clientUri = String(item?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverItem = {
      ...item,
      uri: serverUri,
      range: item?.range ? convertRange(text, item.range, 'utf-16', serverEnc) : item?.range,
      selectionRange: item?.selectionRange ? convertRange(text, item.selectionRange, 'utf-16', serverEnc) : item?.selectionRange,
    };
    const serverParams = { ...params, item: serverItem };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('callHierarchy/incomingCalls', serverParams, { timeoutMs, cancelToken: cts?.token });
      const list = Array.isArray(result) ? result : [];
      const out = [];
      for (const call of list) {
        if (!call || typeof call !== 'object' || !call.from) {
          out.push(call);
          continue;
        }
        const fromUri = String(call.from.uri || '');
        const fromText = fromUri ? await this._getTextForServerUri(s, fromUri) : '';
        out.push({
          ...call,
          from: {
            ...call.from,
            uri: this._mapServerUriToClientUri(s, fromUri),
            range: call.from.range ? convertRange(fromText, call.from.range, serverEnc, 'utf-16') : call.from.range,
            selectionRange: call.from.selectionRange ? convertRange(fromText, call.from.selectionRange, serverEnc, 'utf-16') : call.from.selectionRange,
          },
          fromRanges: Array.isArray(call.fromRanges) ? call.fromRanges.map((r) => convertRange(fromText, r, serverEnc, 'utf-16')) : call.fromRanges,
        });
      }
      return out;
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async callHierarchyOutgoing(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const item = params?.item || {};
    const clientUri = String(item?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverItem = {
      ...item,
      uri: serverUri,
      range: item?.range ? convertRange(text, item.range, 'utf-16', serverEnc) : item?.range,
      selectionRange: item?.selectionRange ? convertRange(text, item.selectionRange, 'utf-16', serverEnc) : item?.selectionRange,
    };
    const serverParams = { ...params, item: serverItem };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('callHierarchy/outgoingCalls', serverParams, { timeoutMs, cancelToken: cts?.token });
      const list = Array.isArray(result) ? result : [];
      const out = [];
      for (const call of list) {
        if (!call || typeof call !== 'object' || !call.to) {
          out.push(call);
          continue;
        }
        const toUri = String(call.to.uri || '');
        const toText = toUri ? await this._getTextForServerUri(s, toUri) : '';
        out.push({
          ...call,
          to: {
            ...call.to,
            uri: this._mapServerUriToClientUri(s, toUri),
            range: call.to.range ? convertRange(toText, call.to.range, serverEnc, 'utf-16') : call.to.range,
            selectionRange: call.to.selectionRange ? convertRange(toText, call.to.selectionRange, serverEnc, 'utf-16') : call.to.selectionRange,
          },
          fromRanges: Array.isArray(call.fromRanges) ? call.fromRanges.map((r) => convertRange(text, r, serverEnc, 'utf-16')) : call.fromRanges,
        });
      }
      return out;
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async references(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = {
      ...params,
      textDocument: { ...(params?.textDocument || {}), uri: serverUri },
      position: params?.position ? convertPosition(text, params.position, 'utf-16', serverEnc) : params?.position,
    };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/references', serverParams, { timeoutMs, cancelToken: cts?.token });
      return await this._convertLocations(s, result, serverEnc, 'utf-16', { originServerUri: serverUri });
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async codeAction(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = {
      ...params,
      textDocument: { ...(params?.textDocument || {}), uri: serverUri },
      range: params?.range ? convertRange(text, params.range, 'utf-16', serverEnc) : params?.range,
      context: params?.context && typeof params.context === 'object'
        ? {
          ...params.context,
          diagnostics: Array.isArray(params.context.diagnostics)
            ? params.context.diagnostics.map((d) => (d && d.range ? { ...d, range: convertRange(text, d.range, 'utf-16', serverEnc) } : d))
            : params.context.diagnostics,
        }
        : params?.context,
    };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/codeAction', serverParams, { timeoutMs, cancelToken: cts?.token });
      const list = Array.isArray(result) ? result : [];
      const out = [];
      for (const ca of list) {
        if (!ca || typeof ca !== 'object' || (!ca.edit && !ca.diagnostics)) {
          out.push(ca);
          continue;
        }
        const next = { ...ca };
        if (Array.isArray(next.diagnostics)) {
          next.diagnostics = next.diagnostics.map((d) => (d && d.range ? { ...d, range: convertRange(text, d.range, serverEnc, 'utf-16') } : d));
        }
        if (next.edit) next.edit = await this._convertWorkspaceEdit(s, next.edit, serverEnc, 'utf-16');
        out.push(next);
      }
      return out;
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async codeActionResolve(serverId, codeAction, docUri, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(docUri || '');
    const serverUri = clientUri ? await this._mapClientUriToServerUri(s, clientUri) : '';
    const serverEnc = this._serverPositionEncoding(s);
    const text = serverUri ? await this._getTextForServerUri(s, serverUri) : '';

    const action = codeAction && typeof codeAction === 'object' ? codeAction : {};
    const serverAction = { ...action };
    if (Array.isArray(serverAction.diagnostics)) {
      serverAction.diagnostics = serverAction.diagnostics.map((d) => (d && d.range ? { ...d, range: convertRange(text, d.range, 'utf-16', serverEnc) } : d));
    }
    if (serverAction.edit) serverAction.edit = await this._convertWorkspaceEdit(s, serverAction.edit, 'utf-16', serverEnc);

    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('codeAction/resolve', serverAction, { timeoutMs, cancelToken: cts?.token });
      if (!result || typeof result !== 'object') return result;
      const next = { ...result };
      if (Array.isArray(next.diagnostics)) {
        next.diagnostics = next.diagnostics.map((d) => (d && d.range ? { ...d, range: convertRange(text, d.range, serverEnc, 'utf-16') } : d));
      }
      if (next.edit) next.edit = await this._convertWorkspaceEdit(s, next.edit, serverEnc, 'utf-16');
      return next;
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async signatureHelp(serverId, params, { timeoutMs = 2000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = {
      ...params,
      textDocument: { ...(params?.textDocument || {}), uri: serverUri },
      position: params?.position ? convertPosition(text, params.position, 'utf-16', serverEnc) : params?.position,
    };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      return await s.proc.sendRequest('textDocument/signatureHelp', serverParams, { timeoutMs, cancelToken: cts?.token });
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async rangeFormat(serverId, params, { timeoutMs = 5000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = {
      ...params,
      textDocument: { ...(params?.textDocument || {}), uri: serverUri },
      range: params?.range ? convertRange(text, params.range, 'utf-16', serverEnc) : params?.range,
    };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/rangeFormatting', serverParams, { timeoutMs, cancelToken: cts?.token });
      const list = Array.isArray(result) ? result : [];
      return list.map((e) => this._convertTextEdit(text, e, serverEnc, 'utf-16'));
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async executeCommand(serverId, params, { timeoutMs = 8000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      return await s.proc.sendRequest('workspace/executeCommand', params, { timeoutMs, cancelToken: cts?.token });
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async rename(serverId, params, { timeoutMs = 5000 } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = {
      ...params,
      textDocument: { ...(params?.textDocument || {}), uri: serverUri },
      position: params?.position ? convertPosition(text, params.position, 'utf-16', serverEnc) : params?.position,
    };
    const result = await s.proc.sendRequest('textDocument/rename', serverParams, { timeoutMs });
    return await this._convertWorkspaceEdit(s, result, serverEnc, 'utf-16');
  }

  async format(serverId, params, { timeoutMs = 5000 } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = { ...params, textDocument: { ...(params?.textDocument || {}), uri: serverUri } };
    const result = await s.proc.sendRequest('textDocument/formatting', serverParams, { timeoutMs });
    const list = Array.isArray(result) ? result : [];
    return list.map((e) => this._convertTextEdit(text, e, serverEnc, 'utf-16'));
  }

  async shutdownServer(serverId) {
    const key = String(serverId);
    const s = this.servers.get(key);
    if (!s) return;
    try {
      if (s.restart?.timer) clearTimeout(s.restart.timer);
    } catch {}
    try {
      await s.proc.shutdown();
    } catch (err) {
      this.logger?.exception?.('shutdownServer failed', err, { serverId: key });
    } finally {
      try { this._clearDynamicRegistrations(key); } catch {}
      this.servers.delete(key);
    }
  }

  async shutdownWorkspace(workspaceId) {
    const wid = String(workspaceId || '').trim();
    if (!wid) return;
    const prefix = `${wid}::`;
    const ids = Array.from(this.servers.keys()).filter((id) => String(id || '').startsWith(prefix));
    for (const id of ids) {
      await this.shutdownServer(id);
    }
    try {
      this.watchHub?.disposeWorkspace?.(wid);
    } catch {}
    try {
      this.workspaceSettings.delete(wid);
    } catch {
      // ignore
    }
  }

  async shutdownAll() {
    for (const id of Array.from(this.servers.keys())) {
      await this.shutdownServer(id);
    }
  }

  _onRegisterCapability({ serverId, id, method, registerOptions }) {
    const sid = String(serverId || '');
    const s = this.servers.get(sid);
    if (!s) return;
    const regId = String(id || '');
    const m = String(method || '');

    try {
      if (!s.dynamicRegistrations) s.dynamicRegistrations = { byId: new Map(), byMethod: new Map() };
      const reg = { id: regId, method: m, registerOptions };
      if (regId) s.dynamicRegistrations.byId.set(regId, reg);
      if (m) {
        if (!s.dynamicRegistrations.byMethod.has(m)) s.dynamicRegistrations.byMethod.set(m, new Map());
        s.dynamicRegistrations.byMethod.get(m).set(regId || `__noid__${Date.now()}`, reg);
      }
    } catch {
      // ignore
    }

    try {
      const caps = this._effectiveServerCapabilities(s);
      this.onCapabilitiesChanged?.({ serverId: sid, capabilities: caps, change: { type: 'register', id: regId, method: m } });
    } catch {
      // ignore
    }

    if (m !== 'workspace/didChangeWatchedFiles') return;

    try {
      const s = this._getServer(serverId);
      const watchers = Array.isArray(registerOptions?.watchers) ? registerOptions.watchers : [];
      this.watchHub?.register?.(serverId, s.workspace, { registrationId: String(id || ''), watchers });
    } catch {
      // ignore
    }
  }

  _onUnregisterCapability({ serverId, id, method }) {
    const sid = String(serverId || '');
    const s = this.servers.get(sid);
    const regId = String(id || '');
    const m = String(method || '');

    try {
      if (s?.dynamicRegistrations?.byId) s.dynamicRegistrations.byId.delete(regId);
      const map = s?.dynamicRegistrations?.byMethod?.get?.(m);
      if (map && map instanceof Map) {
        map.delete(regId);
        if (map.size === 0) s.dynamicRegistrations.byMethod.delete(m);
      }
    } catch {
      // ignore
    }

    try {
      const caps = this._effectiveServerCapabilities(s);
      this.onCapabilitiesChanged?.({ serverId: sid, capabilities: caps, change: { type: 'unregister', id: regId, method: m } });
    } catch {
      // ignore
    }

    if (m !== 'workspace/didChangeWatchedFiles') return;

    try {
      this.watchHub?.unregister?.(serverId, String(id || ''));
    } catch {
      // ignore
    }
  }
}

module.exports = { LspManager };
