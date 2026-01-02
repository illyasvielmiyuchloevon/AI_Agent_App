const path = require('path');
const { BrowserWindow, app } = require('electron');
const { StdioTransport } = require('../lsp/transport/StdioTransport');
const { JsonRpcConnection } = require('../lsp/jsonrpc/JsonRpcConnection');
const commandsService = require('../commands/commandsService');

const broadcastToRenderers = (method, params) => {
  const msg = { jsonrpc: '2.0', method: String(method || ''), ...(params !== undefined ? { params } : {}) };
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('idebus:message', msg);
    } catch {}
  }
};

class ExtensionHostService {
  constructor({ logger, workspaceService, recentStore } = {}) {
    this.logger = logger;
    this.workspaceService = workspaceService;
    this.recentStore = recentStore;
    this.transport = null;
    this.connection = null;
    this._ready = null;
    this._restartTimer = null;
    this._restartDelayMs = 750;
    this._restartHistory = [];
  }

  get ready() {
    return this._ready || Promise.resolve();
  }

  start() {
    if (this._ready) return this._ready;
    this._ready = this._spawnOnce();
    return this._ready;
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
      this._spawnOnce().catch(() => {});
    }, delay);
  }

  async _spawnOnce() {
    try {
      try { this.connection?.dispose?.(); } catch {}
      try { this.transport?.close?.(); } catch {}
      if (this.connection) commandsService.unregisterAllFromOwner(this.connection);
    } catch {}

    const entry = path.join(__dirname, 'extensionHostMain.js');
    const t = new StdioTransport({
      command: process.execPath,
      args: [entry],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      cwd: app.getAppPath(),
      logger: this.logger,
    });
    t.start();
    this.transport = t;

    const conn = new JsonRpcConnection(t, { logger: this.logger, name: 'extHost:main:stdio', traceMeta: true });
    this.connection = conn;

    const onClose = () => {
      try { commandsService.unregisterAllFromOwner(conn); } catch {}
      broadcastToRenderers('commands/changed', { ts: Date.now() });
      this._scheduleRestart('close');
    };
    conn.on('close', onClose);

    try {
      if (t.proc) {
        t.proc.once('exit', (code, signal) => {
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

    conn.onRequest('commands/executeCommand', async (params) => {
      const command = params?.command ? String(params.command) : '';
      const args = Array.isArray(params?.args) ? params.args : [];
      if (!command) return { ok: false, error: 'missing command' };
      const meta = commandsService.getCommandMeta(command);
      if (meta?.source === 'extension' && !this._shouldAllowExtensionCommands()) {
        return { ok: false, error: 'workspace not trusted' };
      }
      const result = await commandsService.executeCommand(command, args);
      return { ok: true, result };
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

    if (!this._isWorkspaceTrusted()) {
      this._restartDelayMs = 750;
      return true;
    }

    const demoEntry = path.join(__dirname, 'demoExtension.js');
    await conn.sendRequest('extHost/loadExtensions', {
      extensions: [
        {
          id: 'demo.extension',
          extensionPath: __dirname,
          main: demoEntry,
        },
      ],
    }, { timeoutMs: 20_000 });

    this._restartDelayMs = 750;
    return true;
  }
}

module.exports = { ExtensionHostService };
