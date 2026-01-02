const path = require('path');
const { fileURLToPath, pathToFileURL } = require('node:url');

const normalizeComparablePath = (p) => {
  const s = String(p || '').replace(/[\\\/]+$/, '');
  const r = path.resolve(s);
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

const isUnderRoot = (rootFsPath, candidateFsPath) => {
  const root = String(rootFsPath || '').trim();
  const candidate = String(candidateFsPath || '').trim();
  if (!root || !candidate) return false;
  const rr = normalizeComparablePath(root);
  const cc = normalizeComparablePath(candidate);
  if (cc === rr) return true;
  const sep = process.platform === 'win32' ? '\\' : path.sep;
  return cc.startsWith(rr + sep);
};

const fileUriToFsPath = (uri) => {
  const u = String(uri || '').trim();
  if (!u) return '';
  if (!u.startsWith('file:')) return '';
  try {
    return fileURLToPath(u);
  } catch {
    return '';
  }
};

const fsPathToFileUri = (fsPath) => {
  const p = String(fsPath || '').trim();
  if (!p) return '';
  try {
    return pathToFileURL(p).toString();
  } catch {
    const normalized = p.replace(/\\/g, '/');
    if (/^[a-zA-Z]:\//.test(normalized)) return `file:///${normalized}`;
    return `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`;
  }
};

function resolveWorkspaceFileFsPath(workspaceRootFsPath, uriOrPath) {
  const root = String(workspaceRootFsPath || '').trim();
  if (!root) return { ok: false, error: 'workspace root is not set', fsPath: '' };

  const raw = uriOrPath == null ? '' : (typeof uriOrPath === 'string' ? uriOrPath : String(uriOrPath));
  const s = String(raw || '').trim();
  if (!s) return { ok: false, error: 'missing path', fsPath: '' };

  let candidate = '';
  if (s.startsWith('file:')) candidate = fileUriToFsPath(s);
  else if (path.isAbsolute(s)) candidate = s;
  else candidate = path.join(root, s);

  if (!candidate) return { ok: false, error: 'invalid file uri', fsPath: '' };

  const resolved = path.resolve(candidate);
  if (!isUnderRoot(root, resolved)) return { ok: false, error: 'path is outside workspace root', fsPath: '' };
  return { ok: true, error: '', fsPath: resolved };
}

module.exports = {
  isUnderRoot,
  fileUriToFsPath,
  fsPathToFileUri,
  resolveWorkspaceFileFsPath,
};

