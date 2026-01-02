function createWorkspaceService() {
  let current = null;
  const configListeners = new Set();
  let currentSettings = {};

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
    if (!current) return;
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
  };

  const start = async ({ fsPath }) => {
    await stop();
    current = {
      fsPath: fsPath || '',
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
  };

  const getCurrent = () => current;
  const getConfiguration = () => currentSettings;
  const onDidChangeConfiguration = (handler) => {
    const fn = typeof handler === 'function' ? handler : null;
    if (!fn) return () => {};
    configListeners.add(fn);
    return () => configListeners.delete(fn);
  };

  return { start, stop, getCurrent, getConfiguration, onDidChangeConfiguration };
}

module.exports = { createWorkspaceService };
