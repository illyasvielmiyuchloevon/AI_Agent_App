export function createWorkspaceController(deps) {
  const {
    workbenchOpenRequested,
    workbenchCloseRequested,
    workspaceServices,
    abortControllerRef,
    initialWorkspaceState,
    welcomeTabPath,
    LocalWorkspaceDriver,
    BackendWorkspaceDriver,
    requestElectronFolderPath,
    hydrateProject,
    refreshRecentProjects,
    setWorkspaceState,
    setWorkspaceDriver,
    setWorkspaceBindingStatus,
    setWorkspaceBindingError,
    setWorkspaceRootLabel,
    setBackendWorkspaceRoot,
    setBackendWorkspaceId,
    setProjectMeta,
    setSessions,
    setMessages,
    setToolRuns,
    setLogs,
    setTaskReview,
    setShowLogs,
    setCurrentSessionId,
    setDiffTabs,
  } = deps || {};

  if (!LocalWorkspaceDriver) {
    throw new Error('createWorkspaceController: missing LocalWorkspaceDriver');
  }

  const isAbsolutePath = (path = '') => {
    const trimmed = String(path || '').trim();
    if (!trimmed) return false;
    return /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\') || trimmed.startsWith('/');
  };

  const pickElectronFolderPath = async () => {
    try {
      const api = globalThis?.window?.electronAPI?.workspace;
      if (api?.pickFolder) {
        const res = await api.pickFolder();
        if (!res?.ok || res?.canceled) return '';
        return String(res?.fsPath || '').trim();
      }
    } catch {
      // ignore
    }
    try {
      if (requestElectronFolderPath) {
        return String((await requestElectronFolderPath()) || '').trim();
      }
    } catch {
      // ignore
    }
    return '';
  };

  if (typeof setWorkspaceState !== 'function') {
    throw new Error('createWorkspaceController: missing setWorkspaceState');
  }

  const openWorkspace = async (projectId = null, { preferredRoot = '' } = {}) => {
    if (typeof setWorkspaceBindingError === 'function') setWorkspaceBindingError('');
    try {
      workbenchOpenRequested?.();
      workspaceServices?.stop?.().catch?.(() => {});
      if (typeof setWorkspaceBindingStatus === 'function') setWorkspaceBindingStatus('checking');

      const preferred = String(preferredRoot || '').trim();
      const explicitFsPath = isAbsolutePath(preferred) ? preferred : (isAbsolutePath(projectId) ? String(projectId) : '');

      let driver = null;
      if (explicitFsPath && BackendWorkspaceDriver?.fromFsPath) {
        driver = await BackendWorkspaceDriver.fromFsPath(explicitFsPath);
      } else if (projectId) {
        driver = await LocalWorkspaceDriver.fromPersisted(projectId);
      } else if (BackendWorkspaceDriver?.fromFsPath) {
        const fsPath = await pickElectronFolderPath();
        if (!fsPath) {
          if (typeof setWorkspaceBindingStatus === 'function') setWorkspaceBindingStatus('idle');
          return;
        }
        driver = await BackendWorkspaceDriver.fromFsPath(fsPath);
      }

      if (!driver && !BackendWorkspaceDriver?.fromFsPath) {
        driver = await LocalWorkspaceDriver.pickFolder();
      }

      if (!driver) {
        throw new Error('未找到可用的项目文件夹');
      }

      let nextPreferred = preferred;
      if (!nextPreferred && isAbsolutePath(driver?.pathLabel)) {
        nextPreferred = String(driver.pathLabel || '').trim();
      }
      if (!nextPreferred && requestElectronFolderPath) {
        nextPreferred = String((await requestElectronFolderPath()) || '').trim();
      }
      await hydrateProject?.(driver, nextPreferred);
    } catch (err) {
      if (typeof setWorkspaceBindingStatus === 'function') setWorkspaceBindingStatus('error');
      if (typeof setWorkspaceBindingError === 'function') setWorkspaceBindingError(err?.message || '选择文件夹失败');
    }
  };

  const openWelcomeTab = ({ focus = true } = {}) => {
    setWorkspaceState((prev) => {
      const exists = prev.openTabs.includes(welcomeTabPath);
      const nextTabs = exists ? prev.openTabs : [...prev.openTabs, welcomeTabPath];
      const nextActive = focus ? welcomeTabPath : (prev.activeFile || (exists ? prev.activeFile : welcomeTabPath));
      return { ...prev, openTabs: nextTabs, activeFile: nextActive, view: 'code' };
    });
  };

  const closeWorkspaceToWelcome = async ({ recentTouchRef } = {}) => {
    workbenchCloseRequested?.();
    await workspaceServices?.stop?.().catch?.(() => {});
    try {
      await globalThis?.window?.electronAPI?.workspace?.close?.();
    } catch {
      // ignore
    }
    try {
      abortControllerRef?.current?.abort?.();
    } catch {
      // ignore
    }

    let backendWorkspaceId = '';
    try {
      if (typeof globalThis !== 'undefined' && globalThis.window && globalThis.window.__NODE_AGENT_WORKSPACE_ID__) {
        backendWorkspaceId = String(globalThis.window.__NODE_AGENT_WORKSPACE_ID__ || '').trim();
      }
    } catch {}
    if (backendWorkspaceId) {
      try {
        await fetch('/api/workspaces/close', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': backendWorkspaceId },
          body: JSON.stringify({ id: backendWorkspaceId }),
        });
      } catch {}
    }

    if (typeof setWorkspaceDriver === 'function') setWorkspaceDriver(null);
    if (typeof setWorkspaceBindingStatus === 'function') setWorkspaceBindingStatus('idle');
    if (typeof setWorkspaceBindingError === 'function') setWorkspaceBindingError('');
    if (typeof setWorkspaceRootLabel === 'function') setWorkspaceRootLabel('');
    if (typeof setBackendWorkspaceRoot === 'function') setBackendWorkspaceRoot('');
    if (typeof setBackendWorkspaceId === 'function') setBackendWorkspaceId('');
    if (typeof setProjectMeta === 'function') setProjectMeta({ id: null, name: '', pathLabel: '' });
    if (typeof setSessions === 'function') setSessions([]);
    if (typeof setMessages === 'function') setMessages([]);
    if (typeof setToolRuns === 'function') setToolRuns({});
    if (typeof setLogs === 'function') setLogs([]);
    if (typeof setTaskReview === 'function') setTaskReview({ taskId: null, files: [], status: 'idle', expanded: false });
    if (typeof setShowLogs === 'function') setShowLogs(false);
    if (typeof setCurrentSessionId === 'function') setCurrentSessionId(null);
    if (typeof setDiffTabs === 'function') setDiffTabs({});
    try {
      if (recentTouchRef) recentTouchRef.current = { id: null, fsPath: null };
    } catch {
      // ignore
    }

    setWorkspaceState({
      ...initialWorkspaceState,
      openTabs: [welcomeTabPath],
      activeFile: welcomeTabPath,
      view: 'code',
    });

    refreshRecentProjects?.();
  };

  const effectEnsureWelcomeTabWhenNoWorkspace = ({ workspaceDriver } = {}) => {
    if (workspaceDriver) return;
    setWorkspaceState((prev) => {
      if (prev.openTabs.includes(welcomeTabPath)) return prev;
      if (prev.openTabs.length > 0) return prev;
      return { ...prev, openTabs: [welcomeTabPath], activeFile: welcomeTabPath, view: 'code' };
    });
  };

  const effectAutoCloseWelcomeTabOnReady = ({ workspaceDriver, workspaceBindingStatus } = {}) => {
    if (!workspaceDriver) return;
    if (workspaceBindingStatus !== 'ready') return;
    setWorkspaceState((prev) => {
      if (!prev.openTabs.includes(welcomeTabPath)) return prev;
      const nextTabs = prev.openTabs.filter((t) => t !== welcomeTabPath);
      const nextActive = prev.activeFile === welcomeTabPath ? (nextTabs[nextTabs.length - 1] || '') : prev.activeFile;
      return { ...prev, openTabs: nextTabs, activeFile: nextActive };
    });
  };

  const effectSyncRecentsOnReady = ({
    workspaceDriver,
    workspaceBindingStatus,
    backendWorkspaceRoot,
    workspaceRootLabel,
    projectMeta,
    backendWorkspaceId,
    recentTouchRef,
  }) => {
    if (!workspaceDriver) return undefined;
    if (workspaceBindingStatus !== 'ready') return undefined;

    let cancelled = false;
    (async () => {
      const fsPath = (backendWorkspaceRoot || workspaceRootLabel || '').trim();
      if (!fsPath) return;

      // Local recent (FS handle registry): only touch after WORKSPACE_READY.
      try {
        const updated = await workspaceDriver.touchRecent?.({ pathLabel: fsPath, workspaceId: backendWorkspaceId, backendRoot: backendWorkspaceRoot });
        if (!cancelled && updated?.id && projectMeta?.id !== updated.id && typeof setProjectMeta === 'function') {
          setProjectMeta((prev) => ({ ...prev, id: updated.id }));
        }
      } catch {
        // ignore
      }

      const id = workspaceDriver.projectId || projectMeta?.id || fsPath;
      if (!id) return;

      try {
        if (recentTouchRef && recentTouchRef.current && recentTouchRef.current.id === id && recentTouchRef.current.fsPath === fsPath) {
          return;
        }
      } catch {
        // ignore
      }

      try {
        if (recentTouchRef) recentTouchRef.current = { id, fsPath };
      } catch {
        // ignore
      }

      // Electron recent: also only touch after WORKSPACE_READY.
      try {
        await globalThis?.window?.electronAPI?.workspace?.open?.({
          id,
          fsPath,
          name: projectMeta?.name || workspaceDriver.rootName || 'Workspace',
        });
      } catch {
        // ignore
      }

      if (!cancelled) refreshRecentProjects?.();
    })();

    return () => {
      cancelled = true;
    };
  };

  const effectSyncWorkspaceServices = ({
    isReady,
    backendWorkspaceRoot,
    workspaceRootLabel,
    workspaceDriver,
    projectMeta,
    workspaceServicesKeyRef,
  }) => {
    if (!workspaceServices) return;

    if (!isReady) {
      if (workspaceServicesKeyRef) workspaceServicesKeyRef.current = '';
      workspaceServices.stop?.().catch?.(() => {});
      return;
    }

    const key = String(backendWorkspaceRoot || workspaceRootLabel || workspaceDriver?.projectId || '');
    if (!key) return;
    if (workspaceServicesKeyRef && workspaceServicesKeyRef.current === key) return;
    if (workspaceServicesKeyRef) workspaceServicesKeyRef.current = key;

    workspaceServices
      .start?.({
        workbenchState: 'WORKSPACE_READY',
        backendWorkspaceRoot,
        workspaceRootLabel,
        projectId: workspaceDriver?.projectId || projectMeta?.id || null,
      })
      .catch?.(() => {});
  };

  return {
    openWorkspace,
    closeWorkspaceToWelcome,
    openWelcomeTab,
    effectEnsureWelcomeTabWhenNoWorkspace,
    effectAutoCloseWelcomeTabOnReady,
    effectSyncRecentsOnReady,
    effectSyncWorkspaceServices,
  };
}
