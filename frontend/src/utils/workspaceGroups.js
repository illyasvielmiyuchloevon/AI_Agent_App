export const normalizeWorkspaceGroups = (editorGroups, legacyOpenTabs, legacyActiveFile) => {
  if (Array.isArray(editorGroups) && editorGroups.length > 0) {
    return editorGroups
      .map((g, idx) => ({
        id: String(g?.id || `group-${idx + 1}`),
        openTabs: Array.isArray(g?.openTabs) ? g.openTabs.filter(Boolean) : [],
        activeFile: String(g?.activeFile || ''),
        locked: !!g?.locked,
        previewTab: String(g?.previewTab || ''),
      }))
      .filter((g) => g.id);
  }
  return [{
    id: 'group-1',
    openTabs: Array.isArray(legacyOpenTabs) ? legacyOpenTabs : [],
    activeFile: String(legacyActiveFile || ''),
    locked: false,
    previewTab: '',
  }];
};

export const resolveActiveGroupId = (activeGroupIdProp, groups) => {
  const desired = String(activeGroupIdProp || '').trim();
  if (desired && groups.some((g) => g.id === desired)) return desired;
  return groups[0]?.id || 'group-1';
};

