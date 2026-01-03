import { pathJoinAbs } from '../../utils/appAlgorithms';

const listeners = new Set();

const STORAGE = {
  history: 'ai_agent_debug_console_history',
  follow: 'ai_agent_debug_console_follow',
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const readJson = (key, fallback) => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
};

const normalizeText = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const splitLines = (text) => {
  const s = String(text ?? '');
  if (!s) return [];
  return s.replace(/\r\n/g, '\n').split('\n');
};

let seq = 1;
let pendingEntries = [];
let flushRaf = 0;
let consoleRestore = null;
let dapUnsubs = [];
let dapSubscribed = false;
let state = {
  version: 1,
  sessionActive: false,
  session: null,
  entries: [],
  breakpoints: {},
  follow: typeof window === 'undefined' ? true : !!readJson(STORAGE.follow, true),
  history: typeof window === 'undefined' ? [] : (readJson(STORAGE.history, []) || []).slice(0, 200),
  scrollToBottomTick: 0,
};

const emit = () => {
  for (const fn of Array.from(listeners)) {
    try { fn(); } catch {}
  }
};

const bump = () => {
  state = { ...state, version: state.version + 1 };
  emit();
};

const persistHistory = () => {
  if (typeof window === 'undefined') return;
  writeJson(STORAGE.history, state.history.slice(0, 200));
};

const persistFollow = () => {
  if (typeof window === 'undefined') return;
  writeJson(STORAGE.follow, !!state.follow);
};

const flush = () => {
  flushRaf = 0;
  if (pendingEntries.length === 0) return;
  state.entries.push(...pendingEntries);
  pendingEntries = [];
  const max = 20000;
  if (state.entries.length > max) state.entries.splice(0, state.entries.length - max);
  bump();
};

const scheduleFlush = () => {
  if (flushRaf) return;
  if (typeof window === 'undefined') {
    flush();
    return;
  }
  flushRaf = window.requestAnimationFrame(flush);
};

const appendEntries = (items) => {
  if (!items || items.length === 0) return;
  pendingEntries.push(...items);
  scheduleFlush();
};

const append = (kind, text, meta) => {
  const lines = splitLines(text);
  if (lines.length === 0) return;
  const now = Date.now();
  appendEntries(lines.map((line) => ({
    id: `dbg:${seq++}`,
    ts: now,
    kind,
    text: String(line ?? ''),
    meta: meta || null,
  })));
};

const evalInRenderer = async (expr) => {
  const code = String(expr || '').trim();
  if (!code) return { ok: true, value: '' };

  const attemptExpression = () => {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return (${code});`);
    return fn();
  };

  const attemptStatement = () => {
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; ${code}`);
    return fn();
  };

  let result;
  try {
    result = attemptExpression();
  } catch (e) {
    try {
      result = attemptStatement();
    } catch (e2) {
      return { ok: false, error: e2?.message || e?.message || String(e2 || e) };
    }
  }

  try {
    if (result && typeof result.then === 'function') {
      const resolved = await result;
      return { ok: true, value: resolved };
    }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
  return { ok: true, value: result };
};

const installConsoleMirror = () => {
  if (typeof window === 'undefined') return;
  if (consoleRestore) return;

  const orig = {};
  const levels = ['log', 'info', 'warn', 'error', 'debug'];
  for (const level of levels) orig[level] = console[level];

  const mirror = (level, args) => {
    try {
      const rendered = Array.from(args || []).map(normalizeText).join(' ');
      if (!rendered) return;
      const stream = level === 'error' || level === 'warn' ? 'stderr' : 'stdout';
      debugService.appendOutput(rendered, { stream });
    } catch {
      // ignore
    }
  };

  for (const level of levels) {
    if (typeof orig[level] !== 'function') continue;
    console[level] = (...args) => {
      mirror(level, args);
      return orig[level].apply(console, args);
    };
  }

  consoleRestore = () => {
    for (const level of levels) {
      if (orig[level]) console[level] = orig[level];
    }
    consoleRestore = null;
  };
};

const getDapApi = () => globalThis?.window?.electronAPI?.dap || null;

const normalizeFileKey = (filePath) => {
  const raw = String(filePath || '');
  const cleaned = raw.replace(/^[\\/]+/, '').replace(/\\/g, '/');
  return cleaned;
};

const getWorkspaceRoot = (fallback) => {
  const root = globalThis?.window?.__NODE_AGENT_WORKSPACE_ROOT__;
  if (root) return String(root);
  return String(fallback || '');
};

