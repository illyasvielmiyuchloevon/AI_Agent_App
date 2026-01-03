export const THEME_STORAGE_KEY = 'ai_agent_theme_choice';
export const LANGUAGE_STORAGE_KEY = 'ai_agent_language_choice';
export const SESSION_STORAGE_KEY = 'ai_agent_sessions_ping';
export const LAYOUT_STORAGE_KEY = 'ai_agent_layout_state';
export const GLOBAL_CONFIG_STORAGE_KEY = 'ai_agent_global_llm_config_v1';

export const detectSystemTheme = () => {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const readStoredLanguage = () => {
  if (typeof window === 'undefined') return 'zh';
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) || 'zh';
  } catch {
    return 'zh';
  }
};

export const persistLanguageChoice = (value) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
  } catch {
    return;
  }
};

export const readStoredTheme = () => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
};

export const persistThemeChoice = (value) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    return;
  }
};

export const readGlobalConfig = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(GLOBAL_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const persistGlobalConfig = (value) => {
  if (typeof window === 'undefined') return;
  try {
    const payload = value || {};
    window.localStorage.setItem(GLOBAL_CONFIG_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('Persist global config failed', err);
  }
};

export const readLayoutPrefs = () => {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
};

export const persistLayoutPrefs = (patch = {}) => {
  if (typeof window === 'undefined') return;
  try {
    const current = readLayoutPrefs();
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch (err) {
    console.warn('Persist layout prefs failed', err);
  }
};

export const pickLayoutNumber = (key, fallback) => {
  const prefs = readLayoutPrefs();
  const val = Number(prefs[key]);
  if (Number.isFinite(val) && val > 0) return val;
  return fallback;
};

