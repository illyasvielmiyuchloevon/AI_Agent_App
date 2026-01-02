const { EventEmitter } = require('events');
const { PendingRequests, TimeoutError } = require('./PendingRequests');
const { CancelledError } = require('./Cancellation');
let randomUUID = null;
try {
  const crypto = require('crypto');
  randomUUID = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID.bind(crypto) : null;
} catch {
  randomUUID = null;
}

function makeError(code, message, data) {
  return { code, message: String(message || ''), ...(data !== undefined ? { data } : {}) };
}

class JsonRpcConnection extends EventEmitter {
  constructor(transport, { logger, tracer, name, traceMeta } = {}) {
    super();
    this.transport = transport;
    this.logger = logger;
    this.tracer = typeof tracer === 'function' ? tracer : null;
    this.name = name ? String(name) : '';
    this.traceMeta = !!traceMeta;

    this.nextId = 1;
    this.pending = new PendingRequests();
    this.requestHandlers = new Map();
    this.notificationHandlers = new Map();
    this.closed = false;

    transport.onMessage((msg) => this._onMessage(msg));
    transport.onInvalid?.((info) => this.logger?.warn?.('invalid message', info));
    transport.onError?.((err) => this.logger?.exception?.('transport error', err));
    transport.onClose?.(() => this._onClose());
  }

  _newId() {
    const v = randomUUID?.();
    if (v) return v;
    return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  }

  _normalizeTrace(trace) {
    if (!trace || typeof trace !== 'object') return null;
    const traceId = trace.traceId ? String(trace.traceId) : '';
    const spanId = trace.spanId ? String(trace.spanId) : '';
    const parentSpanId = trace.parentSpanId ? String(trace.parentSpanId) : '';
    if (!traceId) return null;
    return { traceId, spanId, parentSpanId };
  }

  _makeChildTrace(parent) {
    const p = this._normalizeTrace(parent) || null;
    const traceId = p?.traceId || this._newId();
    const parentSpanId = p?.spanId || p?.parentSpanId || '';
    const spanId = this._newId();
    return { traceId, spanId, parentSpanId };
  }

  _emitTrace(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (!this.tracer && this.listenerCount('trace') === 0) return;
    const evt = this.name ? { ...payload, connection: this.name } : payload;
    try {
      this.emit('trace', evt);
    } catch {}
    try {
      this.tracer?.(evt);
    } catch {}
  }

  dispose() {
    if (this.closed) return;
    this._onClose();
    try { this.transport.close?.(); } catch {}
  }

  onRequest(method, handler) {
    this.requestHandlers.set(String(method), handler);
  }

  onNotification(method, handler) {
    const m = String(method);
    if (!this.notificationHandlers.has(m)) this.notificationHandlers.set(m, new Set());
    this.notificationHandlers.get(m).add(handler);
    return () => this.notificationHandlers.get(m)?.delete?.(handler);
  }

  sendNotification(method, params) {
    if (this.closed) throw new Error('JsonRpcConnection is closed');
    this.transport.send({
      jsonrpc: '2.0',
      method: String(method),
      ...(params !== undefined ? { params } : {}),
    });
  }

