const path = require('path');
const Module = require('module');
const fs = require('node:fs');
const { MessageReader } = require('../lsp/transport/MessageReader');
const { MessageWriter } = require('../lsp/transport/MessageWriter');
const { JsonRpcConnection } = require('../lsp/jsonrpc/JsonRpcConnection');
const { CompletionProviderRegistry } = require('./completionProviderRegistry');
const { Disposable, Uri, TextDocument } = require('./vscodeTypes');
const { singleFolderFromFsPath, diffWorkspaceFolders } = require('./workspaceFoldersModel');

class ProcessTransport {
  constructor({ readable, writable } = {}) {
    this.readable = readable;
    this.writable = writable;
    this.reader = null;
    this.writer = null;
    this._onMessage = null;
    this._onClose = null;
    this._onInvalid = null;
    this._onError = null;
  }

  start() {
    const r = this.readable || process.stdin;
    const w = this.writable || process.stdout;
    this.reader = new MessageReader(r);
    this.writer = new MessageWriter(w);
    this.reader.on('message', (msg) => {
      try {
        this._onMessage?.(msg);
      } catch {}
    });
    this.reader.on('invalid', (info) => {
      try {
        this._onInvalid?.(info);
      } catch {}
    });
    this.reader.on('error', (err) => {
      try {
        this._onError?.(err);
      } catch {}
    });
    this.reader.on('close', () => {
      try {
        this._onClose?.();
      } catch {}
    });
  }

  onMessage(handler) {
    this._onMessage = handler;
  }

  onClose(handler) {
    this._onClose = handler;
  }

  onInvalid(handler) {
    this._onInvalid = handler;
  }

  onError(handler) {
    this._onError = handler;
  }

  send(msg) {
    this.writer?.write?.(msg);
  }

  close() {
    try {
      this.reader?.close?.();
    } catch {}
  }
}

const transport = new ProcessTransport();
transport.start();

const connection = new JsonRpcConnection(transport, { name: 'extHost:stdio', traceMeta: true });

const commandHandlers = new Map();
const commandTitles = new Map();
const extensions = new Map();
let workspaceRootFsPath = process.env.IDE_WORKSPACE_ROOT ? String(process.env.IDE_WORKSPACE_ROOT) : '';
let workspaceSettings = {};
const completionProviders = new CompletionProviderRegistry();
const configurationListeners = new Set();
const openDocumentsByUri = new Map(); // uri -> TextDocument
const openTextDocumentListeners = new Set();
const changeTextDocumentListeners = new Set();
const closeTextDocumentListeners = new Set();
const saveTextDocumentListeners = new Set();
const createFilesListeners = new Set();
const deleteFilesListeners = new Set();
const renameFilesListeners = new Set();
const activeTextEditorListeners = new Set();
let activeTextEditor = undefined;
const workspaceFoldersListeners = new Set();
let workspaceFolders = singleFolderFromFsPath(workspaceRootFsPath);
const fileSystemWatchers = new Map(); // watcherId -> { ignoreCreate, ignoreChange, ignoreDelete, create, change, del }

const normalizeFolderList = (folders) => {
  const list = Array.isArray(folders) ? folders : [];
  const out = [];
  for (const f of list) {
    if (!f || typeof f !== 'object') continue;
    const uri = f.uri instanceof Uri ? f.uri : Uri.parse(f.uri);
    const name = f.name != null ? String(f.name) : '';
    if (!uri || !uri.toString()) continue;
    out.push({ uri, name: name || uri.fsPath || uri.toString(), index: 0 });
  }
  return out.map((f, idx) => ({ ...f, index: idx }));
};

const setWorkspaceFolders = (nextFolders) => {
  const next = normalizeFolderList(nextFolders);
  const { added, removed } = diffWorkspaceFolders(workspaceFolders, next);
  workspaceFolders = next;
  if (!added.length && !removed.length) return;
  const evt = { added, removed };
  for (const fn of Array.from(workspaceFoldersListeners)) {
    try {
      fn(evt);
    } catch {}
  }
};

const normalizeUri = (u) => {
  if (!u) return '';
  if (typeof u === 'string') return u;
  if (typeof u.toString === 'function') return String(u.toString());
  if (typeof u.fsPath === 'string') return Uri.file(String(u.fsPath)).toString();
  return String(u);
};

const sendOutput = (channelId, text, label) => {
  try {
    connection.sendNotification('output/append', {
      channelId: String(channelId || 'Extension Host'),
      label: label ? String(label) : String(channelId || 'Extension Host'),
      text: text == null ? '' : (typeof text === 'string' ? text : JSON.stringify(text)),
    });
  } catch {}
};

