import { useEffect, useRef } from 'react';

export function useAppStartup({
  config,
  pendingDeepLinkRef,
  LocalWorkspaceDriver,
  hydrateProject,
  refreshRecentProjects,
  setWorkspaceBindingStatus,
  setWorkspaceBindingError,
  workbenchBoot,
} = {}) {
  const startupFlagsRef = useRef(null);
  if (!startupFlagsRef.current) {
    startupFlagsRef.current = {
      openDevToolsOnStart: config?.features?.openDevToolsOnStart !== false,
      openWelcomeOnStart: config?.features?.openWelcomeOnStart === true,
      loadRagOnStart: config?.features?.loadRagOnStart !== false,
    };
  }

  const devToolsAutoOpenRef = useRef({ lastWanted: null, attemptInProgress: false });
  useEffect(() => {
    const wantOpen = config?.features?.openDevToolsOnStart !== false;
    const last = devToolsAutoOpenRef.current.lastWanted;
    devToolsAutoOpenRef.current.lastWanted = wantOpen;

    if (!wantOpen) {
      devToolsAutoOpenRef.current.attemptInProgress = false;
      return;
    }
    if (last === true || devToolsAutoOpenRef.current.attemptInProgress) return;
    if (typeof window === 'undefined') return;
    if (pendingDeepLinkRef?.current?.terminalWindow) return;

    devToolsAutoOpenRef.current.attemptInProgress = true;
    const delaysMs = [0, 120, 480, 1500, 3000];
    const attempt = async (idx = 0) => {
      if (!devToolsAutoOpenRef.current.attemptInProgress) return;
      const api = window.electronAPI?.window;
      const fn = api?.openDevTools;
      if (typeof fn !== 'function') {
        if (idx < delaysMs.length - 1) window.setTimeout(() => attempt(idx + 1), delaysMs[idx + 1]);
        else devToolsAutoOpenRef.current.attemptInProgress = false;
        return;
      }
      try {
        const res = await fn();
        if (res?.ok && res?.opened) {
          devToolsAutoOpenRef.current.attemptInProgress = false;
          return;
        }
      } catch (err) {
        console.warn('[App] Failed to auto-open DevTools:', err);
      }
      if (idx < delaysMs.length - 1) window.setTimeout(() => attempt(idx + 1), delaysMs[idx + 1]);
      else devToolsAutoOpenRef.current.attemptInProgress = false;
    };
    void attempt(0);
  }, [config?.features?.openDevToolsOnStart, pendingDeepLinkRef]);

  const workspaceInitializedRef = useRef(false);
  useEffect(() => {
    if (workspaceInitializedRef.current) return;
    workspaceInitializedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        setWorkspaceBindingStatus?.('idle');
        await refreshRecentProjects?.();
        const skipRestore =
          pendingDeepLinkRef?.current?.newWindow === true
          || startupFlagsRef.current?.openWelcomeOnStart === true;
        const driver = skipRestore ? null : await LocalWorkspaceDriver?.fromPersisted?.(null, { allowPrompt: false });
        if (cancelled) return;
        if (driver) {
          await hydrateProject?.(driver);
        } else {
          setWorkspaceBindingStatus?.('idle');
        }
      } catch (err) {
        if (!cancelled) {
          setWorkspaceBindingStatus?.('error');
          setWorkspaceBindingError?.(err?.message || 'Workspace 打开失败');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    workbenchBoot?.();
  }, [workbenchBoot]);

  return { startupFlagsRef };
}

