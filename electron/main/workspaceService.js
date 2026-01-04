function createWorkspaceService() {
  let current = null;
  const workspaceListeners = new Set();
  const configListeners = new Set();
  let currentSettings = {};

  const emitWorkspace = (workspace) => {
    for (const fn of Array.from(workspaceListeners)) {
      try {
        fn(workspace);
      } catch {
        // ignore
      }
    }
  };

  const emitConfiguration = (settings) => {
    const payload = settings && typeof settings === 'object' ? settings : {};
    currentSettings = payload;
    for (const fn of Array.from(configListeners)) {
      try {
        fn(payload);
      } catch {
        // ignore
      }
    }
  };

  const stop = async () => {
    if (!current) return null;
    const prev = current;
    const disposables = current.disposables || [];
    current = null;
    disposables.forEach((dispose) => {
      try {
        dispose?.();
      } catch {
        // ignore
      }
    });
    emitConfiguration({});
    emitWorkspace(null);
    return prev;
  };

  const start = async ({ fsPath, workspaceId, name }) => {
    const prev = await stop();
    const rootFsPath = fsPath || '';
    let rootUri = '';
    try {
      // eslint-disable-next-line global-require
      const { pathToFileURL } = require('node:url');
      rootUri = rootFsPath ? pathToFileURL(rootFsPath).toString() : '';
    } catch {
      rootUri = '';
    }
    const safeName = (() => {
      const p = String(rootFsPath || '').trim().replace(/[\\\/]+$/, '');
      if (!p) return String(name || '') || '';
      try {
        // eslint-disable-next-line global-require
        const path = require('path');
        return path.basename(p) || p;
      } catch {
        return p;
      }
    })();

    current = {
      workspaceId: workspaceId || '',
      name: safeName || String(name || ''),
      fsPath: rootFsPath,
      rootFsPath,
      rootUri,
      folders: rootFsPath && rootUri ? [{ name: safeName || rootFsPath, uri: rootUri }] : [],
      disposables: [],
    };

    // Workspace settings model (Phase 1): keep an in-memory snapshot and emit updates.
    try {
      const { readWorkspaceSettingsSync } = require('./workspace/documentModel');
      emitConfiguration(readWorkspaceSettingsSync(current.fsPath));
    } catch {
      emitConfiguration({});
    }

    // Watch .vscode/settings.json and refresh snapshot.
    try {
      // eslint-disable-next-line global-require
      const chokidar = require('chokidar');
      const path = require('path');
      const settingsPath = path.join(current.fsPath, '.vscode', 'settings.json');
      const watcher = chokidar.watch(settingsPath, { ignoreInitial: true });
      const onChange = () => {
        try {
          const { readWorkspaceSettingsSync } = require('./workspace/documentModel');
          emitConfiguration(readWorkspaceSettingsSync(current.fsPath));
        } catch {
          emitConfiguration({});
        }
      };
      watcher.on('add', onChange);
      watcher.on('change', onChange);
      watcher.on('unlink', onChange);
      current.disposables.push(() => watcher.close());
    } catch {
      // ignore
    }

    emitWorkspace({ ...current, disposables: [] });
    return { ok: true, prev, current: { ...current, disposables: [] } };
  };

  const getCurrent = () => current;
  const getWorkspace = () => (current ? { ...current, disposables: [] } : null);
  const getConfiguration = () => currentSettings;
  const onDidChangeWorkspace = (handler) => {
    const fn = typeof handler === 'function' ? handler : null;
    if (!fn) return () => {};
    workspaceListeners.add(fn);
    return () => workspaceListeners.delete(fn);
  };
  const onDidChangeConfiguration = (handler) => {
    const fn = typeof handler === 'function' ? handler : null;
    if (!fn) return () => {};
    configListeners.add(fn);
    return () => configListeners.delete(fn);
  };

  return { start, stop, getCurrent, getWorkspace, getConfiguration, onDidChangeWorkspace, onDidChangeConfiguration };
}

module.exports = { createWorkspaceService };
