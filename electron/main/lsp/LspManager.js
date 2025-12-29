const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const minimatchPkg = require('minimatch');
const minimatch =
  (typeof minimatchPkg === 'function' && minimatchPkg) ||
  minimatchPkg?.minimatch ||
  minimatchPkg?.default;
const { CancellationTokenSource } = require('./jsonrpc/Cancellation');
const { DocumentStore } = require('./DocumentStore');
const { LspServerProcess } = require('./LspServerProcess');
const { toFileUri, fromFileUri } = require('./util/uri');
const { debounce } = require('./util/debounce');
const { getByPath } = require('./util/objectPath');
const { offsetAt } = require('./util/position');
const { convertPosition, convertRange, convertFoldingRange, convertSemanticTokensData, normalizePositionEncoding } = require('./util/positionEncoding');

function serverKey({ workspaceId, rootKey, languageId, serverConfigId }) {
  const wid = String(workspaceId);
  const root = String(rootKey || '');
  const lang = String(languageId);
  const cfg = String(serverConfigId);
  return `${wid}::${root}::${lang}::${cfg}`;
}

function normalizeWorkspace(workspace) {
  const rootUri = String(workspace?.rootUri || '');
  const workspaceId = String(workspace?.workspaceId || '');
  const folders = Array.isArray(workspace?.folders) ? workspace.folders : [];
  let rootFsPath = String(workspace?.rootFsPath || '').trim();
  if (!rootFsPath && rootUri && rootUri.startsWith('file://')) {
    rootFsPath = fromFileUri(rootUri);
  }
  return { workspaceId, rootUri, folders, rootFsPath };
}

