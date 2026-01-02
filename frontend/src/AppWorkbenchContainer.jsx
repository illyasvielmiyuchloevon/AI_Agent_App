import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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
import { useSessions } from './hooks/useSessions';
import { useWorkspace } from './hooks/useWorkspace';
import { useAppStartup } from './hooks/useAppStartup';
import { useCommandPalette } from './hooks/useCommandPalette';
import { useGit } from './hooks/useGit';
import { useAppModals } from './hooks/useAppModals';
import { buildAppShellProps } from './utils/buildAppShellProps';
import {
  DEFAULT_PROJECT_CONFIG,
  DIFF_TAB_PREFIX,
  MODE_OPTIONS,
  SETTINGS_TAB_PATH,
  TERMINAL_EDITOR_TAB_PATH,
  TERMINAL_SETTINGS_TAB_PATH,
  initialWorkspaceState,
  normalizeProjectConfig as normalizeProjectConfigUtil,
} from './utils/appDefaults';
import { detectSystemTheme, persistGlobalConfig, persistLayoutPrefs, readLayoutPrefs, readStoredTheme } from './utils/appPersistence';
import { isAbsolutePath, isFileUnderRoot, isMissingPathError, pathDirname, pathRelativeToRoot, shouldHidePath } from './utils/appAlgorithms';

const AppWorkbenchContext = createContext(null);

export function useAppWorkbench() {
  const value = useContext(AppWorkbenchContext);
  if (!value) {
    throw new Error('useAppWorkbench must be used within <AppWorkbenchContainer />');
  }
  return value;
}

