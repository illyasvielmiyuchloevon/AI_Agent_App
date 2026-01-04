const path = require('path');
const fs = require('node:fs');
const { BrowserWindow, app } = require('electron');
const { StdioTransport } = require('../lsp/transport/StdioTransport');
const { JsonRpcConnection } = require('../lsp/jsonrpc/JsonRpcConnection');
const commandsService = require('../commands/commandsService');
const { readWorkspaceSettingsSync, openTextDocument } = require('../workspace/documentModel');
const { createPromptCoordinator } = require('../ui/promptCoordinator');
const { findFilesInWorkspace, normalizeGlobArg } = require('./fileSearch');
const { resolveWorkspaceFileFsPath, fsPathToFileUri, fileUriToFsPath, isUnderRoot } = require('./workspaceFsUtils');
const { fsCreateDirectory, fsDelete, fsRename, fsCopy } = require('./workspaceFsOps');
const minimatchPkg = require('minimatch');
const minimatch =
  (typeof minimatchPkg === 'function' && minimatchPkg) ||
  minimatchPkg?.minimatch ||
  minimatchPkg?.default;
const { createApplyEditCoordinator } = require('../lsp/applyEditCoordinator');

const broadcastToRenderers = (method, params) => {
  const msg = { jsonrpc: '2.0', method: String(method || ''), ...(params !== undefined ? { params } : {}) };
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('idebus:message', msg);
    } catch {}
  }
};

class ExtensionHostService {
  constructor({ logger, workspaceService, recentStore, vscodeExtensions, vscodeExtensionsReady } = {}) {
    this.logger = logger;
    this.workspaceService = workspaceService;
    this.recentStore = recentStore;
    this.vscodeExtensions = vscodeExtensions || null;
    this.vscodeExtensionsReady = vscodeExtensionsReady || null;
    this.transport = null;
    this.connection = null;
    this._ready = null;
    this._restartTimer = null;
    this._restartDelayMs = 750;
    this._restartHistory = [];
    this._spawnInFlight = null;
    this._spawnRequested = false;
    this._spawnReason = '';
    this._promptCoordinator = createPromptCoordinator({ timeoutMs: 30_000 });
    this._promptSeq = 1;
    this._fileWatchers = new Map(); // watcherId -> chokidar watcher
    this._watcherSeq = 1;
    this._workspaceApplyEditSeq = 1;
    this._workspaceApplyEditCoordinator = createApplyEditCoordinator({ timeoutMs: 15_000 });
    this._activationIndex = { extensions: new Map(), byCommand: new Map(), byLanguage: new Map(), workspaceContains: [], startup: new Set() };
    this._loadedExtensionIds = new Set();
    this._activationInFlight = new Map();
  }

  get ready() {
    return this._ready || Promise.resolve();
  }

  getStatus() {
    const workspaceFsPath = this._getWorkspaceFsPath();
    const trusted = this._isWorkspaceTrusted();
    return {
      ok: true,
      running: !!this.connection && !!this.transport,
      workspaceFsPath,
      trusted,
      restartBackoffMs: Math.round(this._restartDelayMs || 0),
      restartCountLastMinute: Array.isArray(this._restartHistory) ? this._restartHistory.length : 0,
    };
  }

