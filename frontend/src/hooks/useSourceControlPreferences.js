import { useEffect, useState } from 'react';

const EXPANDED_KEY = 'sc-expanded-v2';
const SECTION_ORDER_KEY = 'sc-section-order-v2';
const VIEW_MODE_KEY = 'sc-view-mode-v2';

const DEFAULT_EXPANDED = {
  staged: true,
  unstaged: true,
  repositories: true,
  graph: true,
  branches: true,
  conflicts: true,
};

const SECTION_IDS = ['staged', 'unstaged', 'repositories', 'graph', 'branches', 'conflicts'];

const DEFAULT_SECTION_ORDER = ['conflicts', 'staged', 'unstaged', 'repositories', 'branches', 'graph'];

const readJson = (key, fallback) => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
};

export function useSourceControlPreferences() {
  const [expanded, setExpanded] = useState(() => {
    const stored = readJson(EXPANDED_KEY, null);
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      const next = { ...DEFAULT_EXPANDED };
      SECTION_IDS.forEach((id) => {
        if (typeof stored[id] === 'boolean') next[id] = stored[id];
      });
      return next;
    }
    return DEFAULT_EXPANDED;
  });

  const [sectionOrder, setSectionOrder] = useState(() => {
    const stored = readJson(SECTION_ORDER_KEY, null);
    if (Array.isArray(stored) && stored.length) {
      const filtered = stored.filter((id) => SECTION_IDS.includes(id));
      const missing = SECTION_IDS.filter((id) => !filtered.includes(id));
      const next = [...filtered, ...missing];
      if (next.length) return next;
    }
    return DEFAULT_SECTION_ORDER;
  });

  const [viewMode, setViewMode] = useState(() => {
    const stored = readJson(VIEW_MODE_KEY, null);
    if (stored === 'list' || stored === 'tree') return stored;
    return 'list';
  });

  useEffect(() => {
    writeJson(EXPANDED_KEY, expanded);
  }, [expanded]);

  useEffect(() => {
    writeJson(SECTION_ORDER_KEY, sectionOrder);
  }, [sectionOrder]);

  useEffect(() => {
    writeJson(VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  return {
    expanded,
    setExpanded,
    sectionOrder,
    setSectionOrder,
    viewMode,
    setViewMode,
  };
}

