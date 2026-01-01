import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackendWorkspaceDriver } from '../utils/backendWorkspaceDriver';
import { WELCOME_TAB_PATH } from '../workbench/constants';
import {
  DIFF_TAB_PREFIX,
  SETTINGS_TAB_PATH,
  TERMINAL_EDITOR_TAB_PATH,
  TERMINAL_SETTINGS_TAB_PATH,
  initialWorkspaceState,
} from '../utils/appDefaults';
import {
  isAbsolutePath,
  isMissingPathError,
  isSpecialTabPath,
  pathDirname,
  pathJoinAbs,
  pathRelativeToRoot,
  shouldHidePath,
} from '../utils/appAlgorithms';

export function useWorkspace({
  lspService = null,
  workspaceController = null,
  workspaceControllerRef = null,
  handleSelectWorkspace,
  setInputModal,
  setWorkspaceRootLabelExternal,
  getProjectConfigLsp,
  config = null,
  toolSettings = null,
  getBackendConfig = null,
  setProjectConfig = null,
} = {}) {
  const [workspaceState, setWorkspaceState] = useState(initialWorkspaceState);
  const [diffTabs, setDiffTabs] = useState({});
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceDriver, setWorkspaceDriver] = useState(null);
  const [workspaceBindingStatus, setWorkspaceBindingStatus] = useState('idle');
  const [workspaceBindingError, setWorkspaceBindingError] = useState('');
  const [workspaceRootLabel, setWorkspaceRootLabel] = useState('');
  const [backendWorkspaceRoot, setBackendWorkspaceRoot] = useState('');
  const [backendWorkspaceId, setBackendWorkspaceId] = useState('');
  const [activeWorkspaces, setActiveWorkspaces] = useState([]);
  const [hotReloadToken, setHotReloadToken] = useState(0);

  const backendWorkspaceRootRef = useRef('');
  const pendingOpenFileRef = useRef({ absPath: '', expectedRoot: '' });
  const pendingDeepLinkRef = useRef({ openFile: '', openMode: '', workspaceFsPath: '' });
  const pendingStartActionRef = useRef({ type: null });
  const pendingTemplateRef = useRef(null);

  const saveTimersRef = useRef({});
  const saveSeqRef = useRef({});
  const syncLockRef = useRef(false);
  const lastSyncRef = useRef(0);
  const diffTabCounterRef = useRef(0);

  const clearPendingOpenFile = useCallback(() => {
    pendingOpenFileRef.current = { absPath: '', expectedRoot: '' };
  }, []);

  const clearPendingStartAction = useCallback(() => {
    pendingStartActionRef.current = { type: null };
  }, []);

  const clearPendingTemplate = useCallback(() => {
    pendingTemplateRef.current = null;
  }, []);

  useEffect(() => {
    backendWorkspaceRootRef.current = String(backendWorkspaceRoot || '');
  }, [backendWorkspaceRoot]);

  useEffect(() => () => {
    Object.values(saveTimersRef.current || {}).forEach((timer) => clearTimeout(timer));
  }, []);

  useEffect(() => {
    if (!workspaceBindingStatus || workspaceBindingStatus !== 'ready') return;
    const lspCfg = typeof getProjectConfigLsp === 'function' ? getProjectConfigLsp() : null;
    const wid = String(backendWorkspaceId || '').trim();
    if (!wid) return;
    if (!backendWorkspaceRoot) return;
    try {
      lspService?.updateWorkspace?.({
        nextWorkspaceId: wid,
        nextRootFsPath: backendWorkspaceRoot,
        nextWorkspaceFolders: [backendWorkspaceRoot],
      });
    } catch {
    }
    try {
      void lspService?.didChangeConfiguration?.(lspCfg || {}).catch?.(() => {});
    } catch {
    }
  }, [backendWorkspaceId, backendWorkspaceRoot, getProjectConfigLsp, lspService, workspaceBindingStatus]);

  const tabMetaKey = useCallback((groupId, tabPath) => `${String(groupId || '')}::${String(tabPath || '')}`, []);

  const ensureEditorGroups = useCallback((state) => {
    const rawGroups = Array.isArray(state?.editorGroups) ? state.editorGroups : [];
    const groups = rawGroups.length
      ? rawGroups
        .map((g) => ({
          id: String(g?.id || ''),
          openTabs: Array.isArray(g?.openTabs) ? g.openTabs.filter(Boolean) : [],
          activeFile: String(g?.activeFile || ''),
          locked: !!g?.locked,
          previewTab: String(g?.previewTab || ''),
        }))
        .filter((g) => g.id)
      : [{ id: 'group-1', openTabs: [], activeFile: '', locked: false, previewTab: '' }];

    const activeGroupIdRaw = String(state?.activeGroupId || '').trim();
    const activeGroupId = groups.some((g) => g.id === activeGroupIdRaw) ? activeGroupIdRaw : groups[0].id;
    const activeGroup = groups.find((g) => g.id === activeGroupId) || groups[0];

    return { groups, activeGroupId, activeGroup };
  }, []);

  const createEditorGroupId = useCallback(() => {
    const rand = Math.floor(Math.random() * 1e9).toString(36);
    return `group-${Date.now().toString(36)}-${rand}`;
  }, []);

  const syncLegacyTabsFromGroups = useCallback((nextState) => {
    const { groups, activeGroupId, activeGroup } = ensureEditorGroups(nextState);
    return {
      ...nextState,
      editorGroups: groups,
      activeGroupId,
      openTabs: activeGroup.openTabs,
      activeFile: activeGroup.activeFile,
    };
  }, [ensureEditorGroups]);

  const loadFileContent = useCallback(async (path) => {
    if (!workspaceDriver) return;
    if (shouldHidePath(path)) return;
    try {
      const data = await workspaceDriver.readFile(path);
      setWorkspaceState((prev) => {
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
      setWorkspaceBindingError(err?.message || 'Failed to load file');
      setWorkspaceBindingStatus('error');
    }
  }, [workspaceDriver]);

  const scheduleSave = useCallback((path, content) => {
    if (!workspaceDriver) return;
    const seq = (saveSeqRef.current[path] || 0) + 1;
    saveSeqRef.current[path] = seq;
    if (saveTimersRef.current[path]) {
      clearTimeout(saveTimersRef.current[path]);
    }
    saveTimersRef.current[path] = setTimeout(async () => {
      try {
        await workspaceDriver.writeFile(path, content, { createDirectories: true });
        if (saveSeqRef.current[path] === seq) {
          setWorkspaceState((prev) => ({
            ...prev,
            files: prev.files.map((f) => (f.path === path ? { ...f, dirty: false } : f)),
          }));
        }
        try { void lspService?.didSavePath?.(path, content); } catch {}
        const now = Date.now();
        setWorkspaceState((prev) => ({ ...prev, livePreview: `${now}` }));
        setHotReloadToken(now);
        setWorkspaceBindingError('');
        setWorkspaceBindingStatus('ready');
      } catch (err) {
        setWorkspaceBindingError(err?.message || 'Save failed');
        setWorkspaceBindingStatus('error');
      }
    }, 220);
  }, [lspService, workspaceDriver]);

  const resolveApiUrl = useCallback((url) => {
    if (typeof window === 'undefined') return url;
    if (typeof url !== 'string') return url;
    if (!url.startsWith('/api/')) return url;
    const proto = window.location?.protocol;
    const origin = window.location?.origin;
    if (proto === 'file:' || origin === 'null') {
      return `http://127.0.0.1:8000${url.replace(/^\/api/, '')}`;
    }
    return url;
  }, []);

  const openBackendWorkspace = useCallback(async (workspaceOrRoot, { silent = false } = {}) => {
    const descriptor = workspaceOrRoot && typeof workspaceOrRoot === 'object' ? workspaceOrRoot : null;
    const rootPath = descriptor && Array.isArray(descriptor.folders) && descriptor.folders[0] && typeof descriptor.folders[0].path === 'string'
      ? descriptor.folders[0].path
      : workspaceOrRoot;
    const trimmed = (rootPath || '').trim();
    if (!trimmed) {
      setBackendWorkspaceRoot('');
      setBackendWorkspaceId('');
      try {
        if (typeof window !== 'undefined') {
          window.__NODE_AGENT_WORKSPACE_ID__ = '';
          window.__NODE_AGENT_WORKSPACE_ROOT__ = '';
        }
      } catch {}
      if (typeof setProjectConfig === 'function') {
        setProjectConfig((cfg) => ({ ...cfg, backendRoot: '' }));
      }
      return;
    }
    if (!isAbsolutePath(trimmed)) {
      const message = '请填写 Workspace 的绝对路径，例如 H:\\\\04';
      setWorkspaceBindingStatus('error');
      setWorkspaceBindingError(message);
      setBackendWorkspaceRoot('');
      setBackendWorkspaceId('');
      try {
        if (typeof window !== 'undefined') {
          window.__NODE_AGENT_WORKSPACE_ID__ = '';
          window.__NODE_AGENT_WORKSPACE_ROOT__ = '';
        }
      } catch {}
      if (typeof setProjectConfig === 'function') {
        setProjectConfig((cfg) => ({ ...cfg, backendRoot: '' }));
      }
      if (!silent) {
        console.warn(message);
      }
      return;
    }
    try {
      setWorkspaceBindingStatus('checking');
      const abort = new AbortController();
      let timeoutId = null;
      try {
        timeoutId = setTimeout(() => abort.abort(), 15000);
        const provider = config?.provider || '';
        const model = (provider && config && config[provider] && config[provider].model) ? config[provider].model : '';
        const llmConfig = typeof getBackendConfig === 'function' ? getBackendConfig() : {};
        const res = await fetch(resolveApiUrl('/api/workspace/bind-root'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Workspace-Root': trimmed },
          body: JSON.stringify({
            root: trimmed,
            settings: {
              provider,
              model: model || '',
              llmConfig,
              toolSettings,
            },
          }),
          signal: abort.signal,
        });
        let data = {};
        try {
          data = await res.json();
        } catch {
          data = {};
        }
        if (!res.ok) {
          throw new Error(data.detail || res.statusText || '打开 Workspace 失败');
        }
        const applied = data.root || trimmed;
        const workspaceId = typeof data.workspace_id === 'string' ? data.workspace_id.trim() : '';
        setBackendWorkspaceId(workspaceId);
        setBackendWorkspaceRoot(applied);
        try {
          if (typeof window !== 'undefined') {
            window.__NODE_AGENT_WORKSPACE_ID__ = workspaceId;
            window.__NODE_AGENT_WORKSPACE_ROOT__ = applied;
          }
        } catch {}
        if (typeof setProjectConfig === 'function') {
          setProjectConfig((cfg) => ({
            ...cfg,
            backendRoot: applied,
            projectPath: cfg.projectPath || applied,
            workspaceId: workspaceId || cfg.workspaceId || '',
          }));
        }
        setWorkspaceBindingError('');
        setWorkspaceBindingStatus('ready');
        return { descriptor: descriptor || (data.workspace || null) || null, workspaceId, root: applied };
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    } catch (err) {
      console.error('Bind backend workspace failed', err);
      setBackendWorkspaceId('');
      try {
        if (typeof window !== 'undefined') {
          window.__NODE_AGENT_WORKSPACE_ID__ = '';
        }
      } catch {}
      setWorkspaceBindingStatus('error');
      const isAbort = err?.name === 'AbortError';
      setWorkspaceBindingError(isAbort ? '打开 Workspace 超时：请确认后端服务已启动' : (err?.message || '打开 Workspace 失败'));
      if (!silent) {
        console.warn(`打开 Workspace 失败：${err.message || err}`);
      }
    }
  }, [config, getBackendConfig, resolveApiUrl, setProjectConfig, toolSettings]);

  const syncWorkspaceFromDisk = useCallback(async ({
    includeContent = false,
    highlight = true,
    driver: driverOverride = null,
    force = false,
    snapshot = null,
  } = {}) => {
    const driver = driverOverride || workspaceDriver;
    if (!driver) {
      setWorkspaceBindingStatus((prev) => (prev === 'error' ? prev : 'idle'));
      return null;
    }
    const now = Date.now();
    const shouldThrottle = !force && !snapshot;
    if (shouldThrottle && syncLockRef.current) return null;
    if (shouldThrottle && now - lastSyncRef.current < 800) return null;
    syncLockRef.current = true;
    setWorkspaceLoading(true);
    try {
      const data = snapshot || await driver.getStructure({ includeContent });
      const incoming = (data.files || [])
        .filter((f) => !shouldHidePath(f.path))
        .map((f) => ({
          path: f.path,
          content: f.content ?? '',
          truncated: f.truncated,
          updated: false,
          dirty: false,
        }));

      setWorkspaceState((prevRaw) => {
        const prev = syncLegacyTabsFromGroups(prevRaw);
        const prevMap = Object.fromEntries((prev.files || []).map((f) => [f.path, f]));
        const incomingPaths = new Set(incoming.map((f) => f.path));
        const prevFiles = Array.isArray(prev.files) ? prev.files : [];
        const dirtyExtraFiles = incoming.length
          ? prevFiles.filter((f) => f && f.dirty && f.path && !incomingPaths.has(f.path) && !shouldHidePath(f.path))
          : [];

        const mergedBase = incoming.length
          ? incoming.map((file) => {
            const prevFile = prevMap[file.path];
            if (prevFile?.dirty) {
              return { ...prevFile, truncated: file.truncated, updated: prevFile.updated };
            }
            const changed = highlight && prevFile && prevFile.content !== file.content;
            const isNew = highlight && !prevFile;
            return { ...file, updated: changed || isNew, dirty: false };
          })
          : (prev.files || []);

        const merged = incoming.length && dirtyExtraFiles.length
          ? [...mergedBase, ...dirtyExtraFiles]
          : mergedBase;

        const existingFilePaths = new Set(
          (data.entries || [])
            .filter((entry) => entry && entry.type === 'file' && typeof entry.path === 'string' && !shouldHidePath(entry.path))
            .map((entry) => entry.path),
        );
        for (const f of prevFiles) {
          if (f && f.dirty && f.path && !shouldHidePath(f.path)) existingFilePaths.add(f.path);
        }
        const isValidTab = (p) => isSpecialTabPath(p, {
          settingsTabPath: SETTINGS_TAB_PATH,
          terminalSettingsTabPath: TERMINAL_SETTINGS_TAB_PATH,
          terminalEditorTabPath: TERMINAL_EDITOR_TAB_PATH,
          welcomeTabPath: WELCOME_TAB_PATH,
          diffTabPrefix: DIFF_TAB_PREFIX,
        }) || existingFilePaths.has(p);

        const { groups, activeGroupId } = ensureEditorGroups(prev);
        const nextGroups = groups.map((g) => {
          const openTabs = (g.openTabs || []).filter(isValidTab);
          const active = isValidTab(g.activeFile) ? g.activeFile : '';
          const activeFile = active || (openTabs[openTabs.length - 1] || '');
          const previewTab = isValidTab(g.previewTab) ? g.previewTab : '';
          return { ...g, openTabs, activeFile, previewTab };
        });

        const hasAnyTabs = nextGroups.some((g) => g.openTabs.length > 0);
        const userClosedAll = !hasAnyTabs && !nextGroups.some((g) => g.activeFile);

        const nextActiveGroupId = nextGroups.some((g) => g.id === activeGroupId) ? activeGroupId : (nextGroups[0]?.id || 'group-1');
        let nextGroups2 = nextGroups;

        if (!userClosedAll) {
          const entry = data.entry_candidates?.[0] || merged[0]?.path || '';
          if (entry && existingFilePaths.has(entry)) {
            nextGroups2 = nextGroups.map((g) => {
              if (g.id !== nextActiveGroupId) return g;
              const openTabs = g.openTabs.includes(entry) ? g.openTabs : [...g.openTabs, entry];
              const activeFile = g.activeFile || entry;
              return { ...g, openTabs, activeFile };
            });
          }
        }

        return syncLegacyTabsFromGroups({
          ...prev,
          files: merged,
          fileTree: (data.entries || []).filter((entry) => !shouldHidePath(entry.path)) || prev.fileTree,
          editorGroups: userClosedAll
            ? [{ id: nextActiveGroupId, openTabs: [], activeFile: '', locked: false, previewTab: '' }]
            : nextGroups2,
          activeGroupId: nextActiveGroupId,
          entryCandidates: data.entry_candidates || prev.entryCandidates,
          workspaceRoots: Array.isArray(data.roots) ? data.roots : prev.workspaceRoots,
        });
      });
      lastSyncRef.current = Date.now();
      return { files: incoming, raw: data };
    } catch (err) {
      setWorkspaceBindingError(err?.message || 'Workspace sync failed');
      setWorkspaceBindingStatus('error');
      return null;
    } finally {
      syncLockRef.current = false;
      setWorkspaceLoading(false);
    }
  }, [ensureEditorGroups, syncLegacyTabsFromGroups, workspaceDriver]);

  useEffect(() => {
    if (!workspaceState.activeFile && workspaceState.openTabs.length > 0) {
      const firstTab = workspaceState.openTabs[0];
      setWorkspaceState((prev) => ({ ...prev, activeFile: firstTab }));
    }
  }, [workspaceState.activeFile, workspaceState.openTabs]);

  const openFile = useCallback((path, options = {}) => {
    const filePath = String(path || '');
    if (!filePath) return;
    const isSpecialTab = filePath === WELCOME_TAB_PATH
      || filePath === SETTINGS_TAB_PATH
      || filePath === TERMINAL_SETTINGS_TAB_PATH
      || filePath === TERMINAL_EDITOR_TAB_PATH
      || (filePath && filePath.startsWith(DIFF_TAB_PREFIX));

    if (!isSpecialTab && !workspaceDriver) {
      alert('请先选择项目文件夹');
      return;
    }

    setWorkspaceState((prevRaw) => {
      const prev = syncLegacyTabsFromGroups(prevRaw);
      const { groups, activeGroupId } = ensureEditorGroups(prev);

      const requestedGroupId = String(options?.groupId || '').trim();
      const targetGroupId = requestedGroupId && groups.some((g) => g.id === requestedGroupId)
        ? requestedGroupId
        : activeGroupId;
      const targetGroup = groups.find((g) => g.id === targetGroupId) || groups[0];
      const previewEnabled = prev.previewEditorEnabled !== false;
      const groupLocked = !!targetGroup.locked;
      const requestedModeRaw = String(options?.mode || '').trim();
      const requestedMode = requestedModeRaw === 'persistent' || requestedModeRaw === 'preview' ? requestedModeRaw : '';
      const mode = requestedMode || ((previewEnabled && !groupLocked && !isSpecialTab) ? 'preview' : 'persistent');

      const tabMeta = prev.tabMeta && typeof prev.tabMeta === 'object' ? prev.tabMeta : {};
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
    });

    if (!isSpecialTab) loadFileContent(filePath);
  }, [ensureEditorGroups, loadFileContent, syncLegacyTabsFromGroups, tabMetaKey, workspaceDriver]);

  const closeFile = useCallback((path, options = {}) => {
    const tabPath = String(path || '');
    if (!tabPath) return;

    setWorkspaceState((prevRaw) => {
      const prev = syncLegacyTabsFromGroups(prevRaw);
      const dismissWelcome = tabPath === WELCOME_TAB_PATH;
      const { groups, activeGroupId } = ensureEditorGroups(prev);
      const requestedGroupId = String(options?.groupId || '').trim();

      const containingGroupId = groups.find((g) => Array.isArray(g.openTabs) && g.openTabs.includes(tabPath))?.id || '';
      const targetGroupId = (requestedGroupId && groups.some((g) => g.id === requestedGroupId))
        ? requestedGroupId
        : (containingGroupId || activeGroupId);

      const tabMeta = prev.tabMeta && typeof prev.tabMeta === 'object' ? prev.tabMeta : {};
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
    });

    if (tabPath && tabPath.startsWith(DIFF_TAB_PREFIX)) {
      setDiffTabs((prev) => {
        if (!prev || !prev[tabPath]) return prev;
        const next = { ...prev };
        delete next[tabPath];
        return next;
      });
    }
  }, [ensureEditorGroups, syncLegacyTabsFromGroups, tabMetaKey]);

  const handleFileChange = useCallback((path, content, options = {}) => {
    const tabPath = String(path || '');
    if (!tabPath) return;

    setWorkspaceState((prevRaw) => {
      const prev = syncLegacyTabsFromGroups(prevRaw);
      const prevFiles = Array.isArray(prev.files) ? prev.files : [];
      const hasEntry = prevFiles.some((f) => f && f.path === tabPath);
      const nextFiles = hasEntry
        ? prevFiles.map((f) => (f.path === tabPath ? { ...f, content, dirty: true } : f))
        : [...prevFiles, { path: tabPath, content, truncated: false, updated: false, dirty: true }];
      const { groups, activeGroupId } = ensureEditorGroups(prev);

      const requestedGroupId = String(options?.groupId || '').trim();
      const containingGroupId = groups.find((g) => Array.isArray(g.openTabs) && g.openTabs.includes(tabPath))?.id || '';
      const targetGroupId = (requestedGroupId && groups.some((g) => g.id === requestedGroupId))
        ? requestedGroupId
        : (containingGroupId || activeGroupId);

      const tabMeta = prev.tabMeta && typeof prev.tabMeta === 'object' ? prev.tabMeta : {};
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
    });

    scheduleSave(tabPath, content);
  }, [ensureEditorGroups, scheduleSave, syncLegacyTabsFromGroups, tabMetaKey]);

  const handleActiveEditorChange = useCallback((path, options = {}) => {
    const tabPath = String(path || '');
    if (!tabPath) return;
    setWorkspaceState((prevRaw) => {
      const prev = syncLegacyTabsFromGroups(prevRaw);
      const { groups, activeGroupId } = ensureEditorGroups(prev);
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
    });
  }, [ensureEditorGroups, syncLegacyTabsFromGroups]);

  const handleActiveGroupChange = useCallback((groupId) => {
    const nextId = String(groupId || '').trim();
    if (!nextId) return;
    setWorkspaceState((prevRaw) => {
      const prev = syncLegacyTabsFromGroups(prevRaw);
      const { groups } = ensureEditorGroups(prev);
      if (!groups.some((g) => g.id === nextId)) return prev;
      return syncLegacyTabsFromGroups({ ...prev, activeGroupId: nextId });
    });
  }, [ensureEditorGroups, syncLegacyTabsFromGroups]);

  const toggleGroupLocked = useCallback((groupId) => {
    const targetId = String(groupId || '').trim();
    if (!targetId) return;
    setWorkspaceState((prevRaw) => {
      const prev = syncLegacyTabsFromGroups(prevRaw);
      const { groups } = ensureEditorGroups(prev);
      if (!groups.some((g) => g.id === targetId)) return prev;
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
    });
  }, [ensureEditorGroups, syncLegacyTabsFromGroups, tabMetaKey]);

  const togglePreviewEditorEnabled = useCallback(() => {
    setWorkspaceState((prevRaw) => {
      const prev = syncLegacyTabsFromGroups(prevRaw);
      const nextEnabled = prev.previewEditorEnabled === false;
      const tabMeta = prev.tabMeta && typeof prev.tabMeta === 'object' ? prev.tabMeta : {};
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
    });
  }, [syncLegacyTabsFromGroups]);

  const toggleTabPinned = useCallback((groupId, tabPath) => {
    const gid = String(groupId || '').trim();
    const path = String(tabPath || '');
    if (!gid || !path) return;
    setWorkspaceState((prevRaw) => {
      const prev = syncLegacyTabsFromGroups(prevRaw);
      const { groups } = ensureEditorGroups(prev);
      if (!groups.some((g) => g.id === gid)) return prev;
      const tabMeta = prev.tabMeta && typeof prev.tabMeta === 'object' ? prev.tabMeta : {};
      const nextTabMeta = { ...tabMeta };
      const key = tabMetaKey(gid, path);
      const current = nextTabMeta[key] && typeof nextTabMeta[key] === 'object' ? nextTabMeta[key] : {};
      const pinned = !current.pinned;
      nextTabMeta[key] = { ...current, pinned, preview: pinned ? false : current.preview };
      const nextGroups = groups.map((g) => {
        if (g.id !== gid) return g;
        if (pinned && g.previewTab === path) return { ...g, previewTab: '' };
        return g;
      });
      return syncLegacyTabsFromGroups({ ...prev, editorGroups: nextGroups, tabMeta: nextTabMeta });
    });
  }, [ensureEditorGroups, syncLegacyTabsFromGroups, tabMetaKey]);

  const toggleTabKeptOpen = useCallback((groupId, tabPath) => {
    const gid = String(groupId || '').trim();
    const path = String(tabPath || '');
    if (!gid || !path) return;
    setWorkspaceState((prevRaw) => {
      const prev = syncLegacyTabsFromGroups(prevRaw);
      const { groups } = ensureEditorGroups(prev);
      if (!groups.some((g) => g.id === gid)) return prev;
      const tabMeta = prev.tabMeta && typeof prev.tabMeta === 'object' ? prev.tabMeta : {};
      const nextTabMeta = { ...tabMeta };
      const key = tabMetaKey(gid, path);
      const current = nextTabMeta[key] && typeof nextTabMeta[key] === 'object' ? nextTabMeta[key] : {};
      const keptOpen = !current.keptOpen;
      nextTabMeta[key] = { ...current, keptOpen, preview: keptOpen ? false : current.preview };
      const nextGroups = groups.map((g) => {
        if (g.id !== gid) return g;
        if (keptOpen && g.previewTab === path) return { ...g, previewTab: '' };
        return g;
      });
      return syncLegacyTabsFromGroups({ ...prev, editorGroups: nextGroups, tabMeta: nextTabMeta });
    });
  }, [ensureEditorGroups, syncLegacyTabsFromGroups, tabMetaKey]);

  const splitEditor = useCallback(({ direction = 'right', groupId, tabPath, move = false } = {}) => {
    const dir = direction === 'down' ? 'down' : 'right';
    setWorkspaceState((prevRaw) => {
      const prev = syncLegacyTabsFromGroups(prevRaw);
      const { groups, activeGroupId } = ensureEditorGroups(prev);
      const requestedGroupId = String(groupId || '').trim();
      const sourceGroupId = requestedGroupId && groups.some((g) => g.id === requestedGroupId) ? requestedGroupId : activeGroupId;
      const sourceGroup = groups.find((g) => g.id === sourceGroupId) || groups[0];
      const path = String(tabPath || sourceGroup.activeFile || '').trim();
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
          if (!move) return g;
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
    });
  }, [createEditorGroupId, ensureEditorGroups, syncLegacyTabsFromGroups, tabMetaKey]);

  const closeEditors = useCallback((action, payload = {}) => {
    setWorkspaceState((prevRaw) => {
      const prev = syncLegacyTabsFromGroups(prevRaw);
      const { groups, activeGroupId } = ensureEditorGroups(prev);
      const tabMeta = prev.tabMeta && typeof prev.tabMeta === 'object' ? prev.tabMeta : {};

      const isSpecialTab = (p) => isSpecialTabPath(p, {
        settingsTabPath: SETTINGS_TAB_PATH,
        terminalSettingsTabPath: TERMINAL_SETTINGS_TAB_PATH,
        terminalEditorTabPath: TERMINAL_EDITOR_TAB_PATH,
        welcomeTabPath: WELCOME_TAB_PATH,
        diffTabPrefix: DIFF_TAB_PREFIX,
      });
      const isDirty = (p) => !!(prev.files || []).find((f) => f.path === p)?.dirty;

      const requestedGroupId = String(payload?.groupId || '').trim();
      const scopeGroupId = requestedGroupId && groups.some((g) => g.id === requestedGroupId) ? requestedGroupId : activeGroupId;
      const contextPath = String(payload?.tabPath || '').trim();

      const closeInGroup = (g) => {
        const openTabs = Array.isArray(g.openTabs) ? [...g.openTabs] : [];
        if (action === 'closeAll') return [];
        if (action === 'closeSaved') return openTabs.filter((t) => {
          if (isSpecialTab(t)) return false;
          return isDirty(t);
        });
        if (action === 'closeOthers' && contextPath) return openTabs.filter((t) => t === contextPath);
        if (action === 'closeRight' && contextPath) {
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
    });
  }, [ensureEditorGroups, syncLegacyTabsFromGroups]);

  const handleTabReorder = useCallback((from, to, options = {}) => {
    setWorkspaceState((prevRaw) => {
      const prev = syncLegacyTabsFromGroups(prevRaw);
      const { groups, activeGroupId } = ensureEditorGroups(prev);
      const requestedGroupId = String(options?.groupId || '').trim();
      const targetGroupId = requestedGroupId && groups.some((g) => g.id === requestedGroupId)
        ? requestedGroupId
        : activeGroupId;

      const nextGroups = groups.map((g) => {
        if (g.id !== targetGroupId) return g;
        const tabs = [...(g.openTabs || [])];
        const fromIdx = Number(from);
        const toIdx = Number(to);
        if (!Number.isFinite(fromIdx) || !Number.isFinite(toIdx)) return g;
        if (fromIdx < 0 || fromIdx >= tabs.length) return g;
        const [item] = tabs.splice(fromIdx, 1);
        const clampedTo = Math.max(0, Math.min(tabs.length, toIdx));
        tabs.splice(clampedTo, 0, item);
        return { ...g, openTabs: tabs };
      });

      return syncLegacyTabsFromGroups({ ...prev, editorGroups: nextGroups });
    });
  }, [ensureEditorGroups, syncLegacyTabsFromGroups]);

  const handleRefreshPreview = useCallback(async () => {
    await syncWorkspaceFromDisk({ includeContent: true, highlight: false });
    const now = Date.now();
    setHotReloadToken(now);
    setWorkspaceState((prev) => ({ ...prev, livePreview: `${now}` }));
  }, [syncWorkspaceFromDisk]);

  const handleGlobalSearch = useCallback(async (query, options = {}) => {
    if (!workspaceDriver) return [];
    try {
      const result = await workspaceDriver.search(query, options);
      return result.results || [];
    } catch {
      return [];
    }
  }, [workspaceDriver]);

  const handleAddFile = useCallback(() => {
    if (!workspaceDriver) {
      alert('请先选择项目文件夹');
      return;
    }
    setInputModal?.({
      isOpen: true,
      title: '新建文件',
      label: '输入文件名 (例如: src/App.js)',
      defaultValue: '',
      placeholder: 'src/App.js',
      confirmText: '创建',
      icon: 'codicon-new-file',
      onConfirm: async (name) => {
        if (!name) return;
        try {
          if (!workspaceDriver?.setFileOperationsHooks) {
            try { await lspService?.willCreateFiles?.([name]); } catch {}
          }
          await workspaceDriver.writeFile(name, '', { createDirectories: true });
          if (!workspaceDriver?.setFileOperationsHooks) {
            try { await lspService?.didCreateFiles?.([name]); } catch {}
          }
          await syncWorkspaceFromDisk({ includeContent: true, highlight: true });
          openFile(name);
        } catch {
        }
        setInputModal?.((prev) => ({ ...prev, isOpen: false }));
      },
      onClose: () => setInputModal?.((prev) => ({ ...prev, isOpen: false })),
    });
  }, [lspService, openFile, setInputModal, syncWorkspaceFromDisk, workspaceDriver]);

  const handleAddFolder = useCallback(() => {
    if (!workspaceDriver) {
      alert('请先选择项目文件夹');
      return;
    }
    setInputModal?.({
      isOpen: true,
      title: '新建文件夹',
      label: '输入文件夹名 (例如: src/components)',
      defaultValue: '',
      placeholder: 'src/components',
      confirmText: '创建',
      icon: 'codicon-new-folder',
      onConfirm: async (name) => {
        if (!name) return;
        try {
          if (!workspaceDriver?.setFileOperationsHooks) {
            try { await lspService?.willCreateFiles?.([name]); } catch {}
          }
          await workspaceDriver.createFolder(name);
          if (!workspaceDriver?.setFileOperationsHooks) {
            try { await lspService?.didCreateFiles?.([name]); } catch {}
          }
          await syncWorkspaceFromDisk({ includeContent: false, highlight: false });
        } catch {
        }
        setInputModal?.((prev) => ({ ...prev, isOpen: false }));
      },
      onClose: () => setInputModal?.((prev) => ({ ...prev, isOpen: false })),
    });
  }, [lspService, setInputModal, syncWorkspaceFromDisk, workspaceDriver]);

  const handleNewFileFromWelcome = useCallback(async () => {
    if (workspaceDriver && workspaceBindingStatus === 'ready') {
      handleAddFile();
      return;
    }
    pendingStartActionRef.current = { type: 'newFile' };
    await handleSelectWorkspace?.(null);
  }, [handleAddFile, handleSelectWorkspace, workspaceBindingStatus, workspaceDriver]);

  useEffect(() => {
    if (!workspaceDriver) return;
    if (workspaceBindingStatus !== 'ready') return;
    const pending = pendingStartActionRef.current;
    if (!pending?.type) return;
    if (pending.type !== 'newFile') return;
    clearPendingStartAction();
    handleAddFile();
  }, [clearPendingStartAction, handleAddFile, workspaceBindingStatus, workspaceDriver]);

  const sanitizeTemplateFolder = useCallback((raw) => {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (s.includes('..')) return '';
    if (s.includes('/') || s.includes('\\')) return '';
    if (/^[A-Za-z]:/.test(s)) return '';
    return s.replace(/[:*?"<>|]+/g, '').trim();
  }, []);

  const getTemplateSpec = useCallback((templateId) => {
    const id = String(templateId || '').trim();
    if (id === 'web') {
      return {
        id: 'web',
        entry: 'index.html',
        files: {
          'README.md': '# Web Template\n\nGenerated by Start Page Templates.\n',
          'index.html': '<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Web Template</title><link rel="stylesheet" href="./style.css"/></head><body><div id="app"></div><script type="module" src="./main.js"></script></body></html>\n',
          'style.css': 'body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;margin:0;padding:24px;background:#f6f7f9;color:#111827}#app{max-width:720px}\n',
          'main.js': "document.querySelector('#app').innerHTML = '<h1>Hello</h1><p>Template created.</p>';\n",
        },
      };
    }
    if (id === 'react') {
      return {
        id: 'react',
        entry: 'src/App.jsx',
        files: {
          'README.md': '# React Template\n\nGenerated by Start Page Templates.\n',
          'index.html': '<!doctype html><html><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/><title>React Template</title></head><body><div id=\"root\"></div><script type=\"module\" src=\"/src/main.jsx\"></script></body></html>\n',
          'src/main.jsx': "import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App.jsx';\n\nReactDOM.createRoot(document.getElementById('root')).render(<App />);\n",
          'src/App.jsx': "import React from 'react';\n\nexport default function App() {\n  return (\n    <div style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial, sans-serif', padding: 24 }}>\n      <h1>Hello</h1>\n      <p>Template created.</p>\n    </div>\n  );\n}\n",
        },
      };
    }
    return {
      id: 'blank',
      entry: 'README.md',
      files: {
        'README.md': '# Blank Template\n\nGenerated by Start Page Templates.\n',
      },
    };
  }, []);

  const createTemplateProjectInWorkspace = useCallback(async ({ templateId, projectName, parentDir } = {}) => {
    const destParent = String(parentDir || '').trim();
    const controller = workspaceControllerRef?.current || workspaceController;
    if (destParent && isAbsolutePath(destParent) && BackendWorkspaceDriver?.fromFsPath) {
      const folder = sanitizeTemplateFolder(projectName) || 'my-project';
      const spec = getTemplateSpec(templateId);

      const parentDriver = await BackendWorkspaceDriver.fromFsPath(destParent);
      await parentDriver.createFolder(folder);

      const targetRoot = pathJoinAbs(destParent, folder);
      const targetDriver = await BackendWorkspaceDriver.fromFsPath(targetRoot);
      for (const [rel, content] of Object.entries(spec.files || {})) {
        await targetDriver.writeFile(rel, String(content || ''), { createDirectories: true });
      }

      clearPendingOpenFile();
      pendingOpenFileRef.current = { absPath: pathJoinAbs(targetRoot, spec.entry), expectedRoot: targetRoot };
      await controller?.openWorkspace?.(targetRoot, { preferredRoot: targetRoot });
      return { queued: true, root: targetRoot };
    }

    if (!workspaceDriver) {
      pendingStartActionRef.current = { type: 'template' };
      pendingTemplateRef.current = { templateId, projectName };
      await handleSelectWorkspace?.(null);
      return { queued: true };
    }
    if (workspaceBindingStatus !== 'ready') {
      pendingStartActionRef.current = { type: 'template' };
      pendingTemplateRef.current = { templateId, projectName };
      return { queued: true };
    }

    const folder = sanitizeTemplateFolder(projectName) || 'my-project';
    const hasExisting =
      (workspaceState.files || []).some((f) => f?.path === folder || String(f?.path || '').startsWith(`${folder}/`))
      || (workspaceState.fileTree || []).some((e) => e?.path === folder || String(e?.path || '').startsWith(`${folder}/`));
    if (hasExisting) {
      throw new Error(`目标目录已存在：${folder}`);
    }

    const spec = getTemplateSpec(templateId);
    const createdPaths = [folder, ...Object.keys(spec.files || {}).map((rel) => `${folder}/${rel}`)].filter(Boolean);
    if (!workspaceDriver?.setFileOperationsHooks) {
      try { await lspService?.willCreateFiles?.(createdPaths); } catch {}
    }
    await workspaceDriver.createFolder(folder);
    for (const [rel, content] of Object.entries(spec.files || {})) {
      await workspaceDriver.writeFile(`${folder}/${rel}`, String(content || ''), { createDirectories: true });
    }
    if (!workspaceDriver?.setFileOperationsHooks) {
      try { await lspService?.didCreateFiles?.(createdPaths); } catch {}
    }
    await syncWorkspaceFromDisk({ includeContent: true, highlight: true, force: true });
    openFile(`${folder}/${spec.entry}`);
    return { ok: true, folder, entry: `${folder}/${spec.entry}` };
  }, [
    clearPendingOpenFile,
    getTemplateSpec,
    handleSelectWorkspace,
    lspService,
    openFile,
    sanitizeTemplateFolder,
    syncWorkspaceFromDisk,
    workspaceBindingStatus,
    workspaceController,
    workspaceControllerRef,
    workspaceDriver,
    workspaceState.fileTree,
    workspaceState.files,
  ]);

  useEffect(() => {
    if (!workspaceDriver) return;
    if (workspaceBindingStatus !== 'ready') return;
    if (pendingStartActionRef.current?.type !== 'template') return;
    const pending = pendingTemplateRef.current;
    if (!pending) return;
    clearPendingStartAction();
    clearPendingTemplate();
    createTemplateProjectInWorkspace(pending).catch((err) => {
      setWorkspaceBindingError(err?.message || 'Create template failed');
      setWorkspaceBindingStatus('error');
    });
  }, [clearPendingStartAction, clearPendingTemplate, createTemplateProjectInWorkspace, workspaceBindingStatus, workspaceDriver]);

  const handleDeletePath = useCallback(async (path) => {
    if (!workspaceDriver) {
      alert('请先选择项目文件夹');
      return;
    }
    if (!path) return;
    if (!window.confirm(`确认删除 ${path} ?`)) return;
    try {
      if (!workspaceDriver?.setFileOperationsHooks) {
        try { await lspService?.willDeleteFiles?.([path]); } catch {}
      }
      await workspaceDriver.deletePath(path);
      if (!workspaceDriver?.setFileOperationsHooks) {
        try { await lspService?.didDeleteFiles?.([path]); } catch {}
      }
      await syncWorkspaceFromDisk({ includeContent: true, highlight: false });
      setWorkspaceState((prevRaw) => {
        const prev = syncLegacyTabsFromGroups(prevRaw);
        const { groups, activeGroupId } = ensureEditorGroups(prev);
        let nextGroups = groups.map((g) => {
          const openTabs = (g.openTabs || []).filter((t) => t !== path);
          const activeFile = g.activeFile === path ? (openTabs[openTabs.length - 1] || '') : g.activeFile;
          const previewTab = g.previewTab === path ? '' : g.previewTab;
          return { ...g, openTabs, activeFile, previewTab };
        });
        if (nextGroups.length > 1) nextGroups = nextGroups.filter((g) => g.openTabs.length > 0);
        const nextActiveGroupId = nextGroups.some((g) => g.id === activeGroupId) ? activeGroupId : (nextGroups[0]?.id || 'group-1');

        const tabMeta = prev.tabMeta && typeof prev.tabMeta === 'object' ? prev.tabMeta : {};
        const nextTabMeta = { ...tabMeta };
        Object.keys(nextTabMeta).forEach((k) => {
          if (k.endsWith(`::${path}`)) delete nextTabMeta[k];
        });

        return syncLegacyTabsFromGroups({
          ...prev,
          files: (prev.files || []).filter((f) => f.path !== path),
          editorGroups: nextGroups,
          activeGroupId: nextActiveGroupId,
          tabMeta: nextTabMeta,
        });
      });
    } catch {
    }
  }, [ensureEditorGroups, lspService, syncLegacyTabsFromGroups, syncWorkspaceFromDisk, workspaceDriver]);

  const handleRenamePath = useCallback(async (oldPath, nextPathInput = null) => {
    if (!workspaceDriver) {
      alert('请先选择项目文件夹');
      return;
    }
    if (nextPathInput) {
      try {
        if (!workspaceDriver?.setFileOperationsHooks) {
          try { await lspService?.willRenameFiles?.([{ from: oldPath, to: nextPathInput }]); } catch {}
        }
        await workspaceDriver.renamePath(oldPath, nextPathInput);
        if (!workspaceDriver?.setFileOperationsHooks) {
          try { await lspService?.didRenameFiles?.([{ from: oldPath, to: nextPathInput }]); } catch {}
        }
        await syncWorkspaceFromDisk({ includeContent: true, highlight: true });
      } catch {
      }
      return;
    }

    setInputModal?.({
      isOpen: true,
      title: '重命名',
      label: '输入新的相对路径',
      defaultValue: oldPath,
      placeholder: oldPath,
      confirmText: '重命名',
      icon: 'codicon-edit',
      onConfirm: async (nextPath) => {
        if (!nextPath || nextPath === oldPath) {
          setInputModal?.((prev) => ({ ...prev, isOpen: false }));
          return;
        }
        try {
          if (!workspaceDriver?.setFileOperationsHooks) {
            try { await lspService?.willRenameFiles?.([{ from: oldPath, to: nextPath }]); } catch {}
          }
          await workspaceDriver.renamePath(oldPath, nextPath);
          if (!workspaceDriver?.setFileOperationsHooks) {
            try { await lspService?.didRenameFiles?.([{ from: oldPath, to: nextPath }]); } catch {}
          }
          await syncWorkspaceFromDisk({ includeContent: true, highlight: true });
        } catch {
        }
        setInputModal?.((prev) => ({ ...prev, isOpen: false }));
      },
      onClose: () => setInputModal?.((prev) => ({ ...prev, isOpen: false })),
    });
  }, [lspService, setInputModal, syncWorkspaceFromDisk, workspaceDriver]);

  const applyWorkspaceEditCreateFile = useCallback(async (path, meta = {}) => {
    const relPath = String(path || '').trim();
    if (!workspaceDriver || !relPath) return false;
    const options = meta?.options && typeof meta.options === 'object' ? meta.options : {};
    const ignoreIfExists = options?.ignoreIfExists === true || options?.ignore_if_exists === true;
    const overwrite = options?.overwrite === true;
    if (ignoreIfExists || !overwrite) {
      try {
        const existing = await workspaceDriver.readFile(relPath, { allowMissing: true });
        if (existing?.exists !== false) return true;
      } catch {
      }
    }
    const initial = typeof meta?.initialContent === 'string'
      ? meta.initialContent
      : (typeof meta?.content === 'string' ? meta.content : '');
    await workspaceDriver.writeFile(relPath, initial, { createDirectories: true, notifyCreate: false });
    setWorkspaceState((prevRaw) => {
      const prev = syncLegacyTabsFromGroups(prevRaw);
      const prevFiles = Array.isArray(prev.files) ? prev.files : [];
      const hasEntry = prevFiles.some((f) => f && f.path === relPath);
      const nextFiles = hasEntry
        ? prevFiles
        : [...prevFiles, { path: relPath, content: initial, truncated: false, updated: false, dirty: false }];
      return syncLegacyTabsFromGroups({ ...prev, files: nextFiles });
    });
    setWorkspaceBindingStatus('ready');
    return true;
  }, [syncLegacyTabsFromGroups, workspaceDriver]);

  const applyWorkspaceEditReadFile = useCallback(async (path) => {
    const relPath = String(path || '').trim();
    if (!workspaceDriver || !relPath) return { exists: false, content: '' };
    const res = await workspaceDriver.readFile(relPath, { allowMissing: true });
    const exists = res?.exists !== false;
    return { exists, content: String(res?.content ?? '') };
  }, [workspaceDriver]);

  const applyWorkspaceEditWriteFile = useCallback(async (path, content) => {
    const relPath = String(path || '').trim();
    if (!workspaceDriver || !relPath) return false;
    const nextContent = String(content ?? '');
    await workspaceDriver.writeFile(relPath, nextContent, { createDirectories: true, notifyCreate: false });
    setWorkspaceState((prevRaw) => {
      const prev = syncLegacyTabsFromGroups(prevRaw);
      const prevFiles = Array.isArray(prev.files) ? prev.files : [];
      const hasEntry = prevFiles.some((f) => f && f.path === relPath);
      const nextFiles = hasEntry
        ? prevFiles.map((f) => (f && f.path === relPath ? { ...f, content: nextContent, dirty: false } : f))
        : [...prevFiles, { path: relPath, content: nextContent, truncated: false, updated: false, dirty: false }];
      return syncLegacyTabsFromGroups({ ...prev, files: nextFiles });
    });
    setWorkspaceBindingStatus('ready');
    return true;
  }, [syncLegacyTabsFromGroups, workspaceDriver]);

  const applyWorkspaceEditRenamePath = useCallback(async (oldPath, nextPath) => {
    const from = String(oldPath || '').trim();
    const to = String(nextPath || '').trim();
    if (!workspaceDriver || !from || !to || from === to) return false;
    let content = '';
    try {
      const data = await workspaceDriver.readFile(from, { allowMissing: true });
      if (data?.exists !== false) content = String(data?.content ?? '');
    } catch {
    }

    await workspaceDriver.writeFile(to, content, { createDirectories: true, notifyCreate: false });
    try {
      await workspaceDriver.deletePath(from, { notify: false });
    } catch {
      await workspaceDriver.deletePath(from);
    }

    setWorkspaceState((prevRaw) => {
      const prev = syncLegacyTabsFromGroups(prevRaw);
      const prevFiles = Array.isArray(prev.files) ? prev.files : [];
      const existing = prevFiles.find((f) => f && f.path === from) || null;
      const nextFiles = existing
        ? prevFiles.map((f) => (f && f.path === from ? { ...f, path: to } : f))
        : [...prevFiles, { path: to, content, truncated: false, updated: false, dirty: false }];

      const { groups, activeGroupId } = ensureEditorGroups(prev);
      const nextGroups = groups.map((g) => {
        const openTabs = (g.openTabs || []).map((t) => (t === from ? to : t));
        const activeFile = g.activeFile === from ? to : g.activeFile;
        const previewTab = g.previewTab === from ? to : g.previewTab;
        return { ...g, openTabs, activeFile, previewTab };
      });
      const nextActiveGroupId = nextGroups.some((g) => g.id === activeGroupId) ? activeGroupId : (nextGroups[0]?.id || 'group-1');

      const tabMeta = prev.tabMeta && typeof prev.tabMeta === 'object' ? prev.tabMeta : {};
      const nextTabMeta = { ...tabMeta };
      Object.keys(nextTabMeta).forEach((k) => {
        if (!k.endsWith(`::${from}`)) return;
        const v = nextTabMeta[k];
        delete nextTabMeta[k];
        const nk = k.replace(`::${from}`, `::${to}`);
        nextTabMeta[nk] = v;
      });

      const nextHistory = Array.isArray(prev.tabHistory)
        ? prev.tabHistory.map((p) => (p === from ? to : p))
        : prev.tabHistory;

      return syncLegacyTabsFromGroups({
        ...prev,
        files: nextFiles,
        editorGroups: nextGroups,
        activeGroupId: nextActiveGroupId,
        tabMeta: nextTabMeta,
        tabHistory: nextHistory,
      });
    });

    return true;
  }, [ensureEditorGroups, syncLegacyTabsFromGroups, workspaceDriver]);

  const applyWorkspaceEditDeletePath = useCallback(async (path) => {
    const relPath = String(path || '').trim();
    if (!workspaceDriver || !relPath) return false;
    try {
      await workspaceDriver.deletePath(relPath, { notify: false });
    } catch {
      await workspaceDriver.deletePath(relPath);
    }
    setWorkspaceState((prevRaw) => {
      const prev = syncLegacyTabsFromGroups(prevRaw);
      const { groups, activeGroupId } = ensureEditorGroups(prev);
      let nextGroups = groups.map((g) => {
        const openTabs = (g.openTabs || []).filter((t) => t !== relPath);
        const activeFile = g.activeFile === relPath ? (openTabs[openTabs.length - 1] || '') : g.activeFile;
        const previewTab = g.previewTab === relPath ? '' : g.previewTab;
        return { ...g, openTabs, activeFile, previewTab };
      });
      if (nextGroups.length > 1) nextGroups = nextGroups.filter((g) => g.openTabs.length > 0);
      const nextActiveGroupId = nextGroups.some((g) => g.id === activeGroupId) ? activeGroupId : (nextGroups[0]?.id || 'group-1');

      const tabMeta = prev.tabMeta && typeof prev.tabMeta === 'object' ? prev.tabMeta : {};
      const nextTabMeta = { ...tabMeta };
      Object.keys(nextTabMeta).forEach((k) => {
        if (k.endsWith(`::${relPath}`)) delete nextTabMeta[k];
      });

      const nextHistory = Array.isArray(prev.tabHistory)
        ? prev.tabHistory.filter((p) => p !== relPath)
        : prev.tabHistory;

      return syncLegacyTabsFromGroups({
        ...prev,
        files: (prev.files || []).filter((f) => f.path !== relPath),
        editorGroups: nextGroups,
        activeGroupId: nextActiveGroupId,
        tabMeta: nextTabMeta,
        tabHistory: nextHistory,
      });
    });
    return true;
  }, [ensureEditorGroups, syncLegacyTabsFromGroups, workspaceDriver]);

  const openDiffTabInWorkspace = useCallback((diff) => {
    if (!diff) return;
    const index = diffTabCounterRef.current++;
    const idBase = diff.diff_id !== undefined ? String(diff.diff_id) : (diff.id !== undefined ? String(diff.id) : (diff.path || 'diff'));
    const tabId = `${DIFF_TAB_PREFIX}${idBase}#${index}`;
    setDiffTabs((prev) => ({ ...prev, [tabId]: diff }));
    setWorkspaceState((prev) => {
      const exists = prev.openTabs.includes(tabId);
      const nextTabs = exists ? prev.openTabs : [...prev.openTabs, tabId];
      return { ...prev, openTabs: nextTabs, activeFile: tabId, view: 'code' };
    });
  }, []);

  useEffect(() => {
    if (!workspaceDriver) return;
    if (workspaceBindingStatus !== 'ready') return;
    const pending = pendingOpenFileRef.current;
    if (!pending?.absPath) return;

    const rootAbs = (backendWorkspaceRoot || workspaceRootLabel || pending.expectedRoot || '').trim();
    const rel = pathRelativeToRoot(rootAbs, pending.absPath);
    clearPendingOpenFile();
    if (!rel) return;
    openFile(rel);
  }, [backendWorkspaceRoot, clearPendingOpenFile, openFile, workspaceBindingStatus, workspaceDriver, workspaceRootLabel]);

  useEffect(() => {
    if (workspaceBindingStatus !== 'ready') return;
    const pending = pendingDeepLinkRef.current;
    const openFileParam = String(pending?.openFile || '').trim();
    if (!openFileParam) return;
    pendingDeepLinkRef.current = { openFile: '', openMode: '', workspaceFsPath: '' };

    if (isAbsolutePath(openFileParam)) {
      pendingOpenFileRef.current = { absPath: openFileParam, expectedRoot: String(pending?.workspaceFsPath || '') };
    } else {
      openFile(openFileParam, { mode: 'persistent' });
    }

    try {
      const url = new URL(window.location.href);
      url.search = '';
      window.history.replaceState({}, '', url.toString());
    } catch {
    }
  }, [openFile, workspaceBindingStatus]);

  const workspaceProps = useMemo(() => ({
    files: workspaceState.files,
    fileTree: workspaceState.fileTree,
    openTabs: workspaceState.openTabs,
    workspaceRoots: workspaceState.workspaceRoots,
  }), [workspaceState.fileTree, workspaceState.files, workspaceState.openTabs, workspaceState.workspaceRoots]);

  useEffect(() => {
    const label = setWorkspaceRootLabelExternal ? setWorkspaceRootLabelExternal() : '';
    if (label) setWorkspaceRootLabel(label);
  }, [setWorkspaceRootLabelExternal]);

  return {
    workspaceState,
    setWorkspaceState,
    diffTabs,
    setDiffTabs,
    workspaceLoading,
    setWorkspaceLoading,
    workspaceDriver,
    setWorkspaceDriver,
    workspaceBindingStatus,
    setWorkspaceBindingStatus,
    workspaceBindingError,
    setWorkspaceBindingError,
    workspaceRootLabel,
    setWorkspaceRootLabel,
    backendWorkspaceRoot,
    setBackendWorkspaceRoot,
    backendWorkspaceId,
    setBackendWorkspaceId,
    activeWorkspaces,
    setActiveWorkspaces,
    hotReloadToken,
    setHotReloadToken,
    backendWorkspaceRootRef,
    pendingOpenFileRef,
    pendingDeepLinkRef,
    pendingStartActionRef,
    pendingTemplateRef,
    clearPendingOpenFile,
    clearPendingStartAction,
    clearPendingTemplate,
    openFile,
    closeFile,
    handleFileChange,
    handleActiveEditorChange,
    handleActiveGroupChange,
    toggleGroupLocked,
    togglePreviewEditorEnabled,
    toggleTabPinned,
    toggleTabKeptOpen,
    closeEditors,
    splitEditor,
    handleTabReorder,
    handleRefreshPreview,
    syncWorkspaceFromDisk,
    handleAddFile,
    handleAddFolder,
    handleNewFileFromWelcome,
    createTemplateProjectInWorkspace,
    openBackendWorkspace,
    handleDeletePath,
    handleRenamePath,
    applyWorkspaceEditCreateFile,
    applyWorkspaceEditReadFile,
    applyWorkspaceEditWriteFile,
    applyWorkspaceEditRenamePath,
    applyWorkspaceEditDeletePath,
    handleGlobalSearch,
    openDiffTabInWorkspace,
    workspaceProps,
    setWorkspaceRootLabelExternal,
  };
}
