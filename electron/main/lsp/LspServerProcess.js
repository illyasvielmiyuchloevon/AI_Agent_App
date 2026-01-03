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
      const stderrRing = { chunks: [], size: 0 };
      const invalidRing = { chunks: [], size: 0 };
      let lastExit = null;
      let lastProcError = null;
      const pushStderr = (buf) => {
        const msg = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '');
        if (!msg) return;
        stderrRing.chunks.push({ ts: Date.now(), msg });
        stderrRing.size += msg.length;
        while (stderrRing.size > 16_384 && stderrRing.chunks.length > 1) {
          const first = stderrRing.chunks.shift();
          stderrRing.size -= (first?.msg || '').length;
        }
      };
      const getStderrTail = () => {
        const tail = stderrRing.chunks.map((c) => c.msg).join('');
        const s = String(tail || '').trim();
        if (!s) return '';
        return s.length > 4096 ? s.slice(-4096) : s;
      };
      const pushInvalid = (info) => {
        const reason = String(info?.reason || '').trim();
        const headerRaw = info?.extra?.headerRaw ? String(info.extra.headerRaw) : '';
        const msg = `${reason}${headerRaw ? `\n${headerRaw}` : ''}`;
        if (!msg.trim()) return;
        invalidRing.chunks.push({ ts: Date.now(), msg });
        invalidRing.size += msg.length;
        while (invalidRing.size > 16_384 && invalidRing.chunks.length > 1) {
          const first = invalidRing.chunks.shift();
          invalidRing.size -= (first?.msg || '').length;
        }
      };
      const getInvalidTail = () => {
        const tail = invalidRing.chunks.map((c) => c.msg).join('\n');
        const s = String(tail || '').trim();
        if (!s) return '';
        return s.length > 2048 ? s.slice(-2048) : s;
      };

      const command = String(this.serverConfig?.transport?.command || '');
      const args = Array.isArray(this.serverConfig?.transport?.args) ? this.serverConfig.transport.args : [];
      const cwd = this.serverConfig?.transport?.cwd ? String(this.serverConfig.transport.cwd) : '';

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
      try { t.proc?.stderr?.on?.('data', pushStderr); } catch {}
      try { t.onInvalid?.((info) => pushInvalid(info)); } catch {}

      t.proc.on('exit', (code, signal) => {
        lastExit = { code, signal, ts: Date.now() };
        this.logger?.warn?.('server exited', { code, signal });
        this.onServerStatus?.({ serverId: this.serverId, status: 'exited', code, signal, stderrTail: getStderrTail() || undefined });
        this.emit('exit', { code, signal });
      });
      t.proc.on('error', (err) => {
        lastProcError = err instanceof Error ? (err.message || String(err)) : String(err || '');
        this.logger?.exception?.('server process error', err);
        this.onServerStatus?.({ serverId: this.serverId, status: 'error', error: err?.message || String(err), stderrTail: getStderrTail() || undefined });
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
      const initStartedAt = Date.now();
      const makeHint = ({ error = '', stderrTail = '' } = {}) => {
        const e = String(error || '').toLowerCase();
        const s = String(stderrTail || '').toLowerCase();
        const cmd = String(this.serverConfig?.transport?.command || '');
        if (e.includes('enoent') || e.includes('not found') || s.includes('enoent') || s.includes('not found')) return cmd ? `command not found: ${cmd}` : 'command not found';
        if (s.includes('cannot find module') || s.includes('module not found')) return 'server crashed: missing module';
        if (e.includes('connection closed')) {
          if (lastExit) return `server exited early (code=${lastExit.code}, signal=${lastExit.signal})`;
          return 'server closed stdio connection during startup (exited early)';
        }
        if (e.includes('eacces') || s.includes('eacces') || s.includes('permission')) return 'permission denied while starting server';
        if (stderrTail) return 'server produced stderr output during startup';
        return 'no stderr received; server may be waiting for input or stuck during startup';
      };
      const slowTimer1 = setTimeout(() => {
        const stderrTail = getStderrTail();
        this.onServerStatus?.({
          serverId: this.serverId,
          status: 'initializing_slow',
          elapsedMs: Date.now() - initStartedAt,
          stderrTail: stderrTail || undefined,
          hint: makeHint({ stderrTail }),
        });
      }, Math.min(5000, Math.max(1000, Math.round(initTimeoutMs / 3))));
      const slowTimer2 = setTimeout(() => {
        const stderrTail = getStderrTail();
        const hint = makeHint({ stderrTail });
        this.onServerStatus?.({
          serverId: this.serverId,
          status: 'initializing_slow',
          elapsedMs: Date.now() - initStartedAt,
          stderrTail: stderrTail || undefined,
          hint,
        });
        this.onLog?.({ serverId: this.serverId, level: 'warn', message: `[startup] initialize is slow (${Date.now() - initStartedAt}ms). ${hint}` });
      }, Math.min(15000, Math.max(2000, Math.round((initTimeoutMs * 2) / 3))));

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
        const stderrTail = getStderrTail();
        const errMsg = err?.message || String(err);
        const invalidTail = getInvalidTail();
        let hint = makeHint({ error: errMsg, stderrTail });
        if (invalidTail && hint === 'no stderr received; server may be waiting for input or stuck during startup') {
          hint = 'server wrote non-JSON-RPC output to stdout during startup';
        }

        const truncate = (s, max = 600) => {
          const t = String(s || '');
          return t.length > max ? `${t.slice(0, max)}…` : t;
        };
        const exitInfo = lastExit ? `exit(code=${lastExit.code}, signal=${lastExit.signal})` : '';
        const procErrInfo = lastProcError ? `procError=${truncate(lastProcError, 180)}` : '';
        const cmdInfo = command ? `cmd=${truncate(command, 180)}` : '';
        const argsInfo = args.length ? `args=${truncate(JSON.stringify(args), 240)}` : '';
        const cwdInfo = cwd ? `cwd=${truncate(cwd, 180)}` : '';
        const invalidInfo = invalidTail ? `stdoutInvalidTail=${truncate(invalidTail, 240)}` : '';
        const contextInfo = [cmdInfo, argsInfo, cwdInfo, exitInfo, procErrInfo, invalidInfo].filter(Boolean).join(' ');

        const errorWithHint = hint
          ? `${errMsg}; ${hint}${contextInfo ? `; ${contextInfo}` : ''}`
          : `${errMsg}${contextInfo ? `; ${contextInfo}` : ''}`;
        this.logger?.error?.('initialize failed', {
          serverId: this.serverId,
          timeoutMs: initTimeoutMs,
          command: this.serverConfig?.transport?.command,
          cwd: this.serverConfig?.transport?.cwd,
          error: errorWithHint,
          stderrTail: stderrTail || undefined,
        });
        this.onServerStatus?.({
          serverId: this.serverId,
          status: 'initialize_failed',
          error: errorWithHint,
          stderrTail: stderrTail || undefined,
          hint,
        });
        if (hint) this.onLog?.({ serverId: this.serverId, level: 'error', message: `[startup] initialize failed. ${hint}` });
        const wrapped = new Error(errorWithHint);
        try { wrapped.cause = err; } catch {}
        throw wrapped;
      } finally {
        try { clearTimeout(slowTimer1); } catch {}
        try { clearTimeout(slowTimer2); } catch {}
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
