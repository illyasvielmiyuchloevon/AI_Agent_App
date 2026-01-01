import { detectSystemTheme } from './appPersistence';

export const DEBUG_SEPARATORS = false;

export const MODE_OPTIONS = [
  { key: 'chat', label: 'Chat', description: '纯聊天，无任何工具' },
  { key: 'plan', label: 'Plan', description: '结构化计划/路标/甘特图/TODO 输出' },
  { key: 'canva', label: 'Canva', description: '画布式网页/前端开发，自动预览' },
  { key: 'agent', label: 'Agent', description: '全工具 Agent，可手动关停工具' },
];

export const DEFAULT_TOOL_SETTINGS = {
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

export const DEFAULT_KEYBINDINGS = {
  'app.commandPalette': 'Ctrl+Shift+P',
  'app.quickOpen': 'Ctrl+P',
  'app.toggleConsole': 'Alt+Shift+I',
  'editor.openEditors': 'Ctrl+E',
  'editor.ai.explain': 'Ctrl+Alt+E',
  'editor.ai.tests': 'Ctrl+Alt+T',
  'editor.ai.optimize': 'Ctrl+Alt+O',
  'editor.ai.comments': 'Ctrl+Alt+C',
  'editor.ai.review': 'Ctrl+Alt+R',
  'editor.ai.rewrite': 'Ctrl+Alt+W',
  'editor.ai.modify': 'Ctrl+Alt+M',
  'editor.ai.docs': 'Ctrl+Alt+D',
};

export const DEFAULT_PROJECT_CONFIG = {
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
  features: {
    workspaceSemanticSearch: true,
    openDevToolsOnStart: true,
    loadRagOnStart: true,
    openWelcomeOnStart: false,
  },
  toolSettings: DEFAULT_TOOL_SETTINGS,
  keybindings: DEFAULT_KEYBINDINGS,
  editorUndoRedoLimit: 16,
  editor: {
    tabSize: 4,
    wordWrap: false,
    minimap: true,
    fontSize: 13,
    lineHeight: 21,
    fontLigatures: true,
    renderWhitespace: 'none',
    navigationMode: 'breadcrumbs',
  },
  lsp: {},
  theme: detectSystemTheme(),
  sidebarWidth: 260,
  chatPanelWidth: 420,
  lastMode: 'chat',
};

export const normalizeUndoRedoLimit = (value, fallback = DEFAULT_PROJECT_CONFIG.editorUndoRedoLimit) => {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  const n = Math.round(raw);
  return Math.max(8, Math.min(64, n));
};

export const normalizeProviderConfig = (incoming = {}, def = {}) => {
  const incomingObj = incoming && typeof incoming === 'object' ? incoming : {};
  const instancesRaw = Array.isArray(incomingObj.instances) ? incomingObj.instances : null;
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
        api_key: incomingObj.api_key || def.api_key || '',
        base_url: incomingObj.base_url || def.base_url || '',
      }];
  const activeId = incomingObj.active_instance_id || incomingObj.activeInstanceId || instances[0]?.id || 'default';
  return {
    ...def,
    ...incomingObj,
    instances,
    active_instance_id: activeId,
  };
};

export const normalizeGlobalConfig = (stored = null) => {
  const base = { ...DEFAULT_PROJECT_CONFIG, ...((stored && typeof stored === 'object') ? stored : {}) };
  if (!base.default_models || typeof base.default_models !== 'object') base.default_models = { ...DEFAULT_PROJECT_CONFIG.default_models };
  if (!base.routing || typeof base.routing !== 'object') base.routing = {};
  if (!base.embedding_options || typeof base.embedding_options !== 'object') base.embedding_options = {};
  base.embedding_options = { ...(DEFAULT_PROJECT_CONFIG.embedding_options || {}), ...(base.embedding_options || {}) };
  if (!base.keybindings || typeof base.keybindings !== 'object') base.keybindings = { ...DEFAULT_PROJECT_CONFIG.keybindings };
  else base.keybindings = { ...DEFAULT_PROJECT_CONFIG.keybindings, ...base.keybindings };
  if (!base.features || typeof base.features !== 'object') base.features = { ...DEFAULT_PROJECT_CONFIG.features };
  else base.features = { ...DEFAULT_PROJECT_CONFIG.features, ...base.features };
  if (!base.editor || typeof base.editor !== 'object') base.editor = { ...DEFAULT_PROJECT_CONFIG.editor };
  else base.editor = { ...DEFAULT_PROJECT_CONFIG.editor, ...base.editor };
  base.editorUndoRedoLimit = normalizeUndoRedoLimit(base.editorUndoRedoLimit, DEFAULT_PROJECT_CONFIG.editorUndoRedoLimit);

  const providerIds = ['openai', 'anthropic', 'openrouter', 'xai', 'ollama', 'lmstudio', 'llamacpp'];
  providerIds.forEach((providerId) => {
    base[providerId] = normalizeProviderConfig(base[providerId], DEFAULT_PROJECT_CONFIG[providerId] || {});
  });

  return {
    provider: base.provider || DEFAULT_PROJECT_CONFIG.provider,
    default_models: base.default_models,
    routing: base.routing,
    embedding_options: (base.embedding_options && typeof base.embedding_options === 'object') ? base.embedding_options : {},
    keybindings: base.keybindings,
    features: base.features,
    editorUndoRedoLimit: base.editorUndoRedoLimit,
    editor: base.editor,
    openai: { ...DEFAULT_PROJECT_CONFIG.openai, ...(base.openai || {}) },
    anthropic: { ...DEFAULT_PROJECT_CONFIG.anthropic, ...(base.anthropic || {}) },
    openrouter: { ...DEFAULT_PROJECT_CONFIG.openrouter, ...(base.openrouter || {}) },
    xai: { ...DEFAULT_PROJECT_CONFIG.xai, ...(base.xai || {}) },
    ollama: { ...DEFAULT_PROJECT_CONFIG.ollama, ...(base.ollama || {}) },
    lmstudio: { ...DEFAULT_PROJECT_CONFIG.lmstudio, ...(base.lmstudio || {}) },
    llamacpp: { ...DEFAULT_PROJECT_CONFIG.llamacpp, ...(base.llamacpp || {}) },
  };
};

