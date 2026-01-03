class CancelledError extends Error {
  constructor(message = 'Request cancelled') {
    super(message);
    this.name = 'CancelledError';
  }
}

class CancellationToken {
  constructor() {
    this._isCancelled = false;
    this._listeners = new Set();
  }

  get isCancelled() {
    return this._isCancelled;
  }

  onCancel(fn) {
    if (this._isCancelled) {
      try { fn(); } catch {}
      return () => {};
    }
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _cancel() {
    if (this._isCancelled) return;
    this._isCancelled = true;
    for (const fn of Array.from(this._listeners)) {
      try { fn(); } catch {}
    }
    this._listeners.clear();
  }
}

class CancellationTokenSource {
  constructor() {
    this.token = new CancellationToken();
  }
  cancel() {
    this.token._cancel();
  }
}

module.exports = { CancelledError, CancellationToken, CancellationTokenSource };