export function AppShellContainer({
  config,
  setConfig,
  getBackendConfig,
  showConfig,
  setShowConfig,
  apiStatus,
  setApiStatus,
  apiMessage,
  setApiMessage,
  inputModal,
  setInputModal,
  layout,
  prefs,
}) {
  React.useEffect(() => {
    const bus = globalThis?.window?.electronAPI?.ideBus;
    if (!bus?.onNotification || !bus?.request) return undefined;

    const disposeInput = bus.onNotification('window/showInputBoxRequest', (payload) => {
      const requestId = String(payload?.requestId || '').trim();
      if (!requestId) return;
      const title = payload?.title ? String(payload.title) : 'Input';
      const prompt = payload?.prompt ? String(payload.prompt) : '';
      const value = payload?.value != null ? String(payload.value) : '';
      const placeHolder = payload?.placeHolder ? String(payload.placeHolder) : '';

      setInputModal({
        isOpen: true,
        title,
        label: prompt,
        defaultValue: value,
        placeholder: placeHolder,
        confirmText: '确定',
        icon: 'codicon-edit',
        onConfirm: async (inputValue) => {
          try {
            await bus.request('window/showInputBoxResponse', { requestId, result: { canceled: false, value: String(inputValue || '') } }, { timeoutMs: 5_000 });
          } catch {
            // ignore
          }
          setInputModal((prev) => ({ ...prev, isOpen: false }));
        },
        onClose: async () => {
          try {
            await bus.request('window/showInputBoxResponse', { requestId, result: { canceled: true } }, { timeoutMs: 5_000 });
          } catch {
            // ignore
          }
          setInputModal((prev) => ({ ...prev, isOpen: false }));
        },
      });
    });

    const disposePick = bus.onNotification('window/showQuickPickRequest', (payload) => {
      const requestId = String(payload?.requestId || '').trim();
      if (!requestId) return;
      const title = payload?.title ? String(payload.title) : 'Select';
      const placeHolder = payload?.placeHolder ? String(payload.placeHolder) : '';
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const normalized = items.map((it) => {
        if (!it) return null;
        if (typeof it === 'string') return { label: it, description: '' };
        if (typeof it === 'object') return { label: String(it.label || ''), description: it.description ? String(it.description) : '' };
        return null;
      }).filter((x) => x?.label);

      const preview = normalized.slice(0, 25).map((it, idx) => `${idx + 1}. ${it.label}${it.description ? ` — ${it.description}` : ''}`).join('\n');
      const label = `请输入编号或标签：\n${preview}${normalized.length > 25 ? `\n… (${normalized.length} items)` : ''}`;

      setInputModal({
        isOpen: true,
        title,
        label,
        defaultValue: '',
        placeholder: placeHolder || '1',
        confirmText: '选择',
        icon: 'codicon-list-selection',
        onConfirm: async (inputValue) => {
          const raw = String(inputValue || '').trim();
          let picked = '';
          const n = Number(raw);
          if (Number.isFinite(n) && n >= 1 && n <= normalized.length) picked = normalized[n - 1]?.label || '';
          if (!picked) {
            const lower = raw.toLowerCase();
            const found = normalized.find((x) => String(x.label).toLowerCase() === lower);
            picked = found ? String(found.label) : '';
          }

          try {
            if (picked) {
              await bus.request('window/showQuickPickResponse', { requestId, result: { canceled: false, value: picked } }, { timeoutMs: 5_000 });
            } else {
              await bus.request('window/showQuickPickResponse', { requestId, result: { canceled: true } }, { timeoutMs: 5_000 });
            }
          } catch {
            // ignore
          }
          setInputModal((prev) => ({ ...prev, isOpen: false }));
        },
        onClose: async () => {
          try {
            await bus.request('window/showQuickPickResponse', { requestId, result: { canceled: true } }, { timeoutMs: 5_000 });
          } catch {
            // ignore
          }
          setInputModal((prev) => ({ ...prev, isOpen: false }));
        },
      });
    });

    return () => {
      try { disposeInput?.(); } catch {}
      try { disposePick?.(); } catch {}
    };
  }, [setInputModal]);

  const {
    projectMeta,
    recentProjects,
    removeRecentProject,
    activeWorkspaces,
    backendBound,
    projectConfig,
    setProjectConfig,
    workspaceController,
    handleSelectWorkspace,
    promptOpenWorkspace,
    closeWorkspaceToWelcome,
    projectFetch,
    aiEngineClient,
    backendWorkspaceRoot,
    backendWorkspaceRootRef,
    backendWorkspaceId,
    openBackendWorkspace,
    workspaceState,
    setWorkspaceState,
    workspaceDriver,
    workspaceBindingStatus,
    workspaceBindingError,
    workspaceRootLabel,
    workspaceLoading,
    hotReloadToken,
    diffTabs,
    openFile,
    closeFile,
    handleFileChange,
    handleActiveEditorChange,
    handleActiveGroupChange,
    handleTabReorder,
    toggleGroupLocked,
    togglePreviewEditorEnabled,
    toggleTabPinned,
    toggleTabKeptOpen,
    closeEditors,
    splitEditor,
    handleRefreshPreview,
    syncWorkspaceFromDisk,
    handleAddFile,
    handleAddFolder,
    handleNewFileFromWelcome,
    createTemplateProjectInWorkspace,
    cloneRepositoryFromWelcome,
    pickNativeFolderPath,
    handleOpenFileFromWelcome,
    openWorkspaceWithPreferredRoot,
    handleOpenBackendWorkspaceFromList,
    handleDeletePath,
    handleRenamePath,
    applyWorkspaceEditCreateFile,
    applyWorkspaceEditRenamePath,
    applyWorkspaceEditDeletePath,
    applyWorkspaceEditReadFile,
    applyWorkspaceEditWriteFile,
    handleGlobalSearch,
    openDiffTabInWorkspace,
    workspaceProps,
    sessions,
    currentSessionId,
    messages,
    toolRuns,
    input,
    setInput,
    taskReview,
    loadingSessions,
    currentMode,
    showLogs,
    setShowLogs,
    logs,
    abortControllerRef,
    sessionActions,
  } = useAppWorkbench();

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
  } = layout;

  const {
    language,
    handleLanguageChange,
    uiDisplayPreferences,
    toolSettings,
    setToolSettings,
    mergeToolSettings,
    theme,
    userThemePreferenceRef,
    handleChangeDisplayPreference,
    handleThemeModeChange,
    handleToggleTheme,
  } = prefs;

  const currentSessionIdRef = useRef(null);
  const openDiffTabInWorkspaceRef = useRef(null);

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    openDiffTabInWorkspaceRef.current = openDiffTabInWorkspace;
  }, [openDiffTabInWorkspace]);

  const {
    diffModal,
    setDiffModal,
    openDiffModal,
    closeDiffModal,
    handleOpenDiff,
    handleOpenDiffInWorkspace,
    showRemoteModal,
    setShowRemoteModal,
    showCloneModal,
    setShowCloneModal,
    helpModal,
    openHelpModal,
    closeHelpModal,
    configFullscreen,
    setConfigFullscreen,
    globalSearchQuery,
    setGlobalSearchQuery,
    editorAiInvoker,
    setEditorAiInvoker,
    handleConnectRemote,
  } = useAppModals({
    uiDiffMode: uiDisplayPreferences.diff,
    projectFetch,
    currentSessionIdRef,
    openDiffTabInWorkspaceRef,
    inputModalState: inputModal,
    setInputModalState: setInputModal,
  });

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

  const keybindingsRef = useRef({});
  useEffect(() => {
    keybindingsRef.current = (config?.keybindings && typeof config.keybindings === 'object') ? config.keybindings : {};
  }, [config?.keybindings]);

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
  }, [backendWorkspaceRoot, backendWorkspaceRootRef, openFile]);

  const persistToolSettings = useCallback((updater) => {
    setToolSettings((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      setProjectConfig((cfg) => ({ ...cfg, toolSettings: next }));
      return next;
    });
  }, [setProjectConfig, setToolSettings]);

  const handleConfigSubmit = useCallback(async () => {
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
  }, [config, setProjectConfig]);

  const applyStoredConfig = useCallback(async () => {
  }, []);

  const fetchPersistedBackendConfig = useCallback(async () => {
    return null;
  }, []);

  const checkApiStatus = useCallback(async () => {
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
  }, [aiEngineClient, getBackendConfig, setApiMessage, setApiStatus]);

  useEffect(() => {
    persistLayoutPrefs({ sidebarWidth });
    if (!sidebarCollapsed) {
      lastSidebarWidthRef.current = sidebarWidth;
    }
  }, [sidebarWidth, sidebarCollapsed, lastSidebarWidthRef]);

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
        llamacpp: { ...config.llamacpp },
      };
    });
  }, [config, setProjectConfig]);

  const configHydratedRef = useRef(false);
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

  const changeEditorNavigationMode = useCallback((mode) => {
    const nextMode = mode === 'stickyScroll' ? 'stickyScroll' : 'breadcrumbs';
    setConfig((prev) => {
      const editor = (prev?.editor && typeof prev.editor === 'object') ? prev.editor : {};
      if (editor.navigationMode === nextMode) return prev;
      return { ...prev, editor: { ...editor, navigationMode: nextMode } };
    });
  }, [setConfig]);

  const handleOpenConfigInEditor = useCallback(() => {
    setConfigFullscreen(false);
    setShowConfig(false);
    openFile(SETTINGS_TAB_PATH, { mode: 'persistent' });
  }, [openFile, setConfigFullscreen, setShowConfig]);

  const currentSession = useMemo(() => sessions.find((s) => s.id === currentSessionId), [currentSessionId, sessions]);
  const lastLog = logs && logs.length > 0 ? logs[0] : null;
  const logStatus = lastLog ? { requestOk: !!lastLog.success, parseOk: lastLog.parsed_success !== false } : null;
  const hasAnyEditorTabs = Array.isArray(workspaceState.editorGroups)
    ? workspaceState.editorGroups.some((g) => Array.isArray(g?.openTabs) && g.openTabs.length > 0)
    : workspaceState.openTabs.length > 0;
  const workspaceVisible = ['canva', 'agent'].includes(currentMode) || hasAnyEditorTabs || Object.keys(diffTabs).length > 0 || !workspaceDriver || workspaceBindingStatus === 'checking' || workspaceBindingStatus === 'error';
  const workspaceShellVisible = workspaceVisible || showLogs;

  const prefsGroup = {
    theme,
    language,
    handleToggleTheme,
    handleThemeModeChange,
    handleLanguageChange,
    uiDisplayPreferences,
    handleChangeDisplayPreference,
    userThemePreferenceRef,
    openHelpModal,
    closeHelpModal,
    helpModal,
    setShowCloneModal,
    setShowRemoteModal,
  };

  const workspaceGroup = {
    projectMeta,
    handleSelectWorkspace,
    workspaceController,
    closeWorkspaceToWelcome,
    promptOpenWorkspace,
    showConfig,
    setShowConfig,
    config,
    setConfig,
    toolSettings,
    persistToolSettings,
    handleConfigSubmit,
    setConfigFullscreen,
    configFullscreen,
    checkApiStatus,
    apiStatus,
    apiMessage,
    userThemePreferenceRef,
    handleThemeModeChange,
    handleLanguageChange,
    uiDisplayPreferences,
    handleChangeDisplayPreference,
    handleOpenConfigInEditor,
    projectConfig,
    setProjectConfig,
    showCommandPalette,
    closeCommandPalette,
    commandPaletteInitialQuery,
    commandPaletteContext,
    workspaceProps,
    openFile,
    closeFile,
    setGlobalSearchQuery,
    handleSidebarTabChange,
    lspService,
    editorAiInvoker,
    setEditorAiInvoker,
    activeSidebarPanel,
    sidebarCollapsed,
    explorerReveal,
    sidebarWidth,
    activeResizeTarget,
    sidebarResizerGhostRef,
    startResize,
    openCommandPalette,
    showResizeOverlay,
    handleMouseMove,
    stopResize,
    workspaceState,
    setWorkspaceState,
    handleAddFile,
    handleAddFolder,
    syncWorkspaceFromDisk,
    handleRefreshPreview,
    workspaceDriver,
    workspaceBindingError,
    workspaceRootLabel,
    recentProjects,
    isAbsolutePath,
    showRemoteModal,
    handleConnectRemote,
    showCloneModal,
    cloneRepositoryFromWelcome,
    pickNativeFolderPath,
    handleOpenFileFromWelcome,
    handleNewFileFromWelcome,
    activeWorkspaces,
    createTemplateProjectInWorkspace,
    openWorkspaceWithPreferredRoot,
    removeRecentProject,
    handleOpenBackendWorkspaceFromList,
    handleFileChange,
    handleActiveEditorChange,
    handleActiveGroupChange,
    handleTabReorder,
    toggleGroupLocked,
    togglePreviewEditorEnabled,
    toggleTabPinned,
    toggleTabKeptOpen,
    closeEditors,
    splitEditor,
    applyWorkspaceEditCreateFile,
    applyWorkspaceEditRenamePath,
    applyWorkspaceEditDeletePath,
    applyWorkspaceEditReadFile,
    applyWorkspaceEditWriteFile,
    workspaceLoading,
    hotReloadToken,
    backendWorkspaceRoot,
    handleDeletePath,
    handleRenamePath,
    handleGlobalSearch,
    diffTabs,
    workspaceShellVisible,
    workspaceVisible,
    diffModal,
    closeDiffModal,
    handleOpenDiff,
    handleOpenDiffInWorkspace,
    logs,
    workspaceBindingStatus,
    globalSearchQuery,
    gitStatus,
  };

  const sessionsGroup = {
    createSession: sessionActions.createSession,
    sessions,
    currentSessionId,
    selectSession: sessionActions.selectSession,
    deleteSession: sessionActions.deleteSession,
    renameSession: sessionActions.renameSession,
    messages,
    input,
    setInput,
    loadingSessions,
    handleSend: sessionActions.handleSend,
    handleStop: sessionActions.handleStop,
    setShowLogs,
    showLogs,
    currentSession,
    logStatus,
    currentMode,
    modeOptions: MODE_OPTIONS,
    handleModeChange: sessionActions.handleModeChange,
    toolRuns,
    taskReview,
    toggleTaskReview: sessionActions.toggleTaskReview,
    keepAllTaskFiles: sessionActions.keepAllTaskFiles,
    revertAllTaskFiles: sessionActions.revertAllTaskFiles,
    keepTaskFile: sessionActions.keepTaskFile,
    revertTaskFile: sessionActions.revertTaskFile,
    resetTaskFile: sessionActions.resetTaskFile,
    logs,
    keepTaskBlock: sessionActions.keepTaskBlock,
    revertTaskBlock: sessionActions.revertTaskBlock,
    resetTaskBlock: sessionActions.resetTaskBlock,
    setTaskReviewCursor: sessionActions.setTaskReviewCursor,
  };

  const gitGroup = {
    gitBadgeCount,
    gitStatus,
    gitRemotes,
    gitLog,
    gitBranches,
    handleGitCommit,
    handleGitStage,
    handleGitUnstage,
    handleGitStageAll,
    handleGitUnstageAll,
    handleGitRestore,
    handleGitRestoreAll,
    handleGitSync,
    handleGitPull,
    handleGitPush,
    handleGitPublishBranch,
    handleGitSetUpstream,
    refreshGitStatus,
    handleGenerateCommitMessage,
    handleGitInit,
    handleGitAddRemote,
    handleGitCreateBranch,
    handleGitDeleteBranch,
    handleGitCheckoutBranch,
    handleGitResolve,
    handleOpenWorkingCopyDiff,
    handleGetCommitDetails,
    handleGetCommitStats,
    handleOpenCommitDiff,
    handleOpenAllCommitDiffs,
    handleOpenBatchDiffs,
    gitLoading,
    gitBranch,
  };

  const layoutGroup = {
    showResizeOverlay,
    handleMouseMove,
    stopResize,
    handleSidebarTabChange,
    activeSidebarPanel,
    sidebarCollapsed,
    explorerReveal,
    sidebarWidth,
    activeResizeTarget,
    sidebarResizerGhostRef,
    startResize,
    setSidebarCollapsed,
    setActiveSidebarPanel,
  };

  const appShellProps = buildAppShellProps({
    workspace: workspaceGroup,
    sessions: sessionsGroup,
    git: gitGroup,
    layout: layoutGroup,
    prefs: prefsGroup,
  });

  appShellProps.inputModal = inputModal;
  appShellProps.diffTabPrefix = DIFF_TAB_PREFIX;
  appShellProps.backendWorkspaceId = backendWorkspaceId;
  appShellProps.aiEngineClient = aiEngineClient;
  appShellProps.getBackendConfig = getBackendConfig;
  appShellProps.undoRedoLimit = Number(config.editorUndoRedoLimit) || DEFAULT_PROJECT_CONFIG.editorUndoRedoLimit;
  appShellProps.changeEditorNavigationMode = changeEditorNavigationMode;
  appShellProps.settingsTabPath = SETTINGS_TAB_PATH;
  appShellProps.terminalSettingsTabPath = TERMINAL_SETTINGS_TAB_PATH;
  appShellProps.terminalEditorTabPath = TERMINAL_EDITOR_TAB_PATH;
  appShellProps.welcomeTabPath = WELCOME_TAB_PATH;

  return <AppShell {...appShellProps} />;
}

