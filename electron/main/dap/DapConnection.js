const { EventEmitter } = require('events');

class DapConnection extends EventEmitter {
  constructor(transport, { logger } = {}) {
    super();
    this.transport = transport;
    this.logger = logger;

    this.nextSeq = 1;
    this.pending = new Map();
    this.requestHandlers = new Map();
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

  onRequest(command, handler) {
    this.requestHandlers.set(String(command || ''), handler);
  }

  onEvent(handler) {
    const fn = typeof handler === 'function' ? handler : null;
    if (!fn) return () => {};
    this.on('event', fn);
    return () => this.off('event', fn);
  }

  sendRequest(command, args, { timeoutMs = 30_000 } = {}) {
    const cmd = String(command || '').trim();
    if (!cmd) return Promise.reject(new Error('dap request missing command'));
    if (this.closed) return Promise.reject(new Error('dap connection closed'));

    const seq = this.nextSeq++;
    const msg = {
      seq,
      type: 'request',
      command: cmd,
      ...(args !== undefined ? { arguments: args } : {}),
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`dap request timeout: ${cmd}`));
      }, Math.max(1, Number(timeoutMs) || 30_000));

      this.pending.set(seq, { resolve, reject, timer, command: cmd });

      try {
        this.transport.send(msg);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(seq);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  _onMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    const type = msg.type ? String(msg.type) : '';

    if (type === 'response') {
      const requestSeq = Number(msg.request_seq);
      const p = this.pending.get(requestSeq);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(requestSeq);
      const ok = msg.success !== false;
      if (!ok) {
        const message = msg.message ? String(msg.message) : (msg.body?.error ? String(msg.body.error) : 'request failed');
        p.reject(new Error(message));
        return;
      }
      p.resolve(msg);
      return;
    }

    if (type === 'event') {
      try {
        this.emit('event', msg);
      } catch {}
      return;
    }

    if (type === 'request') {
      this._handleReverseRequest(msg);
    }
  }

  async _handleReverseRequest(req) {
    const command = req.command ? String(req.command) : '';
    const seq = Number(req.seq);
    const handler = this.requestHandlers.get(command);
    if (!command || !Number.isFinite(seq) || seq <= 0) return;

    if (!handler) {
      this._sendResponse({ requestSeq: seq, command, success: false, message: `unhandled request: ${command}` });
      return;
    }

    try {
      const body = await handler(req.arguments);
      this._sendResponse({ requestSeq: seq, command, success: true, body });
    } catch (err) {
      this._sendResponse({ requestSeq: seq, command, success: false, message: err?.message || String(err) });
    }
  }

  _sendResponse({ requestSeq, command, success, message, body } = {}) {
    if (this.closed) return;
    const seq = this.nextSeq++;
    const msg = {
      seq,
      type: 'response',
      request_seq: Number(requestSeq) || 0,
      success: success !== false,
      command: String(command || ''),
      ...(message ? { message: String(message) } : {}),
      ...(body !== undefined ? { body } : {}),
    };
    try {
      this.transport.send(msg);
    } catch {}
  }

  _onClose() {
    if (this.closed) return;
    this.closed = true;
    for (const [id, p] of this.pending.entries()) {
      clearTimeout(p.timer);
      try {
        p.reject(new Error(`dap connection closed (pending: ${p.command || id})`));
      } catch {}
    }
    this.pending.clear();
    this.emit('close');
  }
}

module.exports = { DapConnection };

