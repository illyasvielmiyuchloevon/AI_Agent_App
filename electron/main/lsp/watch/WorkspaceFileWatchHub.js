const path = require('path');
const chokidar = require('chokidar');
const minimatchPkg = require('minimatch');
const minimatch =
  (typeof minimatchPkg === 'function' && minimatchPkg) ||
  minimatchPkg?.minimatch ||
  minimatchPkg?.default;

const { toFileUri, fromFileUri } = require('../util/uri');
const { debounce } = require('../util/debounce');
const { workspaceFolderRootsFsPaths, pickContainingRoot } = require('../util/fsRoots');

class WorkspaceFileWatchHub {
  constructor({ logger, notifyDidChangeWatchedFiles } = {}) {
    this.logger = logger;
    this.notifyDidChangeWatchedFiles = notifyDidChangeWatchedFiles;

    this.watchedFilesRegs = new Map(); // serverId -> { watchers, registrationsById }
    this.workspaceFileWatchers = new Map(); // workspaceId -> { watcher, rootsFsPaths, serverIds:Set, queueByServer:Map }
    this.serverWorkspaceId = new Map(); // serverId -> workspaceId

    if (typeof minimatch !== 'function') throw new Error('minimatch dependency is not available');
  }

  register(serverId, workspace, { registrationId, watchers } = {}) {
    const sid = String(serverId || '');
    if (!sid) return;
    const wid = String(workspace?.workspaceId || '').trim();
    if (!wid) return;

    const list = Array.isArray(watchers) ? watchers : [];
    const regKey = String(registrationId || '');
    const current = this.watchedFilesRegs.get(sid) || { watchers: [], registrationsById: new Map() };
    current.registrationsById.set(regKey, { watchers: list });
    current.watchers = Array.from(current.registrationsById.values()).flatMap((x) => x.watchers || []);
    this.watchedFilesRegs.set(sid, current);
    this.serverWorkspaceId.set(sid, wid);

    try {
      const roots = workspaceFolderRootsFsPaths(workspace);
      const w = this._ensureWorkspaceWatcher(wid, roots);
      if (w) w.serverIds.add(sid);
    } catch {
      // ignore
    }
  }

  unregister(serverId, registrationId) {
    const sid = String(serverId || '');
    if (!sid) return;

    const current = this.watchedFilesRegs.get(sid);
    if (!current) return;

    current.registrationsById.delete(String(registrationId || ''));
    current.watchers = Array.from(current.registrationsById.values()).flatMap((x) => x.watchers || []);
    if (current.registrationsById.size === 0) this.watchedFilesRegs.delete(sid);

    const wid = this.serverWorkspaceId.get(sid);
    if (!wid) return;
    const w = this.workspaceFileWatchers.get(wid);
    if (!w) return;

    w.serverIds.delete(sid);
    try { w.queueByServer?.delete?.(sid); } catch {}
    if (w.serverIds.size === 0) {
      w.watcher.close().catch?.(() => {});
      this.workspaceFileWatchers.delete(wid);
    }

    if (!this.watchedFilesRegs.has(sid)) this.serverWorkspaceId.delete(sid);
  }

  disposeServer(serverId) {
    const sid = String(serverId || '');
    if (!sid) return;

    const wid = this.serverWorkspaceId.get(sid);
    if (wid) {
      const w = this.workspaceFileWatchers.get(wid);
      if (w) {
        w.serverIds.delete(sid);
        try { w.queueByServer?.delete?.(sid); } catch {}
        if (w.serverIds.size === 0) {
          w.watcher.close().catch?.(() => {});
          this.workspaceFileWatchers.delete(wid);
        }
      }
    }

    this.watchedFilesRegs.delete(sid);
    this.serverWorkspaceId.delete(sid);
  }

  disposeWorkspace(workspaceId) {
    const wid = String(workspaceId || '').trim();
    if (!wid) return;

    const w = this.workspaceFileWatchers.get(wid);
    if (w) {
      w.watcher.close().catch?.(() => {});
      this.workspaceFileWatchers.delete(wid);
    }

    for (const [serverId, swid] of this.serverWorkspaceId.entries()) {
      if (String(swid) !== wid) continue;
      this.serverWorkspaceId.delete(serverId);
      this.watchedFilesRegs.delete(serverId);
    }
  }