function inferWorkspaceFromRootFsPath({ workspaceId, rootFsPath }) {
  const p = String(rootFsPath || '').trim();
  if (!p) return { workspaceId: String(workspaceId || ''), rootUri: '', folders: [] };
  const uri = toFileUri(p);
  return {
    workspaceId: String(workspaceId || ''),
    rootUri: uri,
    folders: [{ name: path.basename(p), uri }],
    rootFsPath: p,
  };
}

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

    // didChangeWatchedFiles support (per workspace watcher, per server globs)
    this.watchedFilesRegs = new Map(); // serverId -> { watchers, registrationsById }
    this.workspaceFileWatchers = new Map(); // workspaceId -> { watcher, rootsFsPaths, serverIds:Set, queueByServer:Map }
    if (typeof minimatch !== 'function') throw new Error('minimatch dependency is not available');
  }

  _mergeDynamicCapabilities(baseCaps, regsByMethod) {
    const base = (baseCaps && typeof baseCaps === 'object') ? baseCaps : {};
    const regs = regsByMethod;
    if (!regs || !(regs instanceof Map) || regs.size === 0) return base;

    const firstOptions = (method) => {
      const map = regs.get(method);
      if (!map || !(map instanceof Map)) return null;
      for (const r of map.values()) return r?.registerOptions ?? true;
      return null;
    };

    const merged = { ...base };

    const setBoolOrOptions = (key, method) => {
      const opt = firstOptions(method);
      if (!opt) return;
      merged[key] = opt === true ? true : opt;
    };

    setBoolOrOptions('completionProvider', 'textDocument/completion');
    setBoolOrOptions('hoverProvider', 'textDocument/hover');
    setBoolOrOptions('definitionProvider', 'textDocument/definition');
    setBoolOrOptions('referencesProvider', 'textDocument/references');
    setBoolOrOptions('signatureHelpProvider', 'textDocument/signatureHelp');
    setBoolOrOptions('documentSymbolProvider', 'textDocument/documentSymbol');
    setBoolOrOptions('renameProvider', 'textDocument/rename');
    setBoolOrOptions('documentFormattingProvider', 'textDocument/formatting');
    setBoolOrOptions('documentRangeFormattingProvider', 'textDocument/rangeFormatting');
    setBoolOrOptions('codeActionProvider', 'textDocument/codeAction');
    setBoolOrOptions('foldingRangeProvider', 'textDocument/foldingRange');
    setBoolOrOptions('implementationProvider', 'textDocument/implementation');
    setBoolOrOptions('typeDefinitionProvider', 'textDocument/typeDefinition');
    setBoolOrOptions('callHierarchyProvider', 'textDocument/callHierarchy');
    setBoolOrOptions('inlayHintProvider', 'textDocument/inlayHint');
    setBoolOrOptions('semanticTokensProvider', 'textDocument/semanticTokens');
    setBoolOrOptions('workspaceSymbolProvider', 'workspace/symbol');

    // executeCommandProvider: union commands across regs (best effort)
    try {
      const map = regs.get('workspace/executeCommand');
      if (map && map instanceof Map && map.size) {
        const commands = new Set(Array.isArray(base?.executeCommandProvider?.commands) ? base.executeCommandProvider.commands : []);
        for (const r of map.values()) {
          const opts = r?.registerOptions;
          const list = Array.isArray(opts?.commands) ? opts.commands : [];
          for (const c of list) commands.add(String(c));
        }
        merged.executeCommandProvider = { ...(base.executeCommandProvider || {}), commands: Array.from(commands) };
      }
    } catch {
      // ignore
    }

    return merged;
  }

  _effectiveServerCapabilities(state) {
    const s = state;
    if (!s) return {};
    const base = (s.proc?.serverCapabilities && typeof s.proc.serverCapabilities === 'object') ? s.proc.serverCapabilities : {};
    const regsByMethod = s.dynamicRegistrations?.byMethod;
    return this._mergeDynamicCapabilities(base, regsByMethod);
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

  _normalizePathForCompare(p) {
    const s = String(p || '');
    if (!s) return '';
    const norm = s.replace(/[\\\/]+$/, '');
    return process.platform === 'win32' ? norm.toLowerCase() : norm;
  }

  _workspaceFolderRootsFsPaths(workspace) {
    const ws = workspace || {};
    const roots = [];
    const rootFsPath = String(ws.rootFsPath || '').trim();
    if (rootFsPath) roots.push(rootFsPath);
    const folders = Array.isArray(ws.folders) ? ws.folders : [];
    for (const f of folders) {
      const uri = typeof f?.uri === 'string' ? f.uri : '';
      if (!uri) continue;
      const fsPath = fromFileUri(uri);
      if (fsPath) roots.push(fsPath);
    }
    const seen = new Set();
    return roots
      .map((x) => String(x || '').trim())
      .filter(Boolean)
      .filter((x) => {
        const key = this._normalizePathForCompare(x);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  _pickContainingRoot(roots, fsPath) {
    const p = this._normalizePathForCompare(fsPath);
    if (!p) return '';
    let best = '';
    for (const r of Array.isArray(roots) ? roots : []) {
      const root = this._normalizePathForCompare(r);
      if (!root) continue;
      if (!p.startsWith(root)) continue;
      if (!best || root.length > best.length) best = r;
    }
    return best;
  }

  async _mapClientUriToServerUri(state, clientUri) {
    const s = state;
    const u = String(clientUri || '');
    if (!s || !u) return u;
    if (!u.startsWith('file://')) return u;
    if (s.uriMap?.clientToServer?.has(u)) return s.uriMap.clientToServer.get(u);

    const fsPath = fromFileUri(u);
    const baseRoot = String(s.workspace?.rootFsPath || '').trim();
    if (!fsPath || !baseRoot) return u;

    const normFs = this._normalizePathForCompare(fsPath);
    const normBase = this._normalizePathForCompare(baseRoot);
    if (!normFs.startsWith(normBase)) return u;

    const rel = path.relative(baseRoot, fsPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return u;

    const roots = this._workspaceFolderRootsFsPaths(s.workspace);
    let chosenFsPath = '';
    for (const root of roots) {
      const candidate = path.join(root, rel);
      try {
        // eslint-disable-next-line no-await-in-loop
        const st = await fs.promises.stat(candidate);
        if (st?.isFile?.() || st?.isFIFO?.() || st?.isSymbolicLink?.() || st) {
          chosenFsPath = candidate;
          break;
        }
      } catch {
        // ignore
      }
    }
    if (!chosenFsPath && roots[0]) chosenFsPath = path.join(roots[0], rel);
    if (!chosenFsPath) return u;

    const serverUri = toFileUri(chosenFsPath) || u;
    if (!s.uriMap) s.uriMap = { clientToServer: new Map(), serverToClient: new Map() };
    s.uriMap.clientToServer.set(u, serverUri);
    s.uriMap.serverToClient.set(serverUri, u);
    return serverUri;
  }

  _mapServerUriToClientUri(state, serverUri) {
    const s = state;
    const u = String(serverUri || '');
    if (!s || !u) return u;
    if (!u.startsWith('file://')) return u;
    if (s.uriMap?.serverToClient?.has(u)) return s.uriMap.serverToClient.get(u);

    const fsPath = fromFileUri(u);
    const baseRoot = String(s.workspace?.rootFsPath || '').trim();
    if (!fsPath || !baseRoot) return u;

    const roots = this._workspaceFolderRootsFsPaths(s.workspace);
    const containing = this._pickContainingRoot(roots, fsPath);
    if (!containing) return u;

    const rel = path.relative(containing, fsPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return u;
    const clientFsPath = path.join(baseRoot, rel);
    const clientUri = toFileUri(clientFsPath) || u;

    if (!s.uriMap) s.uriMap = { clientToServer: new Map(), serverToClient: new Map() };
    s.uriMap.serverToClient.set(u, clientUri);
    s.uriMap.clientToServer.set(clientUri, u);
    return clientUri;
  }

  _applyIncrementalChangeUtf16(text, change) {
    if (!change || typeof change.text !== 'string') return text;
    if (!change.range) return String(change.text || '');
    const start = offsetAt(text, change.range.start);
    const end = offsetAt(text, change.range.end);
    return String(text || '').slice(0, start) + change.text + String(text || '').slice(end);
  }

  _serverPositionEncoding(state) {
    return normalizePositionEncoding(state?.proc?.positionEncoding || 'utf-16');
  }

  async _getTextForServerUri(state, serverUri) {
    const u = String(serverUri || '');
    if (!state || !u) return '';
    const open = state.store?.get?.(u);
    if (open && typeof open.text === 'string') return open.text;
    if (!u.startsWith('file://')) return '';
    const fsPath = fromFileUri(u);
    if (!fsPath) return '';
    try {
      return await fs.promises.readFile(fsPath, 'utf8');
    } catch {
      return '';
    }
  }

  _convertContentChanges(textBefore, contentChanges, fromEncoding, toEncoding) {
    const fromEnc = normalizePositionEncoding(fromEncoding);
    const toEnc = normalizePositionEncoding(toEncoding);
    const changes = Array.isArray(contentChanges) ? contentChanges : [];
    if (fromEnc === toEnc) return changes;
    let text = String(textBefore || '');
    const out = [];
    for (const ch of changes) {
      if (!ch || typeof ch !== 'object') continue;
      if (!ch.range) {
        out.push({ ...ch });
        text = String(ch.text || '');
        continue;
      }
      const convertedRange = convertRange(text, ch.range, fromEnc, toEnc);
      out.push({ ...ch, range: convertedRange });
      text = this._applyIncrementalChangeUtf16(text, ch);
    }
    return out;
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
    proc.on('close', () => {
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
    const enc = normalizePositionEncoding(s.proc?.positionEncoding || 'utf-16');

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
      s.proc.on('close', () => this._handleServerExit(serverId));

      try {
        await s.proc.startAndInitialize();
        s.restart.attempts = 0;
        for (const doc of s.store.list()) {
          s.proc.sendNotification('textDocument/didOpen', {
            textDocument: {
              uri: doc.uri,
              languageId: doc.languageId,
              version: doc.version,
              text: doc.text,
            },
          });
        }
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

    // watched files
    try {
      const w = this.workspaceFileWatchers.get(String(s.workspace.workspaceId || ''));
      if (w) {
        w.serverIds.delete(sid);
        try { w.queueByServer?.delete?.(sid); } catch {}
      }
    } catch {}
    this.watchedFilesRegs.delete(sid);

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
    await s.proc.startAndInitialize();
    const clientUri = String(doc?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverDoc = { ...doc, uri: serverUri };
    s.store.open(serverDoc);
    s.proc.sendNotification('textDocument/didOpen', { textDocument: serverDoc });
  }

  async changeDocument(serverId, change) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(change?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const beforeText = s.store.get(serverUri)?.text || '';
    const res = s.store.applyChange({ ...change, uri: serverUri });
    if (!res.ok && res.reason === 'not_open' && change?.text) {
      s.store.open({ uri: serverUri, languageId: change.languageId || s.serverConfig.languageId, version: change.version, text: change.text });
      s.proc.sendNotification('textDocument/didOpen', { textDocument: s.store.get(serverUri) });
      return;
    }
    const serverEnc = this._serverPositionEncoding(s);
    const contentChanges = this._convertContentChanges(beforeText, change?.contentChanges || [], 'utf-16', serverEnc);
    s.proc.sendNotification('textDocument/didChange', {
      textDocument: { uri: serverUri, version: change.version },
      contentChanges,
    });
  }

  async closeDocument(serverId, uri) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    s.store.close(serverUri);
    s.proc.sendNotification('textDocument/didClose', { textDocument: { uri: String(serverUri) } });
  }

  async saveDocument(serverId, params) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.uri || params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const version = Number(params?.version || params?.textDocument?.version || 0) || undefined;
    const text = typeof params?.text === 'string' ? params.text : undefined;
    s.proc.sendNotification('textDocument/didSave', { textDocument: { uri: serverUri, version }, text });
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

  async inlayHintResolve(serverId, hint, docUri, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(docUri || '');
    const serverUri = clientUri ? await this._mapClientUriToServerUri(s, clientUri) : '';
    const serverEnc = this._serverPositionEncoding(s);
    const text = serverUri ? await this._getTextForServerUri(s, serverUri) : '';

    const item = hint && typeof hint === 'object' ? hint : {};
    const serverItem = { ...item };
    if (serverItem.position) serverItem.position = convertPosition(text, serverItem.position, 'utf-16', serverEnc);
    if (Array.isArray(serverItem.textEdits)) {
      serverItem.textEdits = serverItem.textEdits.map((e) => this._convertTextEdit(text, e, 'utf-16', serverEnc));
    }
    if (Array.isArray(serverItem.label)) {
      serverItem.label = await Promise.all(serverItem.label.map(async (p) => {
        if (!p || typeof p !== 'object' || !p.location) return p;
        const loc = p.location;
        const locClientUri = String(loc.uri || '');
        const locServerUri = await this._mapClientUriToServerUri(s, locClientUri);
        const locText = locServerUri ? await this._getTextForServerUri(s, locServerUri) : '';
        return {
          ...p,
          location: {
            ...loc,
            uri: locServerUri,
            range: loc.range ? convertRange(locText, loc.range, 'utf-16', serverEnc) : loc.range,
          },
        };
      }));
    }

    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('inlayHint/resolve', serverItem, { timeoutMs, cancelToken: cts?.token });
      if (!result || typeof result !== 'object') return result;
      const next = { ...result };
      if (next.position) next.position = convertPosition(text, next.position, serverEnc, 'utf-16');
      if (Array.isArray(next.textEdits)) next.textEdits = next.textEdits.map((e) => this._convertTextEdit(text, e, serverEnc, 'utf-16'));
      if (Array.isArray(next.label)) {
        next.label = await Promise.all(next.label.map(async (p) => {
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
      return next;
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

  async workspaceSymbol(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();

    // Intercept _typescript.applyWorkspaceEdit to handle it client-side
    // This fixes issues where tsls fails to execute this command server-side
    if (params?.command === '_typescript.applyWorkspaceEdit' && Array.isArray(params?.arguments) && params.arguments[0]) {
      try {
        const serverEnc = this._serverPositionEncoding(s);
        const edit = params.arguments[0];
        const converted = await this._convertWorkspaceEdit(s, edit, serverEnc, 'utf-16');
        if (this.externalApplyWorkspaceEdit) {
          const res = await this.externalApplyWorkspaceEdit({
            serverId: String(serverId),
            workspaceId: String(s.workspace?.workspaceId || ''),
            label: 'TypeScript Action',
            edit: converted,
          });
          return res;
        }
      } catch (err) {
        this.logger?.exception?.('intercepted applyWorkspaceEdit failed', err, { serverId });
        throw err;
      }
    }

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

  _convertDocumentSymbol(text, symbol, fromEncoding, toEncoding) {
    if (!symbol || typeof symbol !== 'object') return symbol;
    const out = { ...symbol };
    if (out.range) out.range = convertRange(text, out.range, fromEncoding, toEncoding);
    if (out.selectionRange) out.selectionRange = convertRange(text, out.selectionRange, fromEncoding, toEncoding);
    if (Array.isArray(out.children)) {
      out.children = out.children.map((child) => this._convertDocumentSymbol(text, child, fromEncoding, toEncoding));
    }
    return out;
  }

  async _convertSymbolInformation(state, info, fromEncoding, toEncoding) {
    if (!info || typeof info !== 'object') return info;
    const serverUri = String(info.location?.uri || '');
    if (!serverUri) return info;
    const text = await this._getTextForServerUri(state, serverUri);
    return {
      ...info,
      location: {
        ...info.location,
        uri: this._mapServerUriToClientUri(state, serverUri),
        range: info.location?.range ? convertRange(text, info.location.range, fromEncoding, toEncoding) : info.location?.range,
      },
    };
  }

  async documentSymbol(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const clientUri = String(params?.textDocument?.uri || '');
    const serverUri = await this._mapClientUriToServerUri(s, clientUri);
    const serverEnc = this._serverPositionEncoding(s);
    const text = await this._getTextForServerUri(s, serverUri);
    const serverParams = {
      ...params,
      textDocument: { ...(params?.textDocument || {}), uri: serverUri },
    };
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('textDocument/documentSymbol', serverParams, { timeoutMs, cancelToken: cts?.token });
      const list = Array.isArray(result) ? result : [];
      if (!list.length) return [];

      const isHierarchy = list[0] && list[0].range && !list[0].location;

      if (isHierarchy) {
        return list.map((item) => this._convertDocumentSymbol(text, item, serverEnc, 'utf-16'));
      }
      return await Promise.all(list.map((item) => this._convertSymbolInformation(s, item, serverEnc, 'utf-16')));
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
  }

  async workspaceSymbol(serverId, params, { timeoutMs = 4000, cancelToken } = {}) {
    const s = this._getServer(serverId);
    await s.proc.startAndInitialize();
    const serverEnc = this._serverPositionEncoding(s);
    const cts = cancelToken ? new CancellationTokenSource() : null;
    if (cts && cancelToken) this.trackPendingToken(cancelToken, cts);
    try {
      const result = await s.proc.sendRequest('workspace/symbol', params, { timeoutMs, cancelToken: cts?.token });
      const list = Array.isArray(result) ? result : [];
      return await Promise.all(list.map((item) => this._convertSymbolInformation(s, item, serverEnc, 'utf-16')));
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

  async prepareRename(serverId, params, { timeoutMs = 5000, cancelToken } = {}) {
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
      const result = await s.proc.sendRequest('textDocument/prepareRename', serverParams, { timeoutMs, cancelToken: cts?.token });
      if (!result) return result;
      // Result can be Range, { range, placeholder }, { defaultBehavior }
      if (result.defaultBehavior) return result;
      if (result.range) {
        return { ...result, range: convertRange(text, result.range, serverEnc, 'utf-16') };
      }
      // It might be just a Range object (duck typing)
      if (result.start && result.end) {
        return convertRange(text, result, serverEnc, 'utf-16');
      }
      return result;
    } finally {
      if (cancelToken) this.pendingByToken.delete(String(cancelToken));
    }
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
    // Remove immediately to prevent auto-restart logic in _handleServerExit
    this.servers.delete(key);

    try {
      if (s.restart?.timer) clearTimeout(s.restart.timer);
    } catch {}
    try {
      await s.proc.shutdown();
    } catch (err) {
      this.logger?.exception?.('shutdownServer failed', err, { serverId: key });
    }
  }

  async shutdownAll() {
    for (const id of Array.from(this.servers.keys())) {
      await this.shutdownServer(id);
    }
  }

  _ensureWorkspaceWatcher(workspaceId, rootsFsPaths) {
    const wid = String(workspaceId || '').trim();
    const roots = Array.isArray(rootsFsPaths) ? rootsFsPaths.map((x) => String(x || '').trim()).filter(Boolean) : [];
    if (!wid || roots.length === 0) return null;
    if (this.workspaceFileWatchers.has(wid)) return this.workspaceFileWatchers.get(wid);

    const ignored = (p) => {
      const s = String(p || '');
      if (s.includes(`${path.sep}.git${path.sep}`)) return true;
      if (s.includes(`${path.sep}node_modules${path.sep}`)) return true;
      if (s.includes(`${path.sep}.aichat${path.sep}`)) return true;
      if (s.includes(`${path.sep}dist${path.sep}`)) return true;
      return false;
    };

    const watcher = chokidar.watch(roots, {
      ignoreInitial: true,
      ignored,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    const entry = { watcher, rootsFsPaths: roots, serverIds: new Set(), queueByServer: new Map() };

    const onFs = (type, filePath) => {
      const abs = String(filePath || '');
      if (!abs) return;
      const uri = toFileUri(abs);
      if (!uri) return;
      const eventType = type === 'add' ? 1 : (type === 'change' ? 2 : 3);
      this._enqueueWatchedFileChange(wid, uri, eventType, abs);
    };

    watcher.on('add', (p) => onFs('add', p));
    watcher.on('change', (p) => onFs('change', p));
    watcher.on('unlink', (p) => onFs('unlink', p));
    watcher.on('error', (err) => this.logger?.exception?.('file watcher error', err, { workspaceId: wid }));

    this.workspaceFileWatchers.set(wid, entry);
    return entry;
  }

  _enqueueWatchedFileChange(workspaceId, uri, type, absPath) {
    const entry = this.workspaceFileWatchers.get(String(workspaceId));
    if (!entry) return;

    for (const serverId of Array.from(entry.serverIds)) {
      const reg = this.watchedFilesRegs.get(serverId);
      if (!reg || !Array.isArray(reg.watchers) || reg.watchers.length === 0) continue;
      if (!this._matchesWatchedFiles(reg.watchers, entry.rootsFsPaths, absPath, type)) continue;

      if (!entry.queueByServer.has(serverId)) {
        const queue = new Map(); // uri -> type
        const flush = debounce(() => {
          const changes = Array.from(queue.entries()).map(([u, t]) => ({ uri: u, type: t }));
          queue.clear();
          if (!changes.length) return;
          try {
            const s = this._getServer(serverId);
            s.proc.sendNotification('workspace/didChangeWatchedFiles', { changes });
          } catch (err) {
            this.logger?.exception?.('didChangeWatchedFiles notify failed', err, { serverId });
          }
        }, 200);
        entry.queueByServer.set(serverId, { queue, flush });
      }

      const q = entry.queueByServer.get(serverId);
      q.queue.set(uri, type);
      q.flush();
    }
  }

  _matchesWatchedFiles(watchers, rootsFsPaths, absPath, type) {
    const abs = String(absPath || '').trim();
    if (!abs) return false;
    const roots = Array.isArray(rootsFsPaths) ? rootsFsPaths.map((x) => String(x || '').trim()).filter(Boolean) : [];
    if (roots.length === 0) return false;
    const eventMask = type === 1 ? 1 : (type === 2 ? 2 : 4);

    for (const w of watchers) {
      const gp = w?.globPattern;
      const globPattern = typeof gp === 'string' ? gp : (typeof gp?.pattern === 'string' ? gp.pattern : '');
      if (!globPattern) continue;
      const kind = Number(w?.kind || 0);
      if (kind && (kind & eventMask) === 0) continue;

      let baseFsPath = '';
      if (gp && typeof gp === 'object' && typeof gp.baseUri === 'string' && gp.baseUri.startsWith('file://')) {
        baseFsPath = fromFileUri(gp.baseUri);
      }
      if (!baseFsPath) baseFsPath = this._pickContainingRoot(roots, abs);
      if (!baseFsPath) continue;

      const relNative = path.relative(baseFsPath, abs);
      if (!relNative || relNative.startsWith('..') || path.isAbsolute(relNative)) continue;
      const rel = relNative.split(path.sep).join('/');
      try {
        if (minimatch(rel, globPattern, { dot: true, nocase: process.platform === 'win32' })) return true;
      } catch {
        // ignore invalid patterns
      }
    }
    return false;
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

    const watchers = Array.isArray(registerOptions?.watchers) ? registerOptions.watchers : [];
    const current = this.watchedFilesRegs.get(serverId) || { watchers: [], registrationsById: new Map() };
    current.registrationsById.set(String(id || ''), { watchers });
    current.watchers = Array.from(current.registrationsById.values()).flatMap((x) => x.watchers || []);
    this.watchedFilesRegs.set(serverId, current);

    try {
      const s = this._getServer(serverId);
      const wid = String(s.workspace.workspaceId || '');
      const roots = this._workspaceFolderRootsFsPaths(s.workspace);
      const w = this._ensureWorkspaceWatcher(wid, roots);
      if (w) w.serverIds.add(serverId);
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

    const current = this.watchedFilesRegs.get(serverId);
    if (!current) return;
    current.registrationsById.delete(String(id || ''));
    current.watchers = Array.from(current.registrationsById.values()).flatMap((x) => x.watchers || []);
    if (current.registrationsById.size === 0) this.watchedFilesRegs.delete(serverId);

    // Best-effort detach server from workspace watcher.
    try {
      const s = this._getServer(serverId);
      const wid = String(s.workspace.workspaceId || '');
      const w = this.workspaceFileWatchers.get(wid);
      if (w) {
        w.serverIds.delete(serverId);
        try { w.queueByServer?.delete?.(String(serverId)); } catch {}
      }
      if (w && w.serverIds.size === 0) {
        w.watcher.close().catch?.(() => {});
        this.workspaceFileWatchers.delete(wid);
      }
    } catch {
      // ignore
    }
  }
}

module.exports = { LspManager };