const makeVscodeApi = () => {
  const getPathValue = (obj, rawPath) => {
    const p = String(rawPath || '').trim();
    if (!p) return undefined;
    const parts = p.split('.').filter(Boolean);
    let cur = obj;
    for (const key of parts) {
      if (!cur || typeof cur !== 'object') return undefined;
      if (Object.prototype.hasOwnProperty.call(cur, key)) cur = cur[key];
      else return undefined;
    }
    return cur;
  };

  const getConfigValue = (cfg, rawKey) => {
    const k = String(rawKey || '').trim();
    if (!k) return undefined;
    const nested = getPathValue(cfg, k);
    if (nested !== undefined) return nested;
    if (cfg && typeof cfg === 'object' && Object.prototype.hasOwnProperty.call(cfg, k)) return cfg[k];
    return undefined;
  };

  const toFsPath = (input) => {
    if (!input) return '';
    if (typeof input === 'string') {
      const s = input.trim();
      if (!s) return '';
      if (s.startsWith('file:')) return Uri.parse(s).fsPath || '';
      return s;
    }
    if (typeof input.toString === 'function') return toFsPath(String(input.toString()));
    if (typeof input.fsPath === 'string') return String(input.fsPath);
    return '';
  };

  const isUnderRoot = (root, candidate) => {
    const r = String(root || '').trim();
    const c = String(candidate || '').trim();
    if (!r || !c) return false;
    const norm = (p) => {
      const s = p.replace(/[\\\/]+$/, '');
      return process.platform === 'win32' ? s.toLowerCase() : s;
    };
    const rr = norm(path.resolve(r));
    const cc = norm(path.resolve(c));
    if (cc === rr) return true;
    const sep = process.platform === 'win32' ? '\\' : path.sep;
    return cc.startsWith(rr + sep);
  };

  const pickWorkspaceFolderForPath = (fsPath) => {
    const target = String(fsPath || '').trim();
    if (!target) return null;
    for (const f of workspaceFolders) {
      const root = f?.uri?.fsPath ? String(f.uri.fsPath) : '';
      if (root && isUnderRoot(root, target)) return f;
    }
    const fallback = workspaceFolders[0];
    return fallback || null;
  };

  class Position {
    constructor(line, character) {
      this.line = Number.isFinite(line) ? line : 0;
      this.character = Number.isFinite(character) ? character : 0;
    }
    isEqual(other) {
      const o = other && typeof other === 'object' ? other : {};
      return this.line === Number(o.line) && this.character === Number(o.character);
    }
  }

  class Range {
    constructor(a, b, c, d) {
      if (a && typeof a === 'object' && b && typeof b === 'object') {
        this.start = new Position(a.line, a.character);
        this.end = new Position(b.line, b.character);
        return;
      }
      this.start = new Position(a, b);
      this.end = new Position(c, d);
    }
    get isEmpty() {
      return this.start.isEqual(this.end);
    }
  }

  class WorkspaceEdit {
    constructor() {
      this.changes = {};
      this.documentChanges = [];
    }
    _push(uri, edit) {
      const u = normalizeUri(uri);
      if (!u) return;
      const list = this.changes[u] || [];
      list.push(edit);
      this.changes[u] = list;
    }
    replace(uri, range, newText) {
      const r = range instanceof Range ? range : new Range(range?.start, range?.end);
      this._push(uri, { range: { start: { line: r.start.line, character: r.start.character }, end: { line: r.end.line, character: r.end.character } }, newText: String(newText ?? '') });
    }
    insert(uri, position, newText) {
      const p = position instanceof Position ? position : new Position(position?.line, position?.character);
      const range = { start: { line: p.line, character: p.character }, end: { line: p.line, character: p.character } };
      this._push(uri, { range, newText: String(newText ?? '') });
    }
    delete(uri, range) {
      const r = range instanceof Range ? range : new Range(range?.start, range?.end);
      this._push(uri, { range: { start: { line: r.start.line, character: r.start.character }, end: { line: r.end.line, character: r.end.character } }, newText: '' });
    }
    set(uri, edits) {
      const u = normalizeUri(uri);
      if (!u) return;
      const list = Array.isArray(edits) ? edits : [];
      this.changes[u] = list.map((e) => {
        const rr = e?.range;
        const r = rr instanceof Range ? rr : new Range(rr?.start, rr?.end);
        return { range: { start: { line: r.start.line, character: r.start.character }, end: { line: r.end.line, character: r.end.character } }, newText: String(e?.newText ?? '') };
      });
    }
    toJSON() {
      return { changes: this.changes, documentChanges: this.documentChanges };
    }
  }

  class RelativePattern {
    constructor(base, pattern) {
      const b = base && typeof base === 'object' && base.uri ? base.uri : base;
      this.baseUri = b instanceof Uri ? b : Uri.file(String(b || ''));
      this.pattern = String(pattern || '');
    }
  }

  const commands = {
    registerCommand(command, callback, thisArg) {
      const id = String(command || '').trim();
      if (!id) throw new Error('commands.registerCommand: missing command id');
      const handler = typeof callback === 'function' ? callback : null;
      if (!handler) throw new Error('commands.registerCommand: missing callback');
      commandHandlers.set(id, async (args = []) => handler.apply(thisArg, Array.isArray(args) ? args : [args]));
      commandTitles.set(id, id);
      void connection.sendRequest('commands/registerCommand', { command: id, title: id }).catch(() => {});
      return new Disposable(() => {
        commandHandlers.delete(id);
        commandTitles.delete(id);
        void connection.sendRequest('commands/unregisterCommand', { command: id }).catch(() => {});
      });
    },
    async executeCommand(command, ...args) {
      const id = String(command || '').trim();
      if (!id) throw new Error('commands.executeCommand: missing command id');
      const local = commandHandlers.get(id);
      if (local) return await local(args);
      return await connection.sendRequest('commands/executeCommand', { command: id, args }, { timeoutMs: 30_000 });
    },
  };

	  const window = {
    async showInformationMessage(message, ...items) {
      const msg = String(message || '');
      const list = items.map((x) => String(x));
      await connection.sendRequest('window/showInformationMessage', { message: msg, items: list }).catch(() => null);
      return undefined;
    },
    async showWarningMessage(message, ...items) {
      const msg = `[WARN] ${String(message || '')}`;
      const list = items.map((x) => String(x));
      await connection.sendRequest('window/showInformationMessage', { message: msg, items: list }).catch(() => null);
      return undefined;
    },
    async showErrorMessage(message, ...items) {
      const msg = `[ERROR] ${String(message || '')}`;
      const list = items.map((x) => String(x));
      await connection.sendRequest('window/showInformationMessage', { message: msg, items: list }).catch(() => null);
      return undefined;
    },
    async showInputBox(options) {
      const o = options && typeof options === 'object' ? options : {};
      const res = await connection.sendRequest('window/showInputBox', {
        title: o.title != null ? String(o.title) : 'Input',
        prompt: o.prompt != null ? String(o.prompt) : '',
        value: o.value != null ? String(o.value) : '',
        placeHolder: o.placeHolder != null ? String(o.placeHolder) : '',
      }).catch(() => null);
      if (res == null) return undefined;
      return String(res);
    },
    async showQuickPick(items, options) {
      const list = await Promise.resolve(items).catch(() => []);
      const arr = Array.isArray(list) ? list : [];
      const normalized = arr.map((it) => {
        if (it == null) return null;
        if (typeof it === 'string') return { label: it };
        if (typeof it === 'object') {
          const label = it.label != null ? String(it.label) : '';
          if (!label) return null;
          const description = it.description != null ? String(it.description) : '';
          const detail = it.detail != null ? String(it.detail) : '';
          return { label, ...(description ? { description } : {}), ...(detail ? { detail } : {}) };
        }
        return null;
      }).filter(Boolean);

      const o = options && typeof options === 'object' ? options : {};
      const res = await connection.sendRequest('window/showQuickPick', {
        title: o.title != null ? String(o.title) : 'Select',
        placeHolder: o.placeHolder != null ? String(o.placeHolder) : '',
        canPickMany: !!o.canPickMany,
        items: normalized,
      }).catch(() => null);
      if (res == null) return undefined;
      return String(res);
    },
    createOutputChannel(name) {
      const channelId = String(name || 'Extension');
      const label = channelId;
      const append = (text) => sendOutput(channelId, text, label);
      const appendLine = (text) => sendOutput(channelId, `${text == null ? '' : String(text)}\n`, label);
      return {
        name: channelId,
        append,
        appendLine,
        clear() {
          try {
            connection.sendNotification('output/clear', { channelId });
          } catch {}
        },
        show() {},
        hide() {},
        dispose() {},
      };
    },
    get activeTextEditor() {
      return activeTextEditor;
    },
	    onDidChangeActiveTextEditor(handler) {
	      const fn = typeof handler === 'function' ? handler : null;
	      if (!fn) return new Disposable(() => {});
	      activeTextEditorListeners.add(fn);
	      return new Disposable(() => activeTextEditorListeners.delete(fn));
	    },
	    async showTextDocument(documentOrUri, options) {
	      const opt = options && typeof options === 'object' ? options : {};
	      const raw = documentOrUri == null ? '' : documentOrUri;
	      const uriOrPath = normalizeUri(raw);
	      const doc = (() => {
	        if (raw && typeof raw === 'object' && raw.uri) return raw;
	        if (uriOrPath) return openDocumentsByUri.get(uriOrPath) || null;
	        return null;
	      })();

	      const ensureDoc = async () => {
	        if (doc && typeof doc.getText === 'function') return doc;
	        if (!uriOrPath) throw new Error('window.showTextDocument: missing uri');
	        const opened = await vscodeApi.workspace.openTextDocument(uriOrPath);
	        const key = opened?.uri ? String(opened.uri.toString()) : '';
	        if (key) openDocumentsByUri.set(key, opened);
	        return opened;
	      };

	      const finalDoc = await ensureDoc();
	      try {
	        await connection.sendRequest('window/showTextDocument', { uriOrPath, options: opt }, { timeoutMs: 10_000 });
	      } catch {
	        // ignore
	      }

	      activeTextEditor = createActiveTextEditor(finalDoc);
	      for (const fn of Array.from(activeTextEditorListeners)) {
	        try { fn(activeTextEditor); } catch {}
	      }

	      return activeTextEditor;
	    },
	  };

  const DiagnosticSeverity = {
    Error: 1,
    Warning: 2,
    Information: 3,
    Hint: 4,
  };

  const FileType = {
    Unknown: 0,
    File: 1,
    Directory: 2,
    SymbolicLink: 64,
  };

  const toGlobDto = (arg) => {
    if (arg == null) return null;
    if (typeof arg === 'string') return { pattern: String(arg) };
    if (arg instanceof RelativePattern) return { baseUri: normalizeUri(arg.baseUri), pattern: String(arg.pattern || '') };
    if (typeof arg === 'object') {
      const pattern = arg.pattern != null ? String(arg.pattern) : (arg.glob != null ? String(arg.glob) : '');
      const base = arg.baseUri != null ? arg.baseUri : (arg.base != null ? arg.base : (arg.baseFsPath != null ? arg.baseFsPath : ''));
      const baseUri = base ? normalizeUri(base) : '';
      return { ...(baseUri ? { baseUri } : {}), ...(pattern ? { pattern } : {}) };
    }
    return null;
  };

  const decodeBase64 = (b64) => {
    const s = String(b64 || '');
    if (!s) return new Uint8Array();
    const buf = Buffer.from(s, 'base64');
    return new Uint8Array(buf);
  };

  const encodeBase64 = (data) => {
    if (!data) return '';
    if (typeof data === 'string') return Buffer.from(data, 'utf8').toString('base64');
    if (Buffer.isBuffer(data)) return data.toString('base64');
    if (data instanceof Uint8Array) return Buffer.from(data).toString('base64');
    try {
      return Buffer.from(String(data), 'utf8').toString('base64');
    } catch {
      return '';
    }
  };

  const createEmitter = () => {
    const listeners = new Set();
    return {
      event(listener) {
        const fn = typeof listener === 'function' ? listener : null;
        if (!fn) return new Disposable(() => {});
        listeners.add(fn);
        return new Disposable(() => listeners.delete(fn));
      },
      fire(value) {
        for (const fn of Array.from(listeners)) {
          try {
            fn(value);
          } catch {}
        }
      },
      clear() {
        listeners.clear();
      },
    };
  };

  const normalizeWorkspaceEdit = (edit) => {
    if (!edit) return null;
    if (edit instanceof WorkspaceEdit) return edit.toJSON();
    if (typeof edit !== 'object') return null;
    const changes = edit.changes && typeof edit.changes === 'object' ? edit.changes : {};
    const documentChanges = Array.isArray(edit.documentChanges) ? edit.documentChanges : undefined;
    return { changes, ...(documentChanges ? { documentChanges } : {}) };
  };

  if (typeof TextEditor?.prototype?.edit !== 'function') {
    // eslint-disable-next-line no-param-reassign
    TextEditor.prototype.edit = async function (callback) {
      const fn = typeof callback === 'function' ? callback : null;
      const document = this?.document;
      if (!fn || !document?.uri) return false;
      const edits = [];
      const normalizePos = (p) => {
        if (!p) return { line: 0, character: 0 };
        if (p instanceof Position) return { line: p.line, character: p.character };
        return { line: Number(p.line) || 0, character: Number(p.character) || 0 };
      };
      const normalizeRange = (r) => {
        if (!r) return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
        if (r instanceof Range) return { start: normalizePos(r.start), end: normalizePos(r.end) };
        return { start: normalizePos(r.start), end: normalizePos(r.end) };
      };
      const builder = {
        replace(range, newText) {
          edits.push({ range: normalizeRange(range), newText: String(newText ?? '') });
        },
        insert(position, newText) {
          const p = normalizePos(position);
          edits.push({ range: { start: p, end: p }, newText: String(newText ?? '') });
        },
        delete(range) {
          edits.push({ range: normalizeRange(range), newText: '' });
        },
      };
      const res = fn(builder);
      if (res && typeof res.then === 'function') await res;
      const we = new WorkspaceEdit();
      we.set(document.uri.toString(), edits);
      return await workspace.applyEdit(we);
    };
  }

  const languages = {
    createDiagnosticCollection(name) {
      const owner = String(name || 'extension');
      const api = {
        name: owner,
        set(uri, diagnostics) {
          const u = normalizeUri(uri);
          const list = Array.isArray(diagnostics) ? diagnostics : [];
          if (!u) return;
          connection.sendNotification('diagnostics/publish', { uri: u, diagnostics: list, owner });
        },
        delete(uri) {
          const u = normalizeUri(uri);
          if (!u) return;
          connection.sendNotification('diagnostics/publish', { uri: u, diagnostics: [], owner });
        },
        clear() {},
        dispose() {},
      };
      return api;
    },
    registerCompletionItemProvider(selector, provider, ...triggerCharacters) {
      const reg = completionProviders.register(selector, provider, triggerCharacters);
      return new Disposable(() => reg.dispose());
    },
  };

	  const workspace = {
    get workspaceFolders() {
      return workspaceFolders;
    },
    onDidChangeWorkspaceFolders(handler) {
      const fn = typeof handler === 'function' ? handler : null;
      if (!fn) return new Disposable(() => {});
      workspaceFoldersListeners.add(fn);
      return new Disposable(() => workspaceFoldersListeners.delete(fn));
    },
    get rootPath() {
      const first = workspaceFolders[0];
      return first?.uri?.fsPath ? String(first.uri.fsPath) : undefined;
    },
    getWorkspaceFolder(uri) {
      const fsPath = toFsPath(uri);
      if (!fsPath) return undefined;
      return pickWorkspaceFolderForPath(fsPath) || undefined;
    },
    asRelativePath(pathOrUri, includeWorkspaceFolder) {
      const fsPath = toFsPath(pathOrUri);
      if (!fsPath) return '';
      const folder = pickWorkspaceFolderForPath(fsPath);
      const base = folder?.uri?.fsPath ? String(folder.uri.fsPath) : '';
      if (!base) return fsPath.replace(/\\/g, '/');
      let rel = path.relative(base, fsPath).replace(/\\/g, '/');
      if (!rel || rel.startsWith('..')) rel = fsPath.replace(/\\/g, '/');
      const manyRoots = workspaceFolders.length > 1;
      if (manyRoots && includeWorkspaceFolder) {
        const prefix = folder?.name ? String(folder.name) : '';
        if (prefix) rel = `${prefix}/${rel}`;
      }
      return rel;
    },
	    fs: {
	      async readFile(uri) {
	        const u = normalizeUri(uri);
	        const res = await connection.sendRequest('workspace/fsReadFile', { uri: u }, { timeoutMs: 10_000 }).catch((err) => ({ ok: false, error: err?.message || String(err) }));
	        if (!res || !res.ok) throw new Error(res?.error || 'workspace.fs.readFile failed');
	        return decodeBase64(res.dataB64);
	      },
	      async writeFile(uri, content) {
	        const u = normalizeUri(uri);
	        const dataB64 = encodeBase64(content);
	        const res = await connection.sendRequest('workspace/fsWriteFile', { uri: u, dataB64 }, { timeoutMs: 30_000 }).catch((err) => ({ ok: false, error: err?.message || String(err) }));
	        if (!res || !res.ok) throw new Error(res?.error || 'workspace.fs.writeFile failed');
	        return undefined;
	      },
	      async createDirectory(uri) {
	        const u = normalizeUri(uri);
	        const res = await connection.sendRequest('workspace/fsCreateDirectory', { uri: u }, { timeoutMs: 30_000 }).catch((err) => ({ ok: false, error: err?.message || String(err) }));
	        if (!res || !res.ok) throw new Error(res?.error || 'workspace.fs.createDirectory failed');
	        return undefined;
	      },
	      async delete(uri, options) {
	        const u = normalizeUri(uri);
	        const opt = options && typeof options === 'object' ? options : {};
	        const res = await connection.sendRequest('workspace/fsDelete', { uri: u, options: opt }, { timeoutMs: 30_000 }).catch((err) => ({ ok: false, error: err?.message || String(err) }));
	        if (!res || !res.ok) throw new Error(res?.error || 'workspace.fs.delete failed');
	        return undefined;
	      },
	      async rename(oldUri, newUri, options) {
	        const from = normalizeUri(oldUri);
	        const to = normalizeUri(newUri);
	        const opt = options && typeof options === 'object' ? options : {};
	        const res = await connection.sendRequest('workspace/fsRename', { from, to, options: opt }, { timeoutMs: 30_000 }).catch((err) => ({ ok: false, error: err?.message || String(err) }));
	        if (!res || !res.ok) throw new Error(res?.error || 'workspace.fs.rename failed');
	        return undefined;
	      },
	      async copy(source, destination, options) {
	        const from = normalizeUri(source);
	        const to = normalizeUri(destination);
	        const opt = options && typeof options === 'object' ? options : {};
	        const res = await connection.sendRequest('workspace/fsCopy', { from, to, options: opt }, { timeoutMs: 30_000 }).catch((err) => ({ ok: false, error: err?.message || String(err) }));
	        if (!res || !res.ok) throw new Error(res?.error || 'workspace.fs.copy failed');
	        return undefined;
	      },
	      async stat(uri) {
	        const u = normalizeUri(uri);
	        const res = await connection.sendRequest('workspace/fsStat', { uri: u }, { timeoutMs: 10_000 }).catch((err) => ({ ok: false, error: err?.message || String(err) }));
	        if (!res || !res.ok) throw new Error(res?.error || 'workspace.fs.stat failed');
	        return res.stat || { type: FileType.Unknown, ctime: 0, mtime: 0, size: 0 };
	      },
      async readDirectory(uri) {
        const u = normalizeUri(uri);
        const res = await connection.sendRequest('workspace/fsReadDirectory', { uri: u }, { timeoutMs: 15_000 }).catch((err) => ({ ok: false, error: err?.message || String(err) }));
        if (!res || !res.ok) throw new Error(res?.error || 'workspace.fs.readDirectory failed');
        return Array.isArray(res.entries) ? res.entries : [];
      },
    },
    async findFiles(include, exclude, maxResults) {
      const inc = toGlobDto(include);
      if (!inc || !inc.pattern) return [];
      const exc = exclude != null ? toGlobDto(exclude) : null;
      const res = await connection.sendRequest('workspace/findFiles', { include: inc, exclude: exc, maxResults: Number.isFinite(maxResults) ? maxResults : undefined }, { timeoutMs: 30_000 })
        .catch((err) => ({ ok: false, error: err?.message || String(err), uris: [] }));
      if (!res || !res.ok) return [];
      const uris = Array.isArray(res.uris) ? res.uris : [];
      return uris.map((u) => Uri.parse(String(u || ''))).filter((u) => u && u.toString());
    },
    createFileSystemWatcher(globPattern, ignoreCreateEvents, ignoreChangeEvents, ignoreDeleteEvents) {
      const gp = toGlobDto(globPattern);
      if (!gp || !gp.pattern) throw new Error('workspace.createFileSystemWatcher: missing globPattern');
      const create = createEmitter();
      const change = createEmitter();
      const del = createEmitter();

      const promise = connection.sendRequest('workspace/createFileSystemWatcher', {
        globPattern: gp,
        ignoreCreateEvents: !!ignoreCreateEvents,
        ignoreChangeEvents: !!ignoreChangeEvents,
        ignoreDeleteEvents: !!ignoreDeleteEvents,
      }, { timeoutMs: 20_000 }).catch((err) => ({ ok: false, error: err?.message || String(err) }));

      const watcher = {
        ignoreCreateEvents: !!ignoreCreateEvents,
        ignoreChangeEvents: !!ignoreChangeEvents,
        ignoreDeleteEvents: !!ignoreDeleteEvents,
        onDidCreate: (listener) => create.event(listener),
        onDidChange: (listener) => change.event(listener),
        onDidDelete: (listener) => del.event(listener),
        dispose() {
          promise.then((res) => {
            const watcherId = res?.watcherId ? String(res.watcherId) : '';
            if (!watcherId) return;
            fileSystemWatchers.delete(watcherId);
            void connection.sendRequest('workspace/disposeFileSystemWatcher', { watcherId }, { timeoutMs: 10_000 }).catch(() => {});
          }).catch(() => {});
          create.clear();
          change.clear();
          del.clear();
        },
      };

      promise.then((res) => {
        const watcherId = res?.watcherId ? String(res.watcherId) : '';
        if (!res?.ok || !watcherId) return;
        fileSystemWatchers.set(watcherId, { ignoreCreate: !!ignoreCreateEvents, ignoreChange: !!ignoreChangeEvents, ignoreDelete: !!ignoreDeleteEvents, create, change, del });
      }).catch(() => {});

      return watcher;
    },
    async applyEdit(edit) {
      const normalized = normalizeWorkspaceEdit(edit);
      if (!normalized) return false;
      const res = await connection.sendRequest('workspace/applyEdit', { edit: normalized }, { timeoutMs: 30_000 })
        .catch(() => ({ ok: false, applied: false }));
      return !!res?.ok && !!res?.applied;
    },
    getConfiguration(section, scope) {
      const sec = section == null ? '' : String(section);
      const baseKey = sec ? sec : '';
      const cfg = workspaceSettings && typeof workspaceSettings === 'object' ? workspaceSettings : {};

      const api = {
        get(key, defaultValue) {
          const full = baseKey && key != null ? `${baseKey}.${String(key)}` : (baseKey || String(key || ''));
          const v = getConfigValue(cfg, full);
          return v === undefined ? defaultValue : v;
        },
        has(key) {
          const full = baseKey && key != null ? `${baseKey}.${String(key)}` : (baseKey || String(key || ''));
          return getConfigValue(cfg, full) !== undefined;
        },
        inspect(key) {
          const full = baseKey && key != null ? `${baseKey}.${String(key)}` : (baseKey || String(key || ''));
          const v = getConfigValue(cfg, full);
          return {
            key: full,
            defaultValue: undefined,
            globalValue: undefined,
            workspaceValue: v,
            workspaceFolderValue: undefined,
          };
        },
        async update() {
          throw new Error('workspace.getConfiguration().update is not supported');
        },
      };
      return api;
    },
    onDidChangeConfiguration(handler) {
      const fn = typeof handler === 'function' ? handler : null;
      if (!fn) return new Disposable(() => {});
      configurationListeners.add(fn);
      return new Disposable(() => configurationListeners.delete(fn));
    },
    get textDocuments() {
      return Array.from(openDocumentsByUri.values());
    },
    onDidOpenTextDocument(handler) {
      const fn = typeof handler === 'function' ? handler : null;
      if (!fn) return new Disposable(() => {});
      openTextDocumentListeners.add(fn);
      return new Disposable(() => openTextDocumentListeners.delete(fn));
    },
    onDidChangeTextDocument(handler) {
      const fn = typeof handler === 'function' ? handler : null;
      if (!fn) return new Disposable(() => {});
      changeTextDocumentListeners.add(fn);
      return new Disposable(() => changeTextDocumentListeners.delete(fn));
    },
    onDidCloseTextDocument(handler) {
      const fn = typeof handler === 'function' ? handler : null;
      if (!fn) return new Disposable(() => {});
      closeTextDocumentListeners.add(fn);
      return new Disposable(() => closeTextDocumentListeners.delete(fn));
    },
	    onDidSaveTextDocument(handler) {
	      const fn = typeof handler === 'function' ? handler : null;
	      if (!fn) return new Disposable(() => {});
	      saveTextDocumentListeners.add(fn);
	      return new Disposable(() => saveTextDocumentListeners.delete(fn));
	    },
	    onDidCreateFiles(handler) {
	      const fn = typeof handler === 'function' ? handler : null;
	      if (!fn) return new Disposable(() => {});
	      createFilesListeners.add(fn);
	      return new Disposable(() => createFilesListeners.delete(fn));
	    },
	    onDidDeleteFiles(handler) {
	      const fn = typeof handler === 'function' ? handler : null;
	      if (!fn) return new Disposable(() => {});
	      deleteFilesListeners.add(fn);
	      return new Disposable(() => deleteFilesListeners.delete(fn));
	    },
	    onDidRenameFiles(handler) {
	      const fn = typeof handler === 'function' ? handler : null;
	      if (!fn) return new Disposable(() => {});
	      renameFilesListeners.add(fn);
	      return new Disposable(() => renameFilesListeners.delete(fn));
	    },
	    async openTextDocument(uriOrFileName) {
	      const raw = uriOrFileName == null ? '' : uriOrFileName;
	      const res = await connection.sendRequest('workspace/openTextDocument', { uriOrPath: raw }, { timeoutMs: 10_000 }).catch((err) => ({ ok: false, error: err?.message || String(err) }));
	      if (!res || !res.ok) throw new Error(res?.error || 'openTextDocument failed');
	      const uri = Uri.parse(res.uri || '');
	      return new TextDocument({ uri, fileName: res.fileName || '', languageId: res.languageId || '', version: res.version || 1, text: res.text || '' });
	    },
	  };

  return { commands, window, workspace, languages, Disposable, Uri, DiagnosticSeverity, FileType, RelativePattern, Position, Range, WorkspaceEdit };
};

