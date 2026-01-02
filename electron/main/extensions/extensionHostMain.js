const path = require('path');
const Module = require('module');
const { MessageReader } = require('../lsp/transport/MessageReader');
const { MessageWriter } = require('../lsp/transport/MessageWriter');
const { JsonRpcConnection } = require('../lsp/jsonrpc/JsonRpcConnection');

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

const normalizeUri = (u) => {
  if (!u) return '';
  if (typeof u === 'string') return u;
  if (typeof u.toString === 'function') return String(u.toString());
  if (typeof u.fsPath === 'string') return `file://${String(u.fsPath)}`;
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
  class Disposable {
    constructor(fn) {
      this._fn = typeof fn === 'function' ? fn : null;
      this._disposed = false;
    }
    dispose() {
      if (this._disposed) return;
      this._disposed = true;
      try {
        this._fn?.();
      } catch {}
    }
  }

  class Uri {
    constructor(value) {
      this._value = String(value || '');
    }
    toString() {
      return this._value;
    }
    static parse(value) {
      return new Uri(value);
    }
    static file(fsPath) {
      const p = String(fsPath || '');
      if (!p) return new Uri('');
      if (p.startsWith('file://')) return new Uri(p);
      const normalized = p.replace(/\\/g, '/');
      if (/^[a-zA-Z]:\//.test(normalized)) {
        return new Uri(`file:///${normalized}`);
      }
      return new Uri(`file://${normalized.startsWith('/') ? '' : '/'}${normalized}`);
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
  };

  const DiagnosticSeverity = {
    Error: 1,
    Warning: 2,
    Information: 3,
    Hint: 4,
  };

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
  };

  return { commands, window, languages, Disposable, Uri, DiagnosticSeverity };
};

const vscodeApi = makeVscodeApi();

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

connection.onRequest('initialize', async () => {
  return { ok: true };
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
        extensions.set(id, { id, module: mod, exports: res, context });
        loaded.push({ id, ok: true });
      } else {
        extensions.set(id, { id, module: mod, exports: null, context });
        loaded.push({ id, ok: true, note: 'no activate()' });
      }
    } catch (err) {
      sendOutput('Extension Host', `[ERROR] Failed to load ${id}: ${err?.message || String(err)}`);
      loaded.push({ id, ok: false, error: err?.message || String(err) });
    }
  }

  return { ok: true, loaded };
});

process.on('uncaughtException', (err) => {
  sendOutput('Extension Host', `[FATAL] uncaughtException: ${err?.stack || err?.message || String(err)}`);
});

process.on('unhandledRejection', (reason) => {
  sendOutput('Extension Host', `[FATAL] unhandledRejection: ${reason?.stack || reason?.message || String(reason)}`);
});
