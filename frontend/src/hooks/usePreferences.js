import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PROJECT_CONFIG, DEFAULT_TOOL_SETTINGS } from '../utils/appDefaults';
import {
  THEME_STORAGE_KEY,
  detectSystemTheme,
  persistLanguageChoice,
  persistThemeChoice,
  readGlobalConfig,
  readStoredLanguage,
  readStoredTheme,
} from '../utils/appPersistence';

export function usePreferences() {
  const mergeToolSettings = useCallback((incoming) => ({
    agent: { ...DEFAULT_TOOL_SETTINGS.agent, ...(incoming?.agent || {}) },
    canva: { ...DEFAULT_TOOL_SETTINGS.canva, ...(incoming?.canva || {}) },
  }), []);

  const storedThemePreference = useMemo(() => readStoredTheme(), []);
  const [language, setLanguage] = useState(readStoredLanguage);
  const [uiDisplayPreferences, setUiDisplayPreferences] = useState(() => {
    const stored = readGlobalConfig();
    const defaults = { settings: 'modal', diff: 'modal', diffView: 'compact' };
    return { ...defaults, ...(stored?.uiDisplayPreferences || {}) };
  });
  const [toolSettings, setToolSettings] = useState(() => {
    const stored = readGlobalConfig();
    return mergeToolSettings(stored?.toolSettings || DEFAULT_TOOL_SETTINGS);
  });
  const [theme, setTheme] = useState(() => storedThemePreference || DEFAULT_PROJECT_CONFIG.theme || detectSystemTheme());

  const globalConfigHydratedRef = useRef(!!readGlobalConfig());
  const userThemePreferenceRef = useRef(!!storedThemePreference);

  const handleLanguageChange = useCallback((lang) => {
    setLanguage(lang);
    persistLanguageChoice(lang);
  }, []);

  const handleChangeDisplayPreference = useCallback((key, mode) => {
    setUiDisplayPreferences((prev) => ({ ...prev, [key]: mode }));
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

  return {
    language,
    setLanguage,
    handleLanguageChange,
    uiDisplayPreferences,
    setUiDisplayPreferences,
    handleChangeDisplayPreference,
    toolSettings,
    setToolSettings,
    mergeToolSettings,
    theme,
    setTheme,
    handleThemeModeChange,
    handleToggleTheme,
    globalConfigHydratedRef,
    userThemePreferenceRef,
  };
}