const getBreakpointsForPath = (filePath) => {
  const key = normalizeFileKey(filePath);
  const list = state.breakpoints && typeof state.breakpoints === 'object' ? state.breakpoints[key] : null;
  return Array.isArray(list) ? list.slice() : [];
};

const setBreakpointsForPath = (filePath, nextLines) => {
  const key = normalizeFileKey(filePath);
  const unique = Array.from(new Set((nextLines || []).map((n) => Math.max(1, Math.floor(Number(n) || 0))).filter((n) => n > 0)));
  unique.sort((a, b) => a - b);
  const prev = state.breakpoints && typeof state.breakpoints === 'object' ? state.breakpoints : {};
  const existing = Array.isArray(prev[key]) ? prev[key] : [];
  const same = existing.length === unique.length && existing.every((v, i) => v === unique[i]);
  if (same) return;
  const next = { ...prev };
  if (unique.length === 0) delete next[key];
  else next[key] = unique;
  state = { ...state, breakpoints: next, version: state.version + 1 };
  emit();
};

const sendDapSetBreakpoints = async (dapSessionId, filePath, lines, { workspaceRoot } = {}) => {
  const sid = String(dapSessionId || '');
  if (!sid) return { ok: false, error: 'missing session' };
  const api = getDapApi();
  if (!api?.sendRequest) return { ok: false, error: 'dap not available' };
  const key = normalizeFileKey(filePath);
  const root = getWorkspaceRoot(workspaceRoot);
  const sourcePath = root ? pathJoinAbs(root, key) : key;
  const name = key.split('/').pop() || key;
  return api.sendRequest(
    sid,
    'setBreakpoints',
    {
      source: { name, path: sourcePath },
      breakpoints: (lines || []).map((line) => ({ line: Number(line) || 1 })),
    },
    { timeoutMs: 8_000 },
  ).catch((err) => ({ ok: false, error: err?.message || String(err) }));
};

const ensureDapSubscriptions = () => {
  if (dapSubscribed) return;
  const api = getDapApi();
  if (!api?.onEvent || !api?.onStatus) return;
  dapSubscribed = true;

  dapUnsubs.push(api.onEvent((payload) => {
    const sid = String(payload?.sessionId || '');
    const activeSid = String(state?.session?.dapSessionId || '');
    if (!sid || sid !== activeSid) return;
    const evt = payload?.event || null;
    const evtName = String(evt?.event || '');
    if (evtName === 'output') {
      const out = evt?.body?.output != null ? String(evt.body.output) : '';
      const category = String(evt?.body?.category || '');
      const stream = category === 'stderr' ? 'stderr' : 'stdout';
      if (out) debugService.appendOutput(out, { stream });
      return;
    }
    if (evtName) append('system', `[dap] event: ${evtName}`);
  }));

  dapUnsubs.push(api.onStatus((payload) => {
    const sid = String(payload?.sessionId || '');
    const activeSid = String(state?.session?.dapSessionId || '');
    if (!sid || sid !== activeSid) return;
    const status = String(payload?.status || '');
    if (status) append('system', `[dap] status: ${status}`);
  }));
};

const stopDapIfAny = async () => {
  const sid = String(state?.session?.dapSessionId || '');
  if (!sid) return;
  const api = getDapApi();
  try { await api?.stopSession?.(sid); } catch {}
};

const applyAllDapBreakpoints = async ({ workspaceRoot } = {}) => {
  const sid = String(state?.session?.dapSessionId || '');
  if (!sid) return;
  const map = state.breakpoints && typeof state.breakpoints === 'object' ? state.breakpoints : {};
  for (const [filePath, lines] of Object.entries(map)) {
    if (!Array.isArray(lines) || lines.length === 0) continue;
    await sendDapSetBreakpoints(sid, filePath, lines, { workspaceRoot }).catch(() => {});
  }
};