  _ensureWorkspaceWatcher(workspaceId, rootsFsPaths) {
    const wid = String(workspaceId || '').trim();
    const roots = Array.isArray(rootsFsPaths) ? rootsFsPaths.map((x) => String(x || '').trim()).filter(Boolean) : [];
    if (!wid || roots.length === 0) return null;
    if (this.workspaceFileWatchers.has(wid)) return this.workspaceFileWatchers.get(wid);

    const ignored = (p) => {
      const s = String(p || '');
      if (s.includes(`${path.sep}.git${path.sep}`)) return true;
      if (s.includes(`${path.sep}node_modules${path.sep}`)) return true;
      if (s.includes(`${path.sep}.aichat${path.sep}`)) return true;
      if (s.includes(`${path.sep}dist${path.sep}`)) return true;
      return false;
    };

    const watcher = chokidar.watch(roots, {
      ignoreInitial: true,
      ignored,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    const entry = { watcher, rootsFsPaths: roots, serverIds: new Set(), queueByServer: new Map() };

    const onFs = (type, filePath) => {
      const abs = String(filePath || '');
      if (!abs) return;
      const uri = toFileUri(abs);
      if (!uri) return;
      const eventType = type === 'add' ? 1 : (type === 'change' ? 2 : 3);
      this._enqueueWatchedFileChange(wid, uri, eventType, abs);
    };

    watcher.on('add', (p) => onFs('add', p));
    watcher.on('change', (p) => onFs('change', p));
    watcher.on('unlink', (p) => onFs('unlink', p));
    watcher.on('error', (err) => this.logger?.exception?.('file watcher error', err, { workspaceId: wid }));

    this.workspaceFileWatchers.set(wid, entry);
    return entry;
  }

  _enqueueWatchedFileChange(workspaceId, uri, type, absPath) {
    const entry = this.workspaceFileWatchers.get(String(workspaceId));
    if (!entry) return;

    for (const serverId of Array.from(entry.serverIds)) {
      const reg = this.watchedFilesRegs.get(serverId);
      if (!reg || !Array.isArray(reg.watchers) || reg.watchers.length === 0) continue;
      if (!this._matchesWatchedFiles(reg.watchers, entry.rootsFsPaths, absPath, type)) continue;

      if (!entry.queueByServer.has(serverId)) {
        const queue = new Map(); // uri -> type
        const flush = debounce(() => {
          const changes = Array.from(queue.entries()).map(([u, t]) => ({ uri: u, type: t }));
          queue.clear();
          if (!changes.length) return;
          try {
            this.notifyDidChangeWatchedFiles?.(serverId, changes);
          } catch (err) {
            this.logger?.exception?.('didChangeWatchedFiles notify failed', err, { serverId });
          }
        }, 200);
        entry.queueByServer.set(serverId, { queue, flush });
      }

      const q = entry.queueByServer.get(serverId);
      q.queue.set(uri, type);
      q.flush();
    }
  }

  _matchesWatchedFiles(watchers, rootsFsPaths, absPath, type) {
    const abs = String(absPath || '').trim();
    if (!abs) return false;
    const roots = Array.isArray(rootsFsPaths) ? rootsFsPaths.map((x) => String(x || '').trim()).filter(Boolean) : [];
    if (roots.length === 0) return false;
    const eventMask = type === 1 ? 1 : (type === 2 ? 2 : 4);

    for (const w of watchers) {
      const gp = w?.globPattern;
      const globPattern = typeof gp === 'string' ? gp : (typeof gp?.pattern === 'string' ? gp.pattern : '');
      if (!globPattern) continue;
      const kind = Number(w?.kind || 0);
      if (kind && (kind & eventMask) === 0) continue;

      let baseFsPath = '';
      if (gp && typeof gp === 'object' && typeof gp.baseUri === 'string' && gp.baseUri.startsWith('file://')) {
        baseFsPath = fromFileUri(gp.baseUri);
      }
      if (!baseFsPath) baseFsPath = pickContainingRoot(roots, abs);
      if (!baseFsPath) continue;

      const relNative = path.relative(baseFsPath, abs);
      if (!relNative || relNative.startsWith('..') || path.isAbsolute(relNative)) continue;
      const rel = relNative.split(path.sep).join('/');
      try {
        if (minimatch(rel, globPattern, { dot: true, nocase: process.platform === 'win32' })) return true;
      } catch {
        // ignore invalid patterns
      }
    }
    return false;
  }
}

module.exports = { WorkspaceFileWatchHub };