const vscodeApi = makeVscodeApi();

const createActiveTextEditor = (doc) => {
  if (!doc) return undefined;
  return {
    document: doc,
    async edit(callback, options) {
      const fn = typeof callback === 'function' ? callback : null;
      if (!fn) return false;
      const editBuilder = new vscodeApi.WorkspaceEdit();
      const builder = {
        replace(rangeOrLocation, newText) {
          editBuilder.replace(doc.uri, rangeOrLocation, newText);
        },
        insert(position, newText) {
          editBuilder.insert(doc.uri, position, newText);
        },
        delete(range) {
          editBuilder.delete(doc.uri, range);
        },
        setEndOfLine() {
          // not supported in MVP
        },
      };
      try {
        const maybePromise = fn(builder);
        if (maybePromise && typeof maybePromise.then === 'function') await maybePromise;
        const applied = await vscodeApi.workspace.applyEdit(editBuilder);
        void options;
        return !!applied;
      } catch {
        return false;
      }
    },
  };
};

const normalizeWorkspaceEventFileList = (payload, { allowPairs = false } = {}) => {
  const p = payload && typeof payload === 'object' ? payload : {};
  const filesRaw = Array.isArray(p.files) ? p.files : [];
  const pathsRaw = Array.isArray(p.paths) ? p.paths : [];
  const pairsRaw = allowPairs && Array.isArray(p.pairs) ? p.pairs : [];
  const list = filesRaw.length ? filesRaw : (pathsRaw.length ? pathsRaw : pairsRaw);

  const toFsPath = (value) => {
    if (!value) return '';
    if (typeof value === 'string') {
      const s = value.trim();
      if (!s) return '';
      if (s.startsWith('file:')) return Uri.parse(s).fsPath || '';
      if (/^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('\\\\') || s.startsWith('/')) return s;
      if (workspaceRootFsPath) return path.join(workspaceRootFsPath, s);
      return s;
    }
    if (typeof value === 'object') {
      const uri = value.uri != null ? String(value.uri) : '';
      const fsPath = value.fsPath != null ? String(value.fsPath) : '';
      const pth = value.path != null ? String(value.path) : (value.relPath != null ? String(value.relPath) : '');
      return fsPath || (uri ? (Uri.parse(uri).fsPath || '') : (pth ? toFsPath(pth) : ''));
    }
    return '';
  };

  const toUri = (value) => {
    if (!value) return null;
    if (value instanceof Uri) return value;
    if (typeof value === 'string' && value.trim().startsWith('file:')) return Uri.parse(value);
    const fsPath = toFsPath(value);
    if (!fsPath) return null;
    return Uri.file(fsPath);
  };

  if (!allowPairs) {
    const out = [];
    for (const it of Array.isArray(list) ? list : []) {
      const u = toUri(it);
      if (u) out.push(u);
    }
    return out;
  }

  const pairs = [];
  for (const it of Array.isArray(list) ? list : []) {
    if (!it || typeof it !== 'object') continue;
    const oldV = it.oldUri != null ? it.oldUri : (it.from != null ? it.from : it.oldPath);
    const newV = it.newUri != null ? it.newUri : (it.to != null ? it.to : it.newPath);
    const oldUri = toUri(oldV);
    const newUri = toUri(newV);
    if (oldUri && newUri) pairs.push({ oldUri, newUri });
  }
  return pairs;
};

