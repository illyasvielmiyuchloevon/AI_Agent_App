const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const SCHEMA_VERSION = 2;
const MAX_RECENTS = 20;

function storagePath() {
  return path.join(app.getPath('userData'), 'recent-workspaces.json');
}

function safeReadJson() {
  try {
    const raw = fs.readFileSync(storagePath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { v: SCHEMA_VERSION, items: [], trust: {} };
  }
}

function safeWriteJson(db) {
  fs.mkdirSync(path.dirname(storagePath()), { recursive: true });
  fs.writeFileSync(storagePath(), JSON.stringify(db, null, 2), 'utf-8');
}

function migrate(db) {
  if (!db || typeof db !== 'object') return { v: SCHEMA_VERSION, items: [], trust: {} };
  const items = Array.isArray(db.items) ? db.items : [];
  const trust = db.trust && typeof db.trust === 'object' ? db.trust : {};
  if (db.v === SCHEMA_VERSION) return { ...db, v: SCHEMA_VERSION, items, trust };
  return { v: SCHEMA_VERSION, items, trust };
}

function list() {
  const db = migrate(safeReadJson());
  const items = (db.items || []).map((entry) => {
    const fsPath = entry && entry.fsPath ? String(entry.fsPath) : '';
    const missing = fsPath ? !fs.existsSync(fsPath) : false;
    return { ...entry, missing };
  });
  items.sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
  return items.slice(0, MAX_RECENTS);
}

function touch({ id, fsPath, name }) {
  const db = migrate(safeReadJson());
  const entry = {
    v: SCHEMA_VERSION,
    id: String(id || ''),
    fsPath: String(fsPath || ''),
    name: String(name || fsPath || 'Workspace'),
    lastOpened: Date.now(),
  };
  const items = [entry, ...(db.items || []).filter((x) => x && x.id !== entry.id)].slice(0, MAX_RECENTS);
  safeWriteJson({ v: SCHEMA_VERSION, items, trust: db.trust || {} });
  return entry;
}

function remove(id) {
  const db = migrate(safeReadJson());
  const items = (db.items || []).filter((x) => x && x.id !== id);
  safeWriteJson({ v: SCHEMA_VERSION, items, trust: db.trust || {} });
}

function normalizeFsPath(fsPath) {
  return String(fsPath || '').trim();
}

function getTrustedByFsPath(fsPath) {
  const key = normalizeFsPath(fsPath);
  if (!key) return false;
  const db = migrate(safeReadJson());
  return db?.trust?.[key] === true;
}

function setTrustedByFsPath(fsPath, trusted) {
  const key = normalizeFsPath(fsPath);
  if (!key) return false;
  const db = migrate(safeReadJson());
  const next = { ...(db.trust || {}) };
  if (trusted) next[key] = true;
  else delete next[key];
  safeWriteJson({ v: SCHEMA_VERSION, items: db.items || [], trust: next });
  return true;
}

module.exports = { list, touch, remove, getTrustedByFsPath, setTrustedByFsPath };