export const normalizeProjectConfig = (
  raw = {},
  {
    mergeToolSettings = (v) => v,
    projectMetaName = '',
    projectMetaPathLabel = '',
    backendWorkspaceId = '',
  } = {}
) => {
  const merged = {
    ...DEFAULT_PROJECT_CONFIG,
    ...(raw && typeof raw === 'object' ? raw : {}),
  };
  if (!merged.default_models || typeof merged.default_models !== 'object') merged.default_models = { ...DEFAULT_PROJECT_CONFIG.default_models };
  if (!merged.routing || typeof merged.routing !== 'object') merged.routing = {};
  if (!merged.embedding_options || typeof merged.embedding_options !== 'object') merged.embedding_options = {};
  merged.embedding_options = { ...(DEFAULT_PROJECT_CONFIG.embedding_options || {}), ...(merged.embedding_options || {}) };
  if (!merged.keybindings || typeof merged.keybindings !== 'object') merged.keybindings = { ...DEFAULT_PROJECT_CONFIG.keybindings };
  else merged.keybindings = { ...DEFAULT_PROJECT_CONFIG.keybindings, ...merged.keybindings };
  if (!merged.features || typeof merged.features !== 'object') merged.features = { ...DEFAULT_PROJECT_CONFIG.features };
  else merged.features = { ...DEFAULT_PROJECT_CONFIG.features, ...merged.features };
  if (!merged.editor || typeof merged.editor !== 'object') merged.editor = { ...DEFAULT_PROJECT_CONFIG.editor };
  else merged.editor = { ...DEFAULT_PROJECT_CONFIG.editor, ...merged.editor };
  if (!merged.lsp || typeof merged.lsp !== 'object') merged.lsp = { ...DEFAULT_PROJECT_CONFIG.lsp };
  else merged.lsp = { ...DEFAULT_PROJECT_CONFIG.lsp, ...merged.lsp };

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

  merged.toolSettings = mergeToolSettings((raw && typeof raw === 'object' ? raw.toolSettings : null) || DEFAULT_PROJECT_CONFIG.toolSettings);
  merged.sidebarWidth = Number(merged.sidebarWidth || merged.sessionPanelWidth) || DEFAULT_PROJECT_CONFIG.sidebarWidth;
  merged.chatPanelWidth = Number(merged.chatPanelWidth) || DEFAULT_PROJECT_CONFIG.chatPanelWidth;
  merged.editorUndoRedoLimit = normalizeUndoRedoLimit(merged.editorUndoRedoLimit, DEFAULT_PROJECT_CONFIG.editorUndoRedoLimit);
  merged.theme = merged.theme || DEFAULT_PROJECT_CONFIG.theme;
  merged.lastMode = merged.lastMode || DEFAULT_PROJECT_CONFIG.lastMode;
  merged.projectName = merged.projectName || projectMetaName || merged.projectPath || '';
  merged.projectPath = merged.projectPath || merged.backendRoot || projectMetaPathLabel || '';
  merged.backendRoot = merged.backendRoot || merged.projectPath || projectMetaPathLabel || '';
  merged.workspaceId = merged.workspaceId || backendWorkspaceId || '';
  return merged;
};

export const buildBackendConfigPayload = (config = {}) => {
  const providerId = config?.provider;
  const current = (providerId && config && typeof config === 'object') ? (config[providerId] || {}) : {};
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
    context_independent: current.context_independent,
  };
};

export const mapFlatConfigToState = (snapshot = {}, fallback = {}) => {
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
    context_independent: snapshot.context_independent,
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

export const initialWorkspaceState = {
  files: [],
  fileTree: [],
  openTabs: [],
  activeFile: '',
  editorGroups: [{ id: 'group-1', openTabs: [], activeFile: '', locked: false, previewTab: '' }],
  activeGroupId: 'group-1',
  editorLayout: { mode: 'single', direction: 'vertical' },
  previewEditorEnabled: true,
  tabMeta: {},
  tabHistory: [],
  previewWidth: 50,
  livePreview: '',
  view: 'code',
  entryCandidates: [],
  previewEntry: '',
  workspaceRoots: [],
  welcomeDismissed: false,
};

export const SETTINGS_TAB_PATH = '__system__/settings';
export const TERMINAL_SETTINGS_TAB_PATH = '__system__/terminal-settings';
export const TERMINAL_EDITOR_TAB_PATH = '__system__/terminal-editor';
export const DIFF_TAB_PREFIX = '__diff__/';
