const fs = require('fs');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');

function isUnderRoot(rootFsPath, candidateFsPath) {
  const root = String(rootFsPath || '').trim();
  const candidate = String(candidateFsPath || '').trim();
  if (!root || !candidate) return false;

  const normalize = (p) => {
    const resolved = path.resolve(p).replace(/[\\\/]+$/, '');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };

  const rootNorm = normalize(root);
  const candNorm = normalize(candidate);
  if (candNorm === rootNorm) return true;
  const sep = process.platform === 'win32' ? '\\' : path.sep;
  return candNorm.startsWith(rootNorm + sep);
}

function toFsPath(uriOrPath) {
  if (uriOrPath == null) return '';
  if (typeof uriOrPath === 'string') {
    const s = uriOrPath.trim();
    if (!s) return '';
    if (s.startsWith('file:')) {
      try {
        return fileURLToPath(s);
      } catch {
        return '';
      }
    }
    return s;
  }
  if (typeof uriOrPath.toString === 'function') return toFsPath(String(uriOrPath.toString()));
  if (typeof uriOrPath.fsPath === 'string') return String(uriOrPath.fsPath);
  return '';
}

function toFileUriString(fsPathValue) {
  const p = String(fsPathValue || '').trim();
  if (!p) return '';
  if (p.startsWith('file:')) return p;
  try {
    return pathToFileURL(p).toString();
  } catch {
    return '';
  }
}

function resolveWorkspaceFileFsPath(workspaceRootFsPath, uriOrPath) {
  const root = String(workspaceRootFsPath || '').trim();
  const raw = toFsPath(uriOrPath);
  if (!raw) return '';

  const resolved = path.isAbsolute(raw) ? raw : (root ? path.join(root, raw) : raw);
  const fsPath = resolved ? path.resolve(resolved) : '';
  if (!fsPath) return '';

  if (root && path.isAbsolute(fsPath) && !isUnderRoot(root, fsPath)) return '';
  return fsPath;
}

function readWorkspaceSettingsSync(workspaceRootFsPath) {
  const root = String(workspaceRootFsPath || '').trim();
  if (!root) return {};
  const settingsPath = path.join(root, '.vscode', 'settings.json');
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function openTextDocument({ workspaceRootFsPath, uriOrPath } = {}) {
  const root = String(workspaceRootFsPath || '').trim();
  const fsPath = resolveWorkspaceFileFsPath(root, uriOrPath);
  if (!fsPath) return { ok: false, error: 'invalid path' };
  try {
    const text = await fs.promises.readFile(fsPath, 'utf8');
    const uri = toFileUriString(fsPath);
    if (!uri) return { ok: false, error: 'invalid uri' };
    return { ok: true, uri, fileName: fsPath, version: 1, languageId: '', text };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

module.exports = {
  isUnderRoot,
  toFsPath,
  toFileUriString,
  resolveWorkspaceFileFsPath,
  readWorkspaceSettingsSync,
  openTextDocument,
};

