import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import NavSidebar from './components/NavSidebar';
import SessionDrawer from './components/SessionDrawer';
import ExplorerPanel from './components/ExplorerPanel';
import ChatArea from './components/ChatArea';
import LogPanel from './components/LogPanel';
import ConfigPanel from './components/ConfigPanel';
import TitleBar from './components/TitleBar';
import EditorArea from './workbench/layout/EditorArea';
import WorkbenchShell from './workbench/WorkbenchShell';
import { LocalWorkspaceDriver } from './utils/localWorkspaceDriver';
import { BackendWorkspaceDriver } from './utils/backendWorkspaceDriver';
import DiffModal from './components/DiffModal';
import { GitDriver } from './utils/gitDriver';
import SourceControlPanel from './components/SourceControlPanel';
import WelcomeEditor from './workbench/editors/WelcomeEditor';
import { WELCOME_TAB_PATH } from './workbench/constants';
import { useWorkbenchStateMachine, WorkbenchStates } from './workbench/workbenchStateMachine';
import { createWorkspaceServices } from './workbench/workspace/workspaceServices';
import { createWorkspaceController } from './workbench/workspace/workspaceController';
import ConnectRemoteModal from './components/ConnectRemoteModal';
import CloneRepositoryModal from './components/CloneRepositoryModal';
import SearchPanel from './components/SearchPanel';
import CommandPalette from './components/CommandPalette';
import { getTranslation } from './utils/i18n';
import { createAiEngineClient, readTextResponseBody } from './utils/aiEngineClient';

const DEBUG_SEPARATORS = false;

const THEME_STORAGE_KEY = 'ai_agent_theme_choice';
const LANGUAGE_STORAGE_KEY = 'ai_agent_language_choice';
const detectSystemTheme = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

const readStoredLanguage = () => {
    if (typeof window === 'undefined') return 'zh'; // Default to Chinese
    try {
        return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) || 'zh';
    } catch {
        return 'zh';
    }
};

const persistLanguageChoice = (value) => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
    } catch {
        // ignore
    }
};

const pathDirname = (absPath = '') => {
  const s = String(absPath || '');
  const idx1 = s.lastIndexOf('/');
  const idx2 = s.lastIndexOf('\\');
  const idx = Math.max(idx1, idx2);
  if (idx < 0) return '';
  return s.slice(0, idx);
};

const pathJoinAbs = (baseAbs = '', rel = '') => {
  const base = String(baseAbs || '').replace(/[\\\/]+$/, '');
  const suffix = String(rel || '').replace(/^[\\\/]+/, '');
  if (!base) return suffix;
  if (!suffix) return base;
  const sep = base.includes('\\') ? '\\' : '/';
  const normalized = suffix.replace(/[\\\/]+/g, sep);
  return `${base}${sep}${normalized}`;
};

const pathRelativeToRoot = (rootAbs = '', fileAbs = '') => {
  const root = String(rootAbs || '').replace(/[\\\/]+$/, '');
  const file = String(fileAbs || '');
  if (!root || !file) return '';
  const lowerRoot = root.toLowerCase();
  const lowerFile = file.toLowerCase();
  if (!lowerFile.startsWith(lowerRoot)) return '';
  let rel = file.slice(root.length);
  rel = rel.replace(/^[\\\/]+/, '');
  rel = rel.replace(/\\/g, '/');
  if (!rel || rel.includes('..')) return '';
  return rel;
};

const isFileUnderRoot = (rootAbs = '', fileAbs = '') => {
  const root = String(rootAbs || '').replace(/[\\\/]+$/, '');
  const file = String(fileAbs || '');
  if (!root || !file) return false;
  return file.toLowerCase().startsWith(root.toLowerCase());
};
const readStoredTheme = () => {
  if (typeof window === 'undefined') return null;
  try {
      return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
      return null;
  }
};
const persistThemeChoice = (value) => {
  if (typeof window === 'undefined') return;
  try {
      window.localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
      // ignore storage errors
  }
};

const SESSION_STORAGE_KEY = 'ai_agent_sessions_ping';
const LAYOUT_STORAGE_KEY = 'ai_agent_layout_state';

const GLOBAL_CONFIG_STORAGE_KEY = 'ai_agent_global_llm_config_v1';

const readGlobalConfig = () => {
  if (typeof window === 'undefined') return null;
  try {
      const raw = window.localStorage.getItem(GLOBAL_CONFIG_STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
  } catch {
      return null;
  }
};

const persistGlobalConfig = (value) => {
  if (typeof window === 'undefined') return;
  try {
      const payload = value || {};
      window.localStorage.setItem(GLOBAL_CONFIG_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
      console.warn('Persist global config failed', err);
  }
};

const MODE_OPTIONS = [
  { key: 'chat', label: 'Chat', description: '纯聊天，无任何工具' },
  { key: 'plan', label: 'Plan', description: '结构化计划/路标/甘特图/TODO 输出' },
  { key: 'canva', label: 'Canva', description: '画布式网页/前端开发，自动预览' },
  { key: 'agent', label: 'Agent', description: '全工具 Agent，可手动关停工具' },
];

const DEFAULT_TOOL_SETTINGS = {
  agent: {
    read_file: true,
    write_file: true,
    edit_file: true,
    list_files: true,
    create_folder: true,
    delete_file: true,
    rename_file: true,
    search_in_files: true,
    get_current_project_structure: true,
    execute_shell: true,
    screen_capture: true,
    mouse_control: true,
      keyboard_control: true,
      workspace_semantic_search: true,
    },
    canva: {
      read_file: true,
      write_file: true,
      edit_file: true,
      list_files: true,
      create_folder: true,
      delete_file: true,
      rename_file: true,
      search_in_files: true,
      get_current_project_structure: true,
      execute_shell: true,
      workspace_semantic_search: true,
    },
  };

const DEFAULT_KEYBINDINGS = {
  'app.commandPalette': 'Ctrl+Shift+P',
  'app.quickOpen': 'Ctrl+P',
  'editor.ai.explain': 'Ctrl+Alt+E',
  'editor.ai.tests': 'Ctrl+Alt+T',
  'editor.ai.optimize': 'Ctrl+Alt+O',
  'editor.ai.comments': 'Ctrl+Alt+C',
  'editor.ai.review': 'Ctrl+Alt+R',
  'editor.ai.rewrite': 'Ctrl+Alt+W',
  'editor.ai.modify': 'Ctrl+Alt+M',
  'editor.ai.docs': 'Ctrl+Alt+D',
};

const DEFAULT_PROJECT_CONFIG = {
  projectName: '',
  projectPath: '',
  backendRoot: '',
  workspaceId: '',
  provider: 'openai',
  default_models: { general: '', fast: '', reasoning: '', tools: '', embeddings: '' },
  routing: {},
  embedding_options: { context_max_length: 32768 },
  openai: { api_key: '', model: '', base_url: '', check_model: '', top_p: 0.9, instances: [{ id: 'default', label: 'Default', api_key: '', base_url: '' }], active_instance_id: 'default' },
  anthropic: { api_key: '', model: '', base_url: '', check_model: '', top_p: 0.9, instances: [{ id: 'default', label: 'Default', api_key: '', base_url: '' }], active_instance_id: 'default' },
  openrouter: { api_key: '', model: '', base_url: '', check_model: '', top_p: 0.9, instances: [{ id: 'default', label: 'Default', api_key: '', base_url: '' }], active_instance_id: 'default' },
  xai: { api_key: '', model: '', base_url: '', check_model: '', top_p: 0.9, instances: [{ id: 'default', label: 'Default', api_key: '', base_url: '' }], active_instance_id: 'default' },
  ollama: { api_key: '', model: '', base_url: 'http://localhost:11434/v1', check_model: '', top_p: 0.9, instances: [{ id: 'default', label: 'Default', api_key: 'ollama', base_url: 'http://localhost:11434/v1' }], active_instance_id: 'default' },
  lmstudio: { api_key: '', model: '', base_url: 'http://localhost:1234/v1', check_model: '', top_p: 0.9, instances: [{ id: 'default', label: 'Default', api_key: 'lm-studio', base_url: 'http://localhost:1234/v1' }], active_instance_id: 'default' },
  llamacpp: { api_key: '', model: '', base_url: 'http://localhost:8080/v1', check_model: '', top_p: 0.9, instances: [{ id: 'default', label: 'Default', api_key: 'local', base_url: 'http://localhost:8080/v1' }], active_instance_id: 'default' },
  toolSettings: DEFAULT_TOOL_SETTINGS,
  keybindings: DEFAULT_KEYBINDINGS,
  editorUndoRedoLimit: 16,
  theme: detectSystemTheme(),
  sidebarWidth: 260,
  chatPanelWidth: 420,
  lastMode: 'chat',
};

const isAbsolutePath = (path = '') => {
  const trimmed = (path || '').trim();
  if (!trimmed) return false;
  return /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\') || trimmed.startsWith('/');
};

const normalizeRelPath = (path = '') => (path || '').replace(/^[./\\]+/, '');
const shouldHidePath = (path = '') => {
  const clean = normalizeRelPath(path);
  return clean === '.aichat' || clean.startsWith('.aichat/') || clean.startsWith('.aichat\\');
};

const safeDiffStat = (before = '', after = '') => {
  const a = String(before || '').split('\n');
  const b = String(after || '').split('\n');
  const m = a.length;
  const n = b.length;
  if (m === 0 && n === 0) return { added: 0, removed: 0 };
  if (m === 0) return { added: n, removed: 0 };
  if (n === 0) return { added: 0, removed: m };
  // Guard against pathological memory usage on very large files
  if (m * n > 2000000) {
      return { added: Math.max(n - m, 0), removed: Math.max(m - n, 0) };
  }
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i += 1) {
      for (let j = 1; j <= n; j += 1) {
          dp[i][j] = a[i - 1] === b[j - 1]
              ? dp[i - 1][j - 1] + 1
              : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
  }
  let i = m;
  let j = n;
  let added = 0;
  let removed = 0;
  while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
          i -= 1;
          j -= 1;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
          removed += 1;
          i -= 1;
      } else {
          added += 1;
          j -= 1;
      }
  }
  removed += i;
  added += j;
  return { added, removed };
};

const readLayoutPrefs = () => {
  if (typeof window === 'undefined') return {};
  try {
      return JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) || '{}') || {};
  } catch {
      return {};
  }
};

