const path = require('path');
const { Uri } = require('./vscodeTypes');

const safeBasename = (fsPath) => {
  const raw = String(fsPath || '').trim();
  if (!raw) return '';
  const trimmed = raw.replace(/[\\\/]+$/, '');
  return path.basename(trimmed) || trimmed;
};

function singleFolderFromFsPath(fsPath) {
  const root = String(fsPath || '').trim();
  if (!root) return [];
  return [{ uri: Uri.file(root), name: safeBasename(root), index: 0 }];
}

function diffWorkspaceFolders(prev, next) {
  const a = Array.isArray(prev) ? prev : [];
  const b = Array.isArray(next) ? next : [];
  const toKey = (f) => {
    try {
      const u = f?.uri;
      if (typeof u === 'string') return u;
      if (u && typeof u.toString === 'function') return String(u.toString());
      return '';
    } catch {
      return '';
    }
  };
  const prevKeys = new Map(a.map((f) => [toKey(f), f]).filter(([k]) => k));
  const nextKeys = new Map(b.map((f) => [toKey(f), f]).filter(([k]) => k));

  const added = [];
  const removed = [];
  for (const [k, f] of nextKeys) {
    if (!prevKeys.has(k)) added.push(f);
  }
  for (const [k, f] of prevKeys) {
    if (!nextKeys.has(k)) removed.push(f);
  }
  return { added, removed };
}

module.exports = {
  singleFolderFromFsPath,
  diffWorkspaceFolders,
};