export const debugService = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getSnapshot() {
    return state;
  },
  clear() {
    if (state.entries.length === 0) return;
    pendingEntries = [];
    if (flushRaf && typeof window !== 'undefined') window.cancelAnimationFrame(flushRaf);
    flushRaf = 0;
    state.entries = [];
    bump();
  },
  setFollow(next) {
    const v = !!next;
    if (Object.is(state.follow, v)) return;
    state = { ...state, follow: v, version: state.version + 1 };
    persistFollow();
    emit();
  },
  requestScrollToBottom() {
    state = {
      ...state,
      follow: true,
      scrollToBottomTick: (state.scrollToBottomTick || 0) + 1,
      version: state.version + 1,
    };
    persistFollow();
    emit();
  },
  async startSession({ name = '', mode = '' } = {}) {
    const api = getDapApi();
    const want = String(mode || '').trim() || (api?.startSession ? 'dap' : 'renderer');
    const sessionName = String(name || (want === 'dap' ? 'DAP (Fake Adapter)' : 'JavaScript (Renderer)'));

    if (want === 'dap' && api?.startSession) {
      ensureDapSubscriptions();
      const res = await api.startSession({
        name: sessionName,
        adapter: { kind: 'builtin', id: 'fake' },
        request: 'launch',
        arguments: {},
      }).catch((err) => ({ ok: false, error: err?.message || String(err) }));

      if (!res?.ok) {
        append('error', res?.error || 'Failed to start DAP session');
        return;
      }

      const session = { id: `sess:${Date.now()}`, name: sessionName, startedAt: Date.now(), type: 'dap', dapSessionId: String(res.sessionId || '') };
      state = { ...state, sessionActive: true, session, version: state.version + 1 };
      emit();
      append('system', `Debug session started: ${sessionName}`);
      void applyAllDapBreakpoints({ workspaceRoot: getWorkspaceRoot('') });
      return;
    }

    const session = { id: `sess:${Date.now()}`, name: sessionName, startedAt: Date.now(), type: 'renderer' };
    state = { ...state, sessionActive: true, session, version: state.version + 1 };
    emit();
    installConsoleMirror();
    append('system', `Debug session started: ${sessionName}`);
  },
  async stopSession() {
    if (!state.sessionActive) return;
    const name = state.session?.name || 'Session';
    await stopDapIfAny();
    state = { ...state, sessionActive: false, session: null, version: state.version + 1 };
    emit();
    if (consoleRestore) consoleRestore();
    append('system', `Debug session stopped: ${name}`);
  },
  appendOutput(text, { stream = 'stdout' } = {}) {
    append(stream === 'stderr' ? 'stderr' : 'stdout', text);
  },
  getBreakpoints() {
    const map = state.breakpoints && typeof state.breakpoints === 'object' ? state.breakpoints : {};
    return { ...map };
  },
  hasBreakpoint(filePath, lineNumber) {
    const key = normalizeFileKey(filePath);
    const lines = getBreakpointsForPath(key);
    const ln = Math.max(1, Math.floor(Number(lineNumber) || 0));
    return lines.includes(ln);
  },
  async toggleBreakpoint(filePath, lineNumber, { workspaceRoot } = {}) {
    const key = normalizeFileKey(filePath);
    const ln = Math.max(1, Math.floor(Number(lineNumber) || 0));
    if (!key || !ln) return;
    const lines = getBreakpointsForPath(key);
    const next = lines.includes(ln) ? lines.filter((x) => x !== ln) : [...lines, ln];
    setBreakpointsForPath(key, next);
    const sid = String(state?.session?.dapSessionId || '');
    if (sid) {
      const latest = getBreakpointsForPath(key);
      const res = await sendDapSetBreakpoints(sid, key, latest, { workspaceRoot }).catch((err) => ({ ok: false, error: err?.message || String(err) }));
      if (!res?.ok) append('error', res?.error || 'Failed to set breakpoints');
    }
  },
  async evaluate(expression) {
    const expr = String(expression || '').trim();
    if (!expr) return;
    if (!state.sessionActive) {
      append('system', 'No active debug session. Start a session to evaluate expressions.');
      return;
    }

    state.history = [expr, ...state.history.filter((x) => x !== expr)].slice(0, 200);
    persistHistory();

    append('input', `> ${expr}`);
    const dapSessionId = String(state?.session?.dapSessionId || '');
    if (dapSessionId) {
      const api = getDapApi();
      const res = await api?.sendRequest?.(dapSessionId, 'evaluate', { expression: expr, context: 'repl' }, { timeoutMs: 8_000 })
        .catch((err) => ({ ok: false, error: err?.message || String(err) }));
      if (!res?.ok) {
        append('error', res?.error || 'Error');
        return;
      }
      const value = res?.response?.body?.result;
      const rendered = normalizeText(value);
      append('result', rendered === '' ? 'undefined' : rendered);
      return;
    }

    const res = await evalInRenderer(expr);
    if (!res.ok) {
      append('error', res.error || 'Error');
      return;
    }
    const rendered = normalizeText(res.value);
    append('result', rendered === '' ? 'undefined' : rendered);
  },
  getPlainText() {
    const list = state.entries || [];
    return list.map((e) => e?.text ?? '').join('\n');
  },
  getHistory() {
    return state.history || [];
  },
  historyAt(index) {
    const list = state.history || [];
    if (!Number.isFinite(index)) return '';
    const i = clamp(index, -1, list.length - 1);
    return i < 0 ? '' : (list[i] || '');
  },
};
