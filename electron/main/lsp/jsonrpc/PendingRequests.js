class TimeoutError extends Error {
  constructor(message = 'Request timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

class PendingRequests {
  constructor() {
    this.map = new Map();
  }

  add(id, entry) {
    this.map.set(id, entry);
  }

  take(id) {
    const v = this.map.get(id);
    this.map.delete(id);
    return v;
  }

  get(id) {
    return this.map.get(id);
  }

  has(id) {
    return this.map.has(id);
  }

  cancelAll(reason) {
    for (const [id, entry] of this.map.entries()) {
      try { entry.reject(reason); } catch {}
      this.map.delete(id);
    }
  }
}

module.exports = { PendingRequests, TimeoutError };

