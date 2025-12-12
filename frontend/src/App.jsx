import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import NavSidebar from './components/NavSidebar';
import SessionDrawer from './components/SessionDrawer';
import ExplorerPanel from './components/ExplorerPanel';
import ChatArea from './components/ChatArea';
import LogPanel from './components/LogPanel';
import ConfigPanel from './components/ConfigPanel';
import TitleBar from './components/TitleBar';
import Workspace from './components/Workspace';
import { LocalWorkspaceDriver } from './utils/localWorkspaceDriver';
import DiffModal from './components/DiffModal';

const DEBUG_SEPARATORS = false;

const THEME_STORAGE_KEY = 'ai_agent_theme_choice';
const detectSystemTheme = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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
  },
};

const DEFAULT_PROJECT_CONFIG = {
  projectName: '',
  projectPath: '',
  backendRoot: '',
  provider: 'openai',
  openai: { api_key: '', model: '', base_url: '', check_model: '' },
  anthropic: { api_key: '', model: '', base_url: '', check_model: '' },
  toolSettings: DEFAULT_TOOL_SETTINGS,
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
      check_model: snapshot.check_model || ''
  };
  const openai = { ...(fallback.openai || DEFAULT_PROJECT_CONFIG.openai), ...(provider === 'openai' ? shared : {}) };
  const anthropic = { ...(fallback.anthropic || DEFAULT_PROJECT_CONFIG.anthropic), ...(provider === 'anthropic' ? shared : {}) };
  return { provider, openai, anthropic };
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
};

