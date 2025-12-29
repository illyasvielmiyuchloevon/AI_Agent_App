const { EventEmitter } = require('events');
const { StdioTransport } = require('./transport/StdioTransport');
const { JsonRpcConnection } = require('./jsonrpc/JsonRpcConnection');
const { buildClientCapabilities } = require('./protocol/capabilities');
const { normalizePositionEncoding } = require('./util/positionEncoding');

class LspServerProcess extends EventEmitter {
  constructor({ serverId, serverConfig, workspace, logger, onDiagnostics, onLog, onProgress, onServerStatus, getConfiguration, onRegisterCapability, onUnregisterCapability, applyWorkspaceEdit }) {
    super();
    this.serverId = serverId;
    this.serverConfig = serverConfig;
    this.workspace = workspace;
    this.logger = logger;

    this.onDiagnostics = onDiagnostics;
    this.onLog = onLog;
    this.onProgress = onProgress;
    this.onServerStatus = onServerStatus;
    this.getConfiguration = getConfiguration;
    this.onRegisterCapability = onRegisterCapability;
    this.onUnregisterCapability = onUnregisterCapability;
    this.applyWorkspaceEdit = applyWorkspaceEdit;

    this.transport = null;
    this.connection = null;
    this.serverCapabilities = null;
    this.positionEncoding = 'utf-16';
    this._ready = null;
    this._proc = null;
  }

  get ready() {
    return this._ready || Promise.resolve();
  }

