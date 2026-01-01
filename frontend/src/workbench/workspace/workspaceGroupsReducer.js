export function workspaceGroupsReducer(prevRaw, action, ctx) {
  const type = String(action?.type || '');
  const ensureEditorGroups = ctx?.ensureEditorGroups;
  const syncLegacyTabsFromGroups = ctx?.syncLegacyTabsFromGroups;
  const tabMetaKey = ctx?.tabMetaKey;
  const createEditorGroupId = ctx?.createEditorGroupId;

  if (typeof ensureEditorGroups !== 'function' || typeof syncLegacyTabsFromGroups !== 'function') return prevRaw;
  const prev = syncLegacyTabsFromGroups(prevRaw);
  const { groups, activeGroupId } = ensureEditorGroups(prev);

  if (type === 'activeGroupChange') {
    const nextId = String(action?.groupId || '').trim();
    if (!nextId) return prev;
    if (!groups.some((g) => g.id === nextId)) return prev;
    return syncLegacyTabsFromGroups({ ...prev, activeGroupId: nextId });
  }

  if (type === 'toggleGroupLocked') {
    const targetId = String(action?.groupId || '').trim();
    if (!targetId) return prev;
    if (!groups.some((g) => g.id === targetId)) return prev;
    if (typeof tabMetaKey !== 'function') return prev;
    const tabMeta = prev.tabMeta && typeof prev.tabMeta === 'object' ? prev.tabMeta : {};
    const nextTabMeta = { ...tabMeta };
    const nextGroups = groups.map((g) => {
      if (g.id !== targetId) return g;
      const nextLocked = !g.locked;
      const previewTab = nextLocked ? '' : g.previewTab;
      if (nextLocked && g.previewTab) {
        const key = tabMetaKey(targetId, g.previewTab);
        const current = nextTabMeta[key] && typeof nextTabMeta[key] === 'object' ? nextTabMeta[key] : {};
        nextTabMeta[key] = { ...current, preview: false };
      }
      return { ...g, locked: nextLocked, previewTab };
    });
    return syncLegacyTabsFromGroups({ ...prev, editorGroups: nextGroups, tabMeta: nextTabMeta });
  }

  if (type === 'splitEditor') {
    if (typeof createEditorGroupId !== 'function' || typeof tabMetaKey !== 'function') return prev;
    const dir = action?.direction === 'down' ? 'down' : 'right';
    const requestedGroupId = String(action?.groupId || '').trim();
    const sourceGroupId = requestedGroupId && groups.some((g) => g.id === requestedGroupId) ? requestedGroupId : activeGroupId;
    const sourceGroup = groups.find((g) => g.id === sourceGroupId) || groups[0];
    const path = String(action?.tabPath || sourceGroup.activeFile || '').trim();
    if (!path) return prev;

    const newGroupId = createEditorGroupId();
    const newGroup = { id: newGroupId, openTabs: [path], activeFile: path, locked: false, previewTab: '' };

    const tabMeta = prev.tabMeta && typeof prev.tabMeta === 'object' ? prev.tabMeta : {};
    const nextTabMeta = { ...tabMeta };
    const sourceKey = tabMetaKey(sourceGroupId, path);
    const sourceMeta = nextTabMeta[sourceKey] && typeof nextTabMeta[sourceKey] === 'object' ? nextTabMeta[sourceKey] : {};
    nextTabMeta[tabMetaKey(newGroupId, path)] = { ...sourceMeta, preview: false };

    const nextGroups = [
      ...groups.map((g) => {
        if (g.id !== sourceGroupId) return g;
        if (!action?.move) return g;
        const openTabs = (g.openTabs || []).filter((t) => t !== path);
        const activeFile = g.activeFile === path ? (openTabs[openTabs.length - 1] || '') : g.activeFile;
        const previewTab = g.previewTab === path ? '' : g.previewTab;
        return { ...g, openTabs, activeFile, previewTab };
      }),
      newGroup,
    ].filter(Boolean);

    const layout = { mode: 'split', direction: dir === 'down' ? 'horizontal' : 'vertical' };
    return syncLegacyTabsFromGroups({
      ...prev,
      editorGroups: nextGroups,
      activeGroupId: newGroupId,
      editorLayout: layout,
      tabMeta: nextTabMeta,
    });
  }

  return prev;
}