const installVscodeModule = () => {
  const virtualId = path.join(__dirname, '__virtual_vscode__.js');
  const m = new Module(virtualId);
  m.exports = vscodeApi;
  Module._cache[virtualId] = m;
  const orig = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'vscode') return virtualId;
    return orig.call(this, request, parent, isMain, options);
  };
};

installVscodeModule();

connection.onNotification('workspace/setRoot', (params) => {
  const fsPath = params?.fsPath ? String(params.fsPath) : '';
  workspaceRootFsPath = fsPath;
  setWorkspaceFolders(singleFolderFromFsPath(fsPath));
});

connection.onNotification('workspace/setWorkspaceFolders', (params) => {
  const list = Array.isArray(params?.folders) ? params.folders : [];
  const parsed = [];
  for (const f of list) {
    if (!f || typeof f !== 'object') continue;
    const fsPath = f.fsPath != null ? String(f.fsPath) : '';
    const uriStr = f.uri != null ? String(f.uri) : '';
    const uri = fsPath ? Uri.file(fsPath) : (uriStr ? Uri.parse(uriStr) : null);
    if (!uri || !uri.toString()) continue;
    const name = f.name != null ? String(f.name) : (uri.fsPath ? path.basename(uri.fsPath.replace(/[\\\/]+$/, '')) : '');
    parsed.push({ uri, name: name || 'workspace', index: 0 });
  }
  setWorkspaceFolders(parsed);
  const first = parsed[0];
  if (first?.uri?.fsPath) workspaceRootFsPath = String(first.uri.fsPath);
});

