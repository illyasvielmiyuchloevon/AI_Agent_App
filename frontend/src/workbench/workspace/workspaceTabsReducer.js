import { WELCOME_TAB_PATH } from '../constants';
import {
  DIFF_TAB_PREFIX,
  SETTINGS_TAB_PATH,
  TERMINAL_EDITOR_TAB_PATH,
  TERMINAL_SETTINGS_TAB_PATH,
} from '../../utils/appDefaults';
import { isSpecialTabPath } from '../../utils/appAlgorithms';

const resolveTabMeta = (tabMeta) => (tabMeta && typeof tabMeta === 'object' ? tabMeta : {});

export function workspaceTabsReducer(prevRaw, action, ctx) {
  const type = String(action?.type || '');
  const ensureEditorGroups = ctx?.ensureEditorGroups;
  const syncLegacyTabsFromGroups = ctx?.syncLegacyTabsFromGroups;
  const tabMetaKey = ctx?.tabMetaKey;
  if (typeof ensureEditorGroups !== 'function' || typeof syncLegacyTabsFromGroups !== 'function' || typeof tabMetaKey !== 'function') {
    return prevRaw;
  }

  const prev = syncLegacyTabsFromGroups(prevRaw);
  const { groups, activeGroupId } = ensureEditorGroups(prev);

  if (type === 'openFile') {
    const filePath = String(action?.path || '');
    if (!filePath) return prev;
    const requestedGroupId = String(action?.options?.groupId || '').trim();
    const targetGroupId = requestedGroupId && groups.some((g) => g.id === requestedGroupId)
      ? requestedGroupId
      : activeGroupId;
    const targetGroup = groups.find((g) => g.id === targetGroupId) || groups[0];
    const previewEnabled = prev.previewEditorEnabled !== false;
    const groupLocked = !!targetGroup.locked;
    const isSpecialTab = filePath === WELCOME_TAB_PATH
      || filePath === SETTINGS_TAB_PATH
      || filePath === TERMINAL_SETTINGS_TAB_PATH
      || filePath === TERMINAL_EDITOR_TAB_PATH
      || (filePath && filePath.startsWith(DIFF_TAB_PREFIX));
    const requestedModeRaw = String(action?.options?.mode || '').trim();
    const requestedMode = requestedModeRaw === 'persistent' || requestedModeRaw === 'preview' ? requestedModeRaw : '';
    const mode = requestedMode || ((previewEnabled && !groupLocked && !isSpecialTab) ? 'preview' : 'persistent');

    const tabMeta = resolveTabMeta(prev.tabMeta);
    const getMeta = (groupId, tab) => tabMeta[tabMetaKey(groupId, tab)] || {};
    const setMeta = (next, groupId, tab, patch) => {
      const key = tabMetaKey(groupId, tab);
      const current = next[key] && typeof next[key] === 'object' ? next[key] : {};
      next[key] = { ...current, ...patch };
    };

    const files = Array.isArray(prev.files) ? prev.files : [];
    const exists = files.find((f) => f.path === filePath);
    const nextFiles = exists ? files : [...files, { path: filePath, content: '', updated: false, dirty: false }];

    const nextTabMeta = { ...tabMeta };
    const nextGroups = groups.map((g) => {
      if (g.id !== targetGroupId) return g;
      let openTabs = Array.isArray(g.openTabs) ? [...g.openTabs] : [];
      let activeFile = g.activeFile || '';
      let previewTab = g.previewTab || '';

      if (mode === 'preview') {
        const currentPreview = previewTab;
        if (currentPreview && currentPreview !== filePath && openTabs.includes(currentPreview)) {
          const meta = getMeta(targetGroupId, currentPreview);
          const pinnedOrKept = !!meta.pinned || !!meta.keptOpen;
          const isDirty = !!nextFiles.find((f) => f.path === currentPreview)?.dirty;
          if (!pinnedOrKept && !isDirty) {
            openTabs = openTabs.filter((t) => t !== currentPreview);
            setMeta(nextTabMeta, targetGroupId, currentPreview, { preview: false });
          } else {
            previewTab = '';
            setMeta(nextTabMeta, targetGroupId, currentPreview, { preview: false });
          }
        }

        if (!openTabs.includes(filePath)) openTabs.push(filePath);
        activeFile = filePath;
        previewTab = filePath;
        setMeta(nextTabMeta, targetGroupId, filePath, { preview: true });
      } else {
        if (!openTabs.includes(filePath)) openTabs.push(filePath);
        activeFile = filePath;
        if (previewTab === filePath) previewTab = '';
        setMeta(nextTabMeta, targetGroupId, filePath, { preview: false });
      }

      return { ...g, openTabs, activeFile, previewTab };
    });

    const now = Date.now();
    const history = Array.isArray(prev.tabHistory) ? prev.tabHistory : [];
    const nextHistory = [
      { groupId: targetGroupId, path: filePath, ts: now },
      ...history.filter((h) => !(h?.groupId === targetGroupId && h?.path === filePath)).slice(0, 100),
    ];

    return syncLegacyTabsFromGroups({
      ...prev,
      files: nextFiles,
      editorGroups: nextGroups,
      activeGroupId: targetGroupId,
      tabMeta: nextTabMeta,
      tabHistory: nextHistory,
      previewEntry: filePath,
    });
  }

  if (type === 'closeFile') {
    const tabPath = String(action?.path || '');
    if (!tabPath) return prev;
    const dismissWelcome = tabPath === WELCOME_TAB_PATH;
    const requestedGroupId = String(action?.options?.groupId || '').trim();

    const containingGroupId = groups.find((g) => Array.isArray(g.openTabs) && g.openTabs.includes(tabPath))?.id || '';
    const targetGroupId = (requestedGroupId && groups.some((g) => g.id === requestedGroupId))
      ? requestedGroupId
      : (containingGroupId || activeGroupId);

    const tabMeta = resolveTabMeta(prev.tabMeta);
    const nextTabMeta = { ...tabMeta };
    const metaKey = tabMetaKey(targetGroupId, tabPath);
    if (nextTabMeta[metaKey] && typeof nextTabMeta[metaKey] === 'object') {
      nextTabMeta[metaKey] = { ...nextTabMeta[metaKey], preview: false };
    }

    let nextGroups = groups.map((g) => {
      if (g.id !== targetGroupId) return g;
      const openTabs = Array.isArray(g.openTabs) ? g.openTabs.filter((t) => t !== tabPath) : [];
      const nextActive = g.activeFile === tabPath ? (openTabs[openTabs.length - 1] || '') : g.activeFile;
      const previewTab = g.previewTab === tabPath ? '' : g.previewTab;
      return { ...g, openTabs, activeFile: nextActive, previewTab };
    });

    if (nextGroups.length > 1) {
      nextGroups = nextGroups.filter((g) => g.openTabs.length > 0);
      if (nextGroups.length === 0) {
        nextGroups = [{ id: 'group-1', openTabs: [], activeFile: '', locked: false, previewTab: '' }];
      }
    }

    const nextActiveGroupId = nextGroups.some((g) => g.id === activeGroupId)
      ? activeGroupId
      : nextGroups[0].id;

    const activeGroup = nextGroups.find((g) => g.id === nextActiveGroupId) || nextGroups[0];
    const nextPreviewEntry = activeGroup.activeFile || prev.previewEntry;
    const prevLayout = prev.editorLayout && typeof prev.editorLayout === 'object' ? prev.editorLayout : null;
    const nextLayout = nextGroups.length > 1
      ? { mode: 'split', direction: prevLayout?.direction === 'horizontal' ? 'horizontal' : 'vertical' }
      : { mode: 'single', direction: prevLayout?.direction === 'horizontal' ? 'horizontal' : 'vertical' };

    return syncLegacyTabsFromGroups({
      ...prev,
      editorGroups: nextGroups,
      activeGroupId: nextActiveGroupId,
      editorLayout: nextLayout,
      tabMeta: nextTabMeta,
      previewEntry: nextPreviewEntry,
      welcomeDismissed: dismissWelcome ? true : !!prev.welcomeDismissed,
    });
  }

  if (type === 'fileChanged') {
    const tabPath = String(action?.path || '');
    if (!tabPath) return prev;
    const content = action?.content ?? '';
    const options = action?.options && typeof action.options === 'object' ? action.options : {};

    const prevFiles = Array.isArray(prev.files) ? prev.files : [];
    const hasEntry = prevFiles.some((f) => f && f.path === tabPath);
    const nextFiles = hasEntry
      ? prevFiles.map((f) => (f.path === tabPath ? { ...f, content, dirty: true } : f))
      : [...prevFiles, { path: tabPath, content, truncated: false, updated: false, dirty: true }];

    const requestedGroupId = String(options?.groupId || '').trim();
    const containingGroupId = groups.find((g) => Array.isArray(g.openTabs) && g.openTabs.includes(tabPath))?.id || '';
    const targetGroupId = (requestedGroupId && groups.some((g) => g.id === requestedGroupId))
      ? requestedGroupId
      : (containingGroupId || activeGroupId);

    const tabMeta = resolveTabMeta(prev.tabMeta);
    const nextTabMeta = { ...tabMeta };
    const key = tabMetaKey(targetGroupId, tabPath);
    const meta = nextTabMeta[key] && typeof nextTabMeta[key] === 'object' ? nextTabMeta[key] : {};
    const nextGroups = groups.map((g) => {
      if (g.id !== targetGroupId) return g;
      if (g.previewTab !== tabPath) return g;
      return { ...g, previewTab: '' };
    });

    if (meta.preview) {
      nextTabMeta[key] = { ...meta, preview: false, keptOpen: true };
    }

    return syncLegacyTabsFromGroups({
      ...prev,
      files: nextFiles,
      editorGroups: nextGroups,
      tabMeta: nextTabMeta,
    });
  }

  if (type === 'activeEditorChange') {
    const tabPath = String(action?.path || '');
    if (!tabPath) return prev;
    const options = action?.options && typeof action.options === 'object' ? action.options : {};

    const requestedGroupId = String(options?.groupId || '').trim();
    const containingGroupId = groups.find((g) => Array.isArray(g.openTabs) && g.openTabs.includes(tabPath))?.id || '';
    const targetGroupId = (requestedGroupId && groups.some((g) => g.id === requestedGroupId))
      ? requestedGroupId
      : (containingGroupId || activeGroupId);

    const nextGroups = groups.map((g) => {
      if (g.id !== targetGroupId) return g;
      if (!g.openTabs.includes(tabPath)) return g;
      return { ...g, activeFile: tabPath };
    });

    const isSpecialTab = tabPath === WELCOME_TAB_PATH
      || tabPath === SETTINGS_TAB_PATH
      || tabPath === TERMINAL_SETTINGS_TAB_PATH
      || tabPath === TERMINAL_EDITOR_TAB_PATH
      || (tabPath && tabPath.startsWith(DIFF_TAB_PREFIX));

    const now = Date.now();
    const history = Array.isArray(prev.tabHistory) ? prev.tabHistory : [];
    const nextHistory = [
      { groupId: targetGroupId, path: tabPath, ts: now },
      ...history.filter((h) => !(h?.groupId === targetGroupId && h?.path === tabPath)).slice(0, 100),
    ];

    return syncLegacyTabsFromGroups({
      ...prev,
      editorGroups: nextGroups,
      activeGroupId: targetGroupId,
      tabHistory: nextHistory,
      previewEntry: !isSpecialTab ? tabPath : prev.previewEntry,
    });
  }

  if (type === 'togglePreviewEditorEnabled') {
    const nextEnabled = prev.previewEditorEnabled === false;
    const tabMeta = resolveTabMeta(prev.tabMeta);
    const nextTabMeta = { ...tabMeta };
    const nextGroups = (prev.editorGroups || []).map((g) => ({ ...g, previewTab: nextEnabled ? g.previewTab : '' }));

    if (!nextEnabled) {
      Object.keys(nextTabMeta).forEach((k) => {
        const v = nextTabMeta[k];
        if (v && typeof v === 'object' && v.preview) {
          nextTabMeta[k] = { ...v, preview: false };
        }
      });
    }

    return syncLegacyTabsFromGroups({ ...prev, previewEditorEnabled: nextEnabled, editorGroups: nextGroups, tabMeta: nextTabMeta });
  }

  if (type === 'toggleTabPinned' || type === 'toggleTabKeptOpen') {
    const gid = String(action?.groupId || '').trim();
    const path = String(action?.tabPath || '');
    if (!gid || !path) return prev;
    if (!groups.some((g) => g.id === gid)) return prev;
    const tabMeta = resolveTabMeta(prev.tabMeta);
    const nextTabMeta = { ...tabMeta };
    const key = tabMetaKey(gid, path);
    const current = nextTabMeta[key] && typeof nextTabMeta[key] === 'object' ? nextTabMeta[key] : {};

    if (type === 'toggleTabPinned') {
      const pinned = !current.pinned;
      nextTabMeta[key] = { ...current, pinned, preview: pinned ? false : current.preview };
      const nextGroups = groups.map((g) => {
        if (g.id !== gid) return g;
        if (pinned && g.previewTab === path) return { ...g, previewTab: '' };
        return g;
      });
      return syncLegacyTabsFromGroups({ ...prev, editorGroups: nextGroups, tabMeta: nextTabMeta });
    }

    const keptOpen = !current.keptOpen;
    nextTabMeta[key] = { ...current, keptOpen, preview: keptOpen ? false : current.preview };
    const nextGroups = groups.map((g) => {
      if (g.id !== gid) return g;
      if (keptOpen && g.previewTab === path) return { ...g, previewTab: '' };
      return g;
    });
    return syncLegacyTabsFromGroups({ ...prev, editorGroups: nextGroups, tabMeta: nextTabMeta });
  }

  if (type === 'closeEditors') {
    const actionName = String(action?.action || '');
    const payload = action?.payload && typeof action.payload === 'object' ? action.payload : {};
    const tabMeta = resolveTabMeta(prev.tabMeta);

    const isDirty = (p) => !!(prev.files || []).find((f) => f.path === p)?.dirty;
    const isSpecialTab = (p) => isSpecialTabPath(p, {
      settingsTabPath: SETTINGS_TAB_PATH,
      terminalSettingsTabPath: TERMINAL_SETTINGS_TAB_PATH,
      terminalEditorTabPath: TERMINAL_EDITOR_TAB_PATH,
      welcomeTabPath: WELCOME_TAB_PATH,
      diffTabPrefix: DIFF_TAB_PREFIX,
    });

    const requestedGroupId = String(payload?.groupId || '').trim();
    const scopeGroupId = requestedGroupId && groups.some((g) => g.id === requestedGroupId) ? requestedGroupId : activeGroupId;
    const contextPath = String(payload?.tabPath || '').trim();

    const closeInGroup = (g) => {
      const openTabs = Array.isArray(g.openTabs) ? [...g.openTabs] : [];
      if (actionName === 'closeAll') return [];
      if (actionName === 'closeSaved') return openTabs.filter((t) => {
        if (isSpecialTab(t)) return false;
        return isDirty(t);
      });
      if (actionName === 'closeOthers' && contextPath) return openTabs.filter((t) => t === contextPath);
      if (actionName === 'closeRight' && contextPath) {
        const idx = openTabs.indexOf(contextPath);
        if (idx === -1) return openTabs;
        return openTabs.filter((t, i) => i <= idx);
      }
      return openTabs;
    };

    let nextGroups = groups.map((g) => {
      if (payload.scope === 'all') {
        const nextTabs = closeInGroup(g);
        const nextActive = nextTabs.includes(g.activeFile) ? g.activeFile : (nextTabs[nextTabs.length - 1] || '');
        const previewTab = nextTabs.includes(g.previewTab) ? g.previewTab : '';
        return { ...g, openTabs: nextTabs, activeFile: nextActive, previewTab };
      }
      if (g.id !== scopeGroupId) return g;
      const nextTabs = closeInGroup(g);
      const nextActive = nextTabs.includes(g.activeFile) ? g.activeFile : (nextTabs[nextTabs.length - 1] || '');
      const previewTab = nextTabs.includes(g.previewTab) ? g.previewTab : '';
      return { ...g, openTabs: nextTabs, activeFile: nextActive, previewTab };
    });

    if (nextGroups.length > 1) {
      nextGroups = nextGroups.filter((g) => g.openTabs.length > 0);
      if (nextGroups.length === 0) {
        nextGroups = [{ id: 'group-1', openTabs: [], activeFile: '', locked: false, previewTab: '' }];
      }
    }

    const nextTabMeta = { ...tabMeta };
    Object.keys(nextTabMeta).forEach((k) => {
      const v = nextTabMeta[k];
      if (!v || typeof v !== 'object' || !v.preview) return;
      const [gid, ...rest] = k.split('::');
      const p = rest.join('::');
      const g = nextGroups.find((gg) => gg.id === gid);
      if (!g || !g.openTabs.includes(p) || g.previewTab !== p) {
        nextTabMeta[k] = { ...v, preview: false };
      }
    });

    const nextActiveGroupId = nextGroups.some((g) => g.id === activeGroupId) ? activeGroupId : nextGroups[0].id;
    const prevLayout = prev.editorLayout && typeof prev.editorLayout === 'object' ? prev.editorLayout : null;
    const nextLayout = nextGroups.length > 1
      ? { mode: 'split', direction: prevLayout?.direction === 'horizontal' ? 'horizontal' : 'vertical' }
      : { mode: 'single', direction: prevLayout?.direction === 'horizontal' ? 'horizontal' : 'vertical' };

    return syncLegacyTabsFromGroups({
      ...prev,
      editorGroups: nextGroups,
      activeGroupId: nextActiveGroupId,
      editorLayout: nextLayout,
      tabMeta: nextTabMeta,
    });
  }

  if (type === 'reorderTabs') {
    const from = Number(action?.from);
    const to = Number(action?.to);
    const requestedGroupId = String(action?.options?.groupId || '').trim();
    const targetGroupId = requestedGroupId && groups.some((g) => g.id === requestedGroupId)
      ? requestedGroupId
      : activeGroupId;

    const nextGroups = groups.map((g) => {
      if (g.id !== targetGroupId) return g;
      const tabs = [...(g.openTabs || [])];
      if (!Number.isFinite(from) || !Number.isFinite(to)) return g;
      if (from < 0 || from >= tabs.length) return g;
      const [item] = tabs.splice(from, 1);
      const clampedTo = Math.max(0, Math.min(tabs.length, to));
      tabs.splice(clampedTo, 0, item);
      return { ...g, openTabs: tabs };
    });

    return syncLegacyTabsFromGroups({ ...prev, editorGroups: nextGroups });
  }

  return prev;
}
