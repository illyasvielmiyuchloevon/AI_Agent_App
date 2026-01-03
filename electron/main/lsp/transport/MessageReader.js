const { EventEmitter } = require('events');

class MessageReader extends EventEmitter {
  constructor(readable, { maxBufferBytes = 16 * 1024 * 1024, onInvalid = 'drop' } = {}) {
    super();
    this.readable = readable;
    this.maxBufferBytes = maxBufferBytes;
    this.onInvalid = onInvalid;
    this.buffer = Buffer.alloc(0);
    this.expectedBodyBytes = null;
    this.closed = false;

    this._onData = (chunk) => this._handleChunk(chunk);
    this._onError = (err) => this.emit('error', err);
    this._onClose = () => this.close();

    readable.on('data', this._onData);
    readable.on('error', this._onError);
    readable.on('close', this._onClose);
    readable.on('end', this._onClose);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.readable.off('data', this._onData); } catch {}
    try { this.readable.off('error', this._onError); } catch {}
    try { this.readable.off('close', this._onClose); } catch {}
    try { this.readable.off('end', this._onClose); } catch {}
    this.emit('close');
  }

  _handleInvalid(reason, extra) {
    this.emit('invalid', { reason, ...(extra ? { extra } : {}) });
    if (this.onInvalid === 'close') {
      this.close();
    }
  }

  _append(chunk) {
    if (!chunk || !chunk.length) return;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk);
    if (this.buffer.length > this.maxBufferBytes) {
      this._handleInvalid('buffer_overflow', { size: this.buffer.length });
      this.buffer = Buffer.alloc(0);
      this.expectedBodyBytes = null;
    }
  }

  _handleChunk(chunk) {
    if (this.closed) return;
    this._append(chunk);

    while (!this.closed) {
      if (this.expectedBodyBytes == null) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;

        const headerRaw = this.buffer.slice(0, headerEnd).toString('ascii');
        const headers = headerRaw.split('\r\n');
        let contentLength = null;
        for (const line of headers) {
          const idx = line.indexOf(':');
          if (idx === -1) continue;
          const key = line.slice(0, idx).trim().toLowerCase();
          const value = line.slice(idx + 1).trim();
          if (key === 'content-length') {
            const n = Number.parseInt(value, 10);
            if (Number.isFinite(n) && n >= 0) contentLength = n;
          }
        }
        if (contentLength == null) {
          this._handleInvalid('missing_content_length', { headerRaw });
          this.buffer = this.buffer.slice(headerEnd + 4);
          continue;
        }

        this.expectedBodyBytes = contentLength;
        this.buffer = this.buffer.slice(headerEnd + 4);
      }

      if (this.buffer.length < this.expectedBodyBytes) return;

      const body = this.buffer.slice(0, this.expectedBodyBytes);
      this.buffer = this.buffer.slice(this.expectedBodyBytes);
      this.expectedBodyBytes = null;

      let obj = null;
      try {
        obj = JSON.parse(body.toString('utf8'));
      } catch (err) {
        this._handleInvalid('invalid_json', { err: err?.message || String(err) });
        continue;
      }

      this.emit('message', obj);
    }
  }
}

module.exports = { MessageReader };