connection.onNotification('workspace/fileSystemWatcherEvent', (params) => {
  const watcherId = params?.watcherId != null ? String(params.watcherId) : '';
  const type = params?.type ? String(params.type) : '';
  const uri = params?.uri ? String(params.uri) : '';
  if (!watcherId || !type || !uri) return;
  const w = fileSystemWatchers.get(watcherId);
  if (!w) return;
  const u = Uri.parse(uri);
  if (type === 'create' && !w.ignoreCreate) w.create.fire(u);
  else if (type === 'change' && !w.ignoreChange) w.change.fire(u);
  else if (type === 'delete' && !w.ignoreDelete) w.del.fire(u);
});

connection.onNotification('workspace/didCreateFiles', (payload) => {
  const files = normalizeWorkspaceEventFileList(payload);
  if (!files.length) return;
  const evt = { files };
  for (const fn of Array.from(createFilesListeners)) {
    try { fn(evt); } catch {}
  }
});

connection.onNotification('workspace/didDeleteFiles', (payload) => {
  const files = normalizeWorkspaceEventFileList(payload);
  if (!files.length) return;
  const evt = { files };
  for (const fn of Array.from(deleteFilesListeners)) {
    try { fn(evt); } catch {}
  }
});

connection.onNotification('workspace/didRenameFiles', (payload) => {
  const files = normalizeWorkspaceEventFileList(payload, { allowPairs: true });
  if (!files.length) return;
  const evt = { files };
  for (const fn of Array.from(renameFilesListeners)) {
    try { fn(evt); } catch {}
  }
});

