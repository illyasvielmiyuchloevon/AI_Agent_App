import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import AppShell from './AppShell';
import { LocalWorkspaceDriver } from './utils/localWorkspaceDriver';
import { BackendWorkspaceDriver } from './utils/backendWorkspaceDriver';
import { GitDriver } from './utils/gitDriver';
import { WELCOME_TAB_PATH } from './workbench/constants';
import { useWorkbenchStateMachine, WorkbenchStates } from './workbench/workbenchStateMachine';
import { createWorkspaceServices } from './workbench/workspace/workspaceServices';
import { createWorkspaceController } from './workbench/workspace/workspaceController';
import { createAiEngineClient, readTextResponseBody } from './utils/aiEngineClient';
import { lspService } from './workbench/services/lspService';
import { usePreferences } from './hooks/usePreferences';
import { useLayoutResize } from './hooks/useLayoutResize';
import { useCommandPalette } from './hooks/useCommandPalette';
import { useGit } from './hooks/useGit';
import { useSessions } from './hooks/useSessions';
import { useWorkspace } from './hooks/useWorkspace';
import {
  DEBUG_SEPARATORS,
  DEFAULT_PROJECT_CONFIG,
  DIFF_TAB_PREFIX,
  MODE_OPTIONS,
  SETTINGS_TAB_PATH,
  TERMINAL_EDITOR_TAB_PATH,
  TERMINAL_SETTINGS_TAB_PATH,
  buildBackendConfigPayload as buildBackendConfigPayloadUtil,
  initialWorkspaceState,
  mapFlatConfigToState,
  normalizeGlobalConfig,
  normalizeProjectConfig as normalizeProjectConfigUtil,
} from './utils/appDefaults';
import {
  detectSystemTheme,
  persistGlobalConfig,
  persistLayoutPrefs,
  readGlobalConfig,
  readLayoutPrefs,
  readStoredTheme,
} from './utils/appPersistence';
import {
  isAbsolutePath,
  isFileUnderRoot,
  isMissingPathError,
  pathDirname,
  pathJoinAbs,
  pathRelativeToRoot,
  shouldHidePath,
} from './utils/appAlgorithms';

