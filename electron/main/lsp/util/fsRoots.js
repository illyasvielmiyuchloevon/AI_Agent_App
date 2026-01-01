const { fromFileUri } = require('./uri');

function normalizePathForCompare(p) {
  const s = String(p || '');
  if (!s) return '';
  const norm = s.replace(/[\\\/]+$/, '');
  return process.platform === 'win32' ? norm.toLowerCase() : norm;
}

function workspaceFolderRootsFsPaths(workspace) {
  const ws = workspace || {};
  const roots = [];
  const rootFsPath = String(ws.rootFsPath || '').trim();
  if (rootFsPath) roots.push(rootFsPath);
  const folders = Array.isArray(ws.folders) ? ws.folders : [];
  for (const f of folders) {
    const uri = typeof f?.uri === 'string' ? f.uri : '';
    if (!uri) continue;
    const fsPath = fromFileUri(uri);
    if (fsPath) roots.push(fsPath);
  }
  const seen = new Set();
  return roots
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .filter((x) => {
      const key = normalizePathForCompare(x);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function pickContainingRoot(roots, fsPath) {
  const p = normalizePathForCompare(fsPath);
  if (!p) return '';
  let best = '';
  for (const r of Array.isArray(roots) ? roots : []) {
    const root = normalizePathForCompare(r);
    if (!root) continue;
    if (!p.startsWith(root)) continue;
    if (!best || root.length > normalizePathForCompare(best).length) best = r;
  }
  return best;
}

module.exports = {
  normalizePathForCompare,
  workspaceFolderRootsFsPaths,
  pickContainingRoot,
};