  async listExtensions() {
    try {
      await this.start();
    } catch {
      // ignore
    }
    const conn = this.connection;
    if (!conn || typeof conn.sendRequest !== 'function') return { ok: false, error: 'extension host not running' };
    try {
      return await conn.sendRequest('extHost/listExtensions', {}, { timeoutMs: 10_000 });
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  async provideCompletionItems({ languageId, uri, text, version, position, context } = {}) {
    try {
      await this.start();
    } catch {
      // ignore
    }
    const conn = this.connection;
    if (!conn || typeof conn.sendRequest !== 'function') return { ok: false, error: 'extension host not running' };
    try {
      await this.activateByLanguageId(String(languageId || ''));
    } catch {}
    try {
      return await conn.sendRequest('extHost/provideCompletionItems', {
        languageId: String(languageId || ''),
        uri: String(uri || ''),
        text: text != null ? String(text) : '',
        version: Number.isFinite(version) ? version : 1,
        position: position && typeof position === 'object' ? position : null,
        context: context && typeof context === 'object' ? context : null,
      }, { timeoutMs: 2_000 });
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  async executeCommand(command, args = []) {
    const id = String(command || '').trim();
    if (!id) throw new Error('missing command');
    const meta = commandsService.getCommandMeta(id);
    if (meta?.source === 'extension') {
      await this.activateByCommandId(id).catch(() => {});
      const conn = this.connection;
      if (conn && typeof conn.sendRequest === 'function') {
        try {
          return await conn.sendRequest('extHost/executeCommand', { command: id, args: Array.isArray(args) ? args : [args] }, { timeoutMs: 30_000 });
        } catch {
          // ignore
        }
      }
    }
    return await commandsService.executeCommand(id, args);
  }

  async handleTextDocumentDidOpen(payload) {
    const languageId = payload?.languageId != null ? String(payload.languageId) : '';
    await this.activateByLanguageId(languageId).catch(() => {});
    try {
      this.connection?.sendNotification?.('editor/textDocumentDidOpen', payload);
    } catch {}
  }

  _normalizeWorkspaceEventFsPaths(payload, { allowPairs = false } = {}) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const workspaceRootFsPath = this._getWorkspaceFsPath();
    const root = String(workspaceRootFsPath || '').trim();

    const filesRaw = Array.isArray(p.files) ? p.files : [];
    const pathsRaw = Array.isArray(p.paths) ? p.paths : [];
    const pairsRaw = allowPairs && Array.isArray(p.pairs) ? p.pairs : [];
    const list = filesRaw.length ? filesRaw : (pathsRaw.length ? pathsRaw : pairsRaw);

    const toFsPath = (value) => {
      if (!value) return '';
      if (typeof value === 'string') {
        const s = value.trim();
        if (!s) return '';
        if (s.startsWith('file:')) return fileUriToFsPath(s);
        if (path.isAbsolute(s)) return s;
        if (root) return path.join(root, s);
        return s;
      }
      if (typeof value === 'object') {
        const uri = value.uri != null ? String(value.uri) : '';
        const fsPath = value.fsPath != null ? String(value.fsPath) : '';
        const pth = value.path != null ? String(value.path) : (value.relPath != null ? String(value.relPath) : '');
        if (fsPath) return fsPath;
        if (uri && uri.trim().startsWith('file:')) return fileUriToFsPath(uri);
        if (pth) return toFsPath(pth);
        return '';
      }
      return '';
    };

    if (!allowPairs) {
      return (Array.isArray(list) ? list : []).map((it) => toFsPath(it)).filter(Boolean);
    }

    const out = [];
    for (const it of Array.isArray(list) ? list : []) {
      if (!it || typeof it !== 'object') continue;
      const oldV = it.oldUri != null ? it.oldUri : (it.from != null ? it.from : it.oldPath);
      const newV = it.newUri != null ? it.newUri : (it.to != null ? it.to : it.newPath);
      const oldFsPath = toFsPath(oldV);
      const newFsPath = toFsPath(newV);
      if (oldFsPath && newFsPath) out.push({ oldFsPath, newFsPath });
    }
    return out;
  }

  async handleWorkspaceDidCreateFiles(payload) {
    if (!this._isWorkspaceTrusted()) return { ok: false, error: 'workspace not trusted', activated: [] };
    const fsPaths = this._normalizeWorkspaceEventFsPaths(payload);
    return await this._activateWorkspaceContainsForFsPaths(fsPaths, { reason: 'workspace/didCreateFiles' });
  }

  async handleWorkspaceDidRenameFiles(payload) {
    if (!this._isWorkspaceTrusted()) return { ok: false, error: 'workspace not trusted', activated: [] };
    const pairs = this._normalizeWorkspaceEventFsPaths(payload, { allowPairs: true });
    const fsPaths = (Array.isArray(pairs) ? pairs : []).map((p) => p?.newFsPath).filter(Boolean);
    return await this._activateWorkspaceContainsForFsPaths(fsPaths, { reason: 'workspace/didRenameFiles' });
  }

  async activateByCommandId(commandId) {
    const cmd = String(commandId || '').trim();
    if (!cmd) return { ok: true, activated: [] };
    if (!this._isWorkspaceTrusted()) return { ok: false, error: 'workspace not trusted', activated: [] };
    await this._refreshActivationIndex().catch(() => {});
    const ids = this._activationIndex.byCommand.get(cmd) || [];
    return await this._activateExtensions(ids, { reason: `onCommand:${cmd}` });
  }

  async activateByLanguageId(languageId) {
    const lang = String(languageId || '').trim();
    if (!lang) return { ok: true, activated: [] };
    if (!this._isWorkspaceTrusted()) return { ok: false, error: 'workspace not trusted', activated: [] };
    await this._refreshActivationIndex().catch(() => {});
    const ids = this._activationIndex.byLanguage.get(lang) || [];
    return await this._activateExtensions(ids, { reason: `onLanguage:${lang}` });
  }

  start() {
    if (!this._ready) this._ready = this._ensureSpawn('start');
    return this._ready;
  }

  restart(reason) {
    this._restartDelayMs = 750;
    return this._ensureSpawn(reason || 'restart');
  }

  handlePromptResponse({ senderWebContentsId, requestId, kind, result } = {}) {
    return this._promptCoordinator.handleResponse({ senderWebContentsId, requestId, kind, result });
  }

  handleWorkspaceApplyEditResponse({ senderWebContentsId, requestId, result } = {}) {
    return this._workspaceApplyEditCoordinator.handleResponse({ senderWebContentsId, requestId, result });
  }

  _ensureSpawn(reason) {
    this._spawnRequested = true;
    this._spawnReason = String(reason || '');
    if (this._spawnInFlight) return this._spawnInFlight;

    this._spawnInFlight = (async () => {
      while (this._spawnRequested) {
        this._spawnRequested = false;
        const r = this._spawnReason;
        try {
          await this._spawnOnce(r);
        } catch (err) {
          try { this.logger?.warn?.('extension host spawn failed', { reason: String(r || ''), message: err?.message || String(err) }); } catch {}
          this._scheduleRestart('spawn-failed');
          break;
        }
      }
    })()
      .finally(() => {
        this._spawnInFlight = null;
      });

    return this._spawnInFlight;
  }

  _getWorkspaceFsPath() {
    try {
      return String(this.workspaceService?.getCurrent?.()?.fsPath || '');
    } catch {
      return '';
    }
  }

  _isWorkspaceTrusted() {
    const fsPath = this._getWorkspaceFsPath();
    if (!fsPath) return false;
    try {
      return !!this.recentStore?.getTrustedByFsPath?.(fsPath);
    } catch {
      return false;
    }
  }

  _shouldAllowExtensionCommands() {
    return this._isWorkspaceTrusted();
  }

  _scheduleRestart(reason) {
    try { this.logger?.warn?.('extension host restarting', { reason: String(reason || '') }); } catch {}
    if (this._restartTimer) return;

    const now = Date.now();
    this._restartHistory = this._restartHistory.filter((t) => now - t < 60_000);
    this._restartHistory.push(now);
    if (this._restartHistory.length > 8) {
      try { this.logger?.warn?.('extension host restart suppressed (too frequent)', { count: this._restartHistory.length }); } catch {}
      return;
    }

    const delay = Math.max(250, Math.min(30_000, Math.round(this._restartDelayMs)));
    this._restartDelayMs = Math.min(30_000, Math.round(this._restartDelayMs * 1.7));
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      this._ensureSpawn(`scheduled:${String(reason || '')}`).catch(() => {});
    }, delay);
  }

  async _spawnOnce() {
    try {
      const oldConn = this.connection;
      const oldTransport = this.transport;
      this.connection = null;
      this.transport = null;
      try { this._disposeFileWatchers(); } catch {}
      try { this._promptCoordinator?.dispose?.(); } catch {}
      if (oldConn) {
        try { commandsService.unregisterAllFromOwner(oldConn); } catch {}
        try { oldConn.dispose?.(); } catch {}
      }
      try { oldTransport?.close?.(); } catch {}
    } catch {}

    const entry = path.join(__dirname, 'extensionHostMain.js');
    const t = new StdioTransport({
      command: process.execPath,
      args: [entry],
      env: { ELECTRON_RUN_AS_NODE: '1', IDE_WORKSPACE_ROOT: this._getWorkspaceFsPath() },
      cwd: app.getAppPath(),
      logger: this.logger,
    });
    t.start();
    this.transport = t;

    const conn = new JsonRpcConnection(t, { logger: this.logger, name: 'extHost:main:stdio', traceMeta: true });
    this.connection = conn;
    this._loadedExtensionIds.clear();
    this._activationInFlight.clear();

    try {
      conn.sendNotification('workspace/setRoot', { fsPath: this._getWorkspaceFsPath() });
    } catch {}

    try {
      const fsPath = this._getWorkspaceFsPath();
      const safe = String(fsPath || '').trim();
      const folders = safe ? [{ fsPath: safe, name: path.basename(safe.replace(/[\\\/]+$/, '')) || safe, index: 0 }] : [];
      conn.sendNotification('workspace/setWorkspaceFolders', { folders, ts: Date.now() });
    } catch {}

    try {
      const settings = readWorkspaceSettingsSync(this._getWorkspaceFsPath());
      conn.sendNotification('workspace/setConfiguration', { settings, ts: Date.now() });
    } catch {}

    const onClose = () => {
      if (conn !== this.connection) return;
      try { this._disposeFileWatchers(); } catch {}
      try { commandsService.unregisterAllFromOwner(conn); } catch {}
      broadcastToRenderers('commands/changed', { ts: Date.now() });
      this._scheduleRestart('close');
    };
    conn.on('close', onClose);

    try {
      if (t.proc) {
        t.proc.once('exit', (code, signal) => {
          if (conn !== this.connection) return;
          try { this.logger?.warn?.('extension host exited', { code, signal }); } catch {}
          this._scheduleRestart('exit');
        });
      }
    } catch {}

    conn.onRequest('commands/registerCommand', async (params) => {
      const command = params?.command ? String(params.command) : '';
      const title = params?.title ? String(params.title) : '';
      if (!command) return { ok: false, error: 'missing command' };
      commandsService.registerFromExtensionHost({ command, title, owner: conn });
      broadcastToRenderers('commands/changed', { ts: Date.now() });
      return { ok: true };
    });

    conn.onRequest('commands/unregisterCommand', async (params) => {
      const command = params?.command ? String(params.command) : '';
      if (command) commandsService.unregisterFromExtensionHost(command);
      broadcastToRenderers('commands/changed', { ts: Date.now() });
      return { ok: true };
    });

    conn.onRequest('window/showInformationMessage', async (params) => {
      const message = params?.message ? String(params.message) : '';
      const items = Array.isArray(params?.items) ? params.items.map((x) => String(x)) : [];
      broadcastToRenderers('window/showInformationMessage', { message, items, ts: Date.now() });
      return { ok: true };
    });

	    const pickActiveWebContents = () => {
	      try {
	        const focused = BrowserWindow.getFocusedWindow?.();
	        if (focused?.webContents && !(focused.webContents.isDestroyed?.() || false)) return focused.webContents;
	      } catch {}
	      for (const win of BrowserWindow.getAllWindows()) {
	        const wc = win?.webContents;
	        if (!wc) continue;
	        try {
	          if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) continue;
	        } catch {}
	        return wc;
	      }
	      return null;
	    };

	    const notifyActiveRenderer = (method, params) => {
	      const wc = pickActiveWebContents();
	      if (!wc) return false;
	      try {
	        wc.send('idebus:message', { jsonrpc: '2.0', method: String(method || ''), params: { ...(params || {}), source: 'extensionHost', ts: Date.now() } });
	        return true;
	      } catch {
	        return false;
	      }
	    };

	    const notifyWorkspaceFileEvent = (method, params) => {
	      try {
	        conn.sendNotification(String(method || ''), params && typeof params === 'object' ? params : {});
	      } catch {}
	      notifyActiveRenderer(method, params);
	    };

	    conn.onRequest('window/showTextDocument', async (params) => {
	      const uriOrPath = params?.uriOrPath != null ? params.uriOrPath : (params?.uri || params?.path || params?.fileName);
	      const options = params?.options && typeof params.options === 'object' ? params.options : {};
	      const ok = notifyActiveRenderer('window/showTextDocument', { uriOrPath, options });
	      return ok ? { ok: true } : { ok: false, error: 'no active window' };
	    });

	    const requestPrompt = async ({ kind, payload } = {}) => {
	      const wc = pickActiveWebContents();
	      if (!wc) return { ok: false, error: 'no active window' };
	      const requestId = `p_${Date.now()}_${this._promptSeq++}`;
      const k = String(kind || '');
      const method = k === 'quickPick' ? 'window/showQuickPickRequest' : 'window/showInputBoxRequest';
      return await this._promptCoordinator.request({
        requestId,
        webContentsId: wc.id,
        kind: k,
        send: () => {
          wc.send('idebus:message', { jsonrpc: '2.0', method, params: { requestId, ...(payload || {}) } });
        },
      });
    };

    conn.onRequest('window/showInputBox', async (params) => {
      const title = params?.title != null ? String(params.title) : 'Input';
      const prompt = params?.prompt != null ? String(params.prompt) : '';
      const value = params?.value != null ? String(params.value) : '';
      const placeHolder = params?.placeHolder != null ? String(params.placeHolder) : '';

      const res = await requestPrompt({
        kind: 'inputBox',
        payload: { title, prompt, value, placeHolder },
      });
      if (!res?.ok) return null;
      const canceled = !!res?.result?.canceled;
      if (canceled) return null;
      const out = res?.result?.value != null ? String(res.result.value) : '';
      return out || null;
    });

    conn.onRequest('window/showQuickPick', async (params) => {
      const title = params?.title != null ? String(params.title) : 'Select';
      const placeHolder = params?.placeHolder != null ? String(params.placeHolder) : '';
      const canPickMany = !!params?.canPickMany;
      const items = Array.isArray(params?.items) ? params.items : [];

      const res = await requestPrompt({
        kind: 'quickPick',
        payload: { title, placeHolder, canPickMany, items },
      });
      if (!res?.ok) return null;
      const canceled = !!res?.result?.canceled;
      if (canceled) return null;
      const out = res?.result?.value != null ? String(res.result.value) : '';
      return out || null;
    });

    conn.onRequest('commands/executeCommand', async (params) => {
      const command = params?.command ? String(params.command) : '';
      const args = Array.isArray(params?.args) ? params.args : [];
      if (!command) return { ok: false, error: 'missing command' };
      const meta = commandsService.getCommandMeta(command);
      if (meta?.source === 'extension' && !this._shouldAllowExtensionCommands()) {
        return { ok: false, error: 'workspace not trusted' };
      }
      let result;
      try {
        result = await this.executeCommand(command, args);
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
      return { ok: true, result };
    });

    conn.onRequest('workspace/openTextDocument', async (params) => {
      const uriOrPath = params?.uriOrPath != null ? params.uriOrPath : (params?.uri || params?.path || params?.fileName);
      const workspaceRootFsPath = this._getWorkspaceFsPath();
      return await openTextDocument({ workspaceRootFsPath, uriOrPath });
    });

    conn.onRequest('workspace/applyEdit', async (params) => {
      if (!this._isWorkspaceTrusted()) return { ok: false, applied: false, error: 'workspace not trusted' };
      const edit = params?.edit && typeof params.edit === 'object' ? params.edit : null;
      if (!edit) return { ok: false, applied: false, error: 'missing edit' };

      const wc = pickActiveWebContents();
      if (!wc) return { ok: false, applied: false, error: 'no active window' };

      const requestId = `we_${Date.now()}_${this._workspaceApplyEditSeq++}`;
      const res = await this._workspaceApplyEditCoordinator.request({
        requestId,
        webContentsId: wc.id,
        send: () => {
          wc.send('idebus:message', { jsonrpc: '2.0', method: 'workspace/applyEditRequest', params: { requestId, edit } });
        },
      });

      return { ok: true, applied: !!res.applied, ...(res.failureReason ? { failureReason: res.failureReason } : {}) };
    });

    conn.onRequest('workspace/fsReadFile', async (params) => {
      const workspaceRootFsPath = this._getWorkspaceFsPath();
      const uri = params?.uri != null ? params.uri : (params?.path || params?.fsPath);
      const resolved = resolveWorkspaceFileFsPath(workspaceRootFsPath, uri);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      try {
        const buf = await fs.promises.readFile(resolved.fsPath);
        return { ok: true, dataB64: buf.toString('base64') };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

	    conn.onRequest('workspace/fsWriteFile', async (params) => {
	      if (!this._isWorkspaceTrusted()) return { ok: false, error: 'workspace not trusted' };
	      const workspaceRootFsPath = this._getWorkspaceFsPath();
	      const uri = params?.uri != null ? params.uri : (params?.path || params?.fsPath);
	      const resolved = resolveWorkspaceFileFsPath(workspaceRootFsPath, uri);
	      if (!resolved.ok) return { ok: false, error: resolved.error };
	      const dataB64 = params?.dataB64 != null ? String(params.dataB64) : '';
	      let existed = true;
	      try {
	        await fs.promises.lstat(resolved.fsPath);
	      } catch {
	        existed = false;
	      }
	      try {
	        const buf = dataB64 ? Buffer.from(dataB64, 'base64') : Buffer.from('');
	        await fs.promises.writeFile(resolved.fsPath, buf);
	        if (!existed) {
	          const fileUri = fsPathToFileUri(resolved.fsPath);
	          if (fileUri) notifyWorkspaceFileEvent('workspace/didCreateFiles', { files: [fileUri] });
            try { await this._activateWorkspaceContainsForFsPaths([resolved.fsPath], { reason: 'workspace/fsWriteFile' }); } catch {}
	        }
	        return { ok: true };
	      } catch (err) {
	        return { ok: false, error: err?.message || String(err) };
	      }
	    });

	    conn.onRequest('workspace/fsCreateDirectory', async (params) => {
	      if (!this._isWorkspaceTrusted()) return { ok: false, error: 'workspace not trusted' };
	      const workspaceRootFsPath = this._getWorkspaceFsPath();
	      const uri = params?.uri != null ? params.uri : (params?.path || params?.fsPath);
	      const res = await fsCreateDirectory({ workspaceRootFsPath, uri });
	      if (res?.ok) {
	        const resolved = resolveWorkspaceFileFsPath(workspaceRootFsPath, uri);
	        const dirUri = resolved.ok ? fsPathToFileUri(resolved.fsPath) : '';
	        if (dirUri) notifyWorkspaceFileEvent('workspace/didCreateFiles', { files: [dirUri] });
          if (resolved.ok) {
            try { await this._activateWorkspaceContainsForFsPaths([resolved.fsPath], { reason: 'workspace/fsCreateDirectory' }); } catch {}
          }
	      }
	      return res;
	    });

	    conn.onRequest('workspace/fsDelete', async (params) => {
	      if (!this._isWorkspaceTrusted()) return { ok: false, error: 'workspace not trusted' };
	      const workspaceRootFsPath = this._getWorkspaceFsPath();
	      const uri = params?.uri != null ? params.uri : (params?.path || params?.fsPath);
	      const options = params?.options && typeof params.options === 'object' ? params.options : {};
	      const resolved = resolveWorkspaceFileFsPath(workspaceRootFsPath, uri);
	      const targetUri = resolved.ok ? fsPathToFileUri(resolved.fsPath) : '';
	      const res = await fsDelete({ workspaceRootFsPath, uri, options });
	      if (res?.ok && targetUri) notifyWorkspaceFileEvent('workspace/didDeleteFiles', { files: [targetUri] });
	      return res;
	    });

	    conn.onRequest('workspace/fsRename', async (params) => {
	      if (!this._isWorkspaceTrusted()) return { ok: false, error: 'workspace not trusted' };
	      const workspaceRootFsPath = this._getWorkspaceFsPath();
	      const from = params?.from != null ? params.from : (params?.oldUri || params?.oldPath || params?.source);
	      const to = params?.to != null ? params.to : (params?.newUri || params?.newPath || params?.target);
	      const options = params?.options && typeof params.options === 'object' ? params.options : {};
	      const src = resolveWorkspaceFileFsPath(workspaceRootFsPath, from);
	      const dst = resolveWorkspaceFileFsPath(workspaceRootFsPath, to);
	      const oldUri = src.ok ? fsPathToFileUri(src.fsPath) : '';
	      const newUri = dst.ok ? fsPathToFileUri(dst.fsPath) : '';
	      const res = await fsRename({ workspaceRootFsPath, from, to, options });
	      if (res?.ok && oldUri && newUri) notifyWorkspaceFileEvent('workspace/didRenameFiles', { files: [{ oldUri, newUri }] });
        if (res?.ok && dst.ok) {
          try { await this._activateWorkspaceContainsForFsPaths([dst.fsPath], { reason: 'workspace/fsRename' }); } catch {}
        }
	      return res;
	    });

    conn.onRequest('workspace/fsCopy', async (params) => {
      if (!this._isWorkspaceTrusted()) return { ok: false, error: 'workspace not trusted' };
      const workspaceRootFsPath = this._getWorkspaceFsPath();
      const from = params?.from != null ? params.from : (params?.sourceUri || params?.sourcePath || params?.source);
      const to = params?.to != null ? params.to : (params?.targetUri || params?.targetPath || params?.target);
      const options = params?.options && typeof params.options === 'object' ? params.options : {};
      const dst = resolveWorkspaceFileFsPath(workspaceRootFsPath, to);
      const targetUri = dst.ok ? fsPathToFileUri(dst.fsPath) : '';
      const res = await fsCopy({ workspaceRootFsPath, from, to, options });
      if (res?.ok && targetUri) notifyWorkspaceFileEvent('workspace/didCreateFiles', { files: [targetUri] });
      if (res?.ok && dst.ok) {
        try { await this._activateWorkspaceContainsForFsPaths([dst.fsPath], { reason: 'workspace/fsCopy' }); } catch {}
      }
      return res;
    });

    conn.onRequest('workspace/fsStat', async (params) => {
      const workspaceRootFsPath = this._getWorkspaceFsPath();
      const uri = params?.uri != null ? params.uri : (params?.path || params?.fsPath);
      const resolved = resolveWorkspaceFileFsPath(workspaceRootFsPath, uri);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      try {
        const st = await fs.promises.lstat(resolved.fsPath);
        let type = 0;
        if (st.isFile()) type = 1;
        else if (st.isDirectory()) type = 2;
        else if (st.isSymbolicLink()) type = 64;
        return {
          ok: true,
          stat: {
            type,
            ctime: Math.round(Number(st.ctimeMs) || 0),
            mtime: Math.round(Number(st.mtimeMs) || 0),
            size: Math.round(Number(st.size) || 0),
          },
        };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    conn.onRequest('workspace/fsReadDirectory', async (params) => {
      const workspaceRootFsPath = this._getWorkspaceFsPath();
      const uri = params?.uri != null ? params.uri : (params?.path || params?.fsPath);
      const resolved = resolveWorkspaceFileFsPath(workspaceRootFsPath, uri);
      if (!resolved.ok) return { ok: false, error: resolved.error };
      try {
        const entries = await fs.promises.readdir(resolved.fsPath, { withFileTypes: true });
        const out = [];
        for (const ent of entries) {
          const name = ent?.name ? String(ent.name) : '';
          if (!name) continue;
          let type = 0;
          if (ent.isFile()) type = 1;
          else if (ent.isDirectory()) type = 2;
          else if (ent.isSymbolicLink()) type = 64;
          out.push([name, type]);
        }
        return { ok: true, entries: out };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    conn.onRequest('workspace/findFiles', async (params) => {
      const workspaceRootFsPath = this._getWorkspaceFsPath();
      const include = params?.include;
      const exclude = params?.exclude;
      const maxResults = Number.isFinite(params?.maxResults) ? params.maxResults : undefined;
      const res = await findFilesInWorkspace({ workspaceRootFsPath, include, exclude, maxResults });
      if (!res.ok) return { ok: false, error: res.error, uris: [] };
      return { ok: true, uris: res.uris };
    });

    conn.onRequest('workspace/createFileSystemWatcher', async (params) => {
      const workspaceRootFsPath = this._getWorkspaceFsPath();
      const gp = params?.globPattern;
      const ignoreCreateEvents = !!params?.ignoreCreateEvents;
      const ignoreChangeEvents = !!params?.ignoreChangeEvents;
      const ignoreDeleteEvents = !!params?.ignoreDeleteEvents;
      if (typeof minimatch !== 'function') return { ok: false, error: 'minimatch dependency is not available' };
      const inc = normalizeGlobArg(workspaceRootFsPath, gp);
      if (!inc.ok) return { ok: false, error: inc.error };
      const baseFsPath = inc.baseFsPath || String(workspaceRootFsPath || '');
      const pattern = String(inc.pattern || '');
      if (!pattern) return { ok: false, error: 'missing glob pattern' };
      if (!isUnderRoot(workspaceRootFsPath, baseFsPath)) return { ok: false, error: 'base path is outside workspace root' };

      let chokidar;
      try {
        // eslint-disable-next-line global-require
        chokidar = require('chokidar');
      } catch {
        return { ok: false, error: 'chokidar is not available' };
      }

      const watcherId = `w${this._watcherSeq++}`;
      const mmOpts = { dot: true, nocase: process.platform === 'win32' };
      const ignored = (p) => {
        const s = String(p || '');
        if (!s) return false;
        const normalized = s.replace(/\\/g, '/');
        return /(^|\/)(node_modules|\.git|\.hg|\.svn)(\/|$)/.test(normalized);
      };

      const emit = (type, targetFsPath) => {
        if (!this.connection || conn !== this.connection) return;
        if (!targetFsPath) return;
        if (!isUnderRoot(workspaceRootFsPath, targetFsPath)) return;
        const rel = path.relative(baseFsPath, targetFsPath).replace(/\\/g, '/');
        if (!rel || rel.startsWith('..')) return;
        if (!minimatch(rel, pattern, mmOpts)) return;
        const uri = fsPathToFileUri(targetFsPath);
        if (!uri) return;
        try {
          conn.sendNotification('workspace/fileSystemWatcherEvent', { watcherId, type, uri, ts: Date.now() });
        } catch {}
      };

      try {
        const watcher = chokidar.watch(baseFsPath, { ignoreInitial: true, ignored, persistent: true });
        watcher.on('add', (p) => emit('create', p));
        watcher.on('change', (p) => emit('change', p));
        watcher.on('unlink', (p) => emit('delete', p));
        this._fileWatchers.set(watcherId, watcher);
        return { ok: true, watcherId, ignoreCreateEvents, ignoreChangeEvents, ignoreDeleteEvents };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    });

    conn.onRequest('workspace/disposeFileSystemWatcher', async (params) => {
      const watcherId = params?.watcherId != null ? String(params.watcherId) : '';
      if (!watcherId) return { ok: false, error: 'missing watcherId' };
      const watcher = this._fileWatchers.get(watcherId);
      if (!watcher) return { ok: true };
      this._fileWatchers.delete(watcherId);
      try {
        await watcher.close?.();
      } catch {}
      return { ok: true };
    });

    conn.onNotification('output/append', (params) => {
      const channelId = params?.channelId ? String(params.channelId) : '';
      const label = params?.label ? String(params.label) : '';
      const text = params?.text != null ? String(params.text) : '';
      if (!channelId || !text) return;
      broadcastToRenderers('output/append', { channelId, label, text, ts: Date.now() });
    });

    conn.onNotification('output/clear', (params) => {
      const channelId = params?.channelId ? String(params.channelId) : '';
      if (!channelId) return;
      broadcastToRenderers('output/clear', { channelId, ts: Date.now() });
    });

    conn.onNotification('diagnostics/publish', (params) => {
      const uri = params?.uri ? String(params.uri) : '';
      const diagnostics = Array.isArray(params?.diagnostics) ? params.diagnostics : [];
      const owner = params?.owner ? String(params.owner) : 'extension';
      if (!uri) return;
      broadcastToRenderers('diagnostics/publish', { uri, diagnostics, owner, ts: Date.now() });
    });

    try {
      await (this.vscodeExtensionsReady || Promise.resolve());
    } catch {}

    await this._refreshActivationIndex().catch(() => {});

    if (this._isWorkspaceTrusted()) {
      const startup = Array.from(this._activationIndex.startup.values());
      if (startup.length) await this._activateExtensions(startup, { reason: '*' }).catch(() => {});
      await this._activateWorkspaceContains().catch(() => {});
    }

    this._restartDelayMs = 750;
    return true;
  }

  async _refreshActivationIndex() {
    const installed = (() => {
      try {
        return Array.isArray(this.vscodeExtensions?.listInstalled?.()) ? this.vscodeExtensions.listInstalled() : [];
      } catch {
        return [];
      }
    })();

    const enabled = installed.filter((x) => !!x?.enabled);
    const extensions = new Map();
    const byCommand = new Map();
    const byLanguage = new Map();
    const workspaceContains = [];
    const startup = new Set();
    const commandContributions = [];

    for (const it of enabled) {
      const id = String(it?.id || '').trim();
      const installDir = String(it?.installDir || '').trim();
      const manifest = it?.manifest && typeof it.manifest === 'object' ? it.manifest : {};
      const extensionPath = installDir ? path.join(installDir, 'extension') : '';
      const mainRel = manifest?.main != null ? String(manifest.main).trim() : '';
      const mainAbs = (extensionPath && mainRel) ? path.join(extensionPath, mainRel) : '';
      if (!id || !extensionPath || !mainAbs) continue;

      extensions.set(id, { id, extensionPath, main: mainAbs, manifest });

      const contributes = manifest?.contributes && typeof manifest.contributes === 'object' ? manifest.contributes : {};
      const contribCommands = Array.isArray(contributes.commands) ? contributes.commands : [];
      for (const c of contribCommands) {
        const command = c?.command != null ? String(c.command).trim() : '';
        if (!command) continue;
        const title = c?.title != null ? String(c.title) : command;
        commandContributions.push({ command, title });
        if (!byCommand.has(command)) byCommand.set(command, []);
        byCommand.get(command).push(id);
      }

      const events = Array.isArray(manifest.activationEvents) ? manifest.activationEvents.map((e) => String(e || '').trim()).filter(Boolean) : [];
      for (const e of events) {
        if (e === '*') {
          startup.add(id);
          continue;
        }
        if (e.startsWith('onCommand:')) {
          const cmd = e.slice('onCommand:'.length).trim();
          if (!cmd) continue;
          if (!byCommand.has(cmd)) byCommand.set(cmd, []);
          byCommand.get(cmd).push(id);
          continue;
        }
        if (e.startsWith('onLanguage:')) {
          const lang = e.slice('onLanguage:'.length).trim();
          if (!lang) continue;
          if (!byLanguage.has(lang)) byLanguage.set(lang, []);
          byLanguage.get(lang).push(id);
          continue;
        }
        if (e.startsWith('workspaceContains:')) {
          const glob = e.slice('workspaceContains:'.length).trim();
          if (!glob) continue;
          workspaceContains.push({ id, glob });
        }
      }
    }

    const uniq = (arr) => Array.from(new Set((Array.isArray(arr) ? arr : []).filter(Boolean)));
    for (const [cmd, list] of byCommand.entries()) byCommand.set(cmd, uniq(list));
    for (const [lang, list] of byLanguage.entries()) byLanguage.set(lang, uniq(list));

    this._activationIndex = { extensions, byCommand, byLanguage, workspaceContains, startup };
    commandsService.setExtensionContributions(commandContributions);
    broadcastToRenderers('commands/changed', { ts: Date.now() });
  }

  async _activateWorkspaceContains() {
    const workspaceRootFsPath = this._getWorkspaceFsPath();
    const root = String(workspaceRootFsPath || '').trim();
    if (!root) return { ok: true, activated: [] };
    const matches = new Set();
    const list = Array.isArray(this._activationIndex.workspaceContains) ? this._activationIndex.workspaceContains : [];
    for (const it of list) {
      const id = String(it?.id || '').trim();
      const glob = String(it?.glob || '').trim();
      if (!id || !glob) continue;
      const res = await findFilesInWorkspace({ workspaceRootFsPath: root, include: glob, maxResults: 1 }).catch(() => null);
      if (res?.ok && Array.isArray(res.uris) && res.uris.length) matches.add(id);
    }
    return await this._activateExtensions(Array.from(matches.values()), { reason: 'workspaceContains' });
  }

  async _activateWorkspaceContainsForFsPaths(fsPaths = [], { reason } = {}) {
    if (!this._isWorkspaceTrusted()) return { ok: false, error: 'workspace not trusted', activated: [] };
    const workspaceRootFsPath = this._getWorkspaceFsPath();
    const root = String(workspaceRootFsPath || '').trim();
    if (!root) return { ok: true, activated: [] };
    if (typeof minimatch !== 'function') return { ok: false, error: 'minimatch dependency is not available', activated: [] };

    const list = Array.isArray(fsPaths) ? fsPaths.map((p) => String(p || '').trim()).filter(Boolean) : [];
    if (!list.length) return { ok: true, activated: [] };

    await this._refreshActivationIndex().catch(() => {});
    const patterns = Array.isArray(this._activationIndex.workspaceContains) ? this._activationIndex.workspaceContains : [];
    if (!patterns.length) return { ok: true, activated: [] };

    const mmOpts = { dot: true, nocase: process.platform === 'win32' };
    const normalizePattern = (p) => String(p || '').trim().replace(/\\/g, '/').replace(/^\//, '');

    const matches = new Set();
    for (const fsPath of list) {
      if (!isUnderRoot(root, fsPath)) continue;
      const rel = path.relative(root, fsPath).replace(/\\/g, '/');
      if (!rel || rel.startsWith('..')) continue;
      for (const it of patterns) {
        const id = String(it?.id || '').trim();
        const glob = normalizePattern(it?.glob);
        if (!id || !glob) continue;
        if (!minimatch(rel, glob, mmOpts)) continue;
        matches.add(id);
      }
    }

    if (!matches.size) return { ok: true, activated: [] };
    return await this._activateExtensions(Array.from(matches.values()), { reason: String(reason || 'workspaceContains:fileEvent') });
  }

  async _activateExtensions(extensionIds = [], { reason } = {}) {
    const ids = Array.isArray(extensionIds) ? extensionIds.map((x) => String(x || '').trim()).filter(Boolean) : [];
    if (!ids.length) return { ok: true, activated: [] };
    const pending = ids.filter((id) => !this._loadedExtensionIds.has(id));
    if (!pending.length) return { ok: true, activated: [] };

    const tasks = pending.map((id) => {
      if (this._activationInFlight.has(id)) return this._activationInFlight.get(id);
      const p = this._activateOne(id, { reason });
      this._activationInFlight.set(id, p);
      return p;
    });
    const results = await Promise.allSettled(tasks);
    const activated = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const id = r.value?.id ? String(r.value.id) : '';
      if (id) activated.push(id);
    }
    return { ok: true, activated };
  }

  async _activateOne(id, { reason } = {}) {
    const extId = String(id || '').trim();
    if (!extId) return { ok: false, id: '', error: 'missing id' };
    if (this._loadedExtensionIds.has(extId)) return { ok: true, id: extId, already: true };
    const rec = this._activationIndex.extensions.get(extId);
    if (!rec) return { ok: false, id: extId, error: 'extension not enabled' };

    try {
      await this.start();
    } catch {}
    const conn = this.connection;
    if (!conn || typeof conn.sendRequest !== 'function') return { ok: false, id: extId, error: 'extension host not running' };

    try {
      const res = await conn.sendRequest('extHost/loadExtensions', { extensions: [rec] }, { timeoutMs: 20_000 });
      const ok = Array.isArray(res?.loaded) ? res.loaded.find((x) => String(x?.id || '') === extId)?.ok : true;
      if (!ok) return { ok: false, id: extId, error: 'failed to load' };
      this._loadedExtensionIds.add(extId);
      try { this.logger?.info?.('extension activated', { id: extId, reason: String(reason || '') }); } catch {}
      return { ok: true, id: extId };
    } finally {
      this._activationInFlight.delete(extId);
    }
  }

  _disposeFileWatchers() {
    const entries = Array.from(this._fileWatchers.entries());
    this._fileWatchers.clear();
    for (const [, watcher] of entries) {
      try {
        watcher.close?.();
      } catch {}
    }
  }
}

module.exports = { ExtensionHostService };
