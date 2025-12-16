function createWorkspaceService() {
  let current = null;

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
  };

  const start = async ({ fsPath }) => {
    await stop();
    current = {
      fsPath: fsPath || '',
      disposables: [],
    };

    // Placeholder for future: watcher/index/git/agent context.
    // Keep empty to avoid behavior changes; only establish mount/unmount structure.
  };

  const getCurrent = () => current;

  return { start, stop, getCurrent };
}

module.exports = { createWorkspaceService };

