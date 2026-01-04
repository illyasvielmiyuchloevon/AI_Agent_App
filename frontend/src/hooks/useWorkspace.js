import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackendWorkspaceDriver } from '../utils/backendWorkspaceDriver';
import { WELCOME_TAB_PATH } from '../workbench/constants';
import {
  DIFF_TAB_PREFIX,
  EXTENSIONS_TAB_PREFIX,
  SETTINGS_TAB_PATH,
  TERMINAL_EDITOR_TAB_PATH,
  TERMINAL_SETTINGS_TAB_PATH,
  initialWorkspaceState,
} from '../utils/appDefaults';
import {
  isAbsolutePath,
  isSpecialTabPath,
  pathDirname,
  pathJoinAbs,
  pathRelativeToRoot,
  shouldHidePath,
} from '../utils/appAlgorithms';
import { useWorkspaceBinding } from './useWorkspaceBinding';
import { useWorkspaceFiles } from './useWorkspaceFiles';
import { useWorkspaceDiffTabs } from './useWorkspaceDiffTabs';
import { useWorkspaceFileOps } from './useWorkspaceFileOps';
import { workspaceTabsReducer } from '../workbench/workspace/workspaceTabsReducer';
import { workspaceGroupsReducer } from '../workbench/workspace/workspaceGroupsReducer';

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

  const pendingOpenFileRef = useRef({ absPath: '', expectedRoot: '' });
  const pendingDeepLinkRef = useRef({ openFile: '', openMode: '', workspaceFsPath: '' });
  const pendingStartActionRef = useRef({ type: null });
  const pendingTemplateRef = useRef(null);

  const syncLockRef = useRef(false);
  const lastSyncRef = useRef(0);

  const clearPendingOpenFile = useCallback(() => {
    pendingOpenFileRef.current = { absPath: '', expectedRoot: '' };
  }, []);

  const clearPendingStartAction = useCallback(() => {
    pendingStartActionRef.current = { type: null };
  }, []);

  const clearPendingTemplate = useCallback(() => {
    pendingTemplateRef.current = null;
  }, []);

  const { backendWorkspaceRootRef, openBackendWorkspace } = useWorkspaceBinding({
    lspService,
    getProjectConfigLsp,
    workspaceBindingStatus,
    backendWorkspaceId,
    backendWorkspaceRoot,
    setWorkspaceBindingStatus,
    setWorkspaceBindingError,
    setBackendWorkspaceRoot,
    setBackendWorkspaceId,
    config,
    toolSettings,
    getBackendConfig,
    setProjectConfig,
  });

  const { loadFileContent, scheduleSave } = useWorkspaceFiles({
    workspaceDriver,
    lspService,
    setWorkspaceState,
    setWorkspaceBindingStatus,
    setWorkspaceBindingError,
    setHotReloadToken,
  });

  const { openDiffTabInWorkspace, cleanupDiffTab } = useWorkspaceDiffTabs({
    setDiffTabs,
    setWorkspaceState,
  });

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
          extensionsTabPrefix: EXTENSIONS_TAB_PREFIX,
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
    const isSpecialTab = isSpecialTabPath(filePath, {
      settingsTabPath: SETTINGS_TAB_PATH,
      terminalSettingsTabPath: TERMINAL_SETTINGS_TAB_PATH,
      terminalEditorTabPath: TERMINAL_EDITOR_TAB_PATH,
      welcomeTabPath: WELCOME_TAB_PATH,
      extensionsTabPrefix: EXTENSIONS_TAB_PREFIX,
      diffTabPrefix: DIFF_TAB_PREFIX,
    });

    if (!isSpecialTab && !workspaceDriver) {
      alert('请先选择项目文件夹');
      return;
    }

    setWorkspaceState((prevRaw) => workspaceTabsReducer(prevRaw, { type: 'openFile', path: filePath, options }, {
      ensureEditorGroups,
      syncLegacyTabsFromGroups,
      tabMetaKey,
    }));

    if (!isSpecialTab) loadFileContent(filePath);
  }, [ensureEditorGroups, loadFileContent, syncLegacyTabsFromGroups, tabMetaKey, workspaceDriver]);

  useEffect(() => {
    const ideBus = globalThis?.window?.electronAPI?.ideBus || null;
    if (!ideBus?.onNotification) return undefined;

    const fileUriToFsPath = (uri) => {
      const raw = String(uri || '').trim();
      if (!raw) return '';
      if (!raw.startsWith('file:')) return raw;
      try {
        const u = new URL(raw);
        let p = decodeURIComponent(u.pathname || '');
        if (/^\/[a-zA-Z]:\//.test(p)) p = p.slice(1);
        if (backendWorkspaceRoot && backendWorkspaceRoot.includes('\\')) p = p.replace(/\//g, '\\');
        return p;
      } catch {
        return raw;
      }
    };

    const normalizeOpenPath = (uriOrPath) => {
      const raw = String(uriOrPath || '').trim();
      if (!raw) return '';
      if (raw.startsWith('__system__/')) return raw;
      if (raw.startsWith('__diff__/')) return raw;
      const fsPath = fileUriToFsPath(raw);
      if (backendWorkspaceRoot && fsPath && (fsPath.includes('\\') || fsPath.includes('/'))) {
        const rel = pathRelativeToRoot(backendWorkspaceRoot, fsPath);
        if (rel) return rel;
      }
      return raw;
    };

    const disposeShowTextDocument = ideBus.onNotification('window/showTextDocument', (payload) => {
      const uriOrPath = payload?.uriOrPath != null ? payload.uriOrPath : (payload?.uri || payload?.path || payload?.fileName);
      const options = payload?.options && typeof payload.options === 'object' ? payload.options : {};
      const tabPath = normalizeOpenPath(uriOrPath);
      if (!tabPath) return;
      openFile(tabPath, { mode: options.preview ? 'preview' : 'persistent' });
    });

    const shouldSync = (payload) => String(payload?.source || '') === 'extensionHost';
    const disposeCreated = ideBus.onNotification('workspace/didCreateFiles', (payload) => {
      if (!shouldSync(payload)) return;
      void syncWorkspaceFromDisk?.({ includeContent: false, highlight: false });
    });
    const disposeDeleted = ideBus.onNotification('workspace/didDeleteFiles', (payload) => {
      if (!shouldSync(payload)) return;
      void syncWorkspaceFromDisk?.({ includeContent: false, highlight: false });
    });
    const disposeRenamed = ideBus.onNotification('workspace/didRenameFiles', (payload) => {
      if (!shouldSync(payload)) return;
      void syncWorkspaceFromDisk?.({ includeContent: false, highlight: false });
    });

    return () => {
      try { disposeShowTextDocument?.(); } catch {}
      try { disposeCreated?.(); } catch {}
      try { disposeDeleted?.(); } catch {}
      try { disposeRenamed?.(); } catch {}
    };
  }, [backendWorkspaceRoot, openFile, syncWorkspaceFromDisk]);

  const closeFile = useCallback((path, options = {}) => {
    const tabPath = String(path || '');
    if (!tabPath) return;

    setWorkspaceState((prevRaw) => workspaceTabsReducer(prevRaw, { type: 'closeFile', path: tabPath, options }, {
      ensureEditorGroups,
      syncLegacyTabsFromGroups,
      tabMetaKey,
    }));

    cleanupDiffTab(tabPath);
  }, [cleanupDiffTab, ensureEditorGroups, syncLegacyTabsFromGroups, tabMetaKey]);

  const handleFileChange = useCallback((path, content, options = {}) => {
    const tabPath = String(path || '');
    if (!tabPath) return;

    setWorkspaceState((prevRaw) => workspaceTabsReducer(prevRaw, { type: 'fileChanged', path: tabPath, content, options }, {
      ensureEditorGroups,
      syncLegacyTabsFromGroups,
      tabMetaKey,
    }));

    scheduleSave(tabPath, content);
  }, [ensureEditorGroups, scheduleSave, syncLegacyTabsFromGroups, tabMetaKey]);

  const handleActiveEditorChange = useCallback((path, options = {}) => {
    const tabPath = String(path || '');
    if (!tabPath) return;
    setWorkspaceState((prevRaw) => workspaceTabsReducer(prevRaw, { type: 'activeEditorChange', path: tabPath, options }, {
      ensureEditorGroups,
      syncLegacyTabsFromGroups,
      tabMetaKey,
    }));
  }, [ensureEditorGroups, syncLegacyTabsFromGroups, tabMetaKey]);

  const handleActiveGroupChange = useCallback((groupId) => {
    const nextId = String(groupId || '').trim();
    if (!nextId) return;
    setWorkspaceState((prevRaw) => {
      return workspaceGroupsReducer(prevRaw, { type: 'activeGroupChange', groupId: nextId }, {
        ensureEditorGroups,
        syncLegacyTabsFromGroups,
      });
    });
  }, [ensureEditorGroups, syncLegacyTabsFromGroups]);

  const toggleGroupLocked = useCallback((groupId) => {
    const targetId = String(groupId || '').trim();
    if (!targetId) return;
    setWorkspaceState((prevRaw) => {
      return workspaceGroupsReducer(prevRaw, { type: 'toggleGroupLocked', groupId: targetId }, {
        ensureEditorGroups,
        syncLegacyTabsFromGroups,
        tabMetaKey,
      });
    });
  }, [ensureEditorGroups, syncLegacyTabsFromGroups, tabMetaKey]);

  const togglePreviewEditorEnabled = useCallback(() => {
    setWorkspaceState((prevRaw) => workspaceTabsReducer(prevRaw, { type: 'togglePreviewEditorEnabled' }, {
      ensureEditorGroups,
      syncLegacyTabsFromGroups,
      tabMetaKey,
    }));
  }, [ensureEditorGroups, syncLegacyTabsFromGroups, tabMetaKey]);

  const toggleTabPinned = useCallback((groupId, tabPath) => {
    const gid = String(groupId || '').trim();
    const path = String(tabPath || '');
    if (!gid || !path) return;
    setWorkspaceState((prevRaw) => workspaceTabsReducer(prevRaw, { type: 'toggleTabPinned', groupId: gid, tabPath: path }, {
      ensureEditorGroups,
      syncLegacyTabsFromGroups,
      tabMetaKey,
    }));
  }, [ensureEditorGroups, syncLegacyTabsFromGroups, tabMetaKey]);

  const toggleTabKeptOpen = useCallback((groupId, tabPath) => {
    const gid = String(groupId || '').trim();
    const path = String(tabPath || '');
    if (!gid || !path) return;
    setWorkspaceState((prevRaw) => workspaceTabsReducer(prevRaw, { type: 'toggleTabKeptOpen', groupId: gid, tabPath: path }, {
      ensureEditorGroups,
      syncLegacyTabsFromGroups,
      tabMetaKey,
    }));
  }, [ensureEditorGroups, syncLegacyTabsFromGroups, tabMetaKey]);

  const splitEditor = useCallback(({ direction = 'right', groupId, tabPath, move = false } = {}) => {
    const dir = direction === 'down' ? 'down' : 'right';
    setWorkspaceState((prevRaw) => {
      return workspaceGroupsReducer(prevRaw, { type: 'splitEditor', direction: dir, groupId, tabPath, move }, {
        ensureEditorGroups,
        syncLegacyTabsFromGroups,
        tabMetaKey,
        createEditorGroupId,
      });
    });
  }, [createEditorGroupId, ensureEditorGroups, syncLegacyTabsFromGroups, tabMetaKey]);

  const closeEditors = useCallback((action, payload = {}) => {
    setWorkspaceState((prevRaw) => workspaceTabsReducer(prevRaw, { type: 'closeEditors', action, payload }, {
      ensureEditorGroups,
      syncLegacyTabsFromGroups,
      tabMetaKey,
    }));
  }, [ensureEditorGroups, syncLegacyTabsFromGroups, tabMetaKey]);

  const handleTabReorder = useCallback((from, to, options = {}) => {
    setWorkspaceState((prevRaw) => workspaceTabsReducer(prevRaw, { type: 'reorderTabs', from, to, options }, {
      ensureEditorGroups,
      syncLegacyTabsFromGroups,
      tabMetaKey,
    }));
  }, [ensureEditorGroups, syncLegacyTabsFromGroups, tabMetaKey]);

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

  const {
    handleAddFile,
    handleAddFolder,
    handleDeletePath,
    handleRenamePath,
    applyWorkspaceEditCreateFile,
    applyWorkspaceEditReadFile,
    applyWorkspaceEditWriteFile,
    applyWorkspaceEditRenamePath,
    applyWorkspaceEditDeletePath,
  } = useWorkspaceFileOps({
    workspaceDriver,
    lspService,
    setInputModal,
    openFile,
    syncWorkspaceFromDisk,
    setWorkspaceState,
    ensureEditorGroups,
    syncLegacyTabsFromGroups,
    setWorkspaceBindingStatus,
  });

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
    const hasCreateHook = !!(workspaceDriver?.fileOpsHooks
      && typeof workspaceDriver.fileOpsHooks === 'object'
      && typeof workspaceDriver.fileOpsHooks.willCreateFiles === 'function'
      && typeof workspaceDriver.fileOpsHooks.didCreateFiles === 'function');
    if (!hasCreateHook) {
      try { await lspService?.willCreateFiles?.(createdPaths); } catch {}
    }
    await workspaceDriver.createFolder(folder);
    for (const [rel, content] of Object.entries(spec.files || {})) {
      await workspaceDriver.writeFile(`${folder}/${rel}`, String(content || ''), { createDirectories: true });
    }
    if (!hasCreateHook) {
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