  sendRequest(method, params, { timeoutMs = 0, cancelToken, trace } = {}) {
    if (this.closed) return Promise.reject(new Error('JsonRpcConnection is closed'));
    const id = this.nextId++;
    const startedAt = Date.now();
    const m = String(method);
    const childTrace = this.traceMeta ? this._makeChildTrace(trace) : null;

    this.transport.send({
      jsonrpc: '2.0',
      id,
      method: m,
      ...(params !== undefined ? { params } : {}),
      ...(childTrace ? { trace: childTrace } : {}),
    });

    return new Promise((resolve, reject) => {
      let timeout = null;
      let cancelUnsub = null;
      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        timeout = null;
        if (cancelUnsub) cancelUnsub();
        cancelUnsub = null;
      };

      const entry = {
        id,
        method: m,
        startedAt,
        trace: childTrace,
        resolve: (v) => {
          cleanup();
          this._emitTrace({
            kind: 'request',
            direction: 'outgoing',
            id,
            method: m,
            startedAt,
            endedAt: Date.now(),
            durationMs: Date.now() - startedAt,
            outcome: 'ok',
            timeoutMs: timeoutMs || 0,
            traceId: childTrace?.traceId || '',
            spanId: childTrace?.spanId || '',
            parentSpanId: childTrace?.parentSpanId || '',
            pendingCount: this.pending?.map?.size || 0,
          });
          resolve(v);
        },
        reject: (e) => {
          cleanup();
          const endedAt = Date.now();
          let outcome = 'error';
          if (e instanceof TimeoutError) outcome = 'timeout';
          else if (e instanceof CancelledError) outcome = 'cancelled';
          this._emitTrace({
            kind: 'request',
            direction: 'outgoing',
            id,
            method: m,
            startedAt,
            endedAt,
            durationMs: endedAt - startedAt,
            outcome,
            errorName: e?.name ? String(e.name) : '',
            errorMessage: e?.message ? String(e.message) : '',
            errorCode: typeof e?.code === 'number' ? e.code : undefined,
            timeoutMs: timeoutMs || 0,
            traceId: childTrace?.traceId || '',
            spanId: childTrace?.spanId || '',
            parentSpanId: childTrace?.parentSpanId || '',
            pendingCount: this.pending?.map?.size || 0,
          });
          reject(e);
        },
      };
      this.pending.add(id, entry);

      if (timeoutMs && timeoutMs > 0) {
        timeout = setTimeout(() => {
          if (!this.pending.has(id)) return;
          this.pending.take(id);
          try {
            this.sendNotification('$/cancelRequest', { id });
          } catch {}
          entry.reject(new TimeoutError(`${m} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      if (cancelToken) {
        cancelUnsub = cancelToken.onCancel(() => {
          if (!this.pending.has(id)) return;
          this.pending.take(id);
          try {
            this.sendNotification('$/cancelRequest', { id });
          } catch {}
          entry.reject(new CancelledError(`${m} cancelled`));
        });
      }
    });
  }

  async _onMessage(msg) {
    if (this.closed) return;
    if (!msg || msg.jsonrpc !== '2.0') return;

    if (Object.prototype.hasOwnProperty.call(msg, 'method')) {
      const method = String(msg.method);
      const params = msg.params;
      if (Object.prototype.hasOwnProperty.call(msg, 'id')) {
        const startedAt = Date.now();
        const id = msg.id;
        const incomingTrace = this.traceMeta ? this._makeChildTrace(msg.trace) : null;
        const handler = this.requestHandlers.get(method);
        if (!handler) {
          this.transport.send({ jsonrpc: '2.0', id, error: makeError(-32601, `Method not found: ${method}`), ...(incomingTrace ? { trace: incomingTrace } : {}) });
          const endedAt = Date.now();
          this._emitTrace({
            kind: 'request',
            direction: 'incoming',
            id,
            method,
            startedAt,
            endedAt,
            durationMs: endedAt - startedAt,
            outcome: 'not_found',
            errorCode: -32601,
            errorMessage: `Method not found: ${method}`,
            traceId: incomingTrace?.traceId || '',
            spanId: incomingTrace?.spanId || '',
            parentSpanId: incomingTrace?.parentSpanId || '',
            pendingCount: this.pending?.map?.size || 0,
          });
          return;
        }
        try {
          const result = await handler(params, { trace: incomingTrace });
          this.transport.send({ jsonrpc: '2.0', id, result: result === undefined ? null : result, ...(incomingTrace ? { trace: incomingTrace } : {}) });
          const endedAt = Date.now();
          this._emitTrace({
            kind: 'request',
            direction: 'incoming',
            id,
            method,
            startedAt,
            endedAt,
            durationMs: endedAt - startedAt,
            outcome: 'ok',
            traceId: incomingTrace?.traceId || '',
            spanId: incomingTrace?.spanId || '',
            parentSpanId: incomingTrace?.parentSpanId || '',
            pendingCount: this.pending?.map?.size || 0,
          });
        } catch (err) {
          const message = err?.message || String(err);
          this.transport.send({ jsonrpc: '2.0', id, error: makeError(-32603, message), ...(incomingTrace ? { trace: incomingTrace } : {}) });
          const endedAt = Date.now();
          this._emitTrace({
            kind: 'request',
            direction: 'incoming',
            id,
            method,
            startedAt,
            endedAt,
            durationMs: endedAt - startedAt,
            outcome: 'error',
            errorCode: -32603,
            errorName: err?.name ? String(err.name) : '',
            errorMessage: message,
            traceId: incomingTrace?.traceId || '',
            spanId: incomingTrace?.spanId || '',
            parentSpanId: incomingTrace?.parentSpanId || '',
            pendingCount: this.pending?.map?.size || 0,
          });
        }
      } else {
        const set = this.notificationHandlers.get(method);
        if (!set || !set.size) return;
        for (const fn of Array.from(set)) {
          try { fn(params); } catch (err) {
            this.logger?.exception?.(`notification handler failed: ${method}`, err);
          }
        }
      }
      return;
    }

    if (Object.prototype.hasOwnProperty.call(msg, 'id')) {
      const id = msg.id;
      const entry = this.pending.take(id);
      if (!entry) return;
      if (Object.prototype.hasOwnProperty.call(msg, 'error') && msg.error) {
        const e = new Error(msg.error.message || 'JSON-RPC error');
        e.name = 'JsonRpcError';
        e.code = msg.error.code;
        e.data = msg.error.data;
        entry.reject(e);
      } else {
        entry.resolve(msg.result);
      }
    }
  }

  _onClose() {
    if (this.closed) return;
    this.closed = true;
    this.pending.cancelAll(new Error('Connection closed'));
    this.emit('close');
  }
}

module.exports = { JsonRpcConnection };
