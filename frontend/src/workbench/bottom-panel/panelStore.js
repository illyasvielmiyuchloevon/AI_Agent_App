const STORAGE = {
  active: 'ai_agent_bottom_panel_active',
  height: 'ai_agent_bottom_panel_height',
  collapsed: 'ai_agent_bottom_panel_collapsed',
  hidden: 'ai_agent_bottom_panel_hidden',
  maximized: 'ai_agent_bottom_panel_maximized',
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const readBool = (key, fallback) => {
  try {
    const v = window.localStorage.getItem(key);
    if (v == null) return fallback;
    return v === '1' || v === 'true';
  } catch {
    return fallback;
  }
};

const readNumber = (key, fallback) => {
  try {
    const raw = Number(window.localStorage.getItem(key));
    return Number.isFinite(raw) ? raw : fallback;
  } catch {
    return fallback;
  }
};

const readString = (key, fallback) => {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};

const writeValue = (key, value) => {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
};

const listeners = new Set();

let state = {
  activeViewId: typeof window === 'undefined' ? 'terminal' : readString(STORAGE.active, 'terminal'),
  collapsed: typeof window === 'undefined' ? false : readBool(STORAGE.collapsed, false),
  hidden: typeof window === 'undefined' ? false : readBool(STORAGE.hidden, false),
  maximized: typeof window === 'undefined' ? false : readBool(STORAGE.maximized, false),
  height: typeof window === 'undefined' ? 240 : clamp(readNumber(STORAGE.height, 240), 160, 520),
};

const emit = () => {
  for (const fn of Array.from(listeners)) {
    try { fn(); } catch {}
  }
};

export const panelStore = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getSnapshot() {
    return state;
  },
  setState(patch) {
    const next = { ...state, ...(patch || {}) };
    state = next;
    if (typeof window !== 'undefined') {
      writeValue(STORAGE.active, next.activeViewId);
      writeValue(STORAGE.collapsed, next.collapsed ? '1' : '0');
      writeValue(STORAGE.hidden, next.hidden ? '1' : '0');
      writeValue(STORAGE.maximized, next.maximized ? '1' : '0');
      writeValue(STORAGE.height, next.height);
    }
    emit();
  },
};

