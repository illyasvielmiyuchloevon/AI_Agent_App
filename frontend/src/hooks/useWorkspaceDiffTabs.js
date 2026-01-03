import { useCallback, useRef } from 'react';
import { DIFF_TAB_PREFIX } from '../utils/appDefaults';
import { normalizeWorkspaceGroups, resolveActiveGroupId } from '../utils/workspaceGroups';

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
      const safePrev = prev && typeof prev === 'object' ? prev : {};
      const now = Date.now();

      const groups = normalizeWorkspaceGroups(safePrev.editorGroups, safePrev.openTabs, safePrev.activeFile);
      const activeGroupId = resolveActiveGroupId(safePrev.activeGroupId, groups);
      const nextGroups = groups.map((g) => {
        if (g.id !== activeGroupId) return g;
        const openTabs = g.openTabs.includes(tabId) ? g.openTabs : [...g.openTabs, tabId];
        const previewTab = g.previewTab === tabId ? '' : g.previewTab;
        return { ...g, openTabs, activeFile: tabId, previewTab };
      });
      const activeGroup = nextGroups.find((g) => g.id === activeGroupId) || nextGroups[0] || { openTabs: [], activeFile: '' };

      const history = Array.isArray(safePrev.tabHistory) ? safePrev.tabHistory : [];
      const nextHistory = [
        { groupId: activeGroupId, path: tabId, ts: now },
        ...history.filter((h) => !(h?.groupId === activeGroupId && h?.path === tabId)).slice(0, 100),
      ];

      return {
        ...safePrev,
        editorGroups: nextGroups,
        activeGroupId,
        openTabs: activeGroup.openTabs,
        activeFile: activeGroup.activeFile,
        tabHistory: nextHistory,
        view: 'code',
        previewEntry: tabId,
      };
    });
  }, [setDiffTabs, setWorkspaceState]);

  return { openDiffTabInWorkspace, cleanupDiffTab };
}
