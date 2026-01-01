import { useCallback, useRef } from 'react';
import { DIFF_TAB_PREFIX } from '../utils/appDefaults';

export function useWorkspaceDiffTabs({
  setDiffTabs,
  setWorkspaceState,
} = {}) {
  const diffTabCounterRef = useRef(0);

  const cleanupDiffTab = useCallback((tabPath) => {
    const path = String(tabPath || '');
    if (!path || !path.startsWith(DIFF_TAB_PREFIX)) return;
    setDiffTabs?.((prev) => {
      if (!prev || !prev[path]) return prev;
      const next = { ...prev };
      delete next[path];
      return next;
    });
  }, [setDiffTabs]);

  const openDiffTabInWorkspace = useCallback((diff) => {
    if (!diff) return;
    const index = diffTabCounterRef.current++;
    const idBase = diff.diff_id !== undefined ? String(diff.diff_id) : (diff.id !== undefined ? String(diff.id) : (diff.path || 'diff'));
    const tabId = `${DIFF_TAB_PREFIX}${idBase}#${index}`;
    setDiffTabs?.((prev) => ({ ...prev, [tabId]: diff }));
    setWorkspaceState?.((prev) => {
      const exists = prev.openTabs.includes(tabId);
      const nextTabs = exists ? prev.openTabs : [...prev.openTabs, tabId];
      return { ...prev, openTabs: nextTabs, activeFile: tabId, view: 'code' };
    });
  }, [setDiffTabs, setWorkspaceState]);

  return { openDiffTabInWorkspace, cleanupDiffTab };
}