function App() {
  const mergeToolSettings = (incoming) => ({
      agent: { ...DEFAULT_TOOL_SETTINGS.agent, ...(incoming?.agent || {}) },
      canva: { ...DEFAULT_TOOL_SETTINGS.canva, ...(incoming?.canva || {}) }
  });
  const storedThemePreference = readStoredTheme();
  // --- Config State ---
  const [projectConfig, setProjectConfig] = useState(DEFAULT_PROJECT_CONFIG);
  const [config, setConfig] = useState({ 
    provider: DEFAULT_PROJECT_CONFIG.provider, 
    openai: { ...DEFAULT_PROJECT_CONFIG.openai },
    anthropic: { ...DEFAULT_PROJECT_CONFIG.anthropic }
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
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceDriver, setWorkspaceDriver] = useState(null);
  const [workspaceBindingStatus, setWorkspaceBindingStatus] = useState('idle'); // idle | checking | ready | error
  const [workspaceBindingError, setWorkspaceBindingError] = useState('');
  const [workspaceRootLabel, setWorkspaceRootLabel] = useState('');
  const [backendWorkspaceRoot, setBackendWorkspaceRoot] = useState('');
  const [hotReloadToken, setHotReloadToken] = useState(0);
  const [toolSettings, setToolSettings] = useState(DEFAULT_TOOL_SETTINGS);
  const [theme, setTheme] = useState(() => storedThemePreference || DEFAULT_PROJECT_CONFIG.theme || detectSystemTheme());
  const abortControllerRef = useRef(null);
  const saveTimersRef = useRef({});
  const configSaveTimerRef = useRef(null);
  const streamBufferRef = useRef('');
  const syncLockRef = useRef(false);
  const lastSyncRef = useRef(0);
  const workspaceInitializedRef = useRef(false);
  const taskSnapshotRef = useRef(null);
  const configHydratedRef = useRef(false);
  const userThemePreferenceRef = useRef(!!storedThemePreference);

  // --- Modal State ---
  const [inputModal, setInputModal] = useState({ isOpen: false, title: '', label: '', defaultValue: '', onConfirm: () => {}, onClose: () => {} });
  const [diffModal, setDiffModal] = useState(null);

  // --- Logs State ---
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState([]);

  // --- Layout State ---
  const [sidebarWidth, setSidebarWidth] = useState(() => pickLayoutNumber('sidebarWidth', DEFAULT_PROJECT_CONFIG.sidebarWidth));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSidebarPanel, setActiveSidebarPanel] = useState('sessions');
  const [chatPanelWidth, setChatPanelWidth] = useState(() => pickLayoutNumber('chatWidth', DEFAULT_PROJECT_CONFIG.chatPanelWidth));
  const [chatPanelCollapsed, setChatPanelCollapsed] = useState(false);
  const [activeResizeTarget, setActiveResizeTarget] = useState(null);
  const resizeStateRef = useRef({ target: null, startX: 0, startWidth: 0 });
  const resizePendingRef = useRef({ target: null, width: 0, delta: 0 });
  const resizeRafRef = useRef(null);
  
  // --- Resizer State ---
  // 拖拽分隔条时悬浮提示内容（null 表示隐藏）
  const [resizeTooltip, setResizeTooltip] = useState(null);
  
  const lastChatWidthRef = useRef(pickLayoutNumber('chatWidth', DEFAULT_PROJECT_CONFIG.chatPanelWidth));
  const lastSidebarWidthRef = useRef(pickLayoutNumber('sidebarWidth', DEFAULT_PROJECT_CONFIG.sidebarWidth));
  const sidebarResizerGhostRef = useRef(null);
  const chatResizerGhostRef = useRef(null);
    const chatPanelRef = useRef(null);
  const [showResizeOverlay, setShowResizeOverlay] = useState(false);

  const projectReady = !!workspaceDriver;
  const backendBound = !!backendWorkspaceRoot && workspaceBindingStatus === 'ready';
  const hasElectronPicker = () => typeof window !== 'undefined' && !!window.electronAPI?.openFolder;
  const projectHeaders = useMemo(
      () => (backendWorkspaceRoot ? { 'X-Workspace-Root': backendWorkspaceRoot } : {}),
      [backendWorkspaceRoot]
  );

  const projectFetch = useCallback((url, options = {}) => {
      const headers = { ...(options.headers || {}), ...projectHeaders };
      return fetch(url, { ...options, headers });
  }, [projectHeaders]);

  const normalizeProjectConfig = useCallback((raw = {}) => {
      const merged = {
          ...DEFAULT_PROJECT_CONFIG,
          ...raw,
      };
      merged.toolSettings = mergeToolSettings(raw.toolSettings || DEFAULT_PROJECT_CONFIG.toolSettings);
      merged.sidebarWidth = Number(merged.sidebarWidth || merged.sessionPanelWidth) || DEFAULT_PROJECT_CONFIG.sidebarWidth;
      merged.chatPanelWidth = Number(merged.chatPanelWidth) || DEFAULT_PROJECT_CONFIG.chatPanelWidth;
      merged.theme = merged.theme || DEFAULT_PROJECT_CONFIG.theme;
      merged.lastMode = merged.lastMode || DEFAULT_PROJECT_CONFIG.lastMode;
      merged.projectName = merged.projectName || projectMeta.name || merged.projectPath || '';
      merged.projectPath = merged.projectPath || merged.backendRoot || projectMeta.pathLabel || '';
      merged.backendRoot = merged.backendRoot || merged.projectPath || projectMeta.pathLabel || '';
      return merged;
  }, [mergeToolSettings, projectMeta.name, projectMeta.pathLabel]);

  // Helper to get flat config for backend
  const getBackendConfig = () => {
      const current = config[config.provider];
      return {
          provider: config.provider,
          api_key: current.api_key,
          model: current.model,
          base_url: current.base_url,
          check_model: current.check_model,
          // New parameters
          context_max_length: current.context_max_length,
          output_max_tokens: current.output_max_tokens,
          temperature: current.temperature,
          context_independent: current.context_independent
      };
  };

  const applyBackendConfigSnapshot = useCallback((snapshot = {}) => {
      const mapped = mapFlatConfigToState(snapshot, { provider: config.provider, openai: config.openai, anthropic: config.anthropic });
      setConfig((prev) => ({
          ...prev,
          provider: mapped.provider,
          openai: { ...prev.openai, ...mapped.openai },
          anthropic: { ...prev.anthropic, ...mapped.anthropic }
      }));
      setProjectConfig((prev) => ({
          ...prev,
          provider: mapped.provider,
          openai: { ...prev.openai, ...mapped.openai },
          anthropic: { ...prev.anthropic, ...mapped.anthropic }
      }));
      if (mapped[mapped.provider]?.api_key) {
          setConfigured(true);
      }
      return mapped;
  }, [config.anthropic, config.openai, config.provider]);

  const fetchPersistedBackendConfig = useCallback(async ({ silent = false } = {}) => {
      if (!projectReady) return null;
      try {
          const res = await projectFetch('/api/config');
          if (!res.ok) return null;
          const data = await res.json();
          if (data?.config) {
              const applied = applyBackendConfigSnapshot(data.config);
              if (data.config.api_key) {
                  configHydratedRef.current = true;
              }
              if (!silent) {
                  setApiStatus('unknown');
              }
              return applied;
          }
      } catch (err) {
          if (!silent) {
              console.error('Fetch backend config failed', err);
          }
      }
      return null;
  }, [applyBackendConfigSnapshot, projectFetch, projectReady]);

  const checkApiStatus = async () => {
      if (!projectReady) {
          setApiStatus('unknown');
          setApiMessage('');
          return;
      }
      setApiStatus('checking');
      setApiMessage('Checking connection...');
      try {
          const body = getBackendConfig();
          const res = await projectFetch('/api/health', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: body ? JSON.stringify(body) : null,
          });
          const data = await res.json();
          setApiStatus(data.connected ? 'ok' : 'error');
          setApiMessage(data.message || (data.connected ? 'Connected successfully' : 'Connection failed'));
      } catch (err) {
          setApiStatus('error');
          setApiMessage(`Network Error: ${err.message}`);
      }
  };

  const handleConfigSubmit = async (options = {}) => {
    const { silent = false } = options;
    try {
      const res = await projectFetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getBackendConfig()),
      });
      if (res.ok) {
        setConfigured(true);
        setProjectConfig((prev) => ({ ...prev, provider: config.provider, openai: { ...config.openai }, anthropic: { ...config.anthropic } }));
        if (!silent) checkApiStatus();
      } else {
        const errData = await res.json();
        if (!silent) alert(`Configuration failed: ${errData.detail || 'Unknown error'}`);
        else console.error(`Configuration failed: ${errData.detail || 'Unknown error'}`);
      }
    } catch (err) {
      console.error(err);
      if (!silent) alert(`Error configuring agent: ${err.message}`);
    }
  };

  const applyStoredConfig = useCallback(async ({ silent = false } = {}) => {
      const payload = getBackendConfig();
      if (!payload.api_key || !projectReady) return;
      try {
          const res = await projectFetch('/api/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
          });
          if (res.ok) {
              setConfigured(true);
              checkApiStatus();
          } else if (!silent) {
              alert('Configuration failed');
          }
      } catch (err) {
          console.error(err);
          if (!silent) alert('Error configuring agent');
      }
  }, [getBackendConfig, checkApiStatus, projectFetch, projectReady]);

  // --- Workspace helpers ---
  const persistToolSettings = (updater) => {
      setToolSettings((prev) => {
          const next = typeof updater === 'function' ? updater(prev) : updater;
          setProjectConfig((cfg) => ({ ...cfg, toolSettings: next }));
          return next;
      });
  };

  const bindBackendWorkspaceRoot = useCallback(async (rootPath, { silent = false } = {}) => {
      const trimmed = (rootPath || '').trim();
      if (!trimmed) {
          setBackendWorkspaceRoot('');
          setProjectConfig((cfg) => ({ ...cfg, backendRoot: '' }));
          return;
      }
      if (!isAbsolutePath(trimmed)) {
          const message = '请填写后端工作区的绝对路径，例如 H:\\\\04';
          setWorkspaceBindingStatus('error');
          setWorkspaceBindingError(message);
          setBackendWorkspaceRoot('');
          setProjectConfig((cfg) => ({ ...cfg, backendRoot: '' }));
          if (!silent) {
              console.warn(message);
          }
          return;
      }
      try {
          setWorkspaceBindingStatus('checking');
          const res = await fetch('/api/workspace/bind-root', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Workspace-Root': trimmed },
              body: JSON.stringify({ root: trimmed })
          });
          let data = {};
          try {
              data = await res.json();
          } catch {
              data = {};
          }
          if (!res.ok) {
              throw new Error(data.detail || res.statusText || '绑定后端工作区失败');
          }
          const applied = data.root || trimmed;
          setBackendWorkspaceRoot(applied);
          setProjectConfig((cfg) => ({
              ...cfg,
              backendRoot: applied,
              projectPath: cfg.projectPath || applied
          }));
          setWorkspaceBindingError('');
          setWorkspaceBindingStatus('ready');
      } catch (err) {
          console.error('Bind backend workspace failed', err);
          setWorkspaceBindingStatus('error');
          setWorkspaceBindingError(err?.message || '绑定后端工作区失败');
          if (!silent) {
              console.warn(`绑定后端工作区失败：${err.message || err}`);
          }
      }
  }, []);

  const refreshRecentProjects = useCallback(async () => {
      try {
          const list = await LocalWorkspaceDriver.listRecent();
          setRecentProjects(list);
      } catch {
          setRecentProjects([]);
      }
  }, []);

  const applyConfigToState = useCallback((cfg, driver = null) => {
      setProjectConfig(cfg);
      setConfig({
          provider: cfg.provider,
          openai: { ...cfg.openai },
          anthropic: { ...cfg.anthropic }
      });
      setConfigured(!!cfg?.[cfg.provider]?.api_key);
      setToolSettings(mergeToolSettings(cfg.toolSettings));
      const storedTheme = readStoredTheme();
      const nextTheme = storedTheme || cfg.theme || detectSystemTheme();
      setTheme(nextTheme);
      if (storedTheme) {
          userThemePreferenceRef.current = true;
      }
      const stored = readLayoutPrefs();
      const nextSidebarWidth = Number(stored.sidebarWidth) || cfg.sidebarWidth || cfg.sessionPanelWidth || DEFAULT_PROJECT_CONFIG.sidebarWidth;
      const nextChatWidth = Number(stored.chatWidth) || cfg.chatPanelWidth || DEFAULT_PROJECT_CONFIG.chatPanelWidth;
      setSidebarWidth(nextSidebarWidth);
      setChatPanelWidth(nextChatWidth);
      lastSidebarWidthRef.current = nextSidebarWidth;
      lastChatWidthRef.current = nextChatWidth;
      setSidebarCollapsed(false);
      setActiveSidebarPanel((prev) => prev || 'sessions');
      setCurrentMode(cfg.lastMode || DEFAULT_PROJECT_CONFIG.lastMode);
      const initialBackendRoot = isAbsolutePath(cfg.backendRoot) ? cfg.backendRoot : (isAbsolutePath(cfg.projectPath) ? cfg.projectPath : '');
      setBackendWorkspaceRoot(initialBackendRoot);
      setWorkspaceRootLabel(initialBackendRoot || cfg.projectPath || driver?.pathLabel || driver?.rootName || '');
  }, [mergeToolSettings, userThemePreferenceRef]);

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
      setWorkspaceState(initialWorkspaceState);
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
          await bindBackendWorkspaceRoot(candidateRoot, { silent: false });
          setWorkspaceRootLabel(candidateRoot);
      }

      await syncWorkspaceFromDisk({ includeContent: true, highlight: false, driver });
      return cfg;
  }, [applyConfigToState, bindBackendWorkspaceRoot, loadProjectConfigFromDisk, refreshRecentProjects, syncWorkspaceFromDisk]);

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
      if (!workspaceDriver || !projectReady) return [];
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
      const payload = { timestamp: Date.now(), project: projectMeta.pathLabel || projectMeta.id || 'default', ...detail };
      try {
          // 仅用于跨标签页同步，不在本标签页监听
          localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
      } catch (err) {
          console.warn('Emit sessions-updated failed', err);
      }
  }, [projectMeta]);

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
      if (latest && latest.before !== undefined && latest.after !== undefined) {
          openDiffModal(latest);
          return;
      }
      if (direct) {
          openDiffModal(direct);
          return;
      }
      alert('未找到可用的 diff 快照（请确认已触发文件写入操作）');
  }, [fetchDiffSnapshot, openDiffModal]);

  const closeDiffModal = useCallback(() => setDiffModal(null), []);

  const mergeRunLists = useCallback((existing = [], incoming = []) => {
      const map = new Map();
      existing.forEach((run, idx) => {
          const key = run.id || `${run.name || 'tool'}-${idx}`;
          map.set(key, run);
      });
      incoming.forEach((run, idx) => {
          const key = run.id || `${run.name || 'tool'}-${existing.length + idx}`;
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
      if (!sessionId || !backendBound) return;
      try {
          const res = await projectFetch(`/api/sessions/${sessionId}/messages`);
          if (!res.ok) return;
          const data = await res.json();
          const normalized = normalizeMessages(data);
          setMessages(normalized);
          const derivedRuns = buildToolRunsFromMessages(normalized);
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
  }, [normalizeMessages, buildToolRunsFromMessages, mergeRunLists, projectFetch, backendBound]);

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
          if (hasElectronPicker()) {
              const result = await window.electronAPI.openFolder();
              if (result && typeof result === 'string') return result.trim();
          }
      } catch (err) {
          console.warn('Electron folder picker failed', err);
      }
      return '';
  }, []);

  const handleSelectWorkspace = useCallback(async (projectId = null) => {
      setWorkspaceBindingError('');
      try {
          setWorkspaceBindingStatus('checking');
          const driver = projectId ? await LocalWorkspaceDriver.fromPersisted(projectId) : await LocalWorkspaceDriver.pickFolder();
          if (!driver) {
              throw new Error('未找到可用的项目文件夹');
          }
          const electronPath = await requestElectronFolderPath();
          const cfg = await hydrateProject(driver, electronPath);
      } catch (err) {
          setWorkspaceBindingStatus('error');
          setWorkspaceBindingError(err?.message || '选择文件夹失败');
      }
  }, [hydrateProject, requestElectronFolderPath]);

  const promptBindBackendRoot = useCallback(() => {
      const suggestion = backendWorkspaceRoot || projectConfig.backendRoot || projectConfig.projectPath || '';
      
      setInputModal({
          isOpen: true,
          title: '绑定后端工作区',
          label: '请输入后端工作区的绝对路径（例如 H:\\04）',
          defaultValue: suggestion,
          onConfirm: (input) => {
              if (input) {
                  bindBackendWorkspaceRoot(input, { silent: false });
              }
              setInputModal(prev => ({ ...prev, isOpen: false }));
          },
          onClose: () => setInputModal(prev => ({ ...prev, isOpen: false }))
      });
  }, [backendWorkspaceRoot, projectConfig.backendRoot, projectConfig.projectPath, bindBackendWorkspaceRoot]);

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
      if (chatPanelCollapsed) setChatPanelCollapsed(false); // Auto open chat panel
      await refreshMessages(id);
  }, [sidebarCollapsed, chatPanelCollapsed, refreshMessages]);

  // 不包含任何依赖，防止循环更新
  const fetchSessions = useCallback(async () => {
      if (!backendBound) return;
      try {
          const res = await projectFetch('/api/sessions');
          if (res.ok) {
              const data = await res.json();
              setSessions(data);
          }
      } catch (err) {
          console.error("Failed to fetch sessions", err);
      }
  }, [backendBound, projectFetch]);

  const createSession = useCallback(async (initialTitle) => {
      if (!backendBound) {
          alert('请先绑定后端工作区路径');
          return null;
      }
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
  }, [currentMode, emitSessionsUpdated, projectFetch, backendBound]);

  const deleteSession = useCallback(async (id) => {
      if (!confirm("Are you sure you want to delete this chat?")) return;
      if (!backendBound) return;
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
  }, [currentSessionId, emitSessionsUpdated, projectFetch, backendBound]);

  // --- Initialization ---
  useEffect(() => {
      if (backendBound) {
          fetchSessions();
      } else {
          setSessions([]);
          setMessages([]);
          setCurrentSessionId(null);
      }
  }, [fetchSessions, backendBound]);

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
      setProjectConfig((prev) => (prev.chatPanelWidth === chatPanelWidth ? prev : { ...prev, chatPanelWidth }));
      persistLayoutPrefs({ chatWidth: chatPanelWidth });
      if (!chatPanelCollapsed) {
          lastChatWidthRef.current = chatPanelWidth;
      }
  }, [chatPanelWidth, chatPanelCollapsed]);

  useEffect(() => {
      if (!backendWorkspaceRoot) return;
      setProjectConfig((prev) => (prev.backendRoot === backendWorkspaceRoot ? prev : { ...prev, backendRoot: backendWorkspaceRoot, projectPath: prev.projectPath || backendWorkspaceRoot }));
  }, [backendWorkspaceRoot]);

  useEffect(() => {
      setProjectConfig((prev) => {
          const sameProvider = prev.provider === config.provider;
          const sameOpenai = JSON.stringify(prev.openai) === JSON.stringify(config.openai);
          const sameAnthropic = JSON.stringify(prev.anthropic) === JSON.stringify(config.anthropic);
          if (sameProvider && sameOpenai && sameAnthropic) return prev;
          return { ...prev, provider: config.provider, openai: { ...config.openai }, anthropic: { ...config.anthropic } };
      });
  }, [config]);

  useEffect(() => {
      if (configHydratedRef.current || !backendBound) return;
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
  }, [applyStoredConfig, fetchPersistedBackendConfig, getBackendConfig, backendBound]);

  useEffect(() => {
      if (backendWorkspaceRoot) {
          bindBackendWorkspaceRoot(backendWorkspaceRoot, { silent: true });
      }
  }, [backendWorkspaceRoot, bindBackendWorkspaceRoot]);

  useEffect(() => {
      // ✅ 仅在挂载时执行一次，避免循环依赖
      if (workspaceInitializedRef.current) return;
      workspaceInitializedRef.current = true;
      
      let cancelled = false;
      (async () => {
          try {
              setWorkspaceBindingStatus('checking');
              await refreshRecentProjects();
              const driver = await LocalWorkspaceDriver.fromPersisted();
              if (cancelled) return;
              if (driver) {
                  await hydrateProject(driver);
              } else {
                  setWorkspaceBindingStatus('idle');
              }
          } catch (err) {
              if (!cancelled) {
                  setWorkspaceBindingStatus('error');
                  setWorkspaceBindingError(err?.message || '工作区绑定失败');
              }
          }
      })();
      return () => {
          cancelled = true;
      };
  }, []);

  useEffect(() => {
      // 仅用于跨标签页同步
      // 注意：storage 事件仅在其他标签页被触发，本标签页不会收到
      // 所以这个监听实际上只用于多标签页场景
      const handleStorage = (e) => {
          if (e.key !== SESSION_STORAGE_KEY || !e.newValue) return;
          try {
              const payload = JSON.parse(e.newValue);
              const currentProject = projectMeta.pathLabel || projectMeta.id || 'default';
              if (payload.project && payload.project !== currentProject) return;
          } catch {
              /* ignore parse errors */
          }
          fetchSessions();
      };
      window.addEventListener('storage', handleStorage);
      return () => {
          window.removeEventListener('storage', handleStorage);
      };
  }, [fetchSessions, projectMeta]);

  const renameSession = useCallback(async (id, title) => {
      const trimmed = (title || '').trim();
      if (!trimmed || !projectReady) return;
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
  }, [currentSessionId, emitSessionsUpdated, projectFetch, projectReady]);

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
      if (!currentSessionId || !projectReady) return;
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
      if (showLogs && currentSessionId && projectReady) {
          fetchLogs();
          const interval = setInterval(fetchLogs, 2000);
          return () => clearInterval(interval);
      }
  }, [showLogs, currentSessionId, projectReady]);

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
    if (!projectReady) {
        alert('请先选择项目文件夹。');
        return;
    }
    const enabledTools = getEnabledTools(currentMode);
    if (!configured || apiStatus !== 'ok') {
        alert('请先完成设置并确保后端已连接（点击左侧齿轮进入设置）。');
        setShowConfig(true);
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
      const response = await projectFetch(`/api/sessions/${sessionIdToUse}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: cleanedText, attachments: safeAttachments, mode: currentMode, tool_overrides: enabledTools }),
        signal: controller.signal
      });

      if (!response.body) {
          return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let currentAssistantCid = null;
      let shouldStartNewAssistant = false;

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
          upsertToolRun(ownerCid, {
              id: `live-${ownerCid}-${toolName}`,
              name: toolName,
              status: 'running',
              detail: `正在执行 ${toolName}…`
          });
          const placeholderCid = `tool-${ownerCid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          setMessages((prev) => [...prev, { _cid: placeholderCid, role: 'tool', name: toolName, content: `执行 ${toolName} 中…` }]);
          upsertToolRun(placeholderCid, {
              id: `live-${placeholderCid}`,
              name: toolName,
              status: 'running',
              detail: `正在执行 ${toolName}…`
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

  const closeFile = (path) => {
      setWorkspaceState((prev) => {
          const nextTabs = prev.openTabs.filter((p) => p !== path);
          const nextActive = prev.activeFile === path ? (nextTabs[nextTabs.length - 1] || '') : prev.activeFile;
          return { ...prev, openTabs: nextTabs, activeFile: nextActive, previewEntry: nextActive || prev.previewEntry };
      });
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

  useEffect(() => {
      if (!chatPanelCollapsed) {
          lastChatWidthRef.current = chatPanelWidth;
      }
  }, [chatPanelWidth, chatPanelCollapsed]);

  const toggleChatPanel = useCallback(() => {
      setChatPanelCollapsed((prev) => {
          if (!prev) {
              lastChatWidthRef.current = chatPanelWidth;
          } else {
              setChatPanelWidth(lastChatWidthRef.current || 420);
          }
          return !prev;
      });
  }, [chatPanelWidth]);

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

  // --- Resizer Logic ---
  const startResize = useCallback((target) => (mouseDownEvent) => {
      mouseDownEvent.preventDefault();
      mouseDownEvent.stopPropagation();
      if (DEBUG_SEPARATORS) console.log('[resizer] startResize', { target, clientX: mouseDownEvent.clientX });
      
      // For sidebar drag-to-expand, we allow starting from 0 width
      const startWidth = target === 'sidebar'
          ? (sidebarCollapsed ? 0 : sidebarWidth)
          : (chatPanelCollapsed ? lastChatWidthRef.current || chatPanelWidth : chatPanelWidth);

      // Note: We do NOT auto-uncollapse sidebar here to support "drag > 30px" logic.
      
      if (target === 'chat' && chatPanelCollapsed) {
          setChatPanelCollapsed(false);
          setChatPanelWidth(startWidth || 420);
      }

      // Calculate max width to avoid pushing other panels off-screen
      let maxWidth = 10000;
      const navWidth = 54;
      const resizersWidth = 4; // 2 * 2px
      const fixedDeduction = navWidth + resizersWidth;
      
      if (target === 'sidebar') {
          const currentChatWidth = chatPanelCollapsed ? 0 : chatPanelWidth;
          // Leave at least a tiny bit of space or just prevent overflow
          maxWidth = window.innerWidth - fixedDeduction - currentChatWidth;
      } else if (target === 'chat') {
          const currentSidebarWidth = sidebarCollapsed ? 0 : sidebarWidth;
          maxWidth = window.innerWidth - fixedDeduction - currentSidebarWidth;
      }

      resizeStateRef.current = { target, startX: mouseDownEvent.clientX, startWidth, maxWidth };
      setActiveResizeTarget(target);
      setShowResizeOverlay(true);
      resizePendingRef.current = { target, width: startWidth, delta: 0 };
      const ghost = target === 'sidebar' ? sidebarResizerGhostRef.current : chatResizerGhostRef.current;
      if (ghost) {
          ghost.style.transform = 'translateX(0px)';
      }
      // show immediate visual cue
      if (target === 'sidebar' && sidebarResizerGhostRef.current) sidebarResizerGhostRef.current.style.background = 'var(--sidebar-active)';
      if (target === 'chat' && chatResizerGhostRef.current) chatResizerGhostRef.current.style.background = 'var(--sidebar-active)';
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
  }, [chatPanelCollapsed, chatPanelWidth, sidebarCollapsed, sidebarWidth]);

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
      } else {
          nextWidth = Math.max(240, nextWidth);
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
                            } else if (pending.target === 'chat') {
                                    const clamped = Math.max(240, pending.width);
                                    setChatPanelWidth(clamped);
                                    lastChatWidthRef.current = clamped;
                                    setChatPanelCollapsed(false);
                                    // Also apply inline style to force the DOM width while dragging
                                    try {
                                        if (chatPanelRef.current) {
                                            chatPanelRef.current.style.transition = 'none';
                                            chatPanelRef.current.style.width = `${clamped}px`;
                                            const w = chatPanelRef.current.getBoundingClientRect().width;
                                            if (DEBUG_SEPARATORS) console.log('[resizer DOM width]', { reportedStateWidth: clamped, domWidth: w });
                                        }
                                    } catch (e) { /* ignore */ }
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

      // 在拖拽结束时，将 DOM 实际宽度同步到 chatPanelWidth 状态，确保宽度持久
      if (activeResizeTarget === 'chat' && chatPanelRef.current) {
          const finalWidth = chatPanelRef.current.getBoundingClientRect().width;
          setChatPanelWidth(finalWidth);
          lastChatWidthRef.current = finalWidth;
      }
      resizePendingRef.current = { target: null, width: 0, delta: 0 };
      resizeStateRef.current = { target: null, startX: 0, startWidth: 0 };
      const prevTarget = activeResizeTarget;
      setActiveResizeTarget(null);
      setShowResizeOverlay(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      // clear visual cues
    try { if (sidebarResizerGhostRef.current) sidebarResizerGhostRef.current.style.background = 'var(--border)'; } catch {};
    try { if (chatResizerGhostRef.current) chatResizerGhostRef.current.style.background = 'var(--border)'; } catch {};
      // clear inline width applied during dragging (only for chat target)
      if (prevTarget === 'chat') {
          try { if (chatPanelRef.current) { chatPanelRef.current.style.width = ''; chatPanelRef.current.style.transition = ''; } } catch {};
      }
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
        if (DEBUG_SEPARATORS) console.log('[resizer state]', { activeResizeTarget, showResizeOverlay, sidebarWidth, chatPanelWidth, chatPanelCollapsed, sidebarCollapsed });
    }, [activeResizeTarget, showResizeOverlay, sidebarWidth, chatPanelWidth, chatPanelCollapsed, sidebarCollapsed]);

  const currentSession = sessions.find(s => s.id === currentSessionId);
  const lastLog = logs && logs.length > 0 ? logs[0] : null;
  const logStatus = lastLog ? { requestOk: !!lastLog.success, parseOk: lastLog.parsed_success !== false } : null;
  const workspaceVisible = ['canva', 'agent'].includes(currentMode) || !!workspaceState.activeFile;
  const workspaceShellVisible = workspaceVisible || showLogs;

  // ✅ 使用受控渲染而非延迟值，避免闪烁
  // 直接传递最新状态，在 Workspace 组件内部使用 useMemo 优化
  const workspaceProps = useMemo(() => ({
    files: workspaceState.files,
    fileTree: workspaceState.fileTree,
    openTabs: workspaceState.openTabs,
  }), [workspaceState.files, workspaceState.fileTree, workspaceState.openTabs]);

  if (!workspaceDriver) {
      return (
          <div className="welcome-shell" data-theme={theme}>
              <div className="welcome-card">
                  <div className="welcome-title">请先选择项目文件夹</div>
                  <p className="welcome-subtitle">每个项目独立保存会话、配置和真实文件，完全隔离。</p>
                  <button className="primary-btn jumbo" onClick={() => handleSelectWorkspace()}>
                      📁 选择项目文件夹
                  </button>
              </div>
              <div className="recent-list">
                  <div className="recent-header">最近项目</div>
                  {recentProjects.length === 0 && <div className="recent-empty">暂无记录</div>}
                  {recentProjects.map((proj) => (
                      <button key={proj.id} className="recent-item" onClick={() => handleSelectWorkspace(proj.id)}>
                          <div className="recent-name">{proj.name || '未命名项目'}</div>
                          <div className="recent-path">{proj.pathLabel || '未记录路径'}</div>
                      </button>
                  ))}
              </div>
          </div>
      );
  }

  if (!projectReady) {
      return (
          <div className="welcome-shell" data-theme={theme}>
              <div className="welcome-card">
                  <div className="welcome-title">已绑定项目：{projectMeta.name || '未命名'}</div>
                  <p className="welcome-subtitle">正在初始化项目工作区…</p>
                  <div className="welcome-actions">
                      <button className="primary-btn" onClick={() => handleSelectWorkspace()}>重新选择项目</button>
                  </div>
              </div>
          </div>
      );
  }

  return (
    <div className="app-frame" data-theme={theme}>
      <TitleBar 
          projectMeta={projectMeta}
          onSelectProject={handleSelectWorkspace}
          onBindBackend={promptBindBackendRoot}
          onToggleTheme={handleToggleTheme}
          theme={theme}
          viewMode={workspaceState.view}
          onToggleView={() => setWorkspaceState((prev) => ({ ...prev, view: prev.view === 'code' ? 'preview' : 'code' }))}
          onAddFile={() => handleAddFile()}
          onAddFolder={() => handleAddFolder()}
          onSync={() => syncWorkspaceFromDisk({ includeContent: true, highlight: false })}
          onRefreshPreview={handleRefreshPreview}
          hasDriver={!!workspaceDriver}
          bindingError={workspaceBindingError}
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
          onClose={() => setShowConfig(false)}
          checkApiStatus={checkApiStatus}
          apiStatus={apiStatus}
          apiMessage={apiMessage}
        />
      )}

      <div className="app-body">
          <NavSidebar 
            activeSidebar={activeSidebarPanel}
            sidebarCollapsed={sidebarCollapsed}
            explorerOpen={!sidebarCollapsed && activeSidebarPanel === 'explorer'}
            onSelectSidebar={handleSidebarTabChange}
            onToggleChatPanel={toggleChatPanel}
            chatPanelCollapsed={chatPanelCollapsed}
            onCreateSession={createSession}
            onToggleConfig={() => setShowConfig(true)}
            apiStatus={apiStatus}
          />

          <div
            className={`sidebar-panel-shell ${sidebarCollapsed ? 'collapsed' : ''}`}
            style={{
                width: sidebarCollapsed ? '0px' : `${sidebarWidth}px`,
                minWidth: sidebarCollapsed ? '0' : '220px',
                maxWidth: sidebarCollapsed ? '0' : 'none',
                transition: activeResizeTarget === 'sidebar' ? 'none' : 'width 0.2s ease, min-width 0.2s ease',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                flexShrink: 0,
                background: 'var(--panel)',
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
                  onSwitchProject={() => handleSelectWorkspace()}
                  projectPath={projectMeta.pathLabel || backendWorkspaceRoot}
                  width={sidebarWidth}
                  collapsed={sidebarCollapsed}
                  isResizing={activeResizeTarget === 'sidebar'}
              />
            )}
            {!sidebarCollapsed && activeSidebarPanel === 'explorer' && (
              <ExplorerPanel 
                  files={workspaceProps.files}
                  fileTree={workspaceProps.fileTree}
                  projectLabel={workspaceRootLabel}
                  loading={workspaceLoading}
                  activeFile={workspaceState.activeFile}
                  onOpenFile={openFile}
                  onAddFile={handleAddFile}
                  onAddFolder={handleAddFolder}
                  onDeletePath={handleDeletePath}
                  onRenamePath={handleRenamePath}
                  onSyncStructure={() => syncWorkspaceFromDisk({ includeContent: true, highlight: false })}
                  hasWorkspace={!!workspaceDriver}
              />
            )}
          </div>

          <div
              ref={sidebarResizerGhostRef}
              onMouseDown={startResize('sidebar')}
              onPointerDown={startResize('sidebar')}
              style={{
                  width: sidebarCollapsed ? '12px' : '4px', // Increased hit area
                  marginLeft: sidebarCollapsed ? '-6px' : '-2px', // Center the hit area
                  cursor: 'col-resize',
                  background: sidebarCollapsed ? 'transparent' : 'var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  userSelect: 'none',
                  flexShrink: 0,
                  zIndex: 10001,
                  touchAction: 'none',
                  height: '100%',
                  position: 'relative',
              }}
              title={sidebarCollapsed ? "向右拖动展开侧边栏" : "拖动调整侧边栏宽度"}
              aria-label="Sidebar Resizer"
              aria-valuenow={sidebarWidth}
              aria-valuemin={220}
          />

          <div ref={chatPanelRef} style={{ 
              width: chatPanelCollapsed ? '0px' : `${chatPanelWidth}px`, 
              minWidth: chatPanelCollapsed ? '0' : '240px',
              display: chatPanelCollapsed ? 'none' : 'flex',
              flexDirection: 'column',
              borderRight: '1px solid var(--border)',
              background: 'var(--panel)',
              transition: activeResizeTarget === 'chat' ? 'none' : 'width 0.2s ease-out',
              flex: 'none'
          }}>
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
          </div>

          {!chatPanelCollapsed && (
            <div
                ref={chatResizerGhostRef}
                onMouseDown={startResize('chat')}
                onPointerDown={startResize('chat')}
                style={{
                    width: '2px', 
                    cursor: 'col-resize',
                    background: 'var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10001,
                    userSelect: 'none',
                    flexShrink: 0,
                    position: 'relative',
                    touchAction: 'none'
                }}
                title="拖动调整聊天区宽度"
            />
          )}

          <div style={{ 
              flex: workspaceShellVisible ? 1 : 0, 
              position: 'relative', 
              display: workspaceShellVisible ? 'flex' : 'none', 
              flexDirection: 'column', 
              background: 'var(--bg)',
              minWidth: 0,
              overflow: 'hidden'
          }}>
              {workspaceVisible && (
                <Workspace
                  files={workspaceProps.files}
                  openTabs={workspaceProps.openTabs}
                  activeFile={workspaceState.activeFile}
                  viewMode={workspaceState.view}
                  livePreviewContent={workspaceState.livePreview}
                  entryCandidates={workspaceState.entryCandidates}
                  loading={workspaceLoading}
                  hasWorkspace={!!workspaceDriver}
                  workspaceRootLabel={workspaceRootLabel}
                  bindingStatus={workspaceBindingStatus}
                  bindingError={workspaceBindingError}
                  hotReloadToken={hotReloadToken}
                  theme={theme}
                  backendRoot={backendWorkspaceRoot}
                  onSelectFolder={handleSelectWorkspace}
                  onBindBackendRoot={promptBindBackendRoot}
                  onOpenFile={openFile}
                  onCloseFile={closeFile}
                  onFileChange={handleFileChange}
                  onActiveFileChange={(path) => setWorkspaceState((prev) => ({ ...prev, activeFile: path, previewEntry: path || prev.previewEntry }))} 
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
      <DiffModal 
          diff={diffModal} 
          onClose={closeDiffModal} 
          theme={theme} 
      />
      <InputModal 
          isOpen={inputModal.isOpen}
          title={inputModal.title}
          label={inputModal.label}
          defaultValue={inputModal.defaultValue}
          onConfirm={inputModal.onConfirm}
          onClose={inputModal.onClose}
      />
    </div>
  );
}

export default App;