connection.onNotification('workspace/setConfiguration', (params) => {
  const settings = params?.settings && typeof params.settings === 'object' ? params.settings : {};
  workspaceSettings = settings;
  const evt = { affectsConfiguration: () => true };
  for (const fn of Array.from(configurationListeners)) {
    try {
      fn(evt);
    } catch {}
  }
});

connection.onNotification('editor/textDocumentDidOpen', (params) => {
  const uri = params?.uri ? String(params.uri) : '';
  const languageId = params?.languageId ? String(params.languageId) : '';
  const version = Number.isFinite(params?.version) ? params.version : 1;
  const text = params?.text != null ? String(params.text) : '';
  if (!uri) return;
  const doc = new TextDocument({ uri: Uri.parse(uri), fileName: Uri.parse(uri).fsPath || uri, languageId, version, text });
  openDocumentsByUri.set(uri, doc);
  for (const fn of Array.from(openTextDocumentListeners)) {
    try {
      fn(doc);
    } catch {}
  }
});

connection.onNotification('editor/textDocumentDidChange', (params) => {
  const uri = params?.uri ? String(params.uri) : '';
  if (!uri) return;
  const doc = openDocumentsByUri.get(uri);
  if (!doc) return;
  doc._updateFromBus({ text: params?.text, version: params?.version });
  const evt = { document: doc, contentChanges: [] };
  for (const fn of Array.from(changeTextDocumentListeners)) {
    try {
      fn(evt);
    } catch {}
  }
});

