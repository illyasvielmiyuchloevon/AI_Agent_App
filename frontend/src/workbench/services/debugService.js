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
let state = {
  version: 1,
  sessionActive: false,
  session: null,
  entries: [],
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
  startSession({ name = 'JavaScript (Renderer)' } = {}) {
    const session = { id: `sess:${Date.now()}`, name, startedAt: Date.now() };
    state = { ...state, sessionActive: true, session, version: state.version + 1 };
    emit();
    installConsoleMirror();
    append('system', `Debug session started: ${name}`);
  },
  stopSession() {
    if (!state.sessionActive) return;
    const name = state.session?.name || 'Session';
    state = { ...state, sessionActive: false, session: null, version: state.version + 1 };
    emit();
    if (consoleRestore) consoleRestore();
    append('system', `Debug session stopped: ${name}`);
  },
  appendOutput(text, { stream = 'stdout' } = {}) {
    append(stream === 'stderr' ? 'stderr' : 'stdout', text);
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