export default function AppWorkbenchContainer({
  config,
  setConfig,
  getBackendConfig,
  toolSettings,
  setToolSettings,
  mergeToolSettings,
  globalConfigHydratedRef,
  userThemePreferenceRef,
  theme,
  setTheme,
  sidebarWidth,
  setSidebarWidth,
  sidebarCollapsed,
  setSidebarCollapsed,
  setActiveSidebarPanel,
  lastSidebarWidthRef,
  setInputModal,
  children,
}) {
  const [projectConfig, setProjectConfig] = useState(DEFAULT_PROJECT_CONFIG);
  const [configured, setConfigured] = useState(false);
  const [projectMeta, setProjectMeta] = useState({ id: null, name: '', pathLabel: '' });
  const [recentProjects, setRecentProjects] = useState([]);
  const [activeWorkspaces, setActiveWorkspaces] = useState([]);

  const workbench = useWorkbenchStateMachine();
  const workspaceServices = useMemo(() => createWorkspaceServices(), []);
  const {
    model: workbenchModel,
    boot: workbenchBoot,
    syncFromLegacy: syncWorkbenchFromLegacy,
    openRequested: workbenchOpenRequested,
    closeRequested: workbenchCloseRequested,
  } = workbench;

  const workspaceControllerRef = useRef(null);
  const configHydratedRef = useRef(false);
  const configSaveTimerRef = useRef(null);

  const hasElectronPicker = useCallback(() => {
    return typeof window !== 'undefined' && (!!window.electronAPI?.workspace?.pickFolder || !!window.electronAPI?.openFolder);
  }, []);

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

  const backendBound = !!backendWorkspaceRoot && workspaceBindingStatus === 'ready';

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
        llamacpp: { ...DEFAULT_PROJECT_CONFIG.llamacpp, ...(cfg.llamacpp || {}) },
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
    const initialBackendRoot = isAbsolutePath(cfg.backendRoot) ? cfg.backendRoot : (isAbsolutePath(cfg.projectPath) ? cfg.projectPath : '');
    setBackendWorkspaceRoot(initialBackendRoot);
    setWorkspaceRootLabel(initialBackendRoot || cfg.projectPath || driver?.pathLabel || driver?.rootName || '');
  }, [
    config,
    globalConfigHydratedRef,
    lastSidebarWidthRef,
    mergeToolSettings,
    setActiveSidebarPanel,
    setBackendWorkspaceRoot,
    setConfig,
    setSidebarCollapsed,
    setSidebarWidth,
    setTheme,
    setToolSettings,
    setWorkspaceRootLabel,
    userThemePreferenceRef,
  ]);

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
      view: 'code',
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
      pathLabel: cfg.projectPath || cfg.backendRoot || driver.pathLabel || driver.rootName,
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
  }, [
    applyConfigToState,
    loadProjectConfigFromDisk,
    openBackendWorkspace,
    refreshRecentProjects,
    setBackendWorkspaceRoot,
    setCurrentSessionId,
    setLogs,
    setMessages,
    setProjectConfig,
    setSessions,
    setShowLogs,
    setTaskReview,
    setToolRuns,
    setWorkspaceBindingError,
    setWorkspaceBindingStatus,
    setWorkspaceDriver,
    setWorkspaceRootLabel,
    setWorkspaceState,
    syncWorkspaceFromDisk,
    taskSnapshotRef,
  ]);

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
  }, [hasElectronPicker]);

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

      url.searchParams.delete('openFile');
      url.searchParams.delete('openMode');
      url.searchParams.delete('workspaceFsPath');
      url.searchParams.delete('newWindow');
      try {
        window.history.replaceState({}, '', url.toString());
      } catch {
      }

      pendingDeepLinkRef.current = { openFile: openFileParam, openMode: openModeParam, workspaceFsPath: workspaceFsPathParam, newWindow: isNewWindow };
      if (workspaceFsPathParam && !isNewWindow) {
        workspaceController.openWorkspace(workspaceFsPathParam, { preferredRoot: workspaceFsPathParam });
      }
    } catch {
    }
  }, [pendingDeepLinkRef, workspaceController]);

  useAppStartup({
    config,
    pendingDeepLinkRef,
    LocalWorkspaceDriver,
    hydrateProject,
    refreshRecentProjects,
    setWorkspaceBindingStatus,
    setWorkspaceBindingError,
    workbenchBoot,
  });

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

  useEffect(() => {
    workspaceController.effectEnsureWelcomeTabWhenNoWorkspace({ workspaceDriver });
  }, [workspaceController, workspaceDriver]);

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
  }, [backendWorkspaceId, backendWorkspaceRoot, projectMeta, workspaceBindingStatus, workspaceController, workspaceDriver, workspaceRootLabel]);

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
  }, [clearPendingStartAction, clearPendingTemplate, createTemplateProjectInWorkspace, setWorkspaceBindingError, setWorkspaceBindingStatus, workspaceBindingStatus, workspaceDriver]);

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
      onConfirm: (inputValue) => {
        if (inputValue) {
          openBackendWorkspace(inputValue, { silent: false });
        }
        setInputModal((prev) => ({ ...prev, isOpen: false }));
      },
      onClose: () => setInputModal((prev) => ({ ...prev, isOpen: false })),
    });
  }, [backendWorkspaceRoot, openBackendWorkspace, projectConfig.backendRoot, projectConfig.projectPath, setInputModal]);

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
  }, [pendingOpenFileRef, recentProjects, setWorkspaceBindingError, setWorkspaceBindingStatus, workspaceController]);

  const openWorkspaceWithPreferredRoot = useCallback(async (preferredRoot) => {
    const root = String(preferredRoot || '').trim();
    if (!root) return;
    clearPendingOpenFile();
    await workspaceController.openWorkspace(null, { preferredRoot: root });
  }, [clearPendingOpenFile, workspaceController]);

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

  useEffect(() => {
    const label = projectConfig.projectPath || projectConfig.backendRoot;
    if (label) {
      setWorkspaceRootLabel(label);
    }
  }, [projectConfig.projectPath, projectConfig.backendRoot, setWorkspaceRootLabel]);

  useEffect(() => {
    if (!projectConfig.projectPath) return;
    setProjectMeta((prev) => ({ ...prev, pathLabel: projectConfig.projectPath }));
  }, [projectConfig.projectPath]);

  useEffect(() => {
    setProjectConfig((prev) => (prev.theme === theme ? prev : { ...prev, theme }));
  }, [theme]);

  useEffect(() => {
    setProjectConfig((prev) => (prev.sidebarWidth === sidebarWidth ? prev : { ...prev, sidebarWidth }));
    if (!sidebarCollapsed) {
      lastSidebarWidthRef.current = sidebarWidth;
    }
  }, [sidebarWidth, sidebarCollapsed, lastSidebarWidthRef]);

  useEffect(() => {
    if (!backendWorkspaceRoot) return;
    setProjectConfig((prev) => (prev.backendRoot === backendWorkspaceRoot ? prev : { ...prev, backendRoot: backendWorkspaceRoot, projectPath: prev.projectPath || backendWorkspaceRoot }));
  }, [backendWorkspaceRoot]);

  const value = useMemo(() => ({
    projectMeta,
    setProjectMeta,
    recentProjects,
    refreshRecentProjects,
    removeRecentProject,
    activeWorkspaces,
    backendBound,
    projectConfig,
    setProjectConfig,
    configured,
    workbenchModel,
    workspaceServices,
    workspaceController,
    workspaceControllerRef,
    handleSelectWorkspace,
    promptOpenWorkspace,
    closeWorkspaceToWelcome,
    projectFetch,
    aiEngineClient,
    getBackendConfig,
    normalizeProjectConfig,
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
    handleOpenBackendWorkspaceFromList,
    handleOpenFileFromWelcome,
    openWorkspaceWithPreferredRoot,
    pickNativeFolderPath,
    cloneRepositoryFromWelcome,
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
    sessionActions,
  }), [
    activeWorkspaces,
    aiEngineClient,
    applyWorkspaceEditCreateFile,
    applyWorkspaceEditDeletePath,
    applyWorkspaceEditReadFile,
    applyWorkspaceEditRenamePath,
    applyWorkspaceEditWriteFile,
    backendBound,
    backendWorkspaceId,
    backendWorkspaceRoot,
    backendWorkspaceRootRef,
    clearPendingOpenFile,
    clearPendingStartAction,
    clearPendingTemplate,
    closeEditors,
    closeFile,
    closeWorkspaceToWelcome,
    configured,
    createTemplateProjectInWorkspace,
    currentMode,
    currentSessionId,
    diffTabs,
    getBackendConfig,
    handleActiveEditorChange,
    handleActiveGroupChange,
    handleAddFile,
    handleAddFolder,
    handleDeletePath,
    handleFileChange,
    handleGlobalSearch,
    handleNewFileFromWelcome,
    handleOpenBackendWorkspaceFromList,
    handleOpenFileFromWelcome,
    handleRefreshPreview,
    handleRenamePath,
    handleSelectWorkspace,
    handleTabReorder,
    hotReloadToken,
    input,
    loadingSessions,
    logs,
    messages,
    normalizeProjectConfig,
    openBackendWorkspace,
    openDiffTabInWorkspace,
    openFile,
    openWorkspaceWithPreferredRoot,
    pendingDeepLinkRef,
    pendingOpenFileRef,
    pendingStartActionRef,
    pendingTemplateRef,
    pickNativeFolderPath,
    projectConfig,
    projectFetch,
    projectMeta,
    promptOpenWorkspace,
    recentProjects,
    refreshRecentProjects,
    removeRecentProject,
    sessionActions,
    sessions,
    setActiveSidebarPanel,
    setBackendWorkspaceId,
    setBackendWorkspaceRoot,
    setCurrentMode,
    setCurrentSessionId,
    setDiffTabs,
    setHotReloadToken,
    setInput,
    setLoadingSessions,
    setLogs,
    setMessages,
    setProjectConfig,
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
    setWorkspaceLoading,
    showLogs,
    splitEditor,
    syncWorkspaceFromDisk,
    taskReview,
    toggleGroupLocked,
    togglePreviewEditorEnabled,
    toggleTabKeptOpen,
    toggleTabPinned,
    toolRuns,
    workspaceBindingError,
    workspaceBindingStatus,
    workspaceController,
    workspaceControllerRef,
    workspaceDriver,
    workspaceLoading,
    workspaceProps,
    workspaceRootLabel,
    workspaceServices,
    workspaceState,
    workbenchModel,
  ]);

  return (
    <AppWorkbenchContext.Provider value={value}>
      {children}
    </AppWorkbenchContext.Provider>
  );
}
