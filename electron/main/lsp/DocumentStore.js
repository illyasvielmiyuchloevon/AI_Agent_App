const { offsetAt } = require('./util/position');

function applyIncrementalChange(text, change) {
  if (!change || typeof change.text !== 'string') return text;
  if (!change.range) return change.text;

  const start = offsetAt(text, change.range.start);
  const end = offsetAt(text, change.range.end);
  return text.slice(0, start) + change.text + text.slice(end);
}

class DocumentStore {
  constructor({ logger } = {}) {
    this.logger = logger;
    this.docs = new Map(); // uri -> {uri, languageId, version, text}
  }

  list() {
    return Array.from(this.docs.values());
  }

  get(uri) {
    return this.docs.get(String(uri));
  }

  open({ uri, languageId, version = 1, text = '' }) {
    const key = String(uri);
    this.docs.set(key, {
      uri: key,
      languageId: String(languageId || ''),
      version: Number(version) || 1,
      text: String(text || ''),
    });
  }

  close(uri) {
    this.docs.delete(String(uri));
  }

  applyChange({ uri, version, contentChanges }) {
    const key = String(uri);
    const doc = this.docs.get(key);
    if (!doc) return { ok: false, reason: 'not_open' };

    const nextVersion = Number(version);
    if (!Number.isFinite(nextVersion)) return { ok: false, reason: 'invalid_version' };

    if (nextVersion <= doc.version) {
      this.logger?.warn?.('non-monotonic version ignored', { uri: key, current: doc.version, next: nextVersion });
      return { ok: false, reason: 'non_monotonic' };
    }

    if (nextVersion !== doc.version + 1) {
      this.logger?.warn?.('version jump detected', { uri: key, current: doc.version, next: nextVersion });
    }

    const changes = Array.isArray(contentChanges) ? contentChanges : [];
    let text = doc.text;
    for (const ch of changes) {
      text = applyIncrementalChange(text, ch);
    }
    doc.text = text;
    doc.version = nextVersion;
    return { ok: true, doc };
  }
}

module.exports = { DocumentStore };