function App() {
  const {
    language,
    handleLanguageChange,
    uiDisplayPreferences,
    toolSettings,
    setToolSettings,
    mergeToolSettings,
    theme,
    setTheme,
    handleChangeDisplayPreference,
    handleThemeModeChange,
    handleToggleTheme,
    globalConfigHydratedRef,
    userThemePreferenceRef,
  } = usePreferences();

  // --- Config State ---
  const [projectConfig, setProjectConfig] = useState(DEFAULT_PROJECT_CONFIG);
  const workbench = useWorkbenchStateMachine();
  const workspaceServices = useMemo(() => createWorkspaceServices(), []);
  const {
    model: workbenchModel,
    boot: workbenchBoot,
    syncFromLegacy: syncWorkbenchFromLegacy,
    openRequested: workbenchOpenRequested,
    closeRequested: workbenchCloseRequested,
  } = workbench;
  const [config, setConfig] = useState(() => {
    const stored = readGlobalConfig();
    return normalizeGlobalConfig(stored);
  });
  const startupFlagsRef = useRef(null);
  if (!startupFlagsRef.current) {
    startupFlagsRef.current = {
      openDevToolsOnStart: config?.features?.openDevToolsOnStart !== false,
      openWelcomeOnStart: config?.features?.openWelcomeOnStart === true,
      loadRagOnStart: config?.features?.loadRagOnStart !== false,
    };
  }
  const getBackendConfig = useCallback(() => {
    return buildBackendConfigPayloadUtil(config);
  }, [config]);
  const [showConfig, setShowConfig] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [apiStatus, setApiStatus] = useState('unknown');
  const [apiMessage, setApiMessage] = useState('');
  const [projectMeta, setProjectMeta] = useState({ id: null, name: '', pathLabel: '' });
  const [recentProjects, setRecentProjects] = useState([]);
  const workspaceControllerRef = useRef(null);
  const workspaceInitializedRef = useRef(false);
  const configHydratedRef = useRef(false);
  const configSaveTimerRef = useRef(null);

  // --- Modal State ---
  const [inputModal, setInputModal] = useState({ isOpen: false, title: '', label: '', defaultValue: '', placeholder: '', confirmText: '确定', icon: 'codicon-edit', onConfirm: () => {}, onClose: () => {} });
  const [diffModal, setDiffModal] = useState(null);
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [helpModal, setHelpModal] = useState({ isOpen: false, type: '', appInfo: null });
  const [configFullscreen, setConfigFullscreen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [editorAiInvoker, setEditorAiInvoker] = useState(null);

  const handleSelectWorkspace = useCallback(async (projectId = null) => {
    await workspaceControllerRef.current?.openWorkspace?.(projectId);
  }, []);

  const {
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
  } = useWorkspace({
    lspService,
    workspaceControllerRef,
    handleSelectWorkspace,
    setInputModal,
    getProjectConfigLsp: () => projectConfig?.lsp || {},
    config,
    toolSettings,
    getBackendConfig,
    setProjectConfig,
  });

  const {
    sidebarWidth,
    setSidebarWidth,
    sidebarCollapsed,
    setSidebarCollapsed,
    activeSidebarPanel,
    setActiveSidebarPanel,
    explorerReveal,
    lastSidebarWidthRef,
    sidebarResizerGhostRef,
    showResizeOverlay,
    activeResizeTarget,
    startResize,
    handleMouseMove,
    stopResize,
    handleSidebarTabChange,
    sidebarStyle,
  } = useLayoutResize({ debugSeparators: DEBUG_SEPARATORS });

  const projectReady = !!workspaceDriver;
  const backendBound = !!backendWorkspaceRoot && workspaceBindingStatus === 'ready';
  const hasElectronPicker = () =>
      typeof window !== 'undefined' && (!!window.electronAPI?.workspace?.pickFolder || !!window.electronAPI?.openFolder);
  const projectHeaders = useMemo(
      () => (backendWorkspaceRoot
        ? {
            'X-Workspace-Root': backendWorkspaceRoot,
            'X-Rag-Load-On-Start': (config?.features?.loadRagOnStart !== false) ? '1' : '0',
          }
        : {}),
      [backendWorkspaceRoot, config?.features?.loadRagOnStart]
  );

  const resolveApiUrl = useCallback((url) => {
      if (typeof window === 'undefined') return url;
      if (typeof url !== 'string') return url;
      if (!url.startsWith('/api/')) return url;
      const proto = window.location.protocol;
      const origin = window.location.origin;
      if (proto === 'file:' || origin === 'null') {
          return `http://127.0.0.1:8000${url.replace(/^\/api/, '')}`;
      }
      return url;
  }, []);

  const projectFetch = useCallback((url, options = {}) => {
      const headers = { ...projectHeaders, ...(options.headers || {}) };
      return fetch(resolveApiUrl(url), { ...options, headers });
  }, [projectHeaders, resolveApiUrl]);

  const aiEngineClient = useMemo(() => createAiEngineClient({ fetch: projectFetch }), [projectFetch]);

  const normalizeProjectConfig = useCallback((raw = {}) => normalizeProjectConfigUtil(raw, {
      mergeToolSettings,
      projectMetaName: projectMeta.name,
      projectMetaPathLabel: projectMeta.pathLabel,
      backendWorkspaceId,
  }), [backendWorkspaceId, mergeToolSettings, projectMeta.name, projectMeta.pathLabel]);

  const applyBackendConfigSnapshot = useCallback((snapshot = {}) => {
      const mapped = mapFlatConfigToState(snapshot, {
          provider: config.provider,
          default_models: config.default_models,
          routing: config.routing,
          embedding_options: config.embedding_options,
          openai: config.openai,
          anthropic: config.anthropic,
          openrouter: config.openrouter,
          xai: config.xai,
          ollama: config.ollama,
          lmstudio: config.lmstudio,
          llamacpp: config.llamacpp,
      });
      setConfig((prev) => ({
          ...prev,
          provider: mapped.provider,
          default_models: { ...(prev.default_models || {}), ...(mapped.default_models || {}) },
          routing: mapped.routing || prev.routing,
          embedding_options: (mapped.embedding_options && typeof mapped.embedding_options === 'object') ? mapped.embedding_options : prev.embedding_options,
          openai: { ...prev.openai, ...mapped.openai },
          anthropic: { ...prev.anthropic, ...mapped.anthropic },
          openrouter: { ...prev.openrouter, ...mapped.openrouter },
          xai: { ...prev.xai, ...mapped.xai },
          ollama: { ...prev.ollama, ...mapped.ollama },
          lmstudio: { ...prev.lmstudio, ...mapped.lmstudio },
          llamacpp: { ...prev.llamacpp, ...mapped.llamacpp }
      }));
      setProjectConfig((prev) => ({
          ...prev,
          provider: mapped.provider,
          default_models: { ...(prev.default_models || {}), ...(mapped.default_models || {}) },
          routing: mapped.routing || prev.routing,
          embedding_options: (mapped.embedding_options && typeof mapped.embedding_options === 'object') ? mapped.embedding_options : prev.embedding_options,
          openai: { ...prev.openai, ...mapped.openai },
          anthropic: { ...prev.anthropic, ...mapped.anthropic },
          openrouter: { ...prev.openrouter, ...mapped.openrouter },
          xai: { ...prev.xai, ...mapped.xai },
          ollama: { ...prev.ollama, ...mapped.ollama },
          lmstudio: { ...prev.lmstudio, ...mapped.lmstudio },
          llamacpp: { ...prev.llamacpp, ...mapped.llamacpp }
      }));
      if (mapped[mapped.provider]?.api_key) {
          setConfigured(true);
      }
      return mapped;
  }, [config]);

  const fetchPersistedBackendConfig = useCallback(async ({ silent = false } = {}) => {
      // Backend config persistence is deprecated in favor of local file config (.aichat/config.json)
      return null;
  }, []);

  const checkApiStatus = async () => {
      setApiStatus('checking');
      setApiMessage('Checking connection...');
      try {
          const body = getBackendConfig();
          const data = await aiEngineClient.health(body);
          setApiStatus(data.ok ? 'ok' : 'error');
          setApiMessage(data.ok ? 'Connected' : (data.detail || 'Health check failed'));
      } catch (err) {
          setApiStatus('error');
          setApiMessage(`Network Error: ${err.message}`);
      }
  };

  const keybindingsRef = useRef({});
  useEffect(() => {
      keybindingsRef.current = (config?.keybindings && typeof config.keybindings === 'object') ? config.keybindings : {};
  }, [config?.keybindings]);

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
      if (pendingDeepLinkRef.current?.terminalWindow) return;

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
  }, [config?.features?.openDevToolsOnStart]);

  const activeGroupIdRef = useRef('');
  const editorGroupsRef = useRef([]);
  useEffect(() => {
      activeGroupIdRef.current = String(workspaceState?.activeGroupId || 'group-1');
      editorGroupsRef.current = Array.isArray(workspaceState?.editorGroups) ? workspaceState.editorGroups : [];
  }, [workspaceState?.activeGroupId, workspaceState?.editorGroups]);

  const {
      showCommandPalette,
      commandPaletteInitialQuery,
      commandPaletteContext,
      openCommandPalette,
      closeCommandPalette,
  } = useCommandPalette({
      keybindingsRef,
      activeGroupIdRef,
      editorGroupsRef,
      specialTabs: [WELCOME_TAB_PATH, SETTINGS_TAB_PATH, TERMINAL_SETTINGS_TAB_PATH, TERMINAL_EDITOR_TAB_PATH],
      diffTabPrefix: DIFF_TAB_PREFIX,
  });

  useEffect(() => {
      const onKeyDown = (e) => {
          const tag = String(e.target?.tagName || '').toUpperCase();
          const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable;
          const inMonaco = !!e.target?.closest?.('.monaco-editor');
          if (isEditable && !inMonaco) return;

          const normalizeShortcut = (value) => {
              const raw = String(value || '').trim();
              if (!raw) return '';
              const parts = raw.split('+').map((p) => p.trim()).filter(Boolean);
              if (!parts.length) return '';
              let hasCtrl = false;
              let hasAlt = false;
              let hasShift = false;
              let key = '';
              parts.forEach((p) => {
                  const t = p.toLowerCase();
                  if (t === 'ctrl' || t === 'control' || t === 'cmd' || t === 'command' || t === 'meta') hasCtrl = true;
                  else if (t === 'alt' || t === 'option') hasAlt = true;
                  else if (t === 'shift') hasShift = true;
                  else key = p;
              });
              const normKey = String(key || '').trim();
              if (!normKey) return '';
              const upperKey = normKey.length === 1 ? normKey.toUpperCase() : normKey;
              const out = [];
              if (hasCtrl) out.push('Ctrl');
              if (hasAlt) out.push('Alt');
              if (hasShift) out.push('Shift');
              out.push(upperKey);
              return out.join('+');
          };

          const eventToShortcut = (evt) => {
              const k = String(evt.key || '');
              const lower = k.toLowerCase();
              if (lower === 'control' || lower === 'meta' || lower === 'shift' || lower === 'alt') return '';

              const mods = [];
              if (evt.metaKey || evt.ctrlKey) mods.push('Ctrl');
              if (evt.altKey) mods.push('Alt');
              if (evt.shiftKey) mods.push('Shift');
              if (!mods.length) return '';

              let keyToken = '';
              if (k.length === 1) keyToken = k.toUpperCase();
              else if (lower === 'escape' || lower === 'esc') keyToken = 'Escape';
              else if (lower === 'enter') keyToken = 'Enter';
              else if (lower === 'tab') keyToken = 'Tab';
              else if (k === ',') keyToken = ',';
              else if (k === '.') keyToken = '.';
              else if (/^f\d{1,2}$/i.test(k)) keyToken = k.toUpperCase();
              else keyToken = k;

              return normalizeShortcut([...mods, keyToken].join('+'));
          };

          const matchShortcut = (evt, shortcut) => {
              const expected = normalizeShortcut(shortcut);
              if (!expected) return false;
              const got = eventToShortcut(evt);
              return !!got && got === expected;
          };

          if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.altKey && (e.code === 'Backquote' || e.key === '`')) {
              e.preventDefault();
              try { window.dispatchEvent(new CustomEvent('workbench:openTerminalEditor', { detail: {} })); } catch {}
          }

          const kb = keybindingsRef.current || {};
          const toggleConsole = kb['app.toggleConsole'] || DEFAULT_PROJECT_CONFIG.keybindings['app.toggleConsole'];
          if (matchShortcut(e, toggleConsole)) {
              e.preventDefault();
              try { window.electronAPI?.window?.toggleDevTools?.(); } catch {}
          }
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
      const onOpen = (e) => {
          const profile = typeof e?.detail?.profile === 'string' ? String(e.detail.profile || '').trim() : '';
          try {
              const api = typeof window !== 'undefined' ? window.electronAPI : null;
              if (api?.window?.openNewWindow) {
                  api.window.openNewWindow({
                      openFile: TERMINAL_EDITOR_TAB_PATH,
                      openMode: 'persistent',
                      workspaceFsPath: String(backendWorkspaceRootRef.current || backendWorkspaceRoot || ''),
                  }).catch(() => {});
                  return;
              }
          } catch {}
          openFile(TERMINAL_EDITOR_TAB_PATH, { mode: 'persistent' });
          window.setTimeout(() => {
              try { window.dispatchEvent(new CustomEvent('workbench:terminalEditorCreate', { detail: profile ? { profile } : {} })); } catch {}
          }, 0);
      };
      window.addEventListener('workbench:openTerminalEditor', onOpen);
      return () => window.removeEventListener('workbench:openTerminalEditor', onOpen);
  }, []);

  const handleConfigSubmit = async (options = {}) => {
    const { silent = false } = options;
    try {
        // Backend config persistence is deprecated.
        // We now rely on local file persistence via useEffect hook.
        setConfigured(true);
        setProjectConfig((prev) => ({
            ...prev,
            provider: config.provider,
            default_models: { ...(config.default_models || {}) },
            routing: { ...(config.routing || {}) },
            embedding_options: (config.embedding_options && typeof config.embedding_options === 'object') ? config.embedding_options : {},
            openai: { ...config.openai },
            anthropic: { ...config.anthropic },
            openrouter: { ...config.openrouter },
            xai: { ...config.xai },
            ollama: { ...config.ollama },
            lmstudio: { ...config.lmstudio },
            llamacpp: { ...config.llamacpp },
        }));
    } catch (err) {
      console.error(err);
      if (!silent) alert(`Error configuring agent: ${err.message}`);
    }
  };

  const applyStoredConfig = useCallback(async () => {
      // Backend config persistence is deprecated.
      setConfigured(true);
  }, []);

  // --- Workspace helpers ---
  const persistToolSettings = (updater) => {
      setToolSettings((prev) => {
          const next = typeof updater === 'function' ? updater(prev) : updater;
          setProjectConfig((cfg) => ({ ...cfg, toolSettings: next }));
          return next;
      });
  };

  const refreshRecentProjects = useCallback(async () => {
      try {
          const [list, electronRecent] = await Promise.all([
              LocalWorkspaceDriver.listRecent(),
              (async () => {
                  try {
                      const api = typeof window !== 'undefined' ? window.electronAPI?.recent : null;
                      if (!api?.list) return [];
                      const res = await api.list();
                      return res?.ok ? (res.items || []) : [];
                  } catch {
                      return [];
                  }
              })(),
          ]);

          const mergedById = new Map();

          (electronRecent || []).forEach((entry) => {
              if (!entry?.id) return;
              mergedById.set(entry.id, { ...entry });
          });

          (list || []).forEach((proj) => {
              if (!proj?.id) return;
              const existing = mergedById.get(proj.id);
              mergedById.set(proj.id, existing ? { ...proj, ...existing } : { ...proj });
          });

          const merged = Array.from(mergedById.values()).sort((a, b) => (b?.lastOpened || 0) - (a?.lastOpened || 0));
          setRecentProjects(merged);
      } catch {
          setRecentProjects([]);
      }
  }, []);

  useEffect(() => {
      let cancelled = false;
      const load = async () => {
          try {
              const res = await projectFetch('/api/workspaces');
              if (!res.ok) return;
              const data = await res.json();
              if (!Array.isArray(data)) return;
              if (!cancelled) setActiveWorkspaces(data);
          } catch {
          }
      };
      load();
      const timer = setInterval(load, 5000);
      return () => {
          cancelled = true;
          clearInterval(timer);
      };
  }, [projectFetch]);

  const removeRecentProject = useCallback(async (proj) => {
      const id = proj?.id;
      if (!id) return;
      try {
          await LocalWorkspaceDriver.removeRecent(id);
      } catch (err) {
          console.warn('Remove recent (LocalWorkspaceDriver) failed', err);
      }
      try {
          const api = typeof window !== 'undefined' ? window.electronAPI?.recent : null;
          await api?.remove?.(id);
      } catch (err) {
          console.warn('Remove recent (electron) failed', err);
      }
      refreshRecentProjects();
  }, [refreshRecentProjects]);

  const applyConfigToState = useCallback((cfg, driver = null) => {
      setProjectConfig(cfg);
      if (!globalConfigHydratedRef.current) {
          const provider = cfg.provider || DEFAULT_PROJECT_CONFIG.provider;
          setConfig({
              provider,
              default_models: { ...DEFAULT_PROJECT_CONFIG.default_models, ...((cfg.default_models && typeof cfg.default_models === 'object') ? cfg.default_models : {}) },
              routing: (cfg.routing && typeof cfg.routing === 'object') ? cfg.routing : {},
              embedding_options: (cfg.embedding_options && typeof cfg.embedding_options === 'object') ? cfg.embedding_options : {},
              openai: { ...DEFAULT_PROJECT_CONFIG.openai, ...(cfg.openai || {}) },
              anthropic: { ...DEFAULT_PROJECT_CONFIG.anthropic, ...(cfg.anthropic || {}) },
              openrouter: { ...DEFAULT_PROJECT_CONFIG.openrouter, ...(cfg.openrouter || {}) },
              xai: { ...DEFAULT_PROJECT_CONFIG.xai, ...(cfg.xai || {}) },
              ollama: { ...DEFAULT_PROJECT_CONFIG.ollama, ...(cfg.ollama || {}) },
              lmstudio: { ...DEFAULT_PROJECT_CONFIG.lmstudio, ...(cfg.lmstudio || {}) },
              llamacpp: { ...DEFAULT_PROJECT_CONFIG.llamacpp, ...(cfg.llamacpp || {}) }
          });
          setToolSettings((prev) => mergeToolSettings(cfg.toolSettings || prev));
          globalConfigHydratedRef.current = true;
      }
      const effectiveProvider = (config && config.provider) || cfg.provider || DEFAULT_PROJECT_CONFIG.provider;
      const activeConfig = (config && config[config.provider]) || cfg[effectiveProvider] || {};
      setConfigured(!!activeConfig.api_key);
      const storedTheme = readStoredTheme();
      const nextTheme = storedTheme || cfg.theme || detectSystemTheme();
      setTheme(nextTheme);
      if (storedTheme) {
          userThemePreferenceRef.current = true;
      }
      const stored = readLayoutPrefs();
      const nextSidebarWidth = Number(stored.sidebarWidth) || cfg.sidebarWidth || cfg.sessionPanelWidth || DEFAULT_PROJECT_CONFIG.sidebarWidth;
      setSidebarWidth(nextSidebarWidth);
      lastSidebarWidthRef.current = nextSidebarWidth;
      setSidebarCollapsed(false);
      setActiveSidebarPanel((prev) => prev || 'sessions');
      setCurrentMode(cfg.lastMode || DEFAULT_PROJECT_CONFIG.lastMode);
      const initialBackendRoot = isAbsolutePath(cfg.backendRoot) ? cfg.backendRoot : (isAbsolutePath(cfg.projectPath) ? cfg.projectPath : '');
      setBackendWorkspaceRoot(initialBackendRoot);
      setWorkspaceRootLabel(initialBackendRoot || cfg.projectPath || driver?.pathLabel || driver?.rootName || '');
  }, [mergeToolSettings, userThemePreferenceRef, config]);

  const loadProjectConfigFromDisk = useCallback(async (driver) => {
      if (!driver) return normalizeProjectConfig(DEFAULT_PROJECT_CONFIG);
      try {
          const raw = await driver.readFile('.aichat/config.json', { allowMissing: true });
          const parsed = JSON.parse(raw.content || '{}');
          const normalized = normalizeProjectConfig(parsed);
          if (!normalized.projectPath) {
              normalized.projectPath = driver.pathLabel || driver.rootName;
          }
          await driver.writeFile('.aichat/config.json', JSON.stringify(normalized, null, 2), { createDirectories: true });
          if (normalized.projectPath) {
              driver.updatePathLabel(normalized.projectPath).catch(() => {});
          }
          return normalized;
      } catch (err) {
          const fallback = normalizeProjectConfig(DEFAULT_PROJECT_CONFIG);
          if (!fallback.projectPath) {
              fallback.projectPath = driver.pathLabel || driver.rootName;
          }
          try {
              await driver.writeFile('.aichat/config.json', JSON.stringify(fallback, null, 2), { createDirectories: true });
          } catch (writeErr) {
              console.error('Failed to persist default config', writeErr);
          }
          return fallback;
      }
  }, [normalizeProjectConfig]);

  const {
    sessions,
    setSessions,
    currentSessionId,
    setCurrentSessionId,
    messages,
    setMessages,
    toolRuns,
    setToolRuns,
    input,
    setInput,
    taskReview,
    setTaskReview,
    loadingSessions,
    setLoadingSessions,
    currentMode,
    setCurrentMode,
    showLogs,
    setShowLogs,
    logs,
    setLogs,
    abortControllerRef,
    taskSnapshotRef,
    actions: sessionActions,
  } = useSessions({
    projectFetch,
    aiEngineClient,
    getBackendConfig,
    backendWorkspaceRoot,
    workspaceDriver,
    toolSettings,
    sidebarCollapsed,
    setSidebarCollapsed,
    setActiveSidebarPanel,
    setProjectConfig,
    syncWorkspaceFromDisk,
    setWorkspaceState,
    lspService,
  });

  const {
    selectSession,
    createSession,
    deleteSession,
    renameSession,
    handleSend,
    handleStop,
    handleModeChange,
    toggleTaskReview,
    keepTaskFile,
    keepAllTaskFiles,
    keepTaskBlock,
    revertTaskBlock,
    revertTaskFile,
    revertAllTaskFiles,
    resetTaskFile,
    resetTaskBlock,
    setTaskReviewCursor,
  } = sessionActions;

  const hydrateProject = useCallback(async (driver, preferredRoot = '') => {
      if (!driver) return;
      setWorkspaceBindingStatus('checking');
      configHydratedRef.current = false;
      setWorkspaceState({
          ...initialWorkspaceState,
          editorGroups: [{ id: 'group-1', openTabs: [WELCOME_TAB_PATH], activeFile: WELCOME_TAB_PATH, locked: false, previewTab: '' }],
          activeGroupId: 'group-1',
          openTabs: [WELCOME_TAB_PATH],
          activeFile: WELCOME_TAB_PATH,
          view: 'code'
      });
      setSessions([]);
      setMessages([]);
      setToolRuns({});
      setLogs([]);
      setTaskReview({ taskId: null, files: [], status: 'idle', expanded: false });
      taskSnapshotRef.current = null;
      setShowLogs(false);
      setCurrentSessionId(null);
      const cfg = await loadProjectConfigFromDisk(driver);
      setProjectMeta({
          id: driver.projectId,
          name: driver.rootName,
          pathLabel: cfg.projectPath || cfg.backendRoot || driver.pathLabel || driver.rootName
      });
      applyConfigToState(cfg, driver);
      try {
          if (driver?.setFileOperationsHooks && typeof driver.setFileOperationsHooks === 'function') {
              driver.setFileOperationsHooks({
                  willCreateFiles: (paths, options) => lspService.willCreateFiles(paths, options),
                  didCreateFiles: (paths) => lspService.didCreateFiles(paths),
                  willRenameFiles: (pairs, options) => lspService.willRenameFiles(pairs, options),
                  didRenameFiles: (pairs) => lspService.didRenameFiles(pairs),
                  willDeleteFiles: (paths, options) => lspService.willDeleteFiles(paths, options),
                  didDeleteFiles: (paths) => lspService.didDeleteFiles(paths),
              });
          }
      } catch {}
      setWorkspaceDriver(driver);
      refreshRecentProjects();
      let candidateRoot = null;
      if (isAbsolutePath(preferredRoot)) candidateRoot = preferredRoot;
      else if (isAbsolutePath(cfg.backendRoot)) candidateRoot = cfg.backendRoot;
      else if (isAbsolutePath(cfg.projectPath)) candidateRoot = cfg.projectPath;
      else if (isAbsolutePath(driver?.pathLabel)) candidateRoot = driver.pathLabel;

      if (!candidateRoot) {
          setWorkspaceBindingStatus('error');
          setWorkspaceBindingError('未能自动解析绝对路径，请在设置中填写本机绝对路径（例如 D:\\\\my-react-app）。');
          setBackendWorkspaceRoot('');
          setProjectConfig((prev) => ({ ...prev, backendRoot: '' }));
      } else {
          await openBackendWorkspace(candidateRoot, { silent: false });
          setWorkspaceRootLabel(candidateRoot);
      }

      await syncWorkspaceFromDisk({ includeContent: false, highlight: false, driver });
      return cfg;
  }, [applyConfigToState, openBackendWorkspace, loadProjectConfigFromDisk, refreshRecentProjects, syncWorkspaceFromDisk]);

  useEffect(() => {
      if (!workspaceDriver) return;
      if (configSaveTimerRef.current) clearTimeout(configSaveTimerRef.current);
      configSaveTimerRef.current = setTimeout(async () => {
          try {
              const payload = normalizeProjectConfig(projectConfig);
              await workspaceDriver.writeFile('.aichat/config.json', JSON.stringify(payload, null, 2), { createDirectories: true });
              if (payload.projectPath) {
                  workspaceDriver.updatePathLabel(payload.projectPath).catch(() => {});
              }
          } catch (err) {
              console.error('Save project config failed', err);
          }
      }, 200);
      return () => {
          if (configSaveTimerRef.current) clearTimeout(configSaveTimerRef.current);
      };
  }, [projectConfig, workspaceDriver, normalizeProjectConfig]);

  const openDiffModal = useCallback((payload) => {
      if (!payload) return;
      setDiffModal(payload);
  }, []);

  const fetchDiffSnapshot = useCallback(async ({ diffId, path } = {}) => {
      if (!currentSessionId) return null;
      try {
          let url = '';
          if (diffId) {
              url = `/api/diffs/${diffId}`;
          } else if (path) {
              url = `/api/diffs?session_id=${encodeURIComponent(currentSessionId)}&path=${encodeURIComponent(path)}&limit=1`;
          } else {
              url = `/api/diffs?session_id=${encodeURIComponent(currentSessionId)}&limit=1`;
          }
          const res = await projectFetch(url);
          if (!res.ok) return null;
          const data = await res.json();
          if (Array.isArray(data)) {
              return data[0] || null;
          }
          return data;
      } catch (e) {
          console.warn('fetchDiffSnapshot failed', e);
          return null;
      }
  }, [currentSessionId, projectFetch]);

  const handleOpenDiff = useCallback(async (payload = {}) => {
      const diffId = payload?.diff_id || payload?.id;
      const path = payload?.path;
      const direct = payload && payload.before !== undefined && payload.after !== undefined ? payload : null;
      const latest = await fetchDiffSnapshot({ diffId, path });
      const diff = latest && latest.before !== undefined && latest.after !== undefined ? latest : direct;
      if (diff) {
          if (uiDisplayPreferences.diff === 'editor') {
              openDiffTabInWorkspace(diff);
              setDiffModal(null);
          } else {
              openDiffModal(diff);
          }
          return;
      }
      alert('未找到可用的 diff 快照（请确认已触发文件写入操作）');
  }, [fetchDiffSnapshot, openDiffModal, uiDisplayPreferences.diff, openDiffTabInWorkspace]);

  const closeDiffModal = useCallback(() => setDiffModal(null), []);

  const handleOpenDiffInWorkspace = useCallback((diff) => {
      openDiffTabInWorkspace(diff);
      setDiffModal(null);
  }, [openDiffTabInWorkspace]);

  const {
      gitStatus,
      gitLoading,
      gitRemotes,
      gitLog,
      gitBranches,
      gitBranch,
      gitBadgeCount,
      refreshGitStatus,
      initRepo: handleGitInit,
      createBranch: handleGitCreateBranch,
      deleteBranch: handleGitDeleteBranch,
      checkoutBranch: handleGitCheckoutBranch,
      resolveConflict: handleGitResolve,
      addRemote: handleGitAddRemote,
      stage: handleGitStage,
      unstage: handleGitUnstage,
      stageAll: handleGitStageAll,
      unstageAll: handleGitUnstageAll,
      restore: handleGitRestore,
      restoreAll: handleGitRestoreAll,
      commit: handleGitCommit,
      pull: handleGitPull,
      push: handleGitPush,
      publishBranch: handleGitPublishBranch,
      setUpstream: handleGitSetUpstream,
      sync: handleGitSync,
      generateCommitMessage: handleGenerateCommitMessage,
      getCommitDetails: handleGetCommitDetails,
      getCommitStats: handleGetCommitStats,
      openCommitDiff: handleOpenCommitDiff,
      openAllCommitDiffs: handleOpenAllCommitDiffs,
      openWorkingCopyDiff: handleOpenWorkingCopyDiff,
      openBatchDiffs: handleOpenBatchDiffs,
  } = useGit({
      backendWorkspaceRoot,
      backendBound,
      workspaceDriver,
      lspService,
      uiDiffMode: uiDisplayPreferences.diff,
      openDiffModal,
      openDiffTabInWorkspace,
      setDiffModal,
      openFile,
      shouldHidePath,
      isMissingPathError,
      aiEngineClient,
      readTextResponseBody,
      currentSessionId,
      getBackendConfig,
  });

  const requestElectronFolderPath = useCallback(async () => {
      try {
          const api = typeof window !== 'undefined' ? window.electronAPI?.workspace : null;
          if (api?.pickFolder) {
              const res = await api.pickFolder();
              if (res?.ok && !res?.canceled && res?.fsPath) return String(res.fsPath).trim();
          }
          if (hasElectronPicker() && window.electronAPI?.openFolder) {
              const result = await window.electronAPI.openFolder();
              if (result && typeof result === 'string') return result.trim();
          }
      } catch (err) {
          console.warn('Electron folder picker failed', err);
      }
      return '';
  }, []);

  const workspaceController = useMemo(() => createWorkspaceController({
      workbenchOpenRequested,
      workbenchCloseRequested,
      workspaceServices,
      abortControllerRef,
      initialWorkspaceState,
      welcomeTabPath: WELCOME_TAB_PATH,
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
      setActiveWorkspaces,
  }), [
      abortControllerRef,
      hydrateProject,
      refreshRecentProjects,
      requestElectronFolderPath,
      setBackendWorkspaceRoot,
      setBackendWorkspaceId,
      setCurrentSessionId,
      setDiffTabs,
      setLogs,
      setMessages,
      setProjectMeta,
      setSessions,
      setShowLogs,
      setTaskReview,
      setToolRuns,
      setWorkspaceBindingError,
      setWorkspaceBindingStatus,
      setWorkspaceDriver,
      setWorkspaceRootLabel,
      setWorkspaceState,
      setActiveWorkspaces,
      workbenchCloseRequested,
      workbenchOpenRequested,
      workspaceServices,
  ]);

  useEffect(() => {
      workspaceControllerRef.current = workspaceController;
  }, [workspaceController]);

  useEffect(() => {
      try {
          const url = new URL(window.location.href);
          const openFileParam = String(url.searchParams.get('openFile') || '').trim();
          const openModeParam = String(url.searchParams.get('openMode') || '').trim();
          const workspaceFsPathParam = String(url.searchParams.get('workspaceFsPath') || '').trim();
          const newWindowParam = String(url.searchParams.get('newWindow') || '').trim();
          const isNewWindow = newWindowParam === '1' || newWindowParam.toLowerCase() === 'true';
          if (!openFileParam && !workspaceFsPathParam && !isNewWindow) return;

          // Consume deep-link params exactly once (also prevents "always reopen old workspace" bugs).
          url.searchParams.delete('openFile');
          url.searchParams.delete('openMode');
          url.searchParams.delete('workspaceFsPath');
          url.searchParams.delete('newWindow');
          try {
              window.history.replaceState({}, '', url.toString());
          } catch {
              // ignore
          }

          pendingDeepLinkRef.current = { openFile: openFileParam, openMode: openModeParam, workspaceFsPath: workspaceFsPathParam, newWindow: isNewWindow };
          if (workspaceFsPathParam && !isNewWindow) {
              workspaceController.openWorkspace(workspaceFsPathParam, { preferredRoot: workspaceFsPathParam });
          }
      } catch {
          // ignore
      }
  }, [workspaceController]);

  const handleOpenBackendWorkspaceFromList = useCallback(async (descriptor) => {
      if (!descriptor) return;
      await openBackendWorkspace(descriptor, { silent: false });
  }, [openBackendWorkspace]);

  const handleOpenFileFromWelcome = useCallback(async () => {
      try {
          const api = typeof window !== 'undefined' ? window.electronAPI?.workspace : null;
          if (!api?.pickFile) {
              throw new Error('Open File is not available in this build');
          }
          const res = await api.pickFile();
          if (!res?.ok || res?.canceled) return;
          const absPath = String(res?.fsPath || '').trim();
          if (!absPath) return;

          const expectedRoot = pathDirname(absPath);
          pendingOpenFileRef.current = { absPath, expectedRoot };

          const match = (recentProjects || []).find((p) => p?.id && p?.fsPath && isFileUnderRoot(p.fsPath, absPath));
          if (match?.id) {
              await workspaceController.openWorkspace(match.id, { preferredRoot: match.fsPath });
              return;
          }

          await workspaceController.openWorkspace(null, { preferredRoot: expectedRoot });
      } catch (err) {
          console.warn('Open File failed', err);
          setWorkspaceBindingError(err?.message || 'Open file failed');
          setWorkspaceBindingStatus('error');
      }
  }, [recentProjects, workspaceController]);

  const pickNativeFolderPath = useCallback(async () => {
      const api = typeof window !== 'undefined' ? window.electronAPI?.workspace : null;
      if (!api?.pickFolder) {
          throw new Error('Pick Folder is not available in this build');
      }
      const res = await api.pickFolder();
      if (!res?.ok || res?.canceled) return '';
      return String(res?.fsPath || '').trim();
  }, []);

  const cloneRepositoryFromWelcome = useCallback(async ({ url, parentDir, folderName } = {}) => {
      if (!GitDriver.isAvailable() || typeof GitDriver.clone !== 'function') {
          throw new Error('Clone is not available. Please restart the application.');
      }
      const res = await GitDriver.clone(parentDir, url, folderName);
      if (!res?.success) {
          throw new Error(res?.error || 'Clone failed');
      }
      return { targetPath: res.targetPath };
  }, []);

  const openWorkspaceWithPreferredRoot = useCallback(async (preferredRoot) => {
      const root = String(preferredRoot || '').trim();
      if (!root) return;
      clearPendingOpenFile();
      await workspaceController.openWorkspace(null, { preferredRoot: root });
  }, [clearPendingOpenFile, workspaceController]);

  const promptOpenWorkspace = useCallback(() => {
      const suggestion = backendWorkspaceRoot || projectConfig.backendRoot || projectConfig.projectPath || '';
      
      setInputModal({
          isOpen: true,
          title: '打开 Workspace',
          label: '请输入 Workspace 的绝对路径（例如 H:\\04）',
          defaultValue: suggestion,
          placeholder: 'H:\\04',
          confirmText: '打开',
          icon: 'codicon-folder-opened',
          onConfirm: (input) => {
              if (input) {
                  openBackendWorkspace(input, { silent: false });
              }
              setInputModal(prev => ({ ...prev, isOpen: false }));
          },
          onClose: () => setInputModal(prev => ({ ...prev, isOpen: false }))
      });
  }, [backendWorkspaceRoot, projectConfig.backendRoot, projectConfig.projectPath, openBackendWorkspace]);

  useEffect(() => {
      const label = projectConfig.projectPath || projectConfig.backendRoot;
      if (label) {
          setWorkspaceRootLabel(label);
      }
  }, [projectConfig.projectPath, projectConfig.backendRoot]);

  useEffect(() => {
      if (!projectConfig.projectPath) return;
      setProjectMeta((prev) => ({ ...prev, pathLabel: projectConfig.projectPath }));
  }, [projectConfig.projectPath]);

  useEffect(() => {
      setProjectConfig((prev) => (prev.theme === theme ? prev : { ...prev, theme }));
  }, [theme]);

  useEffect(() => {
      setProjectConfig((prev) => (prev.sidebarWidth === sidebarWidth ? prev : { ...prev, sidebarWidth }));
      persistLayoutPrefs({ sidebarWidth });
      if (!sidebarCollapsed) {
          lastSidebarWidthRef.current = sidebarWidth;
      }
  }, [sidebarWidth, sidebarCollapsed]);

  useEffect(() => {
      if (!backendWorkspaceRoot) return;
      setProjectConfig((prev) => (prev.backendRoot === backendWorkspaceRoot ? prev : { ...prev, backendRoot: backendWorkspaceRoot, projectPath: prev.projectPath || backendWorkspaceRoot }));
  }, [backendWorkspaceRoot]);

  useEffect(() => {
      persistGlobalConfig({
          provider: config.provider,
          default_models: { ...(config.default_models || {}) },
          routing: { ...(config.routing || {}) },
          embedding_options: (config.embedding_options && typeof config.embedding_options === 'object') ? { ...(config.embedding_options || {}) } : {},
          keybindings: { ...(config.keybindings || {}) },
          editorUndoRedoLimit: Number(config.editorUndoRedoLimit) || DEFAULT_PROJECT_CONFIG.editorUndoRedoLimit,
          editor: (config.editor && typeof config.editor === 'object') ? { ...(config.editor || {}) } : { ...DEFAULT_PROJECT_CONFIG.editor },
          openai: { ...config.openai },
          anthropic: { ...config.anthropic },
          openrouter: { ...config.openrouter },
          xai: { ...config.xai },
          ollama: { ...config.ollama },
          lmstudio: { ...config.lmstudio },
          llamacpp: { ...config.llamacpp },
          toolSettings,
          uiDisplayPreferences,
          features: (config.features && typeof config.features === 'object') ? { ...(config.features || {}) } : { ...DEFAULT_PROJECT_CONFIG.features },
      });
  }, [config, toolSettings, uiDisplayPreferences]);

  useEffect(() => {
      setProjectConfig((prev) => {
          const sameProvider = prev.provider === config.provider;
          const sameDefaults = JSON.stringify(prev.default_models) === JSON.stringify(config.default_models);
          const sameRouting = JSON.stringify(prev.routing) === JSON.stringify(config.routing);
          const sameEmbeddingOptions = JSON.stringify(prev.embedding_options) === JSON.stringify(config.embedding_options);
          const sameOpenai = JSON.stringify(prev.openai) === JSON.stringify(config.openai);
          const sameAnthropic = JSON.stringify(prev.anthropic) === JSON.stringify(config.anthropic);
          const sameOpenrouter = JSON.stringify(prev.openrouter) === JSON.stringify(config.openrouter);
          const sameXai = JSON.stringify(prev.xai) === JSON.stringify(config.xai);
          const sameOllama = JSON.stringify(prev.ollama) === JSON.stringify(config.ollama);
          const sameLmstudio = JSON.stringify(prev.lmstudio) === JSON.stringify(config.lmstudio);
          const sameLlamaCpp = JSON.stringify(prev.llamacpp) === JSON.stringify(config.llamacpp);
          if (sameProvider && sameDefaults && sameRouting && sameEmbeddingOptions && sameOpenai && sameAnthropic && sameOpenrouter && sameXai && sameOllama && sameLmstudio && sameLlamaCpp) return prev;
          return {
              ...prev,
              provider: config.provider,
              default_models: { ...(config.default_models || {}) },
              routing: { ...(config.routing || {}) },
              embedding_options: (config.embedding_options && typeof config.embedding_options === 'object') ? { ...(config.embedding_options || {}) } : {},
              openai: { ...config.openai },
              anthropic: { ...config.anthropic },
              openrouter: { ...config.openrouter },
              xai: { ...config.xai },
              ollama: { ...config.ollama },
              lmstudio: { ...config.lmstudio },
              llamacpp: { ...config.llamacpp }
          };
      });
  }, [config]);

  useEffect(() => {
      if (configHydratedRef.current) return;
      const key = getBackendConfig().api_key;
      if (key) {
          configHydratedRef.current = true;
          applyStoredConfig({ silent: true });
          return;
      }
      let cancelled = false;
      (async () => {
          const applied = await fetchPersistedBackendConfig({ silent: true });
          if (cancelled) return;
          if (applied && applied[applied.provider]?.api_key) {
              configHydratedRef.current = true;
          }
      })();
      return () => { cancelled = true; };
  }, [applyStoredConfig, fetchPersistedBackendConfig, getBackendConfig]);

  useEffect(() => {
      if (!workspaceDriver) return;
      if (backendWorkspaceRoot) {
          openBackendWorkspace(backendWorkspaceRoot, { silent: true });
      }
  }, [backendWorkspaceRoot, openBackendWorkspace, workspaceDriver]);

  useEffect(() => {
      // ✅ 仅在挂载时执行一次，避免循环依赖
      if (workspaceInitializedRef.current) return;
      workspaceInitializedRef.current = true;
      
      let cancelled = false;
      (async () => {
          try {
              setWorkspaceBindingStatus('idle');
              await refreshRecentProjects();
              const skipRestore =
                pendingDeepLinkRef.current?.newWindow === true
                || startupFlagsRef.current?.openWelcomeOnStart === true;
              const driver = skipRestore ? null : await LocalWorkspaceDriver.fromPersisted(null, { allowPrompt: false });
              if (cancelled) return;
              if (driver) {
                  await hydrateProject(driver);
              } else {
                  setWorkspaceBindingStatus('idle');
              }
          } catch (err) {
              if (!cancelled) {
          setWorkspaceBindingStatus('error');
          setWorkspaceBindingError(err?.message || 'Workspace 打开失败');
              }
          }
      })();
      return () => {
          cancelled = true;
      };
  }, []);

  useEffect(() => {
      workbenchBoot();
  }, [workbenchBoot]);

  useEffect(() => {
      syncWorkbenchFromLegacy({ workspaceDriver, workspaceBindingStatus, workspaceBindingError });
  }, [syncWorkbenchFromLegacy, workspaceBindingError, workspaceBindingStatus, workspaceDriver]);

  const closeWorkspaceToWelcome = useCallback(async () => {
      clearPendingOpenFile();
      clearPendingStartAction();
      clearPendingTemplate();
      await workspaceController.closeWorkspaceToWelcome({ recentTouchRef });
  }, [clearPendingOpenFile, clearPendingStartAction, clearPendingTemplate, workspaceController]);

  useEffect(() => {
      if (!workspaceDriver && workspaceBindingStatus !== 'checking') {
          clearPendingOpenFile();
          clearPendingStartAction();
          clearPendingTemplate();
      }
  }, [clearPendingOpenFile, clearPendingStartAction, clearPendingTemplate, workspaceBindingStatus, workspaceDriver]);

  // Default editor on boot: Welcome tab (Editor Area), not a blocking full-screen page.
  useEffect(() => {
      workspaceController.effectEnsureWelcomeTabWhenNoWorkspace({ workspaceDriver });
  }, [workspaceController, workspaceDriver]);

  // If a workspace becomes ready, auto-close Welcome to preserve the current editing feel (it can be reopened).
  useEffect(() => {
      workspaceController.effectAutoCloseWelcomeTabOnReady({ workspaceDriver, workspaceBindingStatus });
  }, [workspaceBindingStatus, workspaceController, workspaceDriver]);

  const workspaceServicesKeyRef = useRef('');
  useEffect(() => {
      workspaceController.effectSyncWorkspaceServices({
          isReady: workbenchModel.state === WorkbenchStates.WORKSPACE_READY,
          backendWorkspaceRoot,
          workspaceRootLabel,
          workspaceDriver,
          projectMeta,
          workspaceServicesKeyRef,
      });
  }, [backendWorkspaceRoot, projectMeta, workbenchModel.state, workspaceController, workspaceDriver, workspaceRootLabel]);

  const recentTouchRef = useRef({ id: null, fsPath: null });
  useEffect(() => {
      return workspaceController.effectSyncRecentsOnReady({
          workspaceDriver,
          workspaceBindingStatus,
          backendWorkspaceRoot,
          workspaceRootLabel,
          projectMeta,
          backendWorkspaceId,
          recentTouchRef,
      });
  }, [backendWorkspaceId, backendWorkspaceRoot, projectMeta, refreshRecentProjects, workspaceBindingStatus, workspaceController, workspaceDriver, workspaceRootLabel]);

  const changeEditorNavigationMode = useCallback((mode) => {
      const nextMode = mode === 'stickyScroll' ? 'stickyScroll' : 'breadcrumbs';
      setConfig((prev) => {
          const editor = (prev?.editor && typeof prev.editor === 'object') ? prev.editor : {};
          if (editor.navigationMode === nextMode) return prev;
          return { ...prev, editor: { ...editor, navigationMode: nextMode } };
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
  }, [backendWorkspaceRoot, clearPendingOpenFile, workspaceBindingStatus, workspaceDriver, workspaceRootLabel]);

  useEffect(() => {
      if (!workspaceDriver) return;
      if (workspaceBindingStatus !== 'ready') return;
      if (pendingStartActionRef.current?.type !== 'template') return;
      const pending = pendingTemplateRef.current;
      if (!pending) return;
      clearPendingStartAction();
      clearPendingTemplate();
      createTemplateProjectInWorkspace(pending).catch((err) => {
          console.warn('Create template failed', err);
          setWorkspaceBindingError(err?.message || 'Create template failed');
          setWorkspaceBindingStatus('error');
      });
  }, [clearPendingStartAction, clearPendingTemplate, createTemplateProjectInWorkspace, workspaceBindingStatus, workspaceDriver]);

  const handleConnectRemote = useCallback(async (data) => {
      // TODO: Implement actual backend connection
      console.log('Connecting to remote:', data);
      // Simulate connection delay
      await new Promise(resolve => setTimeout(resolve, 1500));
      alert(`Connected to ${data.username}@${data.host}:${data.port}`);
      setShowRemoteModal(false);
  }, []);

  const handleOpenConfigInEditor = useCallback(() => {
      setConfigFullscreen(false);
      setShowConfig(false);
      openFile(SETTINGS_TAB_PATH, { mode: 'persistent' });
  }, [openFile]);

  const openHelpModal = useCallback((type) => {
      const nextType = type === 'about' ? 'about' : 'docs';
      setHelpModal({ isOpen: true, type: nextType, appInfo: null });
  }, []);

  const closeHelpModal = useCallback(() => {
      setHelpModal((prev) => ({ ...prev, isOpen: false }));
  }, []);

  useEffect(() => {
      if (!helpModal.isOpen) return;
      if (helpModal.type !== 'about') return;
      let cancelled = false;
      (async () => {
          try {
              const api = typeof window !== 'undefined' ? window.electronAPI?.app : null;
              if (!api?.getInfo) return;
              const res = await api.getInfo();
              if (cancelled) return;
              setHelpModal((prev) => {
                  if (!prev.isOpen || prev.type !== 'about') return prev;
                  return { ...prev, appInfo: res || null };
              });
          } catch {
              // ignore
          }
      })();
      return () => { cancelled = true; };
  }, [helpModal.isOpen, helpModal.type]);

  const currentSession = sessions.find(s => s.id === currentSessionId);
  const lastLog = logs && logs.length > 0 ? logs[0] : null;
  const logStatus = lastLog ? { requestOk: !!lastLog.success, parseOk: lastLog.parsed_success !== false } : null;
  const hasAnyEditorTabs = Array.isArray(workspaceState.editorGroups)
    ? workspaceState.editorGroups.some((g) => Array.isArray(g?.openTabs) && g.openTabs.length > 0)
    : workspaceState.openTabs.length > 0;
  const workspaceVisible = ['canva', 'agent'].includes(currentMode) || hasAnyEditorTabs || Object.keys(diffTabs).length > 0 || !workspaceDriver || workspaceBindingStatus === 'checking' || workspaceBindingStatus === 'error';
  const workspaceShellVisible = workspaceVisible || showLogs;

  return (
    <AppShell
      theme={theme}
      projectMeta={projectMeta}
      handleSelectWorkspace={handleSelectWorkspace}
      workspaceController={workspaceController}
      openHelpModal={openHelpModal}
      closeHelpModal={closeHelpModal}
      helpModal={helpModal}
      closeWorkspaceToWelcome={closeWorkspaceToWelcome}
      promptOpenWorkspace={promptOpenWorkspace}
      handleToggleTheme={handleToggleTheme}
      language={language}
      workspaceState={workspaceState}
      setWorkspaceState={setWorkspaceState}
      handleAddFile={handleAddFile}
      handleAddFolder={handleAddFolder}
      syncWorkspaceFromDisk={syncWorkspaceFromDisk}
      handleRefreshPreview={handleRefreshPreview}
      workspaceDriver={workspaceDriver}
      workspaceBindingError={workspaceBindingError}
      workspaceRootLabel={workspaceRootLabel}
      recentProjects={recentProjects}
      isAbsolutePath={isAbsolutePath}
      setShowCloneModal={setShowCloneModal}
      setShowRemoteModal={setShowRemoteModal}
      openCommandPalette={openCommandPalette}
      showResizeOverlay={showResizeOverlay}
      handleMouseMove={handleMouseMove}
      stopResize={stopResize}
      showConfig={showConfig}
      setShowConfig={setShowConfig}
      config={config}
      setConfig={setConfig}
      toolSettings={toolSettings}
      persistToolSettings={persistToolSettings}
      handleConfigSubmit={handleConfigSubmit}
      setConfigFullscreen={setConfigFullscreen}
      configFullscreen={configFullscreen}
      checkApiStatus={checkApiStatus}
      apiStatus={apiStatus}
      apiMessage={apiMessage}
      userThemePreferenceRef={userThemePreferenceRef}
      handleThemeModeChange={handleThemeModeChange}
      handleLanguageChange={handleLanguageChange}
      uiDisplayPreferences={uiDisplayPreferences}
      handleChangeDisplayPreference={handleChangeDisplayPreference}
      handleOpenConfigInEditor={handleOpenConfigInEditor}
      projectConfig={projectConfig}
      setProjectConfig={setProjectConfig}
      showCommandPalette={showCommandPalette}
      closeCommandPalette={closeCommandPalette}
      commandPaletteInitialQuery={commandPaletteInitialQuery}
      commandPaletteContext={commandPaletteContext}
      workspaceProps={workspaceProps}
      openFile={openFile}
      closeFile={closeFile}
      setGlobalSearchQuery={setGlobalSearchQuery}
      handleSidebarTabChange={handleSidebarTabChange}
      lspService={lspService}
      editorAiInvoker={editorAiInvoker}
      activeSidebarPanel={activeSidebarPanel}
      sidebarCollapsed={sidebarCollapsed}
      explorerReveal={explorerReveal}
      sidebarWidth={sidebarWidth}
      activeResizeTarget={activeResizeTarget}
      sidebarResizerGhostRef={sidebarResizerGhostRef}
      startResize={startResize}
      createSession={createSession}
      gitBadgeCount={gitBadgeCount}
      sessions={sessions}
      currentSessionId={currentSessionId}
      selectSession={selectSession}
      deleteSession={deleteSession}
      renameSession={renameSession}
      messages={messages}
      input={input}
      setInput={setInput}
      loadingSessions={loadingSessions}
      handleSend={handleSend}
      handleStop={handleStop}
      setShowLogs={setShowLogs}
      showLogs={showLogs}
      currentSession={currentSession}
      logStatus={logStatus}
      currentMode={currentMode}
      modeOptions={MODE_OPTIONS}
      handleModeChange={handleModeChange}
      toolRuns={toolRuns}
      handleOpenDiff={handleOpenDiff}
      taskReview={taskReview}
      toggleTaskReview={toggleTaskReview}
      keepAllTaskFiles={keepAllTaskFiles}
      revertAllTaskFiles={revertAllTaskFiles}
      keepTaskFile={keepTaskFile}
      revertTaskFile={revertTaskFile}
      resetTaskFile={resetTaskFile}
      workspaceLoading={workspaceLoading}
      hotReloadToken={hotReloadToken}
      backendWorkspaceRoot={backendWorkspaceRoot}
      handleDeletePath={handleDeletePath}
      handleRenamePath={handleRenamePath}
      gitStatus={gitStatus}
      handleGlobalSearch={handleGlobalSearch}
      globalSearchQuery={globalSearchQuery}
      gitRemotes={gitRemotes}
      gitLog={gitLog}
      gitBranches={gitBranches}
      handleGitCommit={handleGitCommit}
      handleGitStage={handleGitStage}
      handleGitUnstage={handleGitUnstage}
      handleGitStageAll={handleGitStageAll}
      handleGitUnstageAll={handleGitUnstageAll}
      handleGitRestore={handleGitRestore}
      handleGitRestoreAll={handleGitRestoreAll}
      handleGitSync={handleGitSync}
      handleGitPull={handleGitPull}
      handleGitPush={handleGitPush}
      handleGitPublishBranch={handleGitPublishBranch}
      handleGitSetUpstream={handleGitSetUpstream}
      refreshGitStatus={refreshGitStatus}
      handleGenerateCommitMessage={handleGenerateCommitMessage}
      handleGitInit={handleGitInit}
      handleGitAddRemote={handleGitAddRemote}
      handleGitCreateBranch={handleGitCreateBranch}
      handleGitDeleteBranch={handleGitDeleteBranch}
      handleGitCheckoutBranch={handleGitCheckoutBranch}
      handleGitResolve={handleGitResolve}
      handleOpenWorkingCopyDiff={handleOpenWorkingCopyDiff}
      handleGetCommitDetails={handleGetCommitDetails}
      handleGetCommitStats={handleGetCommitStats}
      handleOpenCommitDiff={handleOpenCommitDiff}
      handleOpenAllCommitDiffs={handleOpenAllCommitDiffs}
      handleOpenBatchDiffs={handleOpenBatchDiffs}
      gitLoading={gitLoading}
      workspaceShellVisible={workspaceShellVisible}
      workspaceVisible={workspaceVisible}
      diffTabs={diffTabs}
      diffModal={diffModal}
      closeDiffModal={closeDiffModal}
      handleOpenDiffInWorkspace={handleOpenDiffInWorkspace}
      logs={logs}
      gitBranch={gitBranch}
      workspaceBindingStatus={workspaceBindingStatus}
      setSidebarCollapsed={setSidebarCollapsed}
      setActiveSidebarPanel={setActiveSidebarPanel}
      showRemoteModal={showRemoteModal}
      handleConnectRemote={handleConnectRemote}
      showCloneModal={showCloneModal}
      cloneRepositoryFromWelcome={cloneRepositoryFromWelcome}
      pickNativeFolderPath={pickNativeFolderPath}
      handleOpenFileFromWelcome={handleOpenFileFromWelcome}
      handleNewFileFromWelcome={handleNewFileFromWelcome}
      activeWorkspaces={activeWorkspaces}
      createTemplateProjectInWorkspace={createTemplateProjectInWorkspace}
      openWorkspaceWithPreferredRoot={openWorkspaceWithPreferredRoot}
      removeRecentProject={removeRecentProject}
      handleOpenBackendWorkspaceFromList={handleOpenBackendWorkspaceFromList}
      handleFileChange={handleFileChange}
      handleActiveEditorChange={handleActiveEditorChange}
      handleActiveGroupChange={handleActiveGroupChange}
      handleTabReorder={handleTabReorder}
      toggleGroupLocked={toggleGroupLocked}
      togglePreviewEditorEnabled={togglePreviewEditorEnabled}
      toggleTabPinned={toggleTabPinned}
      toggleTabKeptOpen={toggleTabKeptOpen}
      closeEditors={closeEditors}
      splitEditor={splitEditor}
      applyWorkspaceEditCreateFile={applyWorkspaceEditCreateFile}
      applyWorkspaceEditRenamePath={applyWorkspaceEditRenamePath}
      applyWorkspaceEditDeletePath={applyWorkspaceEditDeletePath}
      applyWorkspaceEditReadFile={applyWorkspaceEditReadFile}
      applyWorkspaceEditWriteFile={applyWorkspaceEditWriteFile}
      settingsTabPath={SETTINGS_TAB_PATH}
      terminalSettingsTabPath={TERMINAL_SETTINGS_TAB_PATH}
      terminalEditorTabPath={TERMINAL_EDITOR_TAB_PATH}
      welcomeTabPath={WELCOME_TAB_PATH}
      aiEngineClient={aiEngineClient}
      getBackendConfig={getBackendConfig}
      backendWorkspaceId={backendWorkspaceId}
      setEditorAiInvoker={setEditorAiInvoker}
      undoRedoLimit={config?.editorUndoRedoLimit}
      changeEditorNavigationMode={changeEditorNavigationMode}
      keepTaskBlock={keepTaskBlock}
      revertTaskBlock={revertTaskBlock}
      resetTaskBlock={resetTaskBlock}
      setTaskReviewCursor={setTaskReviewCursor}
      diffTabPrefix={DIFF_TAB_PREFIX}
      inputModal={inputModal}
    />
  );
}

export default App;
