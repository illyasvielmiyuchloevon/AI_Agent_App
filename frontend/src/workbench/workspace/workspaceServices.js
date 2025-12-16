export function createWorkspaceServices() {
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

  const start = async (ctx) => {
    await stop();
    const disposables = [];

    // Placeholder lifecycle hooks for future: watcher/index/git/agent context.
    // Keep empty to avoid behavior changes; only establish the mount/unmount structure.

    current = { ctx, disposables };
  };

  return { start, stop };
}

