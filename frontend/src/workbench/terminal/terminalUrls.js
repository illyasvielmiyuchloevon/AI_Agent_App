const WINDOW_ID_KEY = 'ai-agent:windowId';

const getWindowId = () => {
  if (typeof window === 'undefined') return '';
  try {
    const existing = sessionStorage.getItem(WINDOW_ID_KEY);
    if (existing) return existing;
    const id = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    sessionStorage.setItem(WINDOW_ID_KEY, id);
    return id;
  } catch {
    return '';
  }
};

const isFileOrigin = () => {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'file:' || window.location.origin === 'null';
};

export const getTerminalWsUrl = (workspaceRoot = '') => {
  if (typeof window === 'undefined') return '';

  const root = String(workspaceRoot || '').trim();
  const clientId = getWindowId();
  const qs = (() => {
    const params = new URLSearchParams();
    if (root) params.set('workspaceRoot', root);
    if (clientId) params.set('clientId', clientId);
    const s = params.toString();
    return s ? `?${s}` : '';
  })();

  if (isFileOrigin()) return `ws://127.0.0.1:8000/terminal/ws${qs}`;

  const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProto}//${window.location.host}/api/terminal/ws${qs}`;
};

export const getTerminalPingUrl = () => {
  if (typeof window === 'undefined') return '';
  if (isFileOrigin()) return 'http://127.0.0.1:8000/sessions';
  return '/api/sessions';
};

export const getTerminalStateUrl = () => {
  if (typeof window === 'undefined') return '';
  if (isFileOrigin()) return 'http://127.0.0.1:8000/terminal/state';
  return '/api/terminal/state';
};

