const fs = require('node:fs');
const path = require('node:path');
const minimatchPkg = require('minimatch');
const minimatch =
  (typeof minimatchPkg === 'function' && minimatchPkg) ||
  minimatchPkg?.minimatch ||
  minimatchPkg?.default;
const { resolveWorkspaceFileFsPath, fsPathToFileUri, isUnderRoot } = require('./workspaceFsUtils');

const DEFAULT_IGNORED_DIRS = new Set(['.git', 'node_modules', '.hg', '.svn']);

const toPosixRel = (baseFsPath, fileFsPath) => path.relative(baseFsPath, fileFsPath).replace(/\\/g, '/');

const normalizePattern = (pattern) => {
  const s = String(pattern || '').trim();
  if (!s) return '';
  return s;
};

const normalizeGlobArg = (workspaceRootFsPath, arg) => {
  if (arg == null) return { ok: false, error: 'missing glob', baseFsPath: '', pattern: '' };
  if (typeof arg === 'string') {
    return { ok: true, error: '', baseFsPath: String(workspaceRootFsPath || ''), pattern: normalizePattern(arg) };
  }
  if (typeof arg === 'object') {
    const rawPattern = arg.pattern != null ? arg.pattern : arg.glob != null ? arg.glob : '';
    const pattern = normalizePattern(rawPattern);
    const base = arg.baseFsPath != null ? String(arg.baseFsPath) : (arg.baseUri != null ? String(arg.baseUri) : (arg.base != null ? String(arg.base) : ''));
    if (!pattern) return { ok: false, error: 'missing glob pattern', baseFsPath: '', pattern: '' };
    if (!base) return { ok: true, error: '', baseFsPath: String(workspaceRootFsPath || ''), pattern };
    const resolved = resolveWorkspaceFileFsPath(workspaceRootFsPath, base);
    if (!resolved.ok) return { ok: false, error: resolved.error, baseFsPath: '', pattern: '' };
    return { ok: true, error: '', baseFsPath: resolved.fsPath, pattern };
  }
  return { ok: false, error: 'invalid glob', baseFsPath: '', pattern: '' };
};

const shouldIgnoreDir = (dirName) => {
  const n = String(dirName || '').trim();
  if (!n) return false;
  return DEFAULT_IGNORED_DIRS.has(n);
};

async function findFilesInWorkspace({ workspaceRootFsPath, include, exclude, maxResults } = {}) {
  const root = String(workspaceRootFsPath || '').trim();
  if (!root) return { ok: false, error: 'workspace root is not set', uris: [] };
  if (typeof minimatch !== 'function') return { ok: false, error: 'minimatch dependency is not available', uris: [] };
  const inc = normalizeGlobArg(root, include);
  if (!inc.ok) return { ok: false, error: inc.error, uris: [] };
  const exc = exclude != null ? normalizeGlobArg(root, exclude) : { ok: true, error: '', baseFsPath: '', pattern: '' };
  if (exclude != null && !exc.ok) return { ok: false, error: exc.error, uris: [] };

  const baseFsPath = path.resolve(inc.baseFsPath || root);
  if (!isUnderRoot(root, baseFsPath)) return { ok: false, error: 'base path is outside workspace root', uris: [] };

  const limit = Number.isFinite(maxResults) ? Math.max(0, Math.min(50_000, maxResults)) : 2000;
  const includePattern = inc.pattern;
  const excludePattern = exc.pattern;

  const mmOpts = { dot: true, nocase: process.platform === 'win32' };
  const results = [];
  const queue = [baseFsPath];

  while (queue.length && results.length < limit) {
    const dir = queue.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      if (results.length >= limit) break;
      const name = ent?.name ? String(ent.name) : '';
      if (!name) continue;
      const full = path.join(dir, name);
      if (!isUnderRoot(root, full)) continue;

      if (ent.isDirectory()) {
        if (shouldIgnoreDir(name)) continue;
        queue.push(full);
        continue;
      }

      if (!ent.isFile() && !ent.isSymbolicLink()) continue;

      const rel = toPosixRel(baseFsPath, full);
      if (!rel || rel.startsWith('..')) continue;
      if (!minimatch(rel, includePattern, mmOpts)) continue;
      if (excludePattern && minimatch(rel, excludePattern, mmOpts)) continue;
      results.push(fsPathToFileUri(full));
    }
  }

  return { ok: true, error: '', uris: results };
}

module.exports = {
  findFilesInWorkspace,
  normalizeGlobArg,
};
