const { spawn } = require('child_process');
const { MessageReader } = require('./MessageReader');
const { MessageWriter } = require('./MessageWriter');

class StdioTransport {
  constructor({ command, args = [], env, cwd, logger }) {
    this.command = command;
    this.args = Array.isArray(args) ? args : [];
    this.env = env;
    this.cwd = cwd;
    this.logger = logger;

    this.proc = null;
    this.reader = null;
    this.writer = null;
  }

  start() {
    if (this.proc) return;
    const proc = spawn(this.command, this.args, {
      cwd: this.cwd || undefined,
      env: { ...process.env, ...(this.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.proc = proc;
    this.reader = new MessageReader(proc.stdout);
    this.writer = new MessageWriter(proc.stdin);

    proc.stdin.on('error', (err) => {
      const message = err?.message || String(err);
      if (message) this.logger?.warn?.('server stdin error', { message });
    });

    proc.stderr.on('data', (buf) => {
      const msg = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf || '');
      if (msg.trim()) this.logger?.warn?.('server stderr', { message: msg });
    });
  }

  send(msg) {
    this.writer.write(msg);
  }

  onMessage(handler) {
    this.reader.on('message', handler);
  }

  onInvalid(handler) {
    this.reader.on('invalid', handler);
  }

  onError(handler) {
    this.reader.on('error', handler);
  }

  onClose(handler) {
    this.reader.on('close', handler);
  }

  close() {
    try { this.reader?.close?.(); } catch {}
    try { this.proc?.kill?.(); } catch {}
  }
}

module.exports = { StdioTransport };