const persistLayoutPrefs = (patch = {}) => {
  if (typeof window === 'undefined') return;
  try {
      const current = readLayoutPrefs();
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch (err) {
      console.warn('Persist layout prefs failed', err);
  }
};

const pickLayoutNumber = (key, fallback) => {
  const prefs = readLayoutPrefs();
  const val = Number(prefs[key]);
  if (Number.isFinite(val) && val > 0) return val;
  return fallback;
};

const mapFlatConfigToState = (snapshot = {}, fallback = {}) => {
  const provider = snapshot.provider || fallback.provider || 'openai';
  const shared = {
      api_key: snapshot.api_key || '',
      model: snapshot.model || '',
      base_url: snapshot.base_url || '',
      check_model: snapshot.check_model || '',
      context_max_length: snapshot.context_max_length,
      output_max_tokens: snapshot.output_max_tokens,
      temperature: snapshot.temperature,
      top_p: snapshot.top_p ?? 0.9,
      context_independent: snapshot.context_independent
  };
  const providerIds = ['openai', 'anthropic', 'openrouter', 'xai', 'ollama', 'lmstudio', 'llamacpp'];
  const out = {
      provider,
      default_models: { ...(DEFAULT_PROJECT_CONFIG.default_models || {}), ...((fallback.default_models && typeof fallback.default_models === 'object') ? fallback.default_models : {}) },
      routing: ((fallback.routing && typeof fallback.routing === 'object') ? fallback.routing : {}),
      embedding_options: {
          ...(((fallback.embedding_options && typeof fallback.embedding_options === 'object') ? fallback.embedding_options : {})),
          ...(((snapshot.embedding_options && typeof snapshot.embedding_options === 'object') ? snapshot.embedding_options : {})),
      },
  };
  providerIds.forEach((providerId) => {
      const base = DEFAULT_PROJECT_CONFIG[providerId] || {};
      const prev = fallback[providerId] || {};
      const nextProviderCfg = { ...base, ...prev, ...(provider === providerId ? shared : {}) };
      if (!Array.isArray(nextProviderCfg.instances)) {
          nextProviderCfg.instances = Array.isArray(prev.instances) ? prev.instances : (Array.isArray(base.instances) ? base.instances : [{ id: 'default', label: 'Default', api_key: '', base_url: '' }]);
      }
      if (!nextProviderCfg.active_instance_id) {
          nextProviderCfg.active_instance_id = (nextProviderCfg.instances[0] && nextProviderCfg.instances[0].id) ? String(nextProviderCfg.instances[0].id) : 'default';
      }
      out[providerId] = nextProviderCfg;
  });
  return out;
};

const InputModal = ({ isOpen, title, label, defaultValue, onConfirm, onClose }) => {
    const [value, setValue] = useState(defaultValue);
    useEffect(() => {
        if (isOpen) setValue(defaultValue);
    }, [isOpen, defaultValue]);

    if (!isOpen) return null;

    return (
        <div className="config-modal-backdrop" onClick={onClose}>
            <div className="config-modal" style={{ width: '400px' }} onClick={e => e.stopPropagation()}>
                <div className="config-header">
                    <h3 className="config-title">{title}</h3>
                    <button className="config-close" onClick={onClose}>×</button>
                </div>
                <div className="config-form">
                    <div className="config-field">
                        <label className="config-label">{label}</label>
                        <input 
                            className="config-input" 
                            value={value} 
                            onChange={e => setValue(e.target.value)}
                            autoFocus
                            onKeyDown={e => {
                                if (e.key === 'Enter') onConfirm(value);
                                if (e.key === 'Escape') onClose();
                            }}
                        />
                    </div>
                    <div className="config-actions" style={{ justifyContent: 'flex-end' }}>
                        <button className="ghost-btn" onClick={onClose}>取消</button>
                        <button className="primary-btn" onClick={() => onConfirm(value)}>确定</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const initialWorkspaceState = {
  files: [],
  fileTree: [],
  openTabs: [],
  activeFile: '',
  previewWidth: 50,
  livePreview: '',
  view: 'code',
  entryCandidates: [],
  previewEntry: '',
  workspaceRoots: [],
};

const SETTINGS_TAB_PATH = '__system__/settings';
const DIFF_TAB_PREFIX = '__diff__/';

function App() {
  const mergeToolSettings = (incoming) => ({
      agent: { ...DEFAULT_TOOL_SETTINGS.agent, ...(incoming?.agent || {}) },
      canva: { ...DEFAULT_TOOL_SETTINGS.canva, ...(incoming?.canva || {}) }
  });
  const storedThemePreference = readStoredTheme();
  const [language, setLanguage] = useState(readStoredLanguage);

  const handleLanguageChange = (lang) => {
    setLanguage(lang);
    persistLanguageChoice(lang);
  };

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
    const base = { ...DEFAULT_PROJECT_CONFIG, ...(stored || {}) };
    if (!base.default_models || typeof base.default_models !== 'object') base.default_models = { ...DEFAULT_PROJECT_CONFIG.default_models };
    if (!base.routing || typeof base.routing !== 'object') base.routing = {};
    if (!base.embedding_options || typeof base.embedding_options !== 'object') base.embedding_options = {};
    base.embedding_options = { ...(DEFAULT_PROJECT_CONFIG.embedding_options || {}), ...(base.embedding_options || {}) };
    if (!base.keybindings || typeof base.keybindings !== 'object') base.keybindings = { ...DEFAULT_PROJECT_CONFIG.keybindings };
    else base.keybindings = { ...DEFAULT_PROJECT_CONFIG.keybindings, ...base.keybindings };

    const providerIds = ['openai', 'anthropic', 'openrouter', 'xai', 'ollama', 'lmstudio', 'llamacpp'];
    providerIds.forEach((providerId) => {
      const def = DEFAULT_PROJECT_CONFIG[providerId] || {};
      const incoming = base[providerId] || {};
      const instancesRaw = Array.isArray(incoming.instances) ? incoming.instances : null;
      const instances = (instancesRaw && instancesRaw.length > 0)
        ? instancesRaw.map((inst) => ({
            id: String(inst?.id || 'default'),
            label: typeof inst?.label === 'string' ? inst.label : String(inst?.id || 'default'),
            api_key: inst?.api_key ?? inst?.apiKey ?? '',
            base_url: inst?.base_url ?? inst?.baseUrl ?? '',
          }))
        : [{
            id: 'default',
            label: 'Default',
            api_key: incoming.api_key || def.api_key || '',
            base_url: incoming.base_url || def.base_url || '',
          }];
      const activeId = incoming.active_instance_id || incoming.activeInstanceId || instances[0]?.id || 'default';
      base[providerId] = {
        ...def,
        ...incoming,
        instances,
        active_instance_id: activeId,
      };
    });

    return {
      provider: base.provider || DEFAULT_PROJECT_CONFIG.provider,
      default_models: base.default_models,
      routing: base.routing,
      embedding_options: (base.embedding_options && typeof base.embedding_options === 'object') ? base.embedding_options : {},
      keybindings: base.keybindings,
      openai: { ...DEFAULT_PROJECT_CONFIG.openai, ...(base.openai || {}) },
      anthropic: { ...DEFAULT_PROJECT_CONFIG.anthropic, ...(base.anthropic || {}) },
      openrouter: { ...DEFAULT_PROJECT_CONFIG.openrouter, ...(base.openrouter || {}) },
      xai: { ...DEFAULT_PROJECT_CONFIG.xai, ...(base.xai || {}) },
      ollama: { ...DEFAULT_PROJECT_CONFIG.ollama, ...(base.ollama || {}) },
      lmstudio: { ...DEFAULT_PROJECT_CONFIG.lmstudio, ...(base.lmstudio || {}) },
      llamacpp: { ...DEFAULT_PROJECT_CONFIG.llamacpp, ...(base.llamacpp || {}) },
    };
  });
  const [uiDisplayPreferences, setUiDisplayPreferences] = useState(() => {
    const stored = readGlobalConfig();
    return stored?.uiDisplayPreferences || { settings: 'modal', diff: 'modal' };
  });
  const [showConfig, setShowConfig] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [apiStatus, setApiStatus] = useState('unknown');
  const [apiMessage, setApiMessage] = useState('');
  const [projectMeta, setProjectMeta] = useState({ id: null, name: '', pathLabel: '' });
  const [recentProjects, setRecentProjects] = useState([]);

  // --- Session State ---
  const [sessions, setSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [toolRuns, setToolRuns] = useState({});
  const [input, setInput] = useState('');
  const [taskReview, setTaskReview] = useState({ taskId: null, files: [], status: 'idle', expanded: false });
  const [loadingSessions, setLoadingSessions] = useState(new Set());
  const [currentMode, setCurrentMode] = useState('chat');
  const [workspaceState, setWorkspaceState] = useState(initialWorkspaceState);
  const [diffTabs, setDiffTabs] = useState({});
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceDriver, setWorkspaceDriver] = useState(null);
  const [workspaceBindingStatus, setWorkspaceBindingStatus] = useState('idle'); // idle | checking | ready | error
  const [workspaceBindingError, setWorkspaceBindingError] = useState('');
  const [workspaceRootLabel, setWorkspaceRootLabel] = useState('');
  const [backendWorkspaceRoot, setBackendWorkspaceRoot] = useState('');
  const [backendWorkspaceId, setBackendWorkspaceId] = useState('');
  const [activeWorkspaces, setActiveWorkspaces] = useState([]);
  const [hotReloadToken, setHotReloadToken] = useState(0);
  const [toolSettings, setToolSettings] = useState(() => {
    const stored = readGlobalConfig();
    return mergeToolSettings(stored?.toolSettings || DEFAULT_TOOL_SETTINGS);
  });
  const [theme, setTheme] = useState(() => storedThemePreference || DEFAULT_PROJECT_CONFIG.theme || detectSystemTheme());
  const abortControllerRef = useRef(null);
  const pendingOpenFileRef = useRef({ absPath: '', expectedRoot: '' });
  const clearPendingOpenFile = useCallback(() => {
      pendingOpenFileRef.current = { absPath: '', expectedRoot: '' };
  }, []);
  const pendingStartActionRef = useRef({ type: null });
  const clearPendingStartAction = useCallback(() => {
      pendingStartActionRef.current = { type: null };
  }, []);
  const pendingTemplateRef = useRef(null);
  const clearPendingTemplate = useCallback(() => {
      pendingTemplateRef.current = null;
  }, []);
  const saveTimersRef = useRef({});
  const configSaveTimerRef = useRef(null);
  const streamBufferRef = useRef('');
  const toolRunSyncTimerRef = useRef(null);
  const syncLockRef = useRef(false);
  const lastSyncRef = useRef(0);
  const workspaceInitializedRef = useRef(false);
  const taskSnapshotRef = useRef(null);
  const configHydratedRef = useRef(false);
  const globalConfigHydratedRef = useRef(!!readGlobalConfig());
  const userThemePreferenceRef = useRef(!!storedThemePreference);
  const diffTabCounterRef = useRef(0);

  // --- Modal State ---
  const [inputModal, setInputModal] = useState({ isOpen: false, title: '', label: '', defaultValue: '', onConfirm: () => {}, onClose: () => {} });
  const [diffModal, setDiffModal] = useState(null);
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [configFullscreen, setConfigFullscreen] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [editorAiInvoker, setEditorAiInvoker] = useState(null);

  // --- Logs State ---
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState([]);

  // --- Layout State ---
  const [sidebarWidth, setSidebarWidth] = useState(() => pickLayoutNumber('sidebarWidth', DEFAULT_PROJECT_CONFIG.sidebarWidth));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSidebarPanel, setActiveSidebarPanel] = useState('sessions');
  
  // --- Git State ---
  const [gitStatus, setGitStatus] = useState(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitRemotes, setGitRemotes] = useState([]);
  const [gitLog, setGitLog] = useState([]);
  const [gitBranches, setGitBranches] = useState({ all: [], current: '', branches: {} });

  const [activeResizeTarget, setActiveResizeTarget] = useState(null);
  const resizeStateRef = useRef({ target: null, startX: 0, startWidth: 0 });
  const resizePendingRef = useRef({ target: null, width: 0, delta: 0 });
  const resizeRafRef = useRef(null);
  
  // --- Resizer State ---
  // 拖拽分隔条时悬浮提示内容（null 表示隐藏）
  const [resizeTooltip, setResizeTooltip] = useState(null);
  
  const lastSidebarWidthRef = useRef(pickLayoutNumber('sidebarWidth', DEFAULT_PROJECT_CONFIG.sidebarWidth));
  const sidebarResizerGhostRef = useRef(null);
  const [showResizeOverlay, setShowResizeOverlay] = useState(false);

  const projectReady = !!workspaceDriver;
  const backendBound = !!backendWorkspaceRoot && workspaceBindingStatus === 'ready';
  const hasElectronPicker = () =>
      typeof window !== 'undefined' && (!!window.electronAPI?.workspace?.pickFolder || !!window.electronAPI?.openFolder);
  const projectHeaders = useMemo(
      () => (backendWorkspaceRoot ? { 'X-Workspace-Root': backendWorkspaceRoot } : {}),
      [backendWorkspaceRoot]
  );

  const projectFetch = useCallback((url, options = {}) => {
      const headers = { ...(options.headers || {}), ...projectHeaders };
      return fetch(url, { ...options, headers });
  }, [projectHeaders]);

  const aiEngineClient = useMemo(() => createAiEngineClient({ fetch: projectFetch }), [projectFetch]);

  const normalizeProjectConfig = useCallback((raw = {}) => {
      const merged = {
          ...DEFAULT_PROJECT_CONFIG,
          ...raw,
      };
      if (!merged.default_models || typeof merged.default_models !== 'object') merged.default_models = { ...DEFAULT_PROJECT_CONFIG.default_models };
      if (!merged.routing || typeof merged.routing !== 'object') merged.routing = {};
      if (!merged.embedding_options || typeof merged.embedding_options !== 'object') merged.embedding_options = {};
      merged.embedding_options = { ...(DEFAULT_PROJECT_CONFIG.embedding_options || {}), ...(merged.embedding_options || {}) };
      if (!merged.keybindings || typeof merged.keybindings !== 'object') merged.keybindings = { ...DEFAULT_PROJECT_CONFIG.keybindings };
      else merged.keybindings = { ...DEFAULT_PROJECT_CONFIG.keybindings, ...merged.keybindings };

      const providerIds = ['openai', 'anthropic', 'openrouter', 'xai', 'ollama', 'lmstudio', 'llamacpp'];
      providerIds.forEach((providerId) => {
          const base = DEFAULT_PROJECT_CONFIG[providerId] || {};
          const incoming = merged[providerId] || {};
          const instancesRaw = Array.isArray(incoming.instances) ? incoming.instances : null;
          const instances = (instancesRaw && instancesRaw.length > 0)
              ? instancesRaw.map((inst) => ({
                    id: String(inst?.id || 'default'),
                    label: typeof inst?.label === 'string' ? inst.label : String(inst?.id || 'default'),
                    api_key: inst?.api_key ?? inst?.apiKey ?? '',
                    base_url: inst?.base_url ?? inst?.baseUrl ?? '',
                }))
              : [{
                    id: 'default',
                    label: 'Default',
                    api_key: incoming.api_key || '',
                    base_url: incoming.base_url || '',
                }];
          const activeId = incoming.active_instance_id || incoming.activeInstanceId || instances[0]?.id || 'default';
          merged[providerId] = {
              ...base,
              ...incoming,
              instances,
              active_instance_id: activeId,
          };
      });
      merged.toolSettings = mergeToolSettings(raw.toolSettings || DEFAULT_PROJECT_CONFIG.toolSettings);
      merged.sidebarWidth = Number(merged.sidebarWidth || merged.sessionPanelWidth) || DEFAULT_PROJECT_CONFIG.sidebarWidth;
      merged.chatPanelWidth = Number(merged.chatPanelWidth) || DEFAULT_PROJECT_CONFIG.chatPanelWidth;
      {
          const undoLimitRaw = Number(merged.editorUndoRedoLimit);
          merged.editorUndoRedoLimit = Number.isFinite(undoLimitRaw)
              ? Math.max(8, Math.min(64, Math.round(undoLimitRaw)))
              : DEFAULT_PROJECT_CONFIG.editorUndoRedoLimit;
      }
      merged.theme = merged.theme || DEFAULT_PROJECT_CONFIG.theme;
      merged.lastMode = merged.lastMode || DEFAULT_PROJECT_CONFIG.lastMode;
      merged.projectName = merged.projectName || projectMeta.name || merged.projectPath || '';
      merged.projectPath = merged.projectPath || merged.backendRoot || projectMeta.pathLabel || '';
      merged.backendRoot = merged.backendRoot || merged.projectPath || projectMeta.pathLabel || '';
      merged.workspaceId = merged.workspaceId || backendWorkspaceId || '';
      return merged;
  }, [mergeToolSettings, projectMeta.name, projectMeta.pathLabel, backendWorkspaceId]);

  const getBackendConfig = useCallback(() => {
      const providerId = config.provider;
      const current = config[providerId] || {};
      const instances = Array.isArray(current.instances) ? current.instances : [];
      const poolId = String(current.active_instance_id || (instances[0]?.id || 'default'));
      const active = instances.find((i) => String(i?.id) === poolId) || instances[0] || {};
      const parsedTopP = Number(current.top_p);
      const dm = (config.default_models && typeof config.default_models === 'object') ? config.default_models : {};
      const defaultModels = {
          general: typeof dm.general === 'string' ? dm.general : '',
          fast: typeof dm.fast === 'string' ? dm.fast : '',
          reasoning: typeof dm.reasoning === 'string' ? dm.reasoning : '',
          tools: typeof dm.tools === 'string' ? dm.tools : '',
          embeddings: typeof dm.embeddings === 'string' ? dm.embeddings : '',
      };
      if (!defaultModels.general && current.model) defaultModels.general = String(current.model);
      if (!defaultModels.tools && current.check_model) defaultModels.tools = String(current.check_model);
      const routing = (config.routing && typeof config.routing === 'object') ? config.routing : {};
      const routingPayload = {};
      Object.entries(routing).forEach(([cap, rule]) => {
          if (!rule || typeof rule !== 'object') return;
          const p = rule.provider;
          if (typeof p !== 'string' || p.trim().length === 0) return;
          const target = { provider: p.trim() };
          if (typeof rule.model === 'string' && rule.model.trim().length > 0) target.model = rule.model.trim();
          const rPool = typeof rule.pool_id === 'string' ? rule.pool_id.trim() : (typeof rule.poolId === 'string' ? rule.poolId.trim() : '');
          if (rPool) target.poolId = rPool;
          routingPayload[cap] = [target];
      });

      const providerIds = ['openai', 'anthropic', 'openrouter', 'xai', 'ollama', 'lmstudio', 'llamacpp'];
      const providers = {};
      providerIds.forEach((pid) => {
          const pCfg = config?.[pid] || {};
          const inst = Array.isArray(pCfg.instances) ? pCfg.instances : [];
          const pools = {};
          inst.forEach((i) => {
              const id = String(i?.id || 'default');
              const apiKey = typeof i?.api_key === 'string' ? i.api_key : (typeof pCfg.api_key === 'string' ? pCfg.api_key : '');
              const baseUrl = typeof i?.base_url === 'string' ? i.base_url : (typeof pCfg.base_url === 'string' ? pCfg.base_url : '');
              if (!apiKey || apiKey.trim().length === 0) return;
              pools[id] = { api_key: apiKey, base_url: baseUrl };
          });
          const poolIds = Object.keys(pools);
          if (poolIds.length === 0) return;
          const defaultPoolId = String(pCfg.active_instance_id || poolIds[0] || 'default');
          providers[pid] = { default_pool_id: defaultPoolId, pools };
      });

      return {
          provider: providerId,
          pool_id: poolId,
          api_key: active.api_key ?? current.api_key,
          model: current.model,
          base_url: active.base_url ?? current.base_url,
          check_model: current.check_model,
          default_models: defaultModels,
          routing: routingPayload,
          providers,
          embedding_options: (config.embedding_options && typeof config.embedding_options === 'object') ? config.embedding_options : undefined,
          context_max_length: current.context_max_length,
          output_max_tokens: current.output_max_tokens,
          temperature: current.temperature,
          top_p: Number.isFinite(parsedTopP) ? Math.min(1.0, Math.max(0.1, parsedTopP)) : 0.9,
          context_independent: current.context_independent
      };
  }, [config]);

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

  useEffect(() => {
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

      const eventToShortcut = (e) => {
          const k = String(e.key || '');
          const lower = k.toLowerCase();
          if (lower === 'control' || lower === 'meta' || lower === 'shift' || lower === 'alt') return '';

          const mods = [];
          if (e.metaKey || e.ctrlKey) mods.push('Ctrl');
          if (e.altKey) mods.push('Alt');
          if (e.shiftKey) mods.push('Shift');
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

      const matchShortcut = (e, shortcut) => {
          const expected = normalizeShortcut(shortcut);
          if (!expected) return false;
          const got = eventToShortcut(e);
          return !!got && got === expected;
      };

      const onKeyDown = (e) => {
          const tag = String(e.target?.tagName || '').toUpperCase();
          const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable;
          const inMonaco = !!e.target?.closest?.('.monaco-editor');
          if (isEditable && !inMonaco) return;

          const kb = keybindingsRef.current || {};
          const quickOpen = kb['app.quickOpen'] || DEFAULT_PROJECT_CONFIG.keybindings['app.quickOpen'];
          const commandPalette = kb['app.commandPalette'] || DEFAULT_PROJECT_CONFIG.keybindings['app.commandPalette'];

          if (matchShortcut(e, commandPalette) || matchShortcut(e, quickOpen)) {
              e.preventDefault();
              setShowCommandPalette(true);
          }
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
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
        if (!silent) checkApiStatus();
    } catch (err) {
      console.error(err);
      if (!silent) alert(`Error configuring agent: ${err.message}`);
    }
  };

  const applyStoredConfig = useCallback(async ({ silent = false } = {}) => {
      // Backend config persistence is deprecated.
      setConfigured(true);
      checkApiStatus();
  }, [checkApiStatus]);

  // --- Workspace helpers ---
  const persistToolSettings = (updater) => {
      setToolSettings((prev) => {
          const next = typeof updater === 'function' ? updater(prev) : updater;
          setProjectConfig((cfg) => ({ ...cfg, toolSettings: next }));
          return next;
      });
  };

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
          setProjectConfig((cfg) => ({ ...cfg, backendRoot: '' }));
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
          setProjectConfig((cfg) => ({ ...cfg, backendRoot: '' }));
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
              const res = await fetch('/api/workspace/bind-root', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-Workspace-Root': trimmed },
                  body: JSON.stringify({
                      root: trimmed,
                      settings: {
                          provider: config.provider,
                          model: (config[config.provider] && config[config.provider].model) || '',
                          llmConfig: getBackendConfig(),
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
              setProjectConfig((cfg) => ({
                  ...cfg,
                  backendRoot: applied,
                  projectPath: cfg.projectPath || applied,
                  workspaceId: workspaceId || cfg.workspaceId || '',
              }));
              setWorkspaceBindingError('');
              setWorkspaceBindingStatus('ready');
              if (GitDriver.isAvailable()) {
                  try {
                      setGitLoading(true);
                      const status = await GitDriver.status(applied);
                      setGitStatus(status);
                      const remotes = await GitDriver.getRemotes(applied);
                      setGitRemotes(remotes);
                      const log = await GitDriver.log(applied);
                      setGitLog(log?.all || []);
                  } finally {
                      setGitLoading(false);
                  }
              }
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
  }, [config, toolSettings]);

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
              const res = await fetch('/api/workspaces');
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
  }, []);

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
          const raw = await driver.readFile('.aichat/config.json');
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

  const syncWorkspaceFromDisk = useCallback(async ({ includeContent = true, highlight = true, driver: driverOverride = null, force = false, snapshot = null } = {}) => {
      const driver = driverOverride || workspaceDriver;
      if (!driver) {
          setWorkspaceBindingStatus((prev) => (prev === 'error' ? prev : 'idle'));
          return null;
      }
      const now = Date.now();
      const shouldThrottle = !force && !snapshot;
      if (shouldThrottle && syncLockRef.current) return null;
      // ✅ 增加防抖间隔，避免同步过于频繁（仅对主动拉取生效）
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
              updated: false
          }));

          setWorkspaceState((prev) => {
              const prevMap = Object.fromEntries(prev.files.map((f) => [f.path, f]));
              const merged = incoming.length ? incoming.map((file) => {
                  const prevFile = prevMap[file.path];
                  const changed = highlight && prevFile && prevFile.content !== file.content;
                  const isNew = highlight && !prevFile;
                  return { ...file, updated: changed || isNew };
              }) : prev.files;

              const userClosedAll = !prev.activeFile && prev.openTabs.length === 0;
              let activeFile = userClosedAll ? '' : (prev.activeFile || data.entry_candidates?.[0] || merged[0]?.path || '');
              let openTabs = prev.openTabs.length ? [...prev.openTabs] : [];

              if (!userClosedAll) {
                  merged.forEach((f) => {
                      if ((f.updated || !openTabs.length) && !openTabs.includes(f.path)) {
                          openTabs.push(f.path);
                      }
                  });
                  const mergedPaths = new Set(merged.map((f) => f.path));
                  if (activeFile && !mergedPaths.has(activeFile)) {
                      activeFile = data.entry_candidates?.[0] || merged[0]?.path || '';
                  }
                  openTabs = openTabs.filter((path) => mergedPaths.has(path));
                  if (activeFile && !openTabs.includes(activeFile)) openTabs.unshift(activeFile);
              }

              return {
                  ...prev,
                  files: merged,
                  fileTree: (data.entries || []).filter((entry) => !shouldHidePath(entry.path)) || prev.fileTree,
                  activeFile: userClosedAll ? '' : activeFile,
                  openTabs: userClosedAll ? [] : (openTabs.length ? openTabs : (activeFile ? [activeFile] : [])),
                  entryCandidates: data.entry_candidates || prev.entryCandidates,
                  workspaceRoots: Array.isArray(data.roots) ? data.roots : prev.workspaceRoots,
              };
          });
          lastSyncRef.current = Date.now();
          return { files: incoming, raw: data };
      } catch (err) {
          console.error('Workspace sync failed', err);
          setWorkspaceBindingError(err.message);
          setWorkspaceBindingStatus('error');
      } finally {
          syncLockRef.current = false;
          setWorkspaceLoading(false);
      }
  }, [workspaceDriver]);

  const captureWorkspaceSnapshot = useCallback(async () => {
      if (!workspaceDriver) return null;
      try {
          const data = await workspaceDriver.getStructure({ includeContent: true });
          const files = (data.files || [])
              .filter((f) => !shouldHidePath(f.path))
              .map((f) => ({ path: f.path, content: f.content ?? '' }));
          return { raw: data, files };
      } catch (err) {
          console.error('Capture workspace snapshot failed', err);
          return null;
      }
  }, [workspaceDriver]);

  const buildTaskDiffs = useCallback((beforeFiles = [], afterFiles = []) => {
      const beforeMap = new Map((beforeFiles || []).map((f) => [f.path, f.content ?? '']));
      const afterMap = new Map((afterFiles || []).map((f) => [f.path, f.content ?? '']));
      const allPaths = new Set([...beforeMap.keys(), ...afterMap.keys()]);
      const diffs = [];
      allPaths.forEach((path) => {
          const prev = beforeMap.has(path) ? beforeMap.get(path) : null;
          const next = afterMap.has(path) ? afterMap.get(path) : null;
          if (prev === next) return;
          const changeType = prev === null ? 'added' : (next === null ? 'deleted' : 'modified');
          const stat = safeDiffStat(prev || '', next || '');
          diffs.push({
              path,
              before: prev,
              after: next,
              changeType,
              stat,
              action: 'pending'
          });
      });
      return diffs.sort((a, b) => a.path.localeCompare(b.path));
  }, []);

  const finalizeTaskReview = useCallback(async (taskId) => {
      if (!taskSnapshotRef.current || taskSnapshotRef.current.id !== taskId) return;
      try {
          const after = await captureWorkspaceSnapshot();
          const afterFiles = after?.files || [];
          const diffs = buildTaskDiffs(taskSnapshotRef.current.files || [], afterFiles);
          setTaskReview({
              taskId,
              files: diffs,
              expanded: diffs.length > 0,
              status: diffs.length ? 'ready' : 'clean'
          });
          if (after?.raw) {
              await syncWorkspaceFromDisk({ includeContent: true, highlight: true, force: true, snapshot: after.raw });
          } else {
              await syncWorkspaceFromDisk({ includeContent: true, highlight: true, force: true });
          }
      } catch (err) {
          console.error('Finalize task review failed', err);
          setTaskReview((prev) => (prev && prev.taskId === taskId ? { ...prev, status: 'error' } : prev));
      } finally {
          taskSnapshotRef.current = null;
      }
  }, [buildTaskDiffs, captureWorkspaceSnapshot, syncWorkspaceFromDisk]);

  const hydrateProject = useCallback(async (driver, preferredRoot = '') => {
      if (!driver) return;
      setWorkspaceBindingStatus('checking');
      configHydratedRef.current = false;
      setWorkspaceState({ ...initialWorkspaceState, openTabs: [WELCOME_TAB_PATH], activeFile: WELCOME_TAB_PATH, view: 'code' });
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

      await syncWorkspaceFromDisk({ includeContent: true, highlight: false, driver });
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

  const getEnabledTools = (mode) => {
      if (!workspaceDriver) return [];
      if (mode === 'agent') {
          return Object.entries(toolSettings.agent)
              .filter(([, enabled]) => enabled)
              .map(([name]) => name);
      }
      if (mode === 'canva') {
          return Object.entries(toolSettings.canva)
              .filter(([, enabled]) => enabled)
              .map(([name]) => name);
      }
      return [];
  };

  const emitSessionsUpdated = useCallback((detail = {}) => {
      const payload = { timestamp: Date.now(), ...detail };
      try {
          // 仅用于跨标签页同步，不在本标签页监听
          localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
      } catch (err) {
          console.warn('Emit sessions-updated failed', err);
      }
  }, []);

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

  const collectRunKeys = (run) => {
      const keys = [];
      if (!run) return keys;
      if (run.id) keys.push(String(run.id));
      if (run.name) keys.push(run.name);
      const diff = run.diffTarget;
      if (diff && (diff.path || diff.diff_id !== undefined)) {
          const suffix = diff.diff_id !== undefined ? `#${diff.diff_id}` : `@${diff.path}`;
          if (run.name) keys.push(`${run.name}${suffix}`);
          if (run.id) keys.push(`${run.id}${suffix}`);
      }
      return keys;
  };

  const mergeRunLists = useCallback((existing = [], incoming = []) => {
      const base = [...existing];
      const doneKeySet = new Set();
      incoming
          .filter((run) => run && run.status && run.status !== 'running')
          .forEach((run) => collectRunKeys(run).forEach((k) => k && doneKeySet.add(k)));

      if (doneKeySet.size > 0) {
          // Remove stale placeholders that have been completed
          for (let i = base.length - 1; i >= 0; i -= 1) {
              const candidate = base[i];
              if (!candidate || !candidate.synthetic || candidate.status !== 'running') continue;
              const candidateKeys = collectRunKeys(candidate);
              const shouldDrop = candidateKeys.some((k) => doneKeySet.has(k));
              if (shouldDrop) base.splice(i, 1);
          }
      }

      const map = new Map();
      base.forEach((run, idx) => {
          const key = run.id || `${run.name || 'tool'}-${idx}`;
          map.set(key, run);
      });
      incoming.forEach((run, idx) => {
          if (!run) return;
          const key = run.id || `${run.name || 'tool'}-${base.length + idx}`;
          const prev = map.get(key);
          map.set(key, prev ? { ...prev, ...run, status: run.status || prev.status } : run);
      });
      return Array.from(map.values());
  }, []);

  const deriveDiffTarget = useCallback((result, args) => {
      const resultObject = result && typeof result === 'object' ? result : null;
      const diffObject = resultObject && typeof resultObject.diff === 'object' ? resultObject.diff : null;
      const diffId = typeof resultObject?.diff_id === 'number'
          ? resultObject.diff_id
          : (diffObject && typeof diffObject.id === 'number' ? diffObject.id : undefined);
      const pathCandidate =
          (diffObject && typeof diffObject.path === 'string' && diffObject.path) ||
          (resultObject && typeof resultObject.path === 'string' && resultObject.path) ||
          (args && typeof args.path === 'string' && args.path) ||
          (args && typeof args.new_path === 'string' && args.new_path) ||
          (args && typeof args.old_path === 'string' && args.old_path) ||
          undefined;
      if (!diffId && !pathCandidate) return null;
      return { diff_id: diffId, path: pathCandidate };
  }, []);

  const buildToolRunsFromMessages = useCallback((list = []) => {
      const ownerByToolId = {};
      const derived = {};

      const resolveStatus = (payload) => {
          const inspectObject = (obj) => {
              if (!obj || typeof obj !== 'object') return null;
              const statusValue = typeof obj.status === 'string' ? obj.status.toLowerCase() : '';
              if (['error', 'failed', 'fail'].includes(statusValue)) return 'error';
              if (obj.success === false || obj.ok === false) return 'error';
              if (typeof obj.error === 'string' || typeof obj.err === 'string') return 'error';
              if (typeof obj.message === 'string' && obj.message.toLowerCase().includes('error')) return 'error';
              if (obj.result && typeof obj.result === 'object') {
                  const nested = inspectObject(obj.result);
                  if (nested) return nested;
              }
              return null;
          };

          const nestedStatus = inspectObject(payload);
          if (nestedStatus) return nestedStatus;

          const preview = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
          const lowered = (preview || '').toLowerCase();
          if (lowered.includes('error') || lowered.includes('fail')) return 'error';
          return 'done';
      };

      list.forEach((msg, idx) => {
          const cid = msg._cid || msg.id || `msg-${idx}`;
          if (msg.role === 'assistant') {
              const calls = (msg.tool_calls || []).map((tc, callIdx) => {
                  let parsedArgs = tc.function?.arguments;
                  if (typeof parsedArgs === 'string') {
                      try { parsedArgs = JSON.parse(parsedArgs); } catch { /* keep raw */ }
                  }
                  ownerByToolId[tc.id] = cid;
                  return {
                      id: tc.id || `call-${cid}-${callIdx}`,
                      name: tc.function?.name || 'tool',
                      status: 'running',
                      detail: typeof parsedArgs === 'string' ? parsedArgs.slice(0, 120) : JSON.stringify(parsedArgs || {}).slice(0, 120),
                      args: parsedArgs,
                      diffTarget: deriveDiffTarget(null, parsedArgs)
                  };
              });
              if (calls.length) {
                  derived[cid] = mergeRunLists(derived[cid], calls);
              }
          }
      });

      list.forEach((msg, idx) => {
          if (msg.role !== 'tool') return;
          const cid = (msg.tool_call_id && ownerByToolId[msg.tool_call_id]) || null;
          const targetId = cid || Object.keys(derived)[Object.keys(derived).length - 1];
          if (!targetId) return;
          let parsedResult = msg.content;
          if (typeof msg.content === 'string') {
              try { parsedResult = JSON.parse(msg.content); } catch { parsedResult = msg.content; }
          }
          const previewSource = typeof parsedResult === 'string' ? parsedResult : JSON.stringify(parsedResult || {});
          const status = resolveStatus(parsedResult);
          const existingRuns = derived[targetId] || [];
          const argsSource = (existingRuns.find((r) => r.id === (msg.tool_call_id || `tool-${idx}`)) || {}).args;
          const diffTarget = deriveDiffTarget(parsedResult, argsSource);
          const nextRun = {
              id: msg.tool_call_id || `tool-${idx}`,
              name: msg.name || 'tool',
              status,
              detail: previewSource ? previewSource.slice(0, 160) : '',
              result: parsedResult,
              diffTarget
          };
          derived[targetId] = mergeRunLists(derived[targetId] || [], [nextRun]);
          // Also attach to the tool message itself so the UI can show buttons on tool bubbles.
          const selfCid = msg._cid || msg.id || `toolmsg-${idx}`;
          derived[selfCid] = mergeRunLists(derived[selfCid] || [], [nextRun]);
      });

      return derived;
  }, [mergeRunLists, deriveDiffTarget]);

  const normalizeMessages = useCallback((data = []) => data.map((msg, idx) => {
      let payload = msg.content;
      let modeTag = msg.mode;
      if (payload && typeof payload === 'object' && payload.message) {
          modeTag = payload.mode || modeTag;
          const meta = payload.meta;
          payload = payload.message;
          if (meta?.attachments) {
              if (payload && typeof payload === 'object') {
                  payload = { ...payload, attachments: [...(payload.attachments || []), ...meta.attachments] };
              } else {
                  payload = { content: payload, attachments: meta.attachments };
              }
          }
      }

      const toolCalls = payload?.tool_calls || msg.tool_calls || [];
      const toolCallId = payload?.tool_call_id || msg.tool_call_id;
      const name = payload?.name || msg.name;

      let contentValue = payload;
      if (payload && typeof payload === 'object' && payload.content !== undefined) {
          contentValue = payload.content;
      }
      if (contentValue === undefined || contentValue === null) contentValue = '';
      if (payload && typeof payload === 'object' && payload.attachments) {
          if (typeof contentValue === 'string' || Array.isArray(contentValue)) {
              contentValue = { content: contentValue, attachments: payload.attachments };
          } else if (typeof contentValue === 'object') {
              contentValue = { ...contentValue, attachments: [...(contentValue.attachments || []), ...payload.attachments] };
          }
      }

      const cid = msg.id ? `msg-${msg.id}` : (toolCallId ? `tool-${toolCallId}` : `local-${idx}-${Math.random().toString(16).slice(2)}`);
      return { ...msg, mode: modeTag, content: contentValue, tool_calls: toolCalls, tool_call_id: toolCallId, name, _cid: cid };
  }), []);

  const refreshMessages = useCallback(async (sessionId) => {
      if (!sessionId) return;
      try {
          const res = await projectFetch(`/api/sessions/${sessionId}/messages`);
          if (!res.ok) return;
          const data = await res.json();
          const normalized = normalizeMessages(data);
          const derivedRuns = buildToolRunsFromMessages(normalized);

          // 在任务执行中，不覆盖本地消息，只更新 toolRuns，避免占位卡片被刷新隐藏
          if (loadingSessions.has(sessionId)) {
              setToolRuns((prev) => {
                  const next = {};
                  Object.entries(derivedRuns).forEach(([cid, runs]) => {
                      next[cid] = mergeRunLists(prev[cid] || [], runs);
                  });
                  return next;
              });
              return;
          }

          // 保留本地尚未完成的工具占位气泡，避免轮询时被覆盖
          const localToolPlaceholders = messages.filter((m) => m.role === 'tool' && m.synthetic).filter((m) => {
              const runs = toolRuns[m._cid];
              if (!runs || runs.length === 0) return true;
              return runs.some((r) => !r.status || r.status === 'running');
          });
          const mergedMessages = [...normalized, ...localToolPlaceholders];
          setMessages(mergedMessages);
          setToolRuns((prev) => {
              const next = {};
              Object.entries(derivedRuns).forEach(([cid, runs]) => {
                  next[cid] = mergeRunLists(prev[cid] || [], runs);
              });
              return next;
          });
      } catch (err) {
          console.error(err);
      }
  }, [normalizeMessages, buildToolRunsFromMessages, mergeRunLists, projectFetch, messages, toolRuns, loadingSessions]);

  const refreshToolRuns = useCallback(async (sessionId) => {
      if (!sessionId) return;
      try {
          const res = await projectFetch(`/api/sessions/${sessionId}/messages`);
          if (!res.ok) return;
          const data = await res.json();
          const normalized = normalizeMessages(data);
          const derivedRuns = buildToolRunsFromMessages(normalized);
          const completedKeys = [];
          Object.values(derivedRuns).forEach((runs) => {
              runs.forEach((run) => {
                  if (run && run.status && run.status !== 'running') {
                      collectRunKeys(run).forEach((k) => k && completedKeys.push(k));
                  }
              });
          });

          setToolRuns((prev) => {
              const next = { ...prev };
              Object.entries(derivedRuns).forEach(([cid, runs]) => {
                  next[cid] = mergeRunLists(prev[cid] || [], runs);
              });

              if (completedKeys.length > 0) {
                  const remaining = completedKeys.reduce((acc, key) => {
                      acc.set(key, (acc.get(key) || 0) + 1);
                      return acc;
                  }, new Map());

                  Object.entries(next).forEach(([cid, runs]) => {
                      let changed = false;
                      const filtered = runs.filter((run) => {
                          if (!run || !run.synthetic || run.status !== 'running') return true;
                          const keys = collectRunKeys(run);
                          const matchedKey = keys.find((k) => remaining.get(k) > 0);
                          if (matchedKey) {
                              remaining.set(matchedKey, (remaining.get(matchedKey) || 0) - 1);
                              changed = true;
                              return false;
                          }
                          return true;
                      });
                      if (changed) next[cid] = filtered;
                  });
              }

              // 将后端返回的真实运行结果按名称补充到当前存在的 tool 占位消息上，以便展开详情可见
              const nameBuckets = {};
              Object.values(derivedRuns).forEach((runs) => {
                  runs.forEach((run) => {
                      const key = run?.name;
                      if (!key) return;
                      if (!nameBuckets[key]) nameBuckets[key] = [];
                      nameBuckets[key].push(run);
                  });
              });
              messages.forEach((msg) => {
                  if (msg.role !== 'tool' || !msg.name) return;
                  const bucket = nameBuckets[msg.name];
                  if (!bucket || bucket.length === 0) return;
                  next[msg._cid || msg.id] = mergeRunLists(prev[msg._cid || msg.id] || [], bucket);
              });

              return next;
          });
      } catch (err) {
          console.error('Failed to refresh tool runs', err);
      }
  }, [projectFetch, normalizeMessages, buildToolRunsFromMessages, mergeRunLists, messages]);

  const upsertToolRun = useCallback((messageId, run) => {
      if (!messageId) return;
      setToolRuns((prev) => ({
          ...prev,
          [messageId]: mergeRunLists(prev[messageId] || [], [run])
      }));
  }, [mergeRunLists]);

  const loadFileContent = useCallback(async (path) => {
      if (!workspaceDriver) return;
      try {
          const data = await workspaceDriver.readFile(path);
          setWorkspaceState((prev) => {
              const exists = prev.files.find((f) => f.path === data.path);
              const nextFiles = exists
                  ? prev.files.map((f) => f.path === data.path ? { ...f, content: data.content, updated: false } : f)
                  : [...prev.files, { path: data.path, content: data.content, updated: false }];
              return { ...prev, files: nextFiles };
          });
      } catch (err) {
          console.error('Failed to load file', err);
          setWorkspaceBindingError(err.message);
          setWorkspaceBindingStatus('error');
      }
  }, [workspaceDriver]);

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

  const handleSelectWorkspace = useCallback(async (projectId = null) => {
      await workspaceController.openWorkspace(projectId);
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
          onConfirm: (input) => {
              if (input) {
                  openBackendWorkspace(input, { silent: false });
              }
              setInputModal(prev => ({ ...prev, isOpen: false }));
          },
          onClose: () => setInputModal(prev => ({ ...prev, isOpen: false }))
      });
  }, [backendWorkspaceRoot, projectConfig.backendRoot, projectConfig.projectPath, openBackendWorkspace]);

  const scheduleSave = (path, content) => {
      if (!workspaceDriver) return;
      if (saveTimersRef.current[path]) {
          clearTimeout(saveTimersRef.current[path]);
      }
      saveTimersRef.current[path] = setTimeout(async () => {
          try {
              await workspaceDriver.writeFile(path, content, { createDirectories: true });
              setWorkspaceState((prev) => ({ ...prev, livePreview: `${Date.now()}` }));
              setHotReloadToken(Date.now());
          } catch (err) {
              console.error('Save failed', err);
              setWorkspaceBindingError(err.message);
              setWorkspaceBindingStatus('error');
          }
      }, 220);
  };

  useEffect(() => {
      return () => {
          Object.values(saveTimersRef.current || {}).forEach((timer) => clearTimeout(timer));
      };
  }, []);

  // --- Session Management ---
  const selectSession = useCallback(async (id, sessionHint = null) => {
      if (!id) return;
      setCurrentSessionId(id);
      const found = sessionHint || sessions.find(s => s.id === id);
      if (found?.mode) {
          setCurrentMode(found.mode);
      }
      if (sidebarCollapsed) setSidebarCollapsed(false);
      setActiveSidebarPanel('sessions');
      await refreshMessages(id);
  }, [sidebarCollapsed, refreshMessages]);

  // 不包含任何依赖，防止循环更新
  const fetchSessions = useCallback(async () => {
      try {
          const res = await projectFetch('/api/sessions');
          if (res.ok) {
              const data = await res.json();
              setSessions(data);
          }
      } catch (err) {
          console.error("Failed to fetch sessions", err);
      }
  }, [projectFetch]);

  const createSession = useCallback(async (initialTitle) => {
      console.time('🚀 createSession');
      try {
          console.log('[CREATE] 发送请求...');
          const initialTitleStr = typeof initialTitle === 'string' ? initialTitle : '';
          const title = initialTitleStr.trim() ? initialTitleStr.trim().slice(0, 60) : 'New Chat';
          const res = await projectFetch('/api/sessions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title, mode: currentMode })
          });
          if (res.ok) {
              const newSession = await res.json();
              console.log('[CREATE] 收到响应，更新 UI...', newSession.id);
              // 立即乐观更新 UI，零延迟
              setSessions((prev) => [newSession, ...prev]);
              setCurrentSessionId(newSession.id);
              setMessages([]);
              setToolRuns({});
              setSidebarCollapsed(false);
              setActiveSidebarPanel('sessions');
              console.timeEnd('🚀 createSession');
              // 仅通知其他标签页，本标签页已实时更新
              emitSessionsUpdated({ action: 'create', sessionId: newSession.id });
              return newSession;
          }
      } catch (err) {
          console.error("Failed to create session", err);
      }
      return null;
  }, [currentMode, emitSessionsUpdated, projectFetch]);

  const deleteSession = useCallback(async (id) => {
      if (!confirm("Are you sure you want to delete this chat?")) return;
      // 原子操作：单次 setSessions 调用，确保 UI 立即更新
      setSessions((prev) => {
          const remaining = prev.filter(s => s.id !== id);
          
          // 如果删除的是当前选中的会话，立即切换
          if (currentSessionId === id) {
              if (remaining.length > 0) {
                  setCurrentSessionId(remaining[0].id);
              } else {
                  setCurrentSessionId(null);
              }
              setMessages([]);
              setToolRuns({});
          }
          
          return remaining;
      });
      
      // 后台发送删除请求（不阻塞 UI）
      try {
          await projectFetch(`/api/sessions/${id}`, { method: 'DELETE' });
      } catch (err) {
          console.error(err);
      }
      
      // 通知其他标签页
      emitSessionsUpdated({ action: 'delete', sessionId: id });
  }, [currentSessionId, emitSessionsUpdated, projectFetch]);

  // --- Initialization ---
  useEffect(() => {
      fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
      document.documentElement.setAttribute('data-theme', theme);
      if (typeof window !== 'undefined' && window.electronAPI?.setTitlebarTheme) {
          window.electronAPI.setTitlebarTheme(theme);
      }
      if (userThemePreferenceRef.current) {
          persistThemeChoice(theme);
      } else if (typeof window !== 'undefined') {
          try {
              window.localStorage.removeItem(THEME_STORAGE_KEY);
          } catch {
              // ignore
          }
      }
  }, [theme]);

  useEffect(() => {
      if (typeof window === 'undefined' || !window.matchMedia) return;
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const syncThemeWithSystem = (event) => {
          if (userThemePreferenceRef.current) return;
          setTheme(event.matches ? 'dark' : 'light');
      };
      if (!userThemePreferenceRef.current) {
          const systemTheme = media.matches ? 'dark' : 'light';
          setTheme((prev) => (prev === systemTheme ? prev : systemTheme));
      }
      media.addEventListener('change', syncThemeWithSystem);
      return () => media.removeEventListener('change', syncThemeWithSystem);
  }, []);

  useEffect(() => {
      const hasPending = loadingSessions.size > 0;
      if (hasPending && !toolRunSyncTimerRef.current) {
          const targetSession = currentSessionId || Array.from(loadingSessions)[0];
          if (targetSession) refreshToolRuns(targetSession);
          toolRunSyncTimerRef.current = setInterval(() => {
              const target = currentSessionId || Array.from(loadingSessions)[0];
              if (target) refreshToolRuns(target);
          }, 900);
      } else if (!hasPending && toolRunSyncTimerRef.current) {
          clearInterval(toolRunSyncTimerRef.current);
          toolRunSyncTimerRef.current = null;
      }
      return () => {
          if (toolRunSyncTimerRef.current) {
              clearInterval(toolRunSyncTimerRef.current);
              toolRunSyncTimerRef.current = null;
          }
      };
  }, [loadingSessions, currentSessionId, refreshToolRuns]);

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
          openai: { ...config.openai },
          anthropic: { ...config.anthropic },
          openrouter: { ...config.openrouter },
          xai: { ...config.xai },
          ollama: { ...config.ollama },
          lmstudio: { ...config.lmstudio },
          llamacpp: { ...config.llamacpp },
          toolSettings,
          uiDisplayPreferences
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
              const driver = await LocalWorkspaceDriver.fromPersisted(null, { allowPrompt: false });
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

  useEffect(() => {
      // 仅用于跨标签页同步
      // 注意：storage 事件仅在其他标签页被触发，本标签页不会收到
      // 所以这个监听实际上只用于多标签页场景
      const handleStorage = (e) => {
          if (e.key !== SESSION_STORAGE_KEY || !e.newValue) return;
          fetchSessions();
      };
      window.addEventListener('storage', handleStorage);
      return () => {
          window.removeEventListener('storage', handleStorage);
      };
  }, [fetchSessions]);

  const renameSession = useCallback(async (id, title) => {
      const trimmed = (title || '').trim();
      if (!trimmed) return;
      try {
          const res = await projectFetch(`/api/sessions/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: trimmed })
          });
          if (res.ok) {
              const updated = await res.json();
              // 立即更新本地状态
              setSessions((prev) => prev.map((s) => s.id === id ? { ...s, ...updated } : s));
              if (currentSessionId === id && updated.mode) {
                  setCurrentMode(updated.mode);
              }
              emitSessionsUpdated({ action: 'rename', sessionId: id });
          }
      } catch (err) {
          console.error('Failed to rename session', err);
      }
  }, [currentSessionId, emitSessionsUpdated, projectFetch]);

  const handleModeChange = async (mode) => {
      setCurrentMode(mode);
      setProjectConfig((cfg) => ({ ...cfg, lastMode: mode }));
      // ✅ 增加防抖，避免频繁切换导致多次同步
      if (['canva', 'agent'].includes(mode)) {
          setTimeout(() => {
              syncWorkspaceFromDisk({ includeContent: true, highlight: false });
          }, 300);
      }
      if (!currentSessionId) return;
      setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, mode } : s));
      try {
          await projectFetch(`/api/sessions/${currentSessionId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mode })
          });
          emitSessionsUpdated({ action: 'mode', sessionId: currentSessionId });
      } catch (err) {
          console.error('Failed to update mode', err);
      }
  };

  const fetchLogs = async () => {
      if (!currentSessionId) return;
      try {
          const res = await projectFetch(`/api/sessions/${currentSessionId}/logs`);
          if (res.ok) {
              const data = await res.json();
              setLogs(data);
          }
      } catch (err) {
          console.error(err);
      }
  };

  useEffect(() => {
      if (showLogs && currentSessionId) {
          fetchLogs();
          const interval = setInterval(fetchLogs, 2000);
          return () => clearInterval(interval);
      }
  }, [showLogs, currentSessionId]);

  useEffect(() => {
      if (!workspaceState.activeFile && workspaceState.openTabs.length > 0) {
          const firstTab = workspaceState.openTabs[0];
          setWorkspaceState((prev) => ({ ...prev, activeFile: firstTab }));
      }
  }, [workspaceState.activeFile, workspaceState.openTabs]);

  const handleSend = async ({ text, attachments } = {}) => {
    const messageText = text !== undefined ? text : input;
    const cleanedText = messageText || '';
    const safeAttachments = attachments || [];
    const requiresWorkspace = ['canva', 'agent'].includes(currentMode);
    if (requiresWorkspace && !workspaceDriver) {
        alert('请先选择项目文件夹（Canva/Agent 模式需要访问工作区文件）。');
        return;
    }
    const enabledTools = getEnabledTools(currentMode);
    if (!configured || apiStatus !== 'ok') {
        alert('请先完成设置并确保后端已连接（点击左侧齿轮进入设置）。');
        if (uiDisplayPreferences.settings === 'editor') {
            handleOpenConfigInEditor();
        } else {
            setConfigFullscreen(false);
            setShowConfig(true);
        }
        return;
    }
    if ((!cleanedText.trim()) && safeAttachments.length === 0) return;

    const trackTaskChanges = ['canva', 'agent'].includes(currentMode);
    const deriveTitle = () => {
        const t = (cleanedText || '').trim();
        if (t) return t.slice(0, 60);
        if (safeAttachments.length > 0) {
            const name = safeAttachments[0]?.name || '';
            if (name) return name.slice(0, 60);
        }
        return 'New Chat';
    };

    let sessionIdToUse = currentSessionId;
    if (!sessionIdToUse) {
        const created = await createSession(deriveTitle());
        if (!created?.id) return;
        sessionIdToUse = created.id;
    }
    const sessionForTitle = sessions.find((s) => s.id === sessionIdToUse);
    if (sessionForTitle && (!sessionForTitle.title || sessionForTitle.title.toLowerCase() === 'new chat')) {
        const candidateTitle = deriveTitle();
        if (candidateTitle && candidateTitle !== sessionForTitle.title) {
            renameSession(sessionIdToUse, candidateTitle);
        }
    }

    const taskId = Date.now();
    let snapshotReady = false;
    if (trackTaskChanges && workspaceDriver) {
        const beforeSnapshot = await captureWorkspaceSnapshot();
        if (beforeSnapshot) {
            taskSnapshotRef.current = { id: taskId, files: beforeSnapshot.files || [] };
            setTaskReview({ taskId, files: [], status: 'running', expanded: false });
            snapshotReady = true;
        } else {
            taskSnapshotRef.current = null;
            setTaskReview({ taskId, files: [], status: 'idle', expanded: false });
        }
    } else {
        taskSnapshotRef.current = null;
        setTaskReview({ taskId: null, files: [], status: 'idle', expanded: false });
    }

    const userMessage = { _cid: `user-${Date.now()}`, role: 'user', content: { text: cleanedText, attachments: safeAttachments, mode: currentMode } };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoadingSessions(prev => {
        const next = new Set(prev);
        next.add(sessionIdToUse);
        return next;
    });

      const controller = new AbortController();
      abortControllerRef.current = controller;
      streamBufferRef.current = '';

      try {
      const llmConfig = getBackendConfig();
       const response = await aiEngineClient.chatStream({
         requestId: `ui-${Date.now()}-${Math.random().toString(16).slice(2)}`,
         sessionId: sessionIdToUse,
         workspaceRoot: backendWorkspaceRoot,
         message: cleanedText,
         attachments: safeAttachments,
         mode: currentMode,
         toolOverrides: enabledTools,
         llmConfig,
       }, { signal: controller.signal });

      if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
      }

      if (!response.body) {
          throw new Error('Response body is empty');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let currentAssistantCid = null;
      let shouldStartNewAssistant = false;
      let hasReceivedContent = false;

      const ensureAssistantMessage = () => {
          if (currentAssistantCid && !shouldStartNewAssistant) return currentAssistantCid;
          const cid = `assistant-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          currentAssistantCid = cid;
          shouldStartNewAssistant = false;
          setMessages((prev) => [...prev, { _cid: cid, role: 'assistant', content: '', tool_calls: [] }]);
          return cid;
      };

      const appendToAssistant = (text = '') => {
          if (!text) return;
          hasReceivedContent = true;
          const cid = ensureAssistantMessage();
          setMessages((prev) => {
              const next = [...prev];
              const idx = next.findIndex((m) => m._cid === cid);
              if (idx === -1) {
                  next.push({ _cid: cid, role: 'assistant', content: text, tool_calls: [] });
              } else {
                  const existing = next[idx];
                  next[idx] = { ...existing, content: `${existing.content || ''}${text}` };
              }
              return next;
          });
      };

      const handleToolMarker = (rawName = '') => {
          const ownerCid = currentAssistantCid || ensureAssistantMessage();
          const toolName = rawName?.trim() || '工具';
          const startedAt = Date.now();
          upsertToolRun(ownerCid, {
              id: `live-${ownerCid}-${toolName}`,
              name: toolName,
              status: 'running',
              detail: `正在执行 ${toolName}…`,
              synthetic: true,
              startedAt
          });
          const placeholderCid = `tool-${ownerCid}-${startedAt}-${Math.random().toString(16).slice(2)}`;
          setMessages((prev) => [...prev, { _cid: placeholderCid, role: 'tool', name: toolName, content: `执行 ${toolName} 中…`, synthetic: true }]);
          upsertToolRun(placeholderCid, {
              id: `live-${placeholderCid}`,
              name: toolName,
              status: 'running',
              detail: `正在执行 ${toolName}…`,
              synthetic: true,
              startedAt
          });
          shouldStartNewAssistant = true; // 下一段回复使用新的 agent 卡片
      };

      ensureAssistantMessage();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });

        let buffer = `${streamBufferRef.current}${chunk}`;
        let lastIndex = 0;
        const execRegex = /\[Executing\s+([^\]]+?)\.\.\.\]/g;
        let match;

        while ((match = execRegex.exec(buffer))) {
            const textChunk = buffer.slice(lastIndex, match.index);
            appendToAssistant(textChunk);
            handleToolMarker(match[1]);
            lastIndex = execRegex.lastIndex;
        }

        const remainder = buffer.slice(lastIndex);
        const partialIdx = remainder.lastIndexOf('[Executing ');
        if (partialIdx !== -1) {
            appendToAssistant(remainder.slice(0, partialIdx));
            streamBufferRef.current = remainder.slice(partialIdx);
        } else {
            appendToAssistant(remainder);
            streamBufferRef.current = '';
        }
      }

      if (streamBufferRef.current) {
          appendToAssistant(streamBufferRef.current);
          streamBufferRef.current = '';
      }
      
      if (!hasReceivedContent) {
          appendToAssistant('（AI 未返回任何内容，请检查网络或配置）');
      }

      fetchSessions();
      fetchLogs();
      await refreshMessages(sessionIdToUse);
      emitSessionsUpdated({ action: 'messages', sessionId: sessionIdToUse });
    } catch (err) {
      if (err.name === 'AbortError') {
          console.log('Generation aborted');
          setMessages((prev) => [...prev, { role: 'system', content: '[Stopped by user]' }]);
      } else {
          console.error(err);
          setMessages((prev) => [...prev, { role: 'error', content: 'Error getting response' }]);
      }
    } finally {
      abortControllerRef.current = null;
      streamBufferRef.current = '';
      if (snapshotReady && taskId) {
          await finalizeTaskReview(taskId);
      } else {
          taskSnapshotRef.current = null;
      }
      setLoadingSessions(prev => {
          const next = new Set(prev);
          next.delete(sessionIdToUse);
          return next;
      });
    }
  };

  const toggleTaskReview = useCallback(() => {
      setTaskReview((prev) => (prev ? { ...prev, expanded: !prev.expanded } : prev));
  }, []);

  const keepTaskFile = useCallback((path) => {
      if (!taskReview?.files?.length) return;
      setTaskReview((prev) => {
          if (!prev) return prev;
          const files = prev.files.map((f) => f.path === path ? { ...f, action: 'kept' } : f);
          const status = files.every((f) => f.action !== 'pending') ? 'resolved' : prev.status;
          return { ...prev, files, status };
      });
      setWorkspaceState((prev) => ({
          ...prev,
          files: prev.files.map((f) => f.path === path ? { ...f, updated: false } : f)
      }));
  }, [taskReview]);

  const keepAllTaskFiles = useCallback(() => {
      const paths = taskReview?.files?.map((f) => f.path) || [];
      if (!paths.length) {
          setTaskReview((prev) => (prev ? { ...prev, status: 'clean', expanded: false } : prev));
          return;
      }
      setWorkspaceState((prev) => ({
          ...prev,
          files: prev.files.map((f) => paths.includes(f.path) ? { ...f, updated: false } : f)
      }));
      setTaskReview((prev) => (prev ? {
          ...prev,
          files: prev.files.map((f) => ({ ...f, action: 'kept' })),
          status: 'resolved',
          expanded: false
      } : prev));
  }, [taskReview]);

  const revertTaskFile = useCallback(async (path) => {
      const target = taskReview?.files?.find((f) => f.path === path);
      if (!target || !workspaceDriver) return;
      setTaskReview((prev) => (prev ? { ...prev, status: 'applying' } : prev));
      try {
          if (target.changeType === 'added') {
              await workspaceDriver.deletePath(path);
          } else {
              await workspaceDriver.writeFile(path, target.before || '', { createDirectories: true });
          }
          await syncWorkspaceFromDisk({ includeContent: true, highlight: false, force: true });
          setTaskReview((prev) => {
              if (!prev) return prev;
              const files = prev.files.map((f) => f.path === path ? { ...f, action: 'reverted' } : f);
              const status = files.every((f) => f.action !== 'pending') ? 'resolved' : 'ready';
              return { ...prev, files, status };
          });
      } catch (err) {
          console.error('Revert file failed', err);
          alert(`撤销失败：${err.message || err}`);
          setTaskReview((prev) => (prev ? { ...prev, status: prev.status === 'applying' ? 'ready' : prev.status } : prev));
      }
  }, [syncWorkspaceFromDisk, taskReview, workspaceDriver]);

  const revertAllTaskFiles = useCallback(async () => {
      if (!taskReview?.files?.length || !workspaceDriver) return;
      setTaskReview((prev) => (prev ? { ...prev, status: 'applying' } : prev));
      try {
          for (const file of taskReview.files) {
              // eslint-disable-next-line no-await-in-loop
              if (file.changeType === 'added') {
                  await workspaceDriver.deletePath(file.path);
              } else {
                  await workspaceDriver.writeFile(file.path, file.before || '', { createDirectories: true });
              }
          }
          await syncWorkspaceFromDisk({ includeContent: true, highlight: false, force: true });
          setTaskReview((prev) => (prev ? {
              ...prev,
              files: prev.files.map((f) => ({ ...f, action: 'reverted' })),
              status: 'resolved',
              expanded: false
          } : prev));
      } catch (err) {
          console.error('Revert all failed', err);
          alert(`撤销失败：${err.message || err}`);
          setTaskReview((prev) => (prev ? { ...prev, status: prev.status === 'applying' ? 'ready' : prev.status } : prev));
      }
  }, [syncWorkspaceFromDisk, taskReview, workspaceDriver]);

  const openFile = (path) => {
      if (!workspaceDriver) {
          alert('请先选择项目文件夹');
          return;
      }
      setWorkspaceState((prev) => {
          const exists = prev.files.find((f) => f.path === path);
          const nextFiles = exists ? prev.files : [...prev.files, { path, content: '', updated: false }];
          const nextTabs = prev.openTabs.includes(path) ? prev.openTabs : [...prev.openTabs, path];
          return { ...prev, files: nextFiles, openTabs: nextTabs, activeFile: path, previewEntry: path };
      });
      loadFileContent(path);
  };

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

  const sanitizeTemplateFolder = (raw) => {
      const s = String(raw || '').trim();
      if (!s) return '';
      if (s.includes('..')) return '';
      if (s.includes('/') || s.includes('\\')) return '';
      if (/^[A-Za-z]:/.test(s)) return '';
      return s.replace(/[:*?"<>|]+/g, '').trim();
  };

  const getTemplateSpec = (templateId) => {
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
  };

  const createTemplateProjectInWorkspace = useCallback(async ({ templateId, projectName, parentDir } = {}) => {
      const destParent = String(parentDir || '').trim();
      if (destParent && isAbsolutePath(destParent) && BackendWorkspaceDriver?.fromFsPath) {
          const folder = sanitizeTemplateFolder(projectName) || 'my-project';
          const spec = getTemplateSpec(templateId);

          const parentDriver = await BackendWorkspaceDriver.fromFsPath(destParent);
          await parentDriver.createFolder(folder);

          const targetRoot = pathJoinAbs(destParent, folder);
          const targetDriver = await BackendWorkspaceDriver.fromFsPath(targetRoot);
          for (const [rel, content] of Object.entries(spec.files || {})) {
              // eslint-disable-next-line no-await-in-loop
              await targetDriver.writeFile(rel, String(content || ''), { createDirectories: true });
          }

          clearPendingOpenFile();
          pendingOpenFileRef.current = { absPath: pathJoinAbs(targetRoot, spec.entry), expectedRoot: targetRoot };
          await workspaceController.openWorkspace(targetRoot, { preferredRoot: targetRoot });
          return { queued: true, root: targetRoot };
      }

      if (!workspaceDriver) {
          pendingStartActionRef.current = { type: 'template' };
          pendingTemplateRef.current = { templateId, projectName };
          await handleSelectWorkspace(null);
          return { queued: true };
      }
      if (workspaceBindingStatus !== 'ready') {
          pendingStartActionRef.current = { type: 'template' };
          pendingTemplateRef.current = { templateId, projectName };
          return { queued: true };
      }

      const folder = sanitizeTemplateFolder(projectName) || 'my-project';
      const hasExisting =
          (workspaceState.files || []).some((f) => f?.path === folder || String(f?.path || '').startsWith(`${folder}/`)) ||
          (workspaceState.fileTree || []).some((e) => e?.path === folder || String(e?.path || '').startsWith(`${folder}/`));
      if (hasExisting) {
          throw new Error(`目标目录已存在：${folder}`);
      }

      const spec = getTemplateSpec(templateId);
      await workspaceDriver.createFolder(folder);
      for (const [rel, content] of Object.entries(spec.files || {})) {
          // eslint-disable-next-line no-await-in-loop
          await workspaceDriver.writeFile(`${folder}/${rel}`, String(content || ''), { createDirectories: true });
      }
      await syncWorkspaceFromDisk({ includeContent: true, highlight: true, force: true });
      openFile(`${folder}/${spec.entry}`);
      return { ok: true, folder, entry: `${folder}/${spec.entry}` };
  }, [clearPendingOpenFile, handleSelectWorkspace, openFile, syncWorkspaceFromDisk, workspaceBindingStatus, workspaceController, workspaceDriver, workspaceState.fileTree, workspaceState.files]);

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

  const closeFile = (path) => {
      setWorkspaceState((prev) => {
          const nextTabs = prev.openTabs.filter((p) => p !== path);
          const nextActive = prev.activeFile === path ? (nextTabs[nextTabs.length - 1] || '') : prev.activeFile;
          return { ...prev, openTabs: nextTabs, activeFile: nextActive, previewEntry: nextActive || prev.previewEntry };
      });
      if (path && path.startsWith(DIFF_TAB_PREFIX)) {
          setDiffTabs((prev) => {
              if (!prev || !prev[path]) return prev;
              const next = { ...prev };
              delete next[path];
              return next;
          });
      }
  };

  const handleFileChange = (path, content) => {
      setWorkspaceState((prev) => {
          const nextFiles = prev.files.map((f) => f.path === path ? { ...f, content, updated: false } : f);
          return { ...prev, files: nextFiles, livePreview: prev.livePreview };
      });
      scheduleSave(path, content);
  };

  const handleTabReorder = (from, to) => {
      setWorkspaceState((prev) => {
          const tabs = [...prev.openTabs];
          const [item] = tabs.splice(from, 1);
          tabs.splice(to, 0, item);
          return { ...prev, openTabs: tabs };
      });
  };

  const handleAddFile = () => {
      if (!workspaceDriver) {
          alert('请先选择项目文件夹');
          return;
      }
      setInputModal({
          isOpen: true,
          title: '新建文件',
          label: '输入文件名 (例如: src/App.js)',
          defaultValue: '',
          onConfirm: async (name) => {
              if (!name) return;
              try {
                  await workspaceDriver.writeFile(name, '', { createDirectories: true });
                  await syncWorkspaceFromDisk({ includeContent: true, highlight: true });
                  openFile(name);
              } catch (err) {
                  console.error('Failed to add file', err);
              }
              setInputModal(prev => ({ ...prev, isOpen: false }));
          },
          onClose: () => setInputModal(prev => ({ ...prev, isOpen: false }))
      });
  };

  const handleNewFileFromWelcome = useCallback(async () => {
      if (workspaceDriver && workspaceBindingStatus === 'ready') {
          handleAddFile();
          return;
      }
      pendingStartActionRef.current = { type: 'newFile' };
      await handleSelectWorkspace(null);
  }, [handleSelectWorkspace, handleAddFile, workspaceBindingStatus, workspaceDriver]);

  useEffect(() => {
      if (!workspaceDriver) return;
      if (workspaceBindingStatus !== 'ready') return;
      const pending = pendingStartActionRef.current;
      if (!pending?.type) return;
      if (pending.type !== 'newFile') return;
      clearPendingStartAction();
      handleAddFile();
  }, [clearPendingStartAction, handleAddFile, workspaceBindingStatus, workspaceDriver]);

  const handleAddFolder = () => {
      if (!workspaceDriver) {
          alert('请先选择项目文件夹');
          return;
      }
      setInputModal({
          isOpen: true,
          title: '新建文件夹',
          label: '输入文件夹名 (例如: src/components)',
          defaultValue: '',
          onConfirm: async (name) => {
              if (!name) return;
              try {
                  await workspaceDriver.createFolder(name);
                  await syncWorkspaceFromDisk({ includeContent: false, highlight: false });
              } catch (err) {
                  console.error('Failed to create folder', err);
              }
              setInputModal(prev => ({ ...prev, isOpen: false }));
          },
          onClose: () => setInputModal(prev => ({ ...prev, isOpen: false }))
      });
  };

  const handleConnectRemote = useCallback(async (data) => {
      // TODO: Implement actual backend connection
      console.log('Connecting to remote:', data);
      // Simulate connection delay
      await new Promise(resolve => setTimeout(resolve, 1500));
      alert(`Connected to ${data.username}@${data.host}:${data.port}`);
      setShowRemoteModal(false);
  }, []);

  const handleDeletePath = async (path) => {
      if (!workspaceDriver) {
          alert('请先选择项目文件夹');
          return;
      }
      if (!path) return;
      if (!window.confirm(`确认删除 ${path} ?`)) return;
      try {
          await workspaceDriver.deletePath(path);
          await syncWorkspaceFromDisk({ includeContent: true, highlight: false });
          setWorkspaceState((prev) => ({
              ...prev,
              files: prev.files.filter((f) => f.path !== path),
              openTabs: prev.openTabs.filter((tab) => tab !== path),
              activeFile: prev.activeFile === path ? '' : prev.activeFile,
          }));
      } catch (err) {
          console.error('Failed to delete', err);
      }
  };

  const handleRenamePath = async (oldPath, nextPathInput = null) => {
      if (!workspaceDriver) {
          alert('请先选择项目文件夹');
          return;
      }
      if (nextPathInput) {
          try {
              await workspaceDriver.renamePath(oldPath, nextPathInput);
              await syncWorkspaceFromDisk({ includeContent: true, highlight: true });
          } catch (err) {
              console.error('Failed to rename', err);
          }
          return;
      }

      setInputModal({
          isOpen: true,
          title: '重命名',
          label: '输入新的相对路径',
          defaultValue: oldPath,
          onConfirm: async (nextPath) => {
              if (!nextPath || nextPath === oldPath) {
                  setInputModal(prev => ({ ...prev, isOpen: false }));
                  return;
              }
              try {
                  await workspaceDriver.renamePath(oldPath, nextPath);
                  await syncWorkspaceFromDisk({ includeContent: true, highlight: true });
              } catch (err) {
                  console.error('Failed to rename', err);
              }
              setInputModal(prev => ({ ...prev, isOpen: false }));
          },
          onClose: () => setInputModal(prev => ({ ...prev, isOpen: false }))
      });
  };

  const handleRefreshPreview = async () => {
      await syncWorkspaceFromDisk({ includeContent: true, highlight: false });
      const now = Date.now();
      setHotReloadToken(now);
      setWorkspaceState((prev) => ({ ...prev, livePreview: `${now}` }));
  };

  const handleChangeDisplayPreference = useCallback((key, mode) => {
      setUiDisplayPreferences((prev) => {
          const next = { ...prev, [key]: mode };
          return next;
      });
  }, []);

  const handleOpenConfigInEditor = useCallback(() => {
      setConfigFullscreen(false);
      setShowConfig(false);
      setWorkspaceState((prev) => {
          const exists = prev.openTabs.includes(SETTINGS_TAB_PATH);
          const nextTabs = exists ? prev.openTabs : [...prev.openTabs, SETTINGS_TAB_PATH];
          return { ...prev, openTabs: nextTabs, activeFile: SETTINGS_TAB_PATH, view: 'code' };
      });
  }, []);

  const handleThemeModeChange = useCallback((mode) => {
      if (mode === 'system') {
          userThemePreferenceRef.current = false;
          if (typeof window !== 'undefined') {
              try {
                  window.localStorage.removeItem(THEME_STORAGE_KEY);
              } catch {
              }
          }
          const systemTheme = detectSystemTheme();
          setTheme(systemTheme);
          return;
      }
      userThemePreferenceRef.current = true;
      const nextTheme = mode === 'dark' ? 'dark' : 'light';
      setTheme(nextTheme);
  }, []);

  const handleToggleTheme = useCallback(() => {
      userThemePreferenceRef.current = true;
      setTheme((prev) => {
          const next = prev === 'dark' ? 'light' : 'dark';
          persistThemeChoice(next);
          return next;
      });
  }, []);

  const handleStop = () => {
      if (abortControllerRef.current) {
          abortControllerRef.current.abort();
      }
  };

  const handleSidebarTabChange = useCallback((panelKey) => {
      setActiveSidebarPanel((prev) => {
          if (prev === panelKey && !sidebarCollapsed) {
              setSidebarCollapsed(true);
              return prev;
          }
          setSidebarCollapsed(false);
          return panelKey;
      });
  }, [sidebarCollapsed]);

  // --- Git Logic ---
  const refreshGitStatus = useCallback(async () => {
      if (!backendWorkspaceRoot || !GitDriver.isAvailable()) return;
      setGitLoading(true);
      const status = await GitDriver.status(backendWorkspaceRoot);
      setGitStatus(status);
      if (!status) {
          setGitRemotes([]);
          setGitLog([]);
          setGitLoading(false);
          return;
      }
      const remotes = await GitDriver.getRemotes(backendWorkspaceRoot);
      setGitRemotes(remotes);
      const log = await GitDriver.log(backendWorkspaceRoot);
      setGitLog(log?.all || []);
      const branches = await GitDriver.branch(backendWorkspaceRoot);
      setGitBranches(branches || { all: [], current: '', branches: {} });
      setGitLoading(false);
  }, [backendWorkspaceRoot]);

  useEffect(() => {
      if (backendBound && backendWorkspaceRoot) {
          refreshGitStatus();
          const timer = setInterval(refreshGitStatus, 5000);
          return () => clearInterval(timer);
      }
  }, [backendBound, backendWorkspaceRoot, refreshGitStatus]);

  const handleGitInit = async () => {
      if (!backendWorkspaceRoot) {
          promptBindBackendRoot();
          return;
      }
      await GitDriver.init(backendWorkspaceRoot);
      refreshGitStatus();
  };

  const handleGitCreateBranch = async (name) => {
      if (!backendWorkspaceRoot) return;
      await GitDriver.createBranch(backendWorkspaceRoot, name);
      refreshGitStatus();
  };

  const handleGitDeleteBranch = async (name) => {
      if (!backendWorkspaceRoot) return;
      await GitDriver.deleteBranch(backendWorkspaceRoot, name);
      refreshGitStatus();
  };

  const handleGitCheckoutBranch = async (name) => {
      if (!backendWorkspaceRoot) return;
      await GitDriver.checkout(backendWorkspaceRoot, name);
      refreshGitStatus();
  };

  const handleGitResolve = async (file, type) => {
      if (!backendWorkspaceRoot) return;
      await GitDriver.resolve(backendWorkspaceRoot, file, type);
      refreshGitStatus();
  };

  const handleGitAddRemote = async (name, url) => {
      if (!backendWorkspaceRoot) return;
      await GitDriver.addRemote(backendWorkspaceRoot, name, url);
      refreshGitStatus();
  };

  const handleGitStage = async (files) => {
      if (!backendWorkspaceRoot) return;
      await GitDriver.stage(backendWorkspaceRoot, files);
      refreshGitStatus();
  };
  const handleGitUnstage = async (files) => {
      if (!backendWorkspaceRoot) return;
      await GitDriver.unstage(backendWorkspaceRoot, files);
      refreshGitStatus();
  };
  const handleGitStageAll = async () => {
      if (!backendWorkspaceRoot) return;
      await GitDriver.stage(backendWorkspaceRoot, ['.']);
      refreshGitStatus();
  };
  const handleGitUnstageAll = async () => {
      if (!backendWorkspaceRoot) return;
      const hasStaged = gitStatus?.files?.some(f => ['A', 'M', 'D', 'R'].includes(f.working_dir) === false && ['A', 'M', 'D', 'R'].includes(f.index));
      if (!hasStaged) return;
      await GitDriver.unstage(backendWorkspaceRoot, '.');
      refreshGitStatus();
  };
  const handleGitRestore = async (files) => {
      if (!backendWorkspaceRoot) return;
      if (!window.confirm(`Are you sure you want to discard changes in ${files.length > 1 ? files.length + ' files' : files[0]}?`)) return;
      
      const untracked = [];
      const tracked = [];
      
      files.forEach(path => {
          const file = gitStatus?.files?.find(f => f.path === path);
          if (file && (file.working_dir === '?' || file.working_dir === 'U')) {
              untracked.push(path);
          } else {
              tracked.push(path);
          }
      });

      if (tracked.length > 0) {
          await GitDriver.restore(backendWorkspaceRoot, tracked);
      }
      if (untracked.length > 0 && workspaceDriver) {
          for (const p of untracked) {
             try { await workspaceDriver.deletePath(p); } catch (e) { console.error(e); }
          }
      }
      refreshGitStatus();
  };

  const handleGitRestoreAll = async () => {
      if (!backendWorkspaceRoot) return;
      if (!window.confirm('Are you sure you want to discard ALL changes? This cannot be undone.')) return;
      
      const files = gitStatus?.files?.filter(f => ['A', 'M', 'D', 'R', '?'].includes(f.working_dir)) || [];
      const untracked = [];
      const tracked = [];
      
      files.forEach(f => {
          if (f.working_dir === '?' || f.working_dir === 'U') {
              untracked.push(f.path);
          } else {
              tracked.push(f.path);
          }
      });

      if (tracked.length > 0) {
          await GitDriver.restore(backendWorkspaceRoot, tracked.length === files.length ? '.' : tracked);
      }
      if (untracked.length > 0 && workspaceDriver) {
          for (const p of untracked) {
             try { await workspaceDriver.deletePath(p); } catch (e) { console.error(e); }
          }
      }
      refreshGitStatus();
  };
  const handleGitCommit = async (msg) => {
      if (!backendWorkspaceRoot) return;
      await GitDriver.commit(backendWorkspaceRoot, msg);
      refreshGitStatus();
  };
  const handleGitPull = async () => {
      if (!backendWorkspaceRoot) return;
      await GitDriver.pull(backendWorkspaceRoot);
      refreshGitStatus();
  };
  const handleGitPush = async () => {
      if (!backendWorkspaceRoot) return;
      await GitDriver.push(backendWorkspaceRoot);
      refreshGitStatus();
  };
  const handleGitPublishBranch = async (branch) => {
      if (!backendWorkspaceRoot) return;
      const target = branch || gitStatus?.current;
      if (!target) return;
      await GitDriver.publishBranch(backendWorkspaceRoot, target);
      refreshGitStatus();
  };
  const handleGitSetUpstream = async (branch) => {
      if (!backendWorkspaceRoot) return;
      const target = branch || gitStatus?.current;
      if (!target) return;
      await GitDriver.setUpstream(backendWorkspaceRoot, target);
      refreshGitStatus();
  };
  const handleGitSync = async () => {
      if (!backendWorkspaceRoot) return;
      await GitDriver.pull(backendWorkspaceRoot);
      await GitDriver.push(backendWorkspaceRoot);
      refreshGitStatus();
  };
  
  const handleGenerateCommitMessage = async () => {
      if (!gitStatus || !backendWorkspaceRoot) return '';
      const diff = await GitDriver.diff(backendWorkspaceRoot);
      if (!diff) return '';
      const diffText = typeof diff === 'string' ? diff : JSON.stringify(diff);
      const prompt = `Generate a concise git commit message (first line under 50 chars) for this diff:\n\n${diffText.slice(0, 2000)}`;
      
      if (!currentSessionId) return 'Error: Please open a chat session first.';
      
      try {
           const llmConfig = getBackendConfig();
           const res = await aiEngineClient.chatStream({
              requestId: `git-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              sessionId: currentSessionId,
              workspaceRoot: backendWorkspaceRoot,
              message: prompt,
              mode: 'chat',
              llmConfig,
           });
          const result = await readTextResponseBody(res);
          return String(result || '').trim();
      } catch (e) {
          console.error(e);
          return 'Error generating message';
      }
  };

  const handleGetCommitDetails = useCallback(async (hash) => {
      if (!backendWorkspaceRoot) return [];
      return await GitDriver.getCommitDetails(backendWorkspaceRoot, hash);
  }, [backendWorkspaceRoot]);

  const handleGetCommitStats = useCallback(async (hash) => {
      if (!backendWorkspaceRoot) return null;
      return await GitDriver.getCommitStats(backendWorkspaceRoot, hash);
  }, [backendWorkspaceRoot]);

  const handleOpenCommitDiff = useCallback(async (hash, path) => {
      if (!backendWorkspaceRoot) return;
      try {
          const before = await GitDriver.getFileContent(backendWorkspaceRoot, `${hash}~1`, path);
          const after = await GitDriver.getFileContent(backendWorkspaceRoot, hash, path);
          const diff = { path, before, after };
          if (uiDisplayPreferences.diff === 'editor') {
              openDiffTabInWorkspace(diff);
              setDiffModal(null);
          } else {
              openDiffModal(diff);
          }
      } catch (e) {
          console.error('Failed to open commit diff', e);
      }
  }, [backendWorkspaceRoot, openDiffModal, uiDisplayPreferences.diff, openDiffTabInWorkspace]);

  const handleOpenAllCommitDiffs = useCallback(async (hash) => {
      if (!backendWorkspaceRoot) return;
      try {
          const files = await GitDriver.getCommitFileDiffs(backendWorkspaceRoot, hash);
          if (!files || files.length === 0) return;
          const diff = { files };
          if (uiDisplayPreferences.diff === 'editor') {
              openDiffTabInWorkspace(diff);
              setDiffModal(null);
          } else {
              openDiffModal(diff);
          }
      } catch (e) {
          console.error('Failed to open all commit diffs', e);
      }
  }, [backendWorkspaceRoot, openDiffModal, uiDisplayPreferences.diff, openDiffTabInWorkspace]);

  const handleOpenWorkingCopyDiff = useCallback(async (path, staged = false) => {
      if (!backendWorkspaceRoot || !workspaceDriver) return;
      try {
          let before = '';
          let after = '';
          
          if (staged) {
              // Staged: HEAD vs Index
              before = await GitDriver.getFileContent(backendWorkspaceRoot, 'HEAD', path);
              after = await GitDriver.getFileContent(backendWorkspaceRoot, ':0', path);
          } else {
              // Unstaged: Index vs Worktree
              before = await GitDriver.getFileContent(backendWorkspaceRoot, ':0', path);
              // For worktree, read directly from disk
              const fileData = await workspaceDriver.readFile(path);
              after = fileData.content || '';
          }
          const diff = { path, before, after };
          if (uiDisplayPreferences.diff === 'editor') {
              openDiffTabInWorkspace(diff);
              setDiffModal(null);
          } else {
              openDiffModal(diff);
          }
      } catch (e) {
          console.error('Failed to open working copy diff', e);
          // Fallback to simple file open if diff fails
          openFile(path);
      }
  }, [backendWorkspaceRoot, workspaceDriver, openDiffModal, openFile, uiDisplayPreferences.diff, openDiffTabInWorkspace]);

  const handleOpenBatchDiffs = useCallback(async (files, type = 'unstaged') => {
      if (!backendWorkspaceRoot || !workspaceDriver || !files || files.length === 0) return;
      try {
          const diffs = await Promise.all(files.map(async (file) => {
              const path = file.path;
              let before = '';
              let after = '';
              if (type === 'staged') {
                  before = await GitDriver.getFileContent(backendWorkspaceRoot, 'HEAD', path);
                  after = await GitDriver.getFileContent(backendWorkspaceRoot, ':0', path);
              } else {
                  before = await GitDriver.getFileContent(backendWorkspaceRoot, ':0', path);
                  const fileData = await workspaceDriver.readFile(path);
                  after = fileData.content || '';
              }
              return { path, before, after };
          }));
          const diff = { files: diffs };
          if (uiDisplayPreferences.diff === 'editor') {
              openDiffTabInWorkspace(diff);
              setDiffModal(null);
          } else {
              openDiffModal(diff);
          }
      } catch (e) {
          console.error('Failed to open batch diffs', e);
      }
  }, [backendWorkspaceRoot, workspaceDriver, openDiffModal, uiDisplayPreferences.diff, openDiffTabInWorkspace]);

  // --- Resizer Logic ---
  const startResize = useCallback((target) => (mouseDownEvent) => {
      mouseDownEvent.preventDefault();
      mouseDownEvent.stopPropagation();
      if (DEBUG_SEPARATORS) console.log('[resizer] startResize', { target, clientX: mouseDownEvent.clientX });
      
      // For sidebar drag-to-expand, we allow starting from 0 width
      const startWidth = sidebarCollapsed ? 0 : sidebarWidth;

      // Calculate max width to avoid pushing other panels off-screen
      const navWidth = 54;
      const resizersWidth = 2;
      const fixedDeduction = navWidth + resizersWidth;
      const maxWidth = window.innerWidth - fixedDeduction;

      resizeStateRef.current = { target, startX: mouseDownEvent.clientX, startWidth, maxWidth };
      setActiveResizeTarget(target);
      setShowResizeOverlay(true);
      resizePendingRef.current = { target, width: startWidth, delta: 0 };
      const ghost = sidebarResizerGhostRef.current;
      if (ghost) {
          ghost.style.transform = 'translateX(0px)';
      }
      // show immediate visual cue
      if (sidebarResizerGhostRef.current) sidebarResizerGhostRef.current.style.background = 'var(--sidebar-active)';
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
  }, [sidebarCollapsed, sidebarWidth]);

  const handleMouseMove = useCallback((mouseMoveEvent) => {
      const { target, startX, startWidth, maxWidth } = resizeStateRef.current;
      if (!target) return;
      // debug log
      if (DEBUG_SEPARATORS) console.log('[resizer] move', { clientX: mouseMoveEvent.clientX, target });
      
      const rawDelta = mouseMoveEvent.clientX - startX;
      // Damping coefficient 0.8
      const dampedDelta = rawDelta * 0.8;
      
      if (target === 'sidebar' && sidebarCollapsed) {
           // Drag to expand logic
           if (rawDelta > 30) {
               const targetW = lastSidebarWidthRef.current || 260;
               setSidebarCollapsed(false);
               // Overshoot effect: set width to 110% then restore
               setSidebarWidth(targetW * 1.1);
               stopResize();
               
               // Restore to normal width after short delay to create bounce
               setTimeout(() => {
                   setSidebarWidth(targetW);
               }, 200);
           }
           return;
       }

      let nextWidth = startWidth + dampedDelta;

      if (target === 'sidebar') {
          const MIN_WIDTH = 220;
          // Forced Close: if dragged > 100px past min width (towards left)
          // effective width would be MIN_WIDTH + (negative delta)
          // if nextWidth < MIN_WIDTH - 100, close it
          if (nextWidth < MIN_WIDTH - 100) {
               setSidebarCollapsed(true);
               stopResize();
               return;
          }

          if (nextWidth <= MIN_WIDTH) {
              nextWidth = MIN_WIDTH;
              // Visual Feedback
              setResizeTooltip({
                  text: '无法继续缩小',
                  x: mouseMoveEvent.clientX,
                  y: mouseMoveEvent.clientY,
                  warning: true
              });
              if (sidebarResizerGhostRef.current) {
                  sidebarResizerGhostRef.current.style.background = '#FF5722';
              }
          } else {
              // Normal resize
              setResizeTooltip({
                  text: `${Math.round(nextWidth)}px`,
                  x: mouseMoveEvent.clientX,
                  y: mouseMoveEvent.clientY,
                  warning: false
              });
              if (sidebarResizerGhostRef.current) {
                  sidebarResizerGhostRef.current.style.background = 'var(--sidebar-active, #2196F3)';
              }
          }
      }

      if (maxWidth) {
          nextWidth = Math.min(nextWidth, maxWidth);
      }

      resizePendingRef.current = { target, width: nextWidth, delta: dampedDelta };
      if (!resizeRafRef.current) {
          resizeRafRef.current = requestAnimationFrame(() => {
              const pending = resizePendingRef.current;
              if (!pending.target) return;
              
                            if (pending.target === 'sidebar') {
                                    setSidebarWidth(pending.width);
                                    lastSidebarWidthRef.current = pending.width;
                            }
              resizeRafRef.current = null;
          });
      }
  }, [sidebarCollapsed]);

  const stopResize = useCallback(() => {
      if (DEBUG_SEPARATORS) console.log('[resizer] stopResize');
      if (resizeRafRef.current) {
          cancelAnimationFrame(resizeRafRef.current);
          resizeRafRef.current = null;
      }
      
      // Clear tooltip
      setResizeTooltip(null);

      resizePendingRef.current = { target: null, width: 0, delta: 0 };
      resizeStateRef.current = { target: null, startX: 0, startWidth: 0 };
      setActiveResizeTarget(null);
      setShowResizeOverlay(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      // clear visual cues
    try { if (sidebarResizerGhostRef.current) sidebarResizerGhostRef.current.style.background = 'var(--border)'; } catch {};
  }, [activeResizeTarget]);

  useEffect(() => {
      if (!activeResizeTarget) return;
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', stopResize);
      return () => {
          window.removeEventListener('mousemove', handleMouseMove);
          window.removeEventListener('mouseup', stopResize);
      };
  }, [activeResizeTarget, handleMouseMove, stopResize]);

    // Debug: log changes to resize-related state to help diagnose editor-vs-preview differences
    useEffect(() => {
        if (DEBUG_SEPARATORS) console.log('[resizer state]', { activeResizeTarget, showResizeOverlay, sidebarWidth, sidebarCollapsed });
    }, [activeResizeTarget, showResizeOverlay, sidebarWidth, sidebarCollapsed]);

  const currentSession = sessions.find(s => s.id === currentSessionId);
  const lastLog = logs && logs.length > 0 ? logs[0] : null;
  const logStatus = lastLog ? { requestOk: !!lastLog.success, parseOk: lastLog.parsed_success !== false } : null;
  const workspaceVisible = ['canva', 'agent'].includes(currentMode) || workspaceState.openTabs.length > 0 || Object.keys(diffTabs).length > 0 || !workspaceDriver || workspaceBindingStatus === 'checking' || workspaceBindingStatus === 'error';
  const workspaceShellVisible = workspaceVisible || showLogs;
  const gitBranch = gitStatus?.current || '';
  const gitBadgeCount = useMemo(() => {
      const files = gitStatus?.files || [];
      if (!Array.isArray(files) || files.length === 0) return 0;
      return files.filter((f) => {
          const wd = f.working_dir || '';
          const idx = f.index || '';
          const hasWorkingChange = ['A', 'M', 'D', 'R', '?'].includes(wd);
          const hasIndexChange = ['A', 'M', 'D', 'R'].includes(idx);
          return hasWorkingChange || hasIndexChange;
      }).length;
  }, [gitStatus]);

  const handleGlobalSearch = useCallback(async (query, options = {}) => {
      if (!workspaceDriver) return [];
      try {
          const result = await workspaceDriver.search(query, options);
          return result.results || [];
      } catch (e) {
          console.error('Search failed', e);
          return [];
      }
  }, [workspaceDriver]);

  // ✅ 使用受控渲染而非延迟值，避免闪烁
  // 直接传递最新状态，在 Workspace 组件内部使用 useMemo 优化
  const workspaceProps = useMemo(() => ({
    files: workspaceState.files,
    fileTree: workspaceState.fileTree,
    openTabs: workspaceState.openTabs,
    workspaceRoots: workspaceState.workspaceRoots,
  }), [workspaceState.files, workspaceState.fileTree, workspaceState.openTabs, workspaceState.workspaceRoots]);

  return (
    <WorkbenchShell theme={theme}>
      <TitleBar 
          projectMeta={projectMeta}
          onSelectProject={handleSelectWorkspace}
          onOpenWelcome={() => workspaceController.openWelcomeTab({ focus: true })}
          onCloseWorkspace={closeWorkspaceToWelcome}
          onBindBackend={promptOpenWorkspace}
          onToggleTheme={handleToggleTheme}
          theme={theme}
          language={language}
          viewMode={workspaceState.view}
          onToggleView={() => setWorkspaceState((prev) => ({ ...prev, view: prev.view === 'code' ? 'preview' : 'code' }))}
          onAddFile={() => handleAddFile()}
          onAddFolder={() => handleAddFolder()}
          onSync={() => syncWorkspaceFromDisk({ includeContent: true, highlight: false })}
          onRefreshPreview={handleRefreshPreview}
          hasDriver={!!workspaceDriver}
          bindingError={workspaceBindingError}
          workspaceRoots={workspaceProps.workspaceRoots}
          workspaceRootLabel={workspaceRootLabel}
          recentProjects={recentProjects}
          onOpenRecent={(proj) => {
            const candidate = proj?.fsPath || proj?.pathLabel || proj?.backendRoot || '';
            const target = isAbsolutePath(candidate) ? candidate : (proj?.id || null);
            workspaceController.openWorkspace(target, { preferredRoot: candidate });
          }}
          onCloneRepository={() => setShowCloneModal(true)}
          onConnectRemote={() => setShowRemoteModal(true)}
          onOpenCommandPalette={() => setShowCommandPalette(true)}
      />
            {showResizeOverlay && (
                <div
                    onMouseMove={handleMouseMove}
                    onMouseUp={stopResize}
                    onPointerMove={handleMouseMove}
                    onPointerUp={stopResize}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 99999,
                        cursor: 'col-resize',
                        background: 'transparent',
                        touchAction: 'none',
                    }}
                />
            )}
      {showConfig && (
        <ConfigPanel
          config={config}
          setConfig={setConfig}
          toolSettings={toolSettings}
          onToolSettingsChange={persistToolSettings}
          onSave={handleConfigSubmit}
          onClose={() => { setConfigFullscreen(false); setShowConfig(false); }}
          checkApiStatus={checkApiStatus}
          apiStatus={apiStatus}
          apiMessage={apiMessage}
          appearanceMode={userThemePreferenceRef.current ? (theme === 'dark' ? 'dark' : 'light') : 'system'}
          onChangeAppearanceMode={handleThemeModeChange}
          language={language}
          onLanguageChange={handleLanguageChange}
          displayPreferences={uiDisplayPreferences}
          onChangeDisplayPreference={handleChangeDisplayPreference}
          onOpenInEditor={handleOpenConfigInEditor}
          fullscreen={configFullscreen}
          onToggleFullscreen={() => setConfigFullscreen((prev) => !prev)}
          variant="modal"
        />
      )}

      <CommandPalette 
          isOpen={showCommandPalette}
          onClose={() => setShowCommandPalette(false)}
          files={workspaceProps.files}
          onOpenFile={openFile}
          onSearchText={(text) => {
              setGlobalSearchQuery(text);
              handleSidebarTabChange('search');
          }}
          aiInvoker={editorAiInvoker}
      />

      <div className="app-body">
            <NavSidebar 
            activeSidebar={activeSidebarPanel}
            sidebarCollapsed={sidebarCollapsed}
            explorerOpen={!sidebarCollapsed && activeSidebarPanel === 'explorer'}
            onSelectSidebar={handleSidebarTabChange}
            onCreateSession={createSession}
            onToggleConfig={() => {
              if (uiDisplayPreferences.settings === 'editor') {
                  handleOpenConfigInEditor();
              } else {
                  setConfigFullscreen(false);
                  setShowConfig(true);
              }
            }}
            apiStatus={apiStatus}
            gitBadgeCount={gitBadgeCount}
            language={language}
          />

          <div
            className={`sidebar-panel-shell ${sidebarCollapsed ? 'collapsed' : ''} sidebar-${activeSidebarPanel}-panel`}
            style={{
                width: sidebarCollapsed ? '0px' : `${sidebarWidth}px`,
                minWidth: sidebarCollapsed ? '0' : '220px',
                maxWidth: sidebarCollapsed ? '0' : 'none',
                transition: activeResizeTarget === 'sidebar' ? 'none' : 'width 0.2s ease, min-width 0.2s ease',
                pointerEvents: sidebarCollapsed ? 'none' : 'auto'
            }}
          >
            {!sidebarCollapsed && activeSidebarPanel === 'sessions' && (
              <SessionDrawer 
                  sessions={sessions}
                  currentSessionId={currentSessionId}
                  onSelectSession={selectSession}
                  onDeleteSession={deleteSession}
                  onRenameSession={renameSession}
                  onCreateSession={createSession}
                  width={sidebarWidth}
                  collapsed={sidebarCollapsed}
                  isResizing={activeResizeTarget === 'sidebar'}
              />
            )}
            {!sidebarCollapsed && activeSidebarPanel === 'chat' && (
              <ChatArea 
                 messages={messages}
                 input={input}
                 setInput={setInput}
                 loading={loadingSessions.has(currentSessionId)}
                 onSend={handleSend}
                 onStop={handleStop}
                 onToggleLogs={() => setShowLogs(!showLogs)}
                 currentSession={currentSession}
                 logStatus={logStatus}
                 mode={currentMode}
                 modeOptions={MODE_OPTIONS}
                 onModeChange={handleModeChange}
                 toolRuns={toolRuns}
                 onOpenDiff={handleOpenDiff}
                 taskReview={taskReview}
                 onTaskToggle={toggleTaskReview}
                 onTaskKeepAll={keepAllTaskFiles}
                 onTaskRevertAll={revertAllTaskFiles}
                 onTaskKeepFile={keepTaskFile}
                 onTaskRevertFile={revertTaskFile}
              />
            )}
            {!sidebarCollapsed && activeSidebarPanel === 'explorer' && (
              <ExplorerPanel 
                  files={workspaceProps.files}
                  fileTree={workspaceProps.fileTree}
                  projectLabel={workspaceRootLabel}
                  workspaceRoots={workspaceProps.workspaceRoots}
                  loading={workspaceLoading}
                  activeFile={workspaceState.activeFile}
                  onOpenFile={openFile}
                  onAddFile={handleAddFile}
                  onAddFolder={handleAddFolder}
                  onDeletePath={handleDeletePath}
                  onRenamePath={handleRenamePath}
                  onSyncStructure={() => syncWorkspaceFromDisk({ includeContent: true, highlight: false })}
                  hasWorkspace={!!workspaceDriver}
                  gitStatus={gitStatus}
              />
            )}
            {!sidebarCollapsed && activeSidebarPanel === 'search' && (
                <SearchPanel 
                    onSearch={handleGlobalSearch}
                    onOpenFile={openFile}
                    projectLabel={workspaceRootLabel}
                    initialQuery={globalSearchQuery}
                />
            )}
            {!sidebarCollapsed && activeSidebarPanel === 'git' && (
                <SourceControlPanel 
                    gitStatus={gitStatus}
                    gitRemotes={gitRemotes}
                    gitLog={gitLog}
                    gitBranches={gitBranches}
                    onCommit={handleGitCommit}
                    onStage={handleGitStage}
                    onUnstage={handleGitUnstage}
                    onStageAll={handleGitStageAll}
                    onUnstageAll={handleGitUnstageAll}
                    onDiscard={handleGitRestore}
                    onDiscardAll={handleGitRestoreAll}
                    onSync={handleGitSync}
                    onPull={handleGitPull}
                    onPush={handleGitPush}
                    onPublishBranch={handleGitPublishBranch}
                    onSetUpstream={handleGitSetUpstream}
                    onRefresh={refreshGitStatus}
                    onGenerateCommitMessage={handleGenerateCommitMessage}
                    onInit={handleGitInit}
                    onAddRemote={handleGitAddRemote}
                    onCreateBranch={handleGitCreateBranch}
                    onDeleteBranch={handleGitDeleteBranch}
                    onCheckoutBranch={handleGitCheckoutBranch}
                    onResolve={handleGitResolve}
                    onOpenFile={openFile}
                    onDiff={handleOpenWorkingCopyDiff}
                    onGetCommitDetails={handleGetCommitDetails}
                    onGetCommitStats={handleGetCommitStats}
                    onOpenCommitDiff={handleOpenCommitDiff}
                    onOpenAllDiffs={handleOpenAllCommitDiffs}
                    onOpenBatchDiffs={handleOpenBatchDiffs}
                    loading={gitLoading}
                    repositoryLabel={workspaceRootLabel}
                />
            )}
          </div>

          <div
              ref={sidebarResizerGhostRef}
              onMouseDown={startResize('sidebar')}
              onPointerDown={startResize('sidebar')}
              className={`sidebar-resizer ${sidebarCollapsed ? 'collapsed' : ''}`}
              title={sidebarCollapsed ? "向右拖动展开侧边栏" : "拖动调整侧边栏宽度"}
              aria-label="Sidebar Resizer"
              aria-valuenow={sidebarWidth}
              aria-valuemin={220}
          >
              <div className="sidebar-resizer-hit">
                  <div className="sidebar-resizer-visual" />
              </div>
          </div>

          <div style={{ 
              flex: workspaceShellVisible ? 1 : 0, 
              position: 'relative', 
              display: workspaceShellVisible ? 'flex' : 'none', 
              flexDirection: 'column', 
              background: 'var(--bg)',
              minWidth: 0,
              // Removed overflow: 'hidden' to allow floating card shadows to be visible
          }}>
              {workspaceVisible && (
                <EditorArea
                  files={workspaceProps.files}
                  openTabs={workspaceProps.openTabs}
                  activeFile={workspaceState.activeFile}
                  viewMode={workspaceState.view}
                  livePreviewContent={workspaceState.livePreview}
                  entryCandidates={workspaceState.entryCandidates}
                  loading={workspaceLoading}
                  hasWorkspace={!!workspaceDriver}
                  workspaceRootLabel={workspaceRootLabel}
                  workspaceRoots={workspaceProps.workspaceRoots}
                  bindingStatus={workspaceBindingStatus}
                   bindingError={workspaceBindingError}
                  hotReloadToken={hotReloadToken}
                    theme={theme}
                    backendRoot={backendWorkspaceRoot}
                    keybindings={config?.keybindings}
                    aiEngineClient={aiEngineClient}
                    getBackendConfig={getBackendConfig}
                    currentSessionId={currentSessionId}
                    backendWorkspaceId={backendWorkspaceId}
                    onRegisterEditorAiInvoker={setEditorAiInvoker}
                    undoRedoLimit={config?.editorUndoRedoLimit}
                    welcomeTabPath={WELCOME_TAB_PATH}
                    onOpenWelcomeTab={() => workspaceController.openWelcomeTab({ focus: true })}
                    renderWelcomeTab={() => (
                      <WelcomeEditor
                        theme={theme}
                        bindingStatus={workspaceBindingStatus}
                        bindingError={workspaceBindingError}
                        recentProjects={recentProjects}
                        backendWorkspaces={activeWorkspaces}
                        onOpenFolder={() => handleSelectWorkspace()}
                        onOpenFile={handleOpenFileFromWelcome}
                        onNewFile={handleNewFileFromWelcome}
                        onPickFolderPath={pickNativeFolderPath}
                        onCloneRepository={cloneRepositoryFromWelcome}
                        onCreateTemplate={createTemplateProjectInWorkspace}
                        onOpenFolderWithPreferredRoot={openWorkspaceWithPreferredRoot}
                        onCancelOpen={() => closeWorkspaceToWelcome()}
                        onOpenRecent={(proj) => workspaceController.openWorkspace(proj?.fsPath || proj?.id || null, { preferredRoot: proj?.fsPath || '' })}
                        onRemoveRecent={(proj) => removeRecentProject(proj)}
                        onOpenBackendWorkspace={handleOpenBackendWorkspaceFromList}
                      />
                    )}
                   onSelectFolder={handleSelectWorkspace}
                   onBindBackendRoot={promptOpenWorkspace}
                   onOpenFile={openFile}
                   onCloseFile={closeFile}
                   onFileChange={handleFileChange}
                  onActiveFileChange={(path) => setWorkspaceState((prev) => ({ ...prev, activeFile: path, previewEntry: path && path !== WELCOME_TAB_PATH ? path : prev.previewEntry }))} 
                   onTabReorder={handleTabReorder}
                   onAddFile={handleAddFile}
                   onAddFolder={handleAddFolder}
                  onRefreshPreview={handleRefreshPreview}
                  onToggleTheme={handleToggleTheme}
                  onToggleView={() => setWorkspaceState((prev) => {
                    const nextView = prev.view === 'code' ? 'preview' : 'code';
                    const nextPreviewEntry = prev.activeFile || prev.previewEntry;
                    return { ...prev, view: nextView, previewEntry: nextPreviewEntry };
                  })}
                  onSyncStructure={() => syncWorkspaceFromDisk({ includeContent: true, highlight: false })}
                  previewEntry={workspaceState.previewEntry}
                  onPreviewEntryChange={(value) => setWorkspaceState((prev) => ({ ...prev, previewEntry: value }))}
                  settingsTabPath={SETTINGS_TAB_PATH}
                  renderSettingsTab={() => (
                    <ConfigPanel
                      config={config}
                      setConfig={setConfig}
                      toolSettings={toolSettings}
                      onToolSettingsChange={persistToolSettings}
                      onSave={handleConfigSubmit}
                      onClose={() => closeFile(SETTINGS_TAB_PATH)}
                      checkApiStatus={checkApiStatus}
                      apiStatus={apiStatus}
                      apiMessage={apiMessage}
                      appearanceMode={userThemePreferenceRef.current ? (theme === 'dark' ? 'dark' : 'light') : 'system'}
                      onChangeAppearanceMode={handleThemeModeChange}
                      language={language}
                      onLanguageChange={setLanguage}
                      displayPreferences={uiDisplayPreferences}
                      onChangeDisplayPreference={handleChangeDisplayPreference}
                      onOpenInEditor={handleOpenConfigInEditor}
                      fullscreen={false}
                      onToggleFullscreen={() => {}}
                      variant="inline"
                    />
                  )}
                  diffTabPrefix={DIFF_TAB_PREFIX}
                  diffTabs={diffTabs}
                />
              )}
              {showLogs && (
                  <LogPanel 
                    logs={logs} 
                    onClose={() => setShowLogs(false)} 
                  />
              )}
          </div>
      </div>
      
      <div className="status-bar" style={{
          height: '22px',
          background: 'var(--accent)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          fontSize: '11px',
          cursor: 'default',
          userSelect: 'none',
          zIndex: 100
      }}>
          <div 
            className="status-item" 
            style={{ display: 'flex', gap: '4px', alignItems: 'center', cursor: 'pointer', marginRight: '10px' }}
            onClick={() => {
                if (sidebarCollapsed) setSidebarCollapsed(false);
                setActiveSidebarPanel('git');
            }}
            title="Switch Branch"
          >
              <span className="codicon codicon-git-branch" aria-hidden style={{ fontSize: '13px' }} />
              <span>{gitBranch || 'Git'}</span>
              {gitStatus && (
                  <span style={{ marginLeft: '4px' }}>
                      {gitStatus.ahead > 0 && `↑${gitStatus.ahead} `}
                      {gitStatus.behind > 0 && `↓${gitStatus.behind}`}
                  </span>
              )}
          </div>
          {workspaceBindingStatus === 'error' && (
              <div style={{ background: 'var(--danger)', padding: '0 4px' }}>Connection Error</div>
          )}
      </div>

      {resizeTooltip && (
        <div style={{
            position: 'fixed',
            left: resizeTooltip.x + 15,
            top: resizeTooltip.y,
            background: resizeTooltip.warning ? '#FF5722' : 'rgba(0,0,0,0.8)',
            color: '#fff',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '12px',
            pointerEvents: 'none',
            zIndex: 10002,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            transition: 'opacity 0.2s',
            whiteSpace: 'nowrap'
        }}>
            {resizeTooltip.text}
        </div>
      )}
      <ConnectRemoteModal 
          isOpen={showRemoteModal} 
          onClose={() => setShowRemoteModal(false)}
          onConnect={handleConnectRemote}
      />
      <CloneRepositoryModal 
          isOpen={showCloneModal}
          onClose={() => setShowCloneModal(false)}
          onClone={async (data) => {
              const res = await cloneRepositoryFromWelcome(data);
              if (res?.targetPath) {
                   await workspaceController.openWorkspace(null, { preferredRoot: res.targetPath });
              }
          }}
          onPickFolder={pickNativeFolderPath}
      />
      <DiffModal 
          diff={diffModal} 
          onClose={closeDiffModal} 
          theme={theme} 
          onOpenFile={openFile}
          onOpenDiffInWorkspace={handleOpenDiffInWorkspace}
      />
      <InputModal 
          isOpen={inputModal.isOpen}
          title={inputModal.title}
          label={inputModal.label}
          defaultValue={inputModal.defaultValue}
          onConfirm={inputModal.onConfirm}
          onClose={inputModal.onClose}
      />
    </WorkbenchShell>
  );
}

export default App;