  async startAndInitialize() {
    if (this._ready) return this._ready;
    this._ready = (async () => {
      this.onServerStatus?.({ serverId: this.serverId, status: 'starting' });
      const t = new StdioTransport({
        command: this.serverConfig.transport.command,
        args: this.serverConfig.transport.args || [],
        env: this.serverConfig.transport.env || undefined,
        cwd: this.serverConfig.transport.cwd || undefined,
        logger: this.logger?.child?.('transport') || this.logger,
      });
      t.start();
      this.transport = t;
      this._proc = t.proc;

      t.proc.on('exit', (code, signal) => {
        this.logger?.warn?.('server exited', { code, signal });
        this.onServerStatus?.({ serverId: this.serverId, status: 'exited', code, signal });
        this.emit('exit', { code, signal });
      });
      t.proc.on('error', (err) => {
        this.logger?.exception?.('server process error', err);
        this.onServerStatus?.({ serverId: this.serverId, status: 'error', error: err?.message || String(err) });
      });

      const conn = new JsonRpcConnection(t, { logger: this.logger?.child?.('jsonrpc') || this.logger });
      this.connection = conn;

      conn.onNotification('textDocument/publishDiagnostics', (params) => {
        this.onDiagnostics?.({ serverId: this.serverId, uri: params?.uri, diagnostics: params?.diagnostics || [] });
      });
      conn.onNotification('window/logMessage', (params) => {
        const message = params?.message || '';
        this.onLog?.({ serverId: this.serverId, level: 'info', message });
      });
      conn.onNotification('$/progress', (params) => {
        this.onProgress?.({ serverId: this.serverId, ...params });
      });

      conn.onRequest('workspace/configuration', async (params) => {
        const items = Array.isArray(params?.items) ? params.items : [];
        const results = [];
        for (const item of items) {
          const section = item?.section ? String(item.section) : '';
          try {
            const value = await this.getConfiguration?.(section);
            results.push(value === undefined ? null : value);
          } catch {
            results.push(null);
          }
        }
        return results;
      });

      conn.onRequest('client/registerCapability', async (params) => {
        try {
          const regs = Array.isArray(params?.registrations) ? params.registrations : [];
          for (const r of regs) {
            const method = String(r?.method || '');
            const id = r?.id ? String(r.id) : '';
            const registerOptions = r?.registerOptions;
            this.onRegisterCapability?.({ serverId: this.serverId, id, method, registerOptions });
          }
        } catch (err) {
          this.logger?.exception?.('client/registerCapability handler failed', err);
        }
        return null;
      });

      conn.onRequest('client/unregisterCapability', async (params) => {
        try {
          const unregs = Array.isArray(params?.unregisterations) ? params.unregisterations : (Array.isArray(params?.unregistrations) ? params.unregistrations : []);
          for (const r of unregs) {
            const method = String(r?.method || '');
            const id = r?.id ? String(r.id) : '';
            this.onUnregisterCapability?.({ serverId: this.serverId, id, method });
          }
        } catch (err) {
          this.logger?.exception?.('client/unregisterCapability handler failed', err);
        }
        return null;
      });

      conn.onRequest('workspace/applyEdit', async (params) => {
        const label = params?.label ? String(params.label) : '';
        const edit = params?.edit;
        if (!this.applyWorkspaceEdit) {
          return { applied: false, failureReason: 'workspace/applyEdit is not supported by the client' };
        }
        try {
          const res = await this.applyWorkspaceEdit({ serverId: this.serverId, label, edit });
          if (res && typeof res === 'object' && typeof res.applied === 'boolean') {
            return { applied: !!res.applied, failureReason: res.failureReason ? String(res.failureReason) : undefined };
          }
          if (res === true) return { applied: true };
          if (res === false) return { applied: false, failureReason: 'applyWorkspaceEdit returned false' };
          return { applied: true };
        } catch (err) {
          this.logger?.exception?.('workspace/applyEdit handler failed', err, { serverId: this.serverId });
          return { applied: false, failureReason: err?.message || String(err) };
        }
      });

      conn.onRequest('window/showMessageRequest', async (params) => {
        try {
          const message = params?.message ? String(params.message) : '';
          if (message) this.onLog?.({ serverId: this.serverId, level: 'info', message: `[showMessageRequest] ${message}` });
        } catch {
          // ignore
        }
        return null;
      });

      conn.onRequest('window/workDoneProgress/create', async (params) => {
        try {
          const token = params?.token ? String(params.token) : '';
          if (token) this.onLog?.({ serverId: this.serverId, level: 'debug', message: `[workDoneProgress/create] ${token}` });
        } catch {
          // ignore
        }
        return null;
      });

      const initParams = {
        processId: process.pid,
        rootUri: this.workspace?.rootUri || null,
        workspaceFolders: Array.isArray(this.workspace?.folders) ? this.workspace.folders : [],
        initializationOptions: this.serverConfig.initializationOptions || undefined,
        capabilities: buildClientCapabilities({
          snippetSupport: true,
          dynamicRegistration: true,
          configuration: true,
          positionEncodings: ['utf-16', 'utf-8', 'utf-32'],
        }),
        clientInfo: { name: 'ai-agent-app', version: '0.0.0' },
      };

      const initTimeoutMsRaw =
        this.serverConfig?.initializationTimeoutMs ??
        this.serverConfig?.initializeTimeoutMs ??
        30_000;
      const initTimeoutMs = (() => {
        const n = Number(initTimeoutMsRaw);
        if (!Number.isFinite(n) || n <= 0) return 30_000;
        return Math.max(5_000, Math.min(120_000, Math.round(n)));
      })();
      this.onServerStatus?.({ serverId: this.serverId, status: 'initializing', timeoutMs: initTimeoutMs });

      let onError = null;
      let onExit = null;
      const procFailure = new Promise((_, reject) => {
        onError = (err) => reject(err instanceof Error ? err : new Error(String(err)));
        onExit = (code, signal) => reject(new Error(`server exited before initialize (code=${code}, signal=${signal})`));
        t.proc.once('error', onError);
        t.proc.once('exit', onExit);
      });

      let result;
      try {
        result = await Promise.race([
          conn.sendRequest('initialize', initParams, { timeoutMs: initTimeoutMs }),
          procFailure,
        ]);
      } catch (err) {
        this.logger?.error?.('initialize failed', {
          serverId: this.serverId,
          timeoutMs: initTimeoutMs,
          command: this.serverConfig?.transport?.command,
          cwd: this.serverConfig?.transport?.cwd,
          error: err?.message || String(err),
        });
        this.onServerStatus?.({ serverId: this.serverId, status: 'initialize_failed', error: err?.message || String(err) });
        throw err;
      } finally {
        try { if (onError) t.proc.off('error', onError); } catch {}
        try { if (onExit) t.proc.off('exit', onExit); } catch {}
      }
      this.serverCapabilities = result?.capabilities || {};
      this.positionEncoding = normalizePositionEncoding(this.serverCapabilities?.positionEncoding || 'utf-16');
      conn.sendNotification('initialized', {});
      this.onServerStatus?.({ serverId: this.serverId, status: 'ready' });
      return result;
    })();

    return this._ready;
  }

  async shutdown() {
    try {
      if (this.connection) {
        await this.connection.sendRequest('shutdown', null, { timeoutMs: 5_000 }).catch(() => {});
        try { this.connection.sendNotification('exit'); } catch {}
      }
    } finally {
      try { this.transport?.close?.(); } catch {}
      this.onServerStatus?.({ serverId: this.serverId, status: 'stopped' });
    }
  }

  sendNotification(method, params) {
    if (!this.connection) throw new Error('Server not started');
    this.connection.sendNotification(method, params);
  }

  sendRequest(method, params, options) {
    if (!this.connection) return Promise.reject(new Error('Server not started'));
    return this.connection.sendRequest(method, params, options);
  }
}

module.exports = { LspServerProcess };
