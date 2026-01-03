const fs = require('fs');
const { fromFileUri } = require('./util/uri');
const { offsetAt } = require('./util/position');
const { convertRange, normalizePositionEncoding } = require('./util/positionEncoding');

class DocumentSync {
  constructor({ logger, mapClientUriToServerUri } = {}) {
    this.logger = logger;
    this.mapClientUriToServerUri = mapClientUriToServerUri;
  }

  serverPositionEncoding(state) {
    return normalizePositionEncoding(state?.proc?.positionEncoding || 'utf-16');
  }

  async getTextForServerUri(state, serverUri) {
    const u = String(serverUri || '');
    if (!state || !u) return '';
    const open = state.store?.get?.(u);
    if (open && typeof open.text === 'string') return open.text;
    if (!u.startsWith('file://')) return '';
    const fsPath = fromFileUri(u);
    if (!fsPath) return '';
    try {
      return await fs.promises.readFile(fsPath, 'utf8');
    } catch {
      return '';
    }
  }

  convertContentChanges(textBefore, contentChanges, fromEncoding, toEncoding) {
    const fromEnc = normalizePositionEncoding(fromEncoding);
    const toEnc = normalizePositionEncoding(toEncoding);
    const changes = Array.isArray(contentChanges) ? contentChanges : [];
    if (fromEnc === toEnc) return changes;
    let text = String(textBefore || '');
    const out = [];
    for (const ch of changes) {
      if (!ch || typeof ch !== 'object') continue;
      if (!ch.range) {
        out.push({ ...ch });
        text = String(ch.text || '');
        continue;
      }
      const convertedRange = convertRange(text, ch.range, fromEnc, toEnc);
      out.push({ ...ch, range: convertedRange });
      text = this._applyIncrementalChangeUtf16(text, ch);
    }
    return out;
  }

  async openDocument(state, doc) {
    const s = state;
    if (!s?.proc) return;
    await s.proc.startAndInitialize();
    const clientUri = String(doc?.uri || '');
    const serverUri = await this.mapClientUriToServerUri?.(s, clientUri);
    const serverDoc = { ...doc, uri: serverUri };
    s.store.open(serverDoc);
    s.proc.sendNotification('textDocument/didOpen', { textDocument: serverDoc });
  }

  async changeDocument(state, change) {
    const s = state;
    if (!s?.proc) return;
    await s.proc.startAndInitialize();
    const clientUri = String(change?.uri || '');
    const serverUri = await this.mapClientUriToServerUri?.(s, clientUri);
    const beforeText = s.store.get(serverUri)?.text || '';
    const res = s.store.applyChange({ ...change, uri: serverUri });
    if (!res.ok && res.reason === 'not_open' && change?.text) {
      s.store.open({ uri: serverUri, languageId: change.languageId || s.serverConfig.languageId, version: change.version, text: change.text });
      s.proc.sendNotification('textDocument/didOpen', { textDocument: s.store.get(serverUri) });
      return;
    }
    const serverEnc = this.serverPositionEncoding(s);
    const contentChanges = this.convertContentChanges(beforeText, change?.contentChanges || [], 'utf-16', serverEnc);
    s.proc.sendNotification('textDocument/didChange', {
      textDocument: { uri: serverUri, version: change.version },
      contentChanges,
    });
  }

  async closeDocument(state, uri) {
    const s = state;
    if (!s?.proc) return;
    await s.proc.startAndInitialize();
    const clientUri = String(uri || '');
    const serverUri = await this.mapClientUriToServerUri?.(s, clientUri);
    s.store.close(serverUri);
    s.proc.sendNotification('textDocument/didClose', { textDocument: { uri: String(serverUri) } });
  }

  async saveDocument(state, params) {
    const s = state;
    if (!s?.proc) return;
    await s.proc.startAndInitialize();
    const clientUri = String(params?.uri || params?.textDocument?.uri || '');
    const serverUri = await this.mapClientUriToServerUri?.(s, clientUri);
    const version = Number(params?.version || params?.textDocument?.version || 0) || undefined;
    const text = typeof params?.text === 'string' ? params.text : undefined;
    s.proc.sendNotification('textDocument/didSave', { textDocument: { uri: serverUri, version }, text });
  }

  reopenAll(state) {
    const s = state;
    if (!s?.proc) return;
    for (const doc of s.store.list()) {
      s.proc.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri: doc.uri,
          languageId: doc.languageId,
          version: doc.version,
          text: doc.text,
        },
      });
    }
  }

  _applyIncrementalChangeUtf16(text, change) {
    if (!change || typeof change.text !== 'string') return text;
    if (!change.range) return String(change.text || '');
    const start = offsetAt(text, change.range.start);
    const end = offsetAt(text, change.range.end);
    return String(text || '').slice(0, start) + change.text + String(text || '').slice(end);
  }
}

module.exports = { DocumentSync };

