const path = require('path');
const { fileURLToPath, pathToFileURL } = require('node:url');

class Disposable {
  constructor(fn) {
    this._fn = typeof fn === 'function' ? fn : null;
    this._disposed = false;
  }
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    try {
      this._fn?.();
    } catch {}
  }
}

class Uri {
  constructor(value) {
    this._value = String(value || '');
  }
  toString() {
    return this._value;
  }
  get scheme() {
    const s = this._value;
    const idx = s.indexOf(':');
    if (idx <= 0) return '';
    return s.slice(0, idx);
  }
  get fsPath() {
    const s = this._value;
    if (!s || !s.startsWith('file:')) return '';
    try {
      return fileURLToPath(s);
    } catch {
      return '';
    }
  }
  get path() {
    const fp = this.fsPath;
    if (!fp) return '';
    const normalized = fp.replace(/\\/g, '/');
    if (/^[a-zA-Z]:\//.test(normalized)) return `/${normalized}`;
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }
  static parse(value) {
    return new Uri(String(value || ''));
  }
  static file(fsPath) {
    const p = String(fsPath || '').trim();
    if (!p) return new Uri('');
    try {
      return new Uri(pathToFileURL(p).toString());
    } catch {
      const normalized = p.replace(/\\/g, '/');
      if (/^[a-zA-Z]:\//.test(normalized)) return new Uri(`file:///${normalized}`);
      return new Uri(`file://${normalized.startsWith('/') ? '' : '/'}${normalized}`);
    }
  }
  static joinPath(base, ...paths) {
    const b = base instanceof Uri ? base.fsPath : '';
    if (!b) return new Uri('');
    const next = path.join(b, ...paths.map((p) => String(p || '')));
    return Uri.file(next);
  }
}

class TextDocument {
  constructor({ uri, fileName, languageId, version, text } = {}) {
    const u = uri instanceof Uri ? uri : Uri.parse(uri);
    this.uri = u;
    this.fileName = fileName ? String(fileName) : (u ? u.fsPath || String(u.toString()) : '');
    this.isUntitled = false;
    this.languageId = languageId ? String(languageId) : '';
    this.version = Number.isFinite(version) ? version : 1;
    this._text = text == null ? '' : String(text);
  }
  getText() {
    return this._text;
  }
  _updateFromBus({ text, version } = {}) {
    if (text != null) this._text = String(text);
    if (Number.isFinite(version)) this.version = version;
  }
}

class TextEditor {
  constructor(document) {
    this.document = document;
  }
}

module.exports = {
  Disposable,
  Uri,
  TextDocument,
  TextEditor,
};