connection.onNotification('editor/textDocumentDidClose', (params) => {
  const uri = params?.uri ? String(params.uri) : '';
  if (!uri) return;
  const doc = openDocumentsByUri.get(uri);
  if (!doc) return;
  openDocumentsByUri.delete(uri);
  for (const fn of Array.from(closeTextDocumentListeners)) {
    try {
      fn(doc);
    } catch {}
  }
});

connection.onNotification('editor/textDocumentDidSave', (params) => {
  const uri = params?.uri ? String(params.uri) : '';
  if (!uri) return;
  const doc = openDocumentsByUri.get(uri);
  if (!doc) return;
  for (const fn of Array.from(saveTextDocumentListeners)) {
    try {
      fn(doc);
    } catch {}
  }
});

connection.onNotification('editor/activeTextEditorChanged', (params) => {
  const uri = params?.uri ? String(params.uri) : '';
  const doc = uri ? openDocumentsByUri.get(uri) : null;
  activeTextEditor = doc ? createActiveTextEditor(doc) : undefined;
  for (const fn of Array.from(activeTextEditorListeners)) {
    try {
      fn(activeTextEditor);
    } catch {}
  }
});

connection.onRequest('initialize', async () => {
  return { ok: true };
});

connection.onRequest('extHost/provideCompletionItems', async (params) => {
  const languageId = params?.languageId ? String(params.languageId) : '';
  const uri = params?.uri ? String(params.uri) : '';
  const text = params?.text != null ? String(params.text) : '';
  const version = Number.isFinite(params?.version) ? params.version : 1;
  const position = params?.position && typeof params.position === 'object' ? params.position : null;
  if (!languageId) return { ok: true, items: [] };
  const doc = new TextDocument({ uri: Uri.parse(uri || '').toString(), fileName: '', languageId, version, text });
  const items = await completionProviders.provide({ languageId, document: doc, position, context: params?.context || null });
  const normalized = Array.isArray(items) ? items.map((it) => {
    if (!it || typeof it !== 'object') return null;
    const label = it.label != null ? String(it.label) : '';
    if (!label) return null;
    const insertText = it.insertText != null ? String(it.insertText) : '';
    const detail = it.detail != null ? String(it.detail) : '';
    const documentation = it.documentation?.value != null ? String(it.documentation.value) : (it.documentation != null ? String(it.documentation) : '');
    const kind = Number.isFinite(it.kind) ? it.kind : undefined;
    return {
      label,
      ...(insertText ? { insertText } : {}),
      ...(detail ? { detail } : {}),
      ...(documentation ? { documentation } : {}),
      ...(kind ? { kind } : {}),
    };
  }).filter(Boolean) : [];
  return { ok: true, items: normalized };
});

