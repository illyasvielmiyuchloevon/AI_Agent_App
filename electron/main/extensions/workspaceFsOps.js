const fs = require('node:fs');
const { resolveWorkspaceFileFsPath } = require('./workspaceFsUtils');

const pathExists = async (fsPath) => {
  try {
    await fs.promises.lstat(fsPath);
    return true;
  } catch {
    return false;
  }
};

const removePath = async (fsPath, { recursive } = {}) => {
  const rec = !!recursive;
  try {
    const st = await fs.promises.lstat(fsPath);
    if (st.isDirectory() && !rec) {
      await fs.promises.rmdir(fsPath);
      return;
    }
  } catch (err) {
    throw err;
  }
  await fs.promises.rm(fsPath, { recursive: rec, force: false });
};

async function fsCreateDirectory({ workspaceRootFsPath, uri } = {}) {
  const workspaceRoot = String(workspaceRootFsPath || '').trim();
  const resolved = resolveWorkspaceFileFsPath(workspaceRoot, uri);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  try {
    await fs.promises.mkdir(resolved.fsPath, { recursive: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function fsDelete({ workspaceRootFsPath, uri, options } = {}) {
  const workspaceRoot = String(workspaceRootFsPath || '').trim();
  const resolved = resolveWorkspaceFileFsPath(workspaceRoot, uri);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const recursive = !!options?.recursive;
  try {
    if (!(await pathExists(resolved.fsPath))) return { ok: false, error: 'path does not exist' };
    await removePath(resolved.fsPath, { recursive });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function fsRename({ workspaceRootFsPath, from, to, options } = {}) {
  const workspaceRoot = String(workspaceRootFsPath || '').trim();
  const src = resolveWorkspaceFileFsPath(workspaceRoot, from);
  if (!src.ok) return { ok: false, error: src.error };
  const dst = resolveWorkspaceFileFsPath(workspaceRoot, to);
  if (!dst.ok) return { ok: false, error: dst.error };
  const overwrite = !!options?.overwrite;
  try {
    if (!(await pathExists(src.fsPath))) return { ok: false, error: 'source does not exist' };
    if (await pathExists(dst.fsPath)) {
      if (!overwrite) return { ok: false, error: 'target already exists' };
      await removePath(dst.fsPath, { recursive: true });
    }
    await fs.promises.rename(src.fsPath, dst.fsPath);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

async function fsCopy({ workspaceRootFsPath, from, to, options } = {}) {
  const workspaceRoot = String(workspaceRootFsPath || '').trim();
  const src = resolveWorkspaceFileFsPath(workspaceRoot, from);
  if (!src.ok) return { ok: false, error: src.error };
  const dst = resolveWorkspaceFileFsPath(workspaceRoot, to);
  if (!dst.ok) return { ok: false, error: dst.error };
  const overwrite = !!options?.overwrite;
  try {
    if (!(await pathExists(src.fsPath))) return { ok: false, error: 'source does not exist' };
    if (await pathExists(dst.fsPath)) {
      if (!overwrite) return { ok: false, error: 'target already exists' };
      await removePath(dst.fsPath, { recursive: true });
    }
    if (typeof fs.promises.cp !== 'function') return { ok: false, error: 'fs.promises.cp is not available' };
    await fs.promises.cp(src.fsPath, dst.fsPath, { recursive: true, force: false });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

module.exports = {
  fsCreateDirectory,
  fsDelete,
  fsRename,
  fsCopy,
};

