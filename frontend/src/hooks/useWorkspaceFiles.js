import { useCallback, useEffect, useRef } from 'react';
import { isMissingPathError, shouldHidePath } from '../utils/appAlgorithms';

export function useWorkspaceFiles({
  workspaceDriver = null,
  lspService = null,
  setWorkspaceState,
  setWorkspaceBindingStatus,
  setWorkspaceBindingError,
  setHotReloadToken,
} = {}) {
  const saveTimersRef = useRef({});
  const saveSeqRef = useRef({});

  useEffect(() => () => {
    Object.values(saveTimersRef.current || {}).forEach((timer) => clearTimeout(timer));
  }, []);

  const loadFileContent = useCallback(async (path) => {
    if (!workspaceDriver) return;
    if (shouldHidePath(path)) return;
    try {
      const data = await workspaceDriver.readFile(path);
      setWorkspaceState?.((prev) => {
        const exists = prev.files.find((f) => f.path === data.path);
        const nextFiles = exists
          ? prev.files.map((f) => {
            if (f.path !== data.path) return f;
            if (f.dirty) return f;
            return {
              ...f,
              content: data.content,
              updated: false,
              dirty: false,
              truncated: data.truncated,
            };
          })
          : [...prev.files, {
            path: data.path,
            content: data.content,
            updated: false,
            dirty: false,
            truncated: data.truncated,
          }];
        return { ...prev, files: nextFiles };
      });
    } catch (err) {
      if (isMissingPathError(err)) return;
      setWorkspaceBindingError?.(err?.message || 'Failed to load file');
      setWorkspaceBindingStatus?.('error');
    }
  }, [setWorkspaceBindingError, setWorkspaceBindingStatus, setWorkspaceState, workspaceDriver]);

  const scheduleSave = useCallback((path, content) => {
    if (!workspaceDriver) return;
    const seq = (saveSeqRef.current[path] || 0) + 1;
    saveSeqRef.current[path] = seq;
    if (saveTimersRef.current[path]) {
      clearTimeout(saveTimersRef.current[path]);
    }
    saveTimersRef.current[path] = setTimeout(async () => {
      try {
        await workspaceDriver.writeFile(path, content, { createDirectories: true, notifyCreate: false });
        if (saveSeqRef.current[path] === seq) {
          setWorkspaceState?.((prev) => ({
            ...prev,
            files: prev.files.map((f) => (f.path === path ? { ...f, dirty: false } : f)),
          }));
        }
        try { void lspService?.didSavePath?.(path, content); } catch {}
        const now = Date.now();
        setWorkspaceState?.((prev) => ({ ...prev, livePreview: `${now}` }));
        setHotReloadToken?.(now);
        setWorkspaceBindingError?.('');
        setWorkspaceBindingStatus?.('ready');
      } catch (err) {
        setWorkspaceBindingError?.(err?.message || 'Save failed');
        setWorkspaceBindingStatus?.('error');
      }
    }, 220);
  }, [
    lspService,
    setHotReloadToken,
    setWorkspaceBindingError,
    setWorkspaceBindingStatus,
    setWorkspaceState,
    workspaceDriver,
  ]);

  return { loadFileContent, scheduleSave };
}