connection.onRequest('commands/executeCommand', async (params) => {
  const cmd = params?.command ? String(params.command) : '';
  const args = Array.isArray(params?.args) ? params.args : [];
  const fn = commandHandlers.get(cmd);
  if (!fn) throw new Error(`command not found: ${cmd}`);
  return await fn(args);
});

connection.onRequest('extHost/executeCommand', async (params) => {
  const cmd = params?.command ? String(params.command) : '';
  const args = Array.isArray(params?.args) ? params.args : [];
  const fn = commandHandlers.get(cmd);
  if (!fn) throw new Error(`command not found: ${cmd}`);
  return await fn(args);
});

connection.onRequest('extHost/loadExtensions', async (params) => {
  const list = Array.isArray(params?.extensions) ? params.extensions : [];
  const loaded = [];

  for (const ext of list) {
    const id = ext?.id ? String(ext.id) : '';
    const main = ext?.main ? String(ext.main) : '';
    const extensionPath = ext?.extensionPath ? String(ext.extensionPath) : '';
    if (!id || !main) continue;
    if (extensions.has(id)) continue;

    const context = { subscriptions: [], extensionPath };
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      const mod = require(main);
      if (mod && typeof mod.activate === 'function') {
        const res = await mod.activate(context);
        extensions.set(id, { id, main, extensionPath, module: mod, exports: res, context });
        loaded.push({ id, ok: true });
      } else {
        extensions.set(id, { id, main, extensionPath, module: mod, exports: null, context });
        loaded.push({ id, ok: true, note: 'no activate()' });
      }
    } catch (err) {
      sendOutput('Extension Host', `[ERROR] Failed to load ${id}: ${err?.message || String(err)}`);
      loaded.push({ id, ok: false, error: err?.message || String(err) });
    }
  }

  return { ok: true, loaded };
});

connection.onRequest('extHost/listExtensions', async () => {
  const items = Array.from(extensions.values()).map((e) => ({
    id: e?.id ? String(e.id) : '',
    main: e?.main ? String(e.main) : '',
    extensionPath: e?.extensionPath ? String(e.extensionPath) : '',
  })).filter((e) => e.id);
  items.sort((a, b) => a.id.localeCompare(b.id));
  return { ok: true, items };
});

process.on('uncaughtException', (err) => {
  sendOutput('Extension Host', `[FATAL] uncaughtException: ${err?.stack || err?.message || String(err)}`);
});

process.on('unhandledRejection', (reason) => {
  sendOutput('Extension Host', `[FATAL] unhandledRejection: ${reason?.stack || reason?.message || String(reason)}`);
});
