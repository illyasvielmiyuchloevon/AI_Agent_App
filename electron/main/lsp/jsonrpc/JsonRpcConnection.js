const { EventEmitter } = require('events');
const { PendingRequests, TimeoutError } = require('./PendingRequests');
const { CancelledError } = require('./Cancellation');

function makeError(code, message, data) {
  return { code, message: String(message || ''), ...(data !== undefined ? { data } : {}) };
}

class JsonRpcConnection extends EventEmitter {
  constructor(transport, { logger } = {}) {
    super();
    this.transport = transport;
    this.logger = logger;

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

  sendRequest(method, params, { timeoutMs = 0, cancelToken } = {}) {
    if (this.closed) return Promise.reject(new Error('JsonRpcConnection is closed'));
    const id = this.nextId++;
    const startedAt = Date.now();
    const m = String(method);

    this.transport.send({
      jsonrpc: '2.0',
      id,
      method: m,
      ...(params !== undefined ? { params } : {}),
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
        resolve: (v) => { cleanup(); resolve(v); },
        reject: (e) => { cleanup(); reject(e); },
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
        const id = msg.id;
        const handler = this.requestHandlers.get(method);
        if (!handler) {
          this.transport.send({ jsonrpc: '2.0', id, error: makeError(-32601, `Method not found: ${method}`) });
          return;
        }
        try {
          const result = await handler(params);
          this.transport.send({ jsonrpc: '2.0', id, result: result === undefined ? null : result });
        } catch (err) {
          const message = err?.message || String(err);
          this.transport.send({ jsonrpc: '2.0', id, error: makeError(-32603, message) });
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

