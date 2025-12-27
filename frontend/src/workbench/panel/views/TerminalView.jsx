import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

const DEFAULT_PROFILE = 'cmd';

const computeLabel = (base, existing) => {
  const name = String(base || DEFAULT_PROFILE) || DEFAULT_PROFILE;
  const count = (existing || []).filter((t) => (t.title || '') === name).length;
  return count > 0 ? `${name} (${count + 1})` : name;
};

const getWsUrl = () => {
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol;
  if (proto === 'file:' || window.location.origin === 'null') {
    return 'ws://127.0.0.1:8000/terminal/ws';
  }
  const wsProto = proto === 'https:' ? 'wss:' : 'ws:';
  return `${wsProto}//${window.location.host}/api/terminal/ws`;
};

const getPingUrl = () => {
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol;
  if (proto === 'file:' || window.location.origin === 'null') {
    return 'http://127.0.0.1:8000/sessions';
  }
  return '/api/sessions';
};

const getTerminalStateUrl = () => {
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol;
  if (proto === 'file:' || window.location.origin === 'null') {
    return 'http://127.0.0.1:8000/terminal/state';
  }
  return '/api/terminal/state';
};

const readCssVar = (name, fallback) => {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const readJson = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const writeJson = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

function TerminalView({ workspacePath = '', onStateChange, autoConnect = true, isResizing = false }, ref) {
  const wsRef = useRef(null);
  const pendingCreateRef = useRef(new Map());
  const instanceRef = useRef(new Map()); // id -> { term, fit, search }
  const containerRef = useRef(new Map()); // id -> HTMLElement
  const resizeObsRef = useRef(null);
  const fitRafRef = useRef(0);
  const mainPaneRef = useRef(null);
  const connectLoopRef = useRef({ running: false, timer: 0, abort: null });
  const findInputRef = useRef(null);
  const splitDragRef = useRef({ active: false, raf: 0, pending: 0 });
  const splitResizingRef = useRef(false);
  const activeIdRef = useRef('');
  const splitIdsRef = useRef([]);
  const terminalsRef = useRef([]);
  const splitRef = useRef({ enabled: false, orientation: 'vertical', ids: [], size: 0.5 });
  const splitAddPaneRef = useRef(async () => {});
  const closeActivePaneRef = useRef(() => {});
  const focusPaneDeltaRef = useRef(() => {});

  const [connected, setConnected] = useState(false);
  const [listed, setListed] = useState(false);
  const [terminals, setTerminals] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [scrollLock, setScrollLock] = useState(false);
  const isResizingRef = useRef(false);
  const [themeTick, setThemeTick] = useState(0);
  const [split, setSplit] = useState({ enabled: false, orientation: 'vertical', ids: [], size: 0.5 });
  const [dragTerminalId, setDragTerminalId] = useState('');
  const [ctxMenu, setCtxMenu] = useState(null);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [profileEditing, setProfileEditing] = useState(DEFAULT_PROFILE);
  const [profileEnvText, setProfileEnvText] = useState({ cmd: '', powershell: '', bash: '' });
  const [find, setFind] = useState({
    open: false,
    query: '',
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    resultIndex: 0,
    resultCount: 0,
  });

  const storageBase = useMemo(() => {
    const base = String(workspacePath || 'default');
    return `terminal:${encodeURIComponent(base)}`;
  }, [workspacePath]);

  const prefsKey = useMemo(() => `${storageBase}:prefs`, [storageBase]);
  const metaKey = useMemo(() => `${storageBase}:meta`, [storageBase]);

  const writeClipboard = useCallback(async (text) => {
    const value = String(text || '');
    if (!value) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
      }
    } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', 'true');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch {}
  }, []);

  const readClipboard = useCallback(async () => {
    try {
      if (navigator?.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        return String(text || '');
      }
    } catch {}
    return '';
  }, []);

  const openExternal = useCallback((url) => {
    const target = String(url || '').trim();
    if (!target) return;
    try {
      window.open(target, '_blank', 'noopener,noreferrer');
    } catch {}
  }, []);

  const parseEnvText = useCallback((text) => {
    const out = {};
    const lines = String(text || '').split(/\r?\n/);
    for (const raw of lines) {
      const line = String(raw || '').trim();
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx <= 0) continue;
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (!k) continue;
      out[k] = v;
    }
    return out;
  }, []);

  const getEnvForProfile = useCallback((profile) => {
    const key = String(profile || DEFAULT_PROFILE);
    const base = {
      TERM_PROGRAM: 'ai-agent-ide',
      TERM_PROGRAM_VERSION: '0.0.0',
      COLORTERM: 'truecolor',
      AI_AGENT_SHELL_INTEGRATION: '1',
    };
    const env = parseEnvText(profileEnvText?.[key] || '');
    return { ...base, ...env };
  }, [parseEnvText, profileEnvText]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    splitIdsRef.current = split.enabled ? (Array.isArray(split.ids) ? split.ids : []) : [];
  }, [split.enabled, split.ids]);

  useEffect(() => {
    terminalsRef.current = terminals;
  }, [terminals]);

  useEffect(() => {
    splitRef.current = split;
  }, [split]);

  const isDark = useMemo(() => {
    try {
      return document.documentElement.getAttribute('data-theme') === 'dark';
    } catch {
      return false;
    }
  }, [themeTick]);

  const theme = useMemo(() => {
    const background = readCssVar('--panel', '#1e1e1e');
    const foreground = readCssVar('--text', '#d4d4d4');
    const selection = readCssVar('--accent-subtle', 'rgba(79,70,229,0.25)');
    const cursor = readCssVar('--text', '#d4d4d4');
    return {
      background,
      foreground,
      cursor,
      selectionBackground: selection,
      black: isDark ? '#000000' : '#000000',
      red: isDark ? '#cd3131' : '#cd3131',
      green: isDark ? '#0dbc79' : '#00a651',
      yellow: isDark ? '#e5e510' : '#949800',
      blue: isDark ? '#2472c8' : '#0451a5',
      magenta: isDark ? '#bc3fbc' : '#bc05bc',
      cyan: isDark ? '#11a8cd' : '#0598bc',
      white: isDark ? '#e5e5e5' : '#555555',
      brightBlack: isDark ? '#666666' : '#333333',
      brightRed: isDark ? '#f14c4c' : '#cd3131',
      brightGreen: isDark ? '#23d18b' : '#00a651',
      brightYellow: isDark ? '#f5f543' : '#949800',
      brightBlue: isDark ? '#3b8eea' : '#0451a5',
      brightMagenta: isDark ? '#d670d6' : '#bc05bc',
      brightCyan: isDark ? '#29b8db' : '#0598bc',
      brightWhite: isDark ? '#ffffff' : '#111111',
    };
  }, [themeTick]);

  useEffect(() => {
    const prefs = readJson(prefsKey, null);
    if (!prefs || typeof prefs !== 'object') return;
    setSplit((prev) => ({
      ...prev,
      orientation: prefs.orientation === 'horizontal' ? 'horizontal' : 'vertical',
      size: typeof prefs.size === 'number' ? clamp(prefs.size, 0.1, 0.9) : prev.size,
    }));
  }, [prefsKey]);

  useEffect(() => {
    writeJson(prefsKey, { orientation: split.orientation, size: split.size });
  }, [prefsKey, split.orientation, split.size]);

  useEffect(() => {
    const url = getTerminalStateUrl();
    if (!url || !workspacePath) return undefined;
    const ctl = new AbortController();
    fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-workspace-root': String(workspacePath || ''),
      },
      signal: ctl.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || typeof data !== 'object') return;
        const splitState = data.split && typeof data.split === 'object' ? data.split : null;
        if (splitState) {
          setSplit((prev) => ({
            ...prev,
            enabled: !!splitState.enabled,
            orientation: splitState.orientation === 'horizontal' ? 'horizontal' : 'vertical',
            size: typeof splitState.size === 'number' ? clamp(splitState.size, 0.1, 0.9) : prev.size,
            ids: Array.isArray(splitState.ids) ? splitState.ids.map((x) => String(x || '')).filter(Boolean) : prev.ids,
          }));
        }
        const prof = data.profiles && typeof data.profiles === 'object' ? data.profiles : null;
        const envText = prof?.envText && typeof prof.envText === 'object' ? prof.envText : null;
        if (envText) {
          setProfileEnvText((prev) => ({
            ...(prev || { cmd: '', powershell: '', bash: '' }),
            cmd: typeof envText.cmd === 'string' ? envText.cmd : (prev?.cmd || ''),
            powershell: typeof envText.powershell === 'string' ? envText.powershell : (prev?.powershell || ''),
            bash: typeof envText.bash === 'string' ? envText.bash : (prev?.bash || ''),
          }));
        }
      })
      .catch(() => {});
    return () => {
      try { ctl.abort(); } catch {}
    };
  }, [workspacePath]);

  useEffect(() => {
    const url = getTerminalStateUrl();
    if (!url || !workspacePath) return undefined;
    const t = window.setTimeout(() => {
      fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-workspace-root': String(workspacePath || ''),
        },
        body: JSON.stringify({
          split: {
            enabled: !!split.enabled,
            orientation: split.orientation === 'horizontal' ? 'horizontal' : 'vertical',
            size: clamp(split.size, 0.1, 0.9),
            ids: Array.isArray(split.ids) ? split.ids : [],
          },
          profiles: {
            envText: profileEnvText,
          },
          updatedAt: Date.now(),
        }),
      }).catch(() => {});
    }, 500);
    return () => window.clearTimeout(t);
  }, [profileEnvText, split.enabled, split.ids, split.orientation, split.size, workspacePath]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return undefined;
    const el = document.documentElement;
    if (!el) return undefined;
    const obs = new MutationObserver(() => setThemeTick((v) => v + 1));
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      try { obs.disconnect(); } catch {}
    };
  }, []);

  useEffect(() => {
    instanceRef.current.forEach((inst) => {
      // @xterm/xterm does not expose `setOption`; update via the `options` bag.
      try { inst.term.options.theme = theme; } catch {}
      try { inst.term.refresh(0, Math.max(0, inst.term.rows - 1)); } catch {}
    });
  }, [theme]);

  const emitState = useCallback((next) => {
    onStateChange?.(next);
  }, [onStateChange]);

  useEffect(() => {
    emitState({ connected, listed, terminals, activeId, scrollLock, split });
  }, [connected, listed, terminals, activeId, scrollLock, split, emitState]);

  const send = useCallback((msg) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }, []);

  const getPersistedMeta = useCallback((id) => {
    const all = readJson(metaKey, {});
    if (!all || typeof all !== 'object') return null;
    const item = all[String(id || '')];
    return item && typeof item === 'object' ? item : null;
  }, [metaKey]);

  const persistMeta = useCallback((id, patch) => {
    const key = String(id || '');
    if (!key) return;
    const all = readJson(metaKey, {});
    const nextAll = all && typeof all === 'object' ? { ...all } : {};
    const prev = nextAll[key] && typeof nextAll[key] === 'object' ? nextAll[key] : {};
    nextAll[key] = { ...prev, ...(patch || {}) };
    writeJson(metaKey, nextAll);
  }, [metaKey]);

  const copySelectionActive = useCallback(() => {
    const id = String(activeId || '');
    if (!id) return;
    const inst = instanceRef.current.get(id);
    if (!inst?.term?.hasSelection?.() || !inst.term.hasSelection()) return;
    try { writeClipboard(inst.term.getSelection()); } catch {}
  }, [activeId, writeClipboard]);

  const pasteFromClipboardActive = useCallback(() => {
    const id = String(activeId || '');
    if (!id) return;
    const inst = instanceRef.current.get(id);
    if (!inst?.term) return;
    readClipboard().then((text) => {
      const value = String(text || '');
      if (!value) return;
      try { inst.term.paste(value); } catch {}
    });
  }, [activeId, readClipboard]);

  const clearActive = useCallback(() => {
    const id = String(activeId || '');
    if (!id) return;
    const inst = instanceRef.current.get(id);
    if (!inst?.term) return;
    const meta = terminals.find((t) => t.id === id);
    const profile = String(meta?.profile || meta?.title || DEFAULT_PROFILE).toLowerCase();
    const cmd = profile.includes('bash') ? 'clear\r' : 'cls\r';
    try { inst.term.paste(cmd); } catch {}
  }, [activeId, terminals]);

  const findDecorations = useMemo(() => (isDark ? ({
    matchBackground: '#264f78',
    matchBorder: '#264f78',
    matchOverviewRuler: '#264f78',
    activeMatchBackground: '#007acc',
    activeMatchBorder: '#007acc',
    activeMatchColorOverviewRuler: '#007acc',
  }) : ({
    matchBackground: '#add6ff',
    matchBorder: '#add6ff',
    matchOverviewRuler: '#add6ff',
    activeMatchBackground: '#0e639c',
    activeMatchBorder: '#0e639c',
    activeMatchColorOverviewRuler: '#0e639c',
  })), [isDark]);

  const openFind = useCallback((id) => {
    const target = String(id || activeId || '');
    if (target) setActiveId(target);
    setFind((prev) => ({ ...prev, open: true }));
  }, [activeId]);

  const closeFind = useCallback(() => {
    setFind((prev) => ({ ...prev, open: false, resultIndex: 0, resultCount: 0 }));
    try {
      const inst = instanceRef.current.get(String(activeId || ''));
      inst?.search?.clearDecorations?.();
    } catch {}
  }, [activeId]);

  const runFind = useCallback((direction = 'next') => {
    const inst = instanceRef.current.get(String(activeId || ''));
    if (!inst?.search) return false;
    const q = String(find.query || '');
    if (!q) return false;
    try {
      const opts = {
        caseSensitive: !!find.caseSensitive,
        wholeWord: !!find.wholeWord,
        regex: !!find.regex,
        incremental: true,
        decorations: findDecorations,
      };
      if (direction === 'prev') return !!inst.search.findPrevious(q, opts);
      return !!inst.search.findNext(q, opts);
    } catch {
      return false;
    }
  }, [activeId, find.caseSensitive, find.query, find.regex, find.wholeWord, findDecorations]);

  useEffect(() => {
    if (!find.open) return;
    const t = window.setTimeout(() => {
      try { findInputRef.current?.focus?.(); } catch {}
      try { findInputRef.current?.select?.(); } catch {}
    }, 0);
    return () => window.clearTimeout(t);
  }, [find.open]);

  useEffect(() => {
    if (!ctxMenu) return undefined;
    const close = () => setCtxMenu(null);
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  useEffect(() => {
    if (!profileSettingsOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setProfileSettingsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [profileSettingsOpen]);

  const ensureXterm = useCallback((meta) => {
    if (!meta?.id) return;
    if (instanceRef.current.has(meta.id)) return;

    const term = new Terminal({
      fontFamily: 'Consolas, ui-monospace, SFMono-Regular, Menlo, Monaco, "Liberation Mono", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      convertEol: true,
      theme,
      scrollback: 4000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon((event, uri) => {
      try { event?.preventDefault?.(); } catch {}
      openExternal(uri);
    }));

    const resultsDispose = search.onDidChangeResults((ev) => {
      try {
        if (activeIdRef.current !== meta.id) return;
        setFind((prev) => (prev.open ? { ...prev, resultIndex: ev.resultIndex, resultCount: ev.resultCount } : prev));
      } catch {}
    });

    term.onData((data) => {
      send({ type: 'input', id: meta.id, data });
    });

    term.attachCustomKeyEventHandler((ev) => {
      try {
        const key = String(ev?.key || '').toLowerCase();
        const ctrlOrCmd = !!(ev?.ctrlKey || ev?.metaKey);
        if (ctrlOrCmd && !ev.altKey && key === 'f') {
          openFind(meta.id);
          return false;
        }
        if (ctrlOrCmd && ev.shiftKey && !ev.altKey && key === '5') {
          splitAddPaneRef.current?.('vertical');
          return false;
        }
        if (ctrlOrCmd && ev.shiftKey && !ev.altKey && key === '6') {
          splitAddPaneRef.current?.('horizontal');
          return false;
        }
        if (ctrlOrCmd && ev.shiftKey && !ev.altKey && key === 'w') {
          closeActivePaneRef.current?.();
          return false;
        }
        if (ctrlOrCmd && ev.altKey && (key === 'arrowright' || key === 'arrowdown')) {
          focusPaneDeltaRef.current?.(1);
          return false;
        }
        if (ctrlOrCmd && ev.altKey && (key === 'arrowleft' || key === 'arrowup')) {
          focusPaneDeltaRef.current?.(-1);
          return false;
        }
        if (ctrlOrCmd && !ev.altKey && key === 'c' && !ev.shiftKey) {
          if (term.hasSelection()) {
            writeClipboard(term.getSelection());
            return false;
          }
          return true;
        }
        if (ctrlOrCmd && !ev.altKey && key === 'c' && ev.shiftKey) {
          if (term.hasSelection()) writeClipboard(term.getSelection());
          return false;
        }
        if (ev?.ctrlKey && key === 'insert') {
          if (term.hasSelection()) writeClipboard(term.getSelection());
          return false;
        }
        if ((ctrlOrCmd && !ev.altKey && key === 'v') || (ev?.shiftKey && key === 'insert')) {
          readClipboard().then((text) => {
            const value = String(text || '');
            if (!value) return;
            try { term.paste(value); } catch {}
          });
          return false;
        }
      } catch {}
      return true;
    });

    term.onTitleChange((title) => {
      const nextTitle = String(title || '').trim();
      if (!nextTitle) return;
      persistMeta(meta.id, { title: nextTitle });
      setTerminals((prev) => prev.map((t) => (t.id === meta.id ? { ...t, title: nextTitle } : t)));
    });

    instanceRef.current.set(meta.id, { term, fit, search, resultsDispose });
  }, [openExternal, openFind, persistMeta, readClipboard, send, theme, writeClipboard]);

  const openToContainerIfReady = useCallback((id) => {
    const inst = instanceRef.current.get(id);
    const el = containerRef.current.get(id);
    if (!inst || !el) return;
    if (el.dataset.xtermOpened === '1') return;
    el.dataset.xtermOpened = '1';
    inst.term.open(el);
    try {
      inst.fit.fit();
    } catch {}
    send({ type: 'resize', id, cols: inst.term.cols, rows: inst.term.rows });
  }, [send]);

  const fitActive = useCallback(() => {
    const ids = split.enabled ? (Array.isArray(split.ids) ? split.ids : []) : (activeId ? [activeId] : []);
    for (const id of ids) {
      const inst = instanceRef.current.get(id);
      if (!inst) continue;
      try {
        inst.fit.fit();
        send({ type: 'resize', id, cols: inst.term.cols, rows: inst.term.rows });
      } catch {}
    }
  }, [activeId, send, split.enabled, split.ids]);

  const createTerminal = useCallback(async (profile = DEFAULT_PROFILE) => {
    const reqId = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const ok = send({
      type: 'create',
      requestId: reqId,
      profile,
      cwd: workspacePath || '',
      cols: 80,
      rows: 24,
      env: getEnvForProfile(profile),
    });
    if (!ok) throw new Error('Terminal backend not connected');
    return new Promise((resolve, reject) => {
      const t = window.setTimeout(() => {
        pendingCreateRef.current.delete(reqId);
        reject(new Error('Terminal create timeout'));
      }, 5000);
      pendingCreateRef.current.set(reqId, (payload) => {
        window.clearTimeout(t);
        resolve(payload);
      });
    });
  }, [getEnvForProfile, send, workspacePath]);

  const disposeTerminal = useCallback((id) => {
    const target = String(id || '');
    if (!target) return;
    send({ type: 'dispose', id: target });
  }, [send]);

  const killActive = useCallback(() => {
    if (!activeId) return;
    disposeTerminal(activeId);
  }, [activeId, disposeTerminal]);

  const toggleScrollLock = useCallback(() => setScrollLock((v) => !v), []);

  const toggleSplitOrientation = useCallback(() => {
    setSplit((prev) => ({ ...prev, orientation: prev.orientation === 'horizontal' ? 'vertical' : 'horizontal' }));
  }, []);

  const splitAddPane = useCallback(async (orientation = splitRef.current.orientation) => {
    const dir = orientation === 'horizontal' ? 'horizontal' : 'vertical';
    const currentTerminals = Array.isArray(terminalsRef.current) ? terminalsRef.current : [];
    const baseId = String(activeIdRef.current || currentTerminals[0]?.id || '');
    if (!baseId) return;

    const currentSplit = splitRef.current;
    const prevIds = currentSplit.enabled ? (Array.isArray(currentSplit.ids) ? currentSplit.ids : []) : [baseId];
    const ids = prevIds.includes(baseId) ? [...prevIds] : [baseId, ...prevIds];

    const prof = String(currentTerminals.find((t) => t.id === baseId)?.profile || DEFAULT_PROFILE);
    const meta = await createTerminal(prof).catch(() => null);
    const newId = String(meta?.id || '');
    if (!newId || ids.includes(newId)) return;

    ids.push(newId);
    setSplit((prev) => ({ ...prev, enabled: true, orientation: dir, ids }));
    setActiveId(newId);
  }, [createTerminal]);

  const closeActivePane = useCallback(() => {
    const currentSplit = splitRef.current;
    if (!currentSplit.enabled) return;
    const current = String(activeIdRef.current || '');
    const ids = Array.isArray(currentSplit.ids) ? currentSplit.ids : [];
    const remaining = ids.filter((id) => id !== current);
    if (remaining.length <= 1) {
      setSplit((prev) => ({ ...prev, enabled: false, ids: [] }));
      if (remaining[0]) setActiveId(remaining[0]);
      return;
    }
    setSplit((prev) => ({ ...prev, enabled: true, ids: remaining }));
    if (!remaining.includes(current)) setActiveId(remaining[0] || '');
  }, []);

  const focusPaneDelta = useCallback((delta) => {
    const ids = splitIdsRef.current || [];
    if (!Array.isArray(ids) || ids.length < 2) return;
    const current = String(activeIdRef.current || '');
    const idx = ids.indexOf(current);
    const base = idx >= 0 ? idx : 0;
    const next = ids[(base + delta + ids.length) % ids.length];
    if (next) setActiveId(next);
  }, []);

  splitAddPaneRef.current = splitAddPane;
  closeActivePaneRef.current = closeActivePane;
  focusPaneDeltaRef.current = focusPaneDelta;

  const toggleSplit = useCallback(async () => {
    if (!split.enabled) {
      await splitAddPane(split.orientation);
      return;
    }
    setSplit((prev) => ({ ...prev, enabled: false, ids: [] }));
  }, [split.enabled, split.orientation, splitAddPane]);

  const renameActive = useCallback(() => {
    const id = String(activeId || '');
    if (!id) return;
    const meta = terminals.find((t) => t.id === id);
    const current = meta?.title || meta?.label || meta?.profile || '';
    const next = window.prompt('重命名终端', current);
    if (next == null) return;
    const value = String(next).trim();
    if (!value) return;
    persistMeta(id, { title: value });
    setTerminals((prev) => prev.map((t) => (t.id === id ? { ...t, title: value } : t)));
  }, [activeId, persistMeta, terminals]);

  const moveTerminalInList = useCallback((fromId, toId) => {
    const from = String(fromId || '');
    const to = String(toId || '');
    if (!from || !to || from === to) return;
    setTerminals((prev) => {
      const items = Array.isArray(prev) ? [...prev] : [];
      const fromIdx = items.findIndex((t) => t.id === from);
      const toIdx = items.findIndex((t) => t.id === to);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const [moved] = items.splice(fromIdx, 1);
      items.splice(toIdx, 0, moved);
      return items;
    });
  }, []);

  const onSplitterPointerDown = useCallback((e) => {
    if (!split.enabled || (Array.isArray(split.ids) ? split.ids.length : 0) !== 2) return;
    if (e.button !== 0) return;
    const root = mainPaneRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return;
    e.preventDefault();
    e.stopPropagation();

    splitResizingRef.current = true;
    splitDragRef.current.active = true;

    const isH = split.orientation === 'horizontal';
    const total = isH ? rect.height : rect.width;
    const minPx = 120;
    const maxPx = Math.max(minPx, total - minPx);
    const clampPx = (px) => clamp(px, minPx, maxPx);

    const startPos = isH ? e.clientY : e.clientX;
    const startSizePx = clampPx(Math.round(total * clamp(split.size, 0.1, 0.9)));

    const apply = () => {
      splitDragRef.current.raf = 0;
      const el = mainPaneRef.current;
      if (!el) return;
      const ratio = splitDragRef.current.pending;
      const pct = `${Math.round(ratio * 1000) / 10}%`;
      try { el.style.setProperty('--terminal-split', pct); } catch {}
    };

    const setPending = (nextSizePx) => {
      splitDragRef.current.pending = clamp(nextSizePx / total, 0.1, 0.9);
      if (!splitDragRef.current.raf) splitDragRef.current.raf = window.requestAnimationFrame(apply);
    };

    const onMove = (ev) => {
      const pos = isH ? ev.clientY : ev.clientX;
      const delta = pos - startPos;
      setPending(clampPx(startSizePx + delta));
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);

      splitDragRef.current.active = false;
      splitResizingRef.current = false;
      if (splitDragRef.current.raf) {
        window.cancelAnimationFrame(splitDragRef.current.raf);
        splitDragRef.current.raf = 0;
      }

      const ratio = clamp(splitDragRef.current.pending || split.size, 0.1, 0.9);
      setSplit((prev) => ({ ...prev, size: ratio }));
      if (fitRafRef.current) cancelAnimationFrame(fitRafRef.current);
      fitRafRef.current = requestAnimationFrame(() => fitActive());
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [fitActive, split.enabled, split.orientation, split.size]);

  useImperativeHandle(ref, () => ({
    createTerminal,
    clearActive,
    killActive,
    disposeTerminal,
    setActive: (id) => setActiveId(String(id || '')),
    toggleScrollLock,
    toggleSplit,
    closeActivePane,
    splitAddVertical: () => splitAddPane('vertical'),
    splitAddHorizontal: () => splitAddPane('horizontal'),
    toggleSplitOrientation,
    openFind: () => openFind(activeId),
    closeFind,
    findNext: () => runFind('next'),
    findPrev: () => runFind('prev'),
    renameActive,
    openProfileSettings: (profile) => {
      setProfileEditing(String(profile || DEFAULT_PROFILE));
      setProfileSettingsOpen(true);
    },
    copySelection: copySelectionActive,
    pasteFromClipboard: pasteFromClipboardActive,
    focus: () => {
      const inst = instanceRef.current.get(activeId);
      inst?.term?.focus?.();
    },
    getState: () => ({ connected, terminals, activeId, scrollLock, split }),
  }), [
    activeId,
    clearActive,
    closeActivePane,
    closeFind,
    connected,
    copySelectionActive,
    createTerminal,
    disposeTerminal,
    killActive,
    openFind,
    pasteFromClipboardActive,
    profileEditing,
    profileSettingsOpen,
    renameActive,
    runFind,
    scrollLock,
    splitAddPane,
    split,
    terminals,
    toggleScrollLock,
    toggleSplit,
    toggleSplitOrientation,
  ]);

  useEffect(() => {
    if (!autoConnect) return;
    if (wsRef.current) return;
    if (connectLoopRef.current.running) return;
    connectLoopRef.current.running = true;

    const url = getWsUrl();
    if (!url) return;

    const pingUrl = getPingUrl();
    let cancelled = false;

    const clearTimer = () => {
      if (connectLoopRef.current.timer) window.clearTimeout(connectLoopRef.current.timer);
      connectLoopRef.current.timer = 0;
    };

    const abortPing = () => {
      const ctl = connectLoopRef.current.abort;
      connectLoopRef.current.abort = null;
      try { ctl?.abort?.(); } catch {}
    };

    const schedule = (ms) => {
      clearTimer();
      connectLoopRef.current.timer = window.setTimeout(() => tick(), ms);
    };

    const tryPing = async () => {
      abortPing();
      if (!pingUrl) return false;
      const ctl = new AbortController();
      connectLoopRef.current.abort = ctl;
      const t = window.setTimeout(() => ctl.abort(), 500);
      try {
        const res = await fetch(pingUrl, { method: 'GET', signal: ctl.signal });
        return !!res?.ok;
      } catch {
        return false;
      } finally {
        window.clearTimeout(t);
        if (connectLoopRef.current.abort === ctl) connectLoopRef.current.abort = null;
      }
    };

    const openWs = () => {
      if (cancelled) return;
      if (wsRef.current) return;

      const ws = new WebSocket(url);
      wsRef.current = ws;
      setConnected(false);
      setListed(false);

      ws.onopen = () => {
        setConnected(true);
        send({ type: 'list', requestId: 'boot' });
      };

      ws.onclose = () => {
        setConnected(false);
        setListed(false);
      };

      ws.onerror = () => {
        setConnected(false);
        setListed(false);
      };

      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(String(ev.data || ''));
        } catch {
          return;
        }
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'created') {
          const meta = {
            id: String(msg.id || ''),
            pid: Number(msg.pid || 0),
            title: String(msg.title || DEFAULT_PROFILE),
            profile: String(msg.profile || DEFAULT_PROFILE),
            cwd: String(msg.cwd || ''),
          };
          if (!meta.id) return;
          setListed(true);
          const persisted = getPersistedMeta(meta.id);
          if (persisted?.title) meta.title = String(persisted.title);
          setTerminals((prev) => {
            if (prev.some((t) => t.id === meta.id)) return prev;
            const next = { ...meta, label: computeLabel(meta.title, prev) };
            return [...prev, next];
          });
          setActiveId(meta.id);
          ensureXterm(meta);
          const resolve = pendingCreateRef.current.get(String(msg.requestId || ''));
          if (resolve) {
            pendingCreateRef.current.delete(String(msg.requestId || ''));
            resolve(meta);
          }
          return;
        }

        if (msg.type === 'list' && Array.isArray(msg.terminals)) {
          setListed(true);
          const items = msg.terminals
            .map((t) => ({
              id: String(t.id || ''),
              pid: Number(t.pid || 0),
              title: String(t.title || DEFAULT_PROFILE),
              profile: String(t.profile || DEFAULT_PROFILE),
              cwd: String(t.cwd || ''),
            }))
            .filter((t) => t.id);
          items.forEach((t) => {
            const persisted = getPersistedMeta(t.id);
            if (persisted?.title) t.title = String(persisted.title);
          });
          setTerminals((prev) => {
            const order = new Map((Array.isArray(prev) ? prev : []).map((t, idx) => [t.id, idx]));
            const next = items.map((t, idx) => ({ ...t, label: `${t.title || t.profile || DEFAULT_PROFILE} (${idx + 1})` }));
            next.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
            return next;
          });
          setActiveId((prev) => prev || items[0]?.id || '');
          items.forEach(ensureXterm);
          return;
        }

        if (msg.type === 'data') {
          const id = String(msg.id || '');
          const data = typeof msg.data === 'string' ? msg.data : String(msg.data || '');
          const inst = instanceRef.current.get(id);
          if (!inst) return;
          const preserve = scrollLock && id === activeId;
          let anchor = 0;
          if (preserve) {
            try {
              const buf = inst.term.buffer.active;
              anchor = buf.baseY + buf.viewportY;
            } catch {
              anchor = 0;
            }
          }
          inst.term.write(data, () => {
            if (!preserve) return;
            try {
              const buf = inst.term.buffer.active;
              const max = buf.baseY + buf.length - 1;
              inst.term.scrollToLine(clamp(anchor, 0, max));
            } catch {}
          });
          return;
        }

        if (msg.type === 'exit') {
          const id = String(msg.id || '');
          const inst = instanceRef.current.get(id);
          if (inst) {
            inst.term.write(`\r\n[process exited with code ${Number(msg.exitCode || 0)}]\r\n`);
          }
          return;
        }

        if (msg.type === 'disposed') {
          const id = String(msg.id || '');
          setTerminals((prev) => {
            const next = prev.filter((t) => t.id !== id);
            setActiveId((prevActive) => {
              if (prevActive !== id) return prevActive;
              return next[0]?.id || '';
            });
            return next;
          });
          const inst = instanceRef.current.get(id);
          if (inst) {
            try { inst.resultsDispose?.dispose?.(); } catch {}
            try { inst.search?.dispose?.(); } catch {}
            try { inst.term.dispose(); } catch {}
            instanceRef.current.delete(id);
          }
          containerRef.current.delete(id);
          return;
        }
      };
    };

    const tick = async () => {
      if (cancelled) return;
      if (wsRef.current) return;
      const ok = await tryPing();
      if (cancelled) return;
      if (ok) {
        connectLoopRef.current.running = false;
        clearTimer();
        abortPing();
        openWs();
        return;
      }
      schedule(1200);
    };

    setConnected(false);
    tick();

    return () => {
      cancelled = true;
      connectLoopRef.current.running = false;
      clearTimer();
      abortPing();
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect, createTerminal, ensureXterm, send, workspacePath]);

  useEffect(() => () => {
    const ws = wsRef.current;
    wsRef.current = null;
    try { window.clearTimeout(connectLoopRef.current.timer); } catch {}
    connectLoopRef.current.timer = 0;
    try { connectLoopRef.current.abort?.abort?.(); } catch {}
    connectLoopRef.current.abort = null;
    try { ws?.close?.(); } catch {}
  }, []);

  useLayoutEffect(() => {
    if (resizeObsRef.current) {
      try { resizeObsRef.current.disconnect(); } catch {}
      resizeObsRef.current = null;
    }

    const root = mainPaneRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return undefined;
    const obs = new ResizeObserver(() => {
      if (isResizingRef.current || splitResizingRef.current) return;
      if (fitRafRef.current) cancelAnimationFrame(fitRafRef.current);
      fitRafRef.current = requestAnimationFrame(() => fitActive());
    });
    obs.observe(root);
    resizeObsRef.current = obs;
    return () => {
      try { obs.disconnect(); } catch {}
    };
  }, [fitActive]);

  useEffect(() => {
    isResizingRef.current = !!isResizing;
    if (isResizing) return;
    if (fitRafRef.current) cancelAnimationFrame(fitRafRef.current);
    fitRafRef.current = requestAnimationFrame(() => fitActive());
  }, [fitActive, isResizing]);

  useEffect(() => {
    if (isResizingRef.current) return;
    if (fitRafRef.current) cancelAnimationFrame(fitRafRef.current);
    fitRafRef.current = requestAnimationFrame(() => fitActive());
  }, [fitActive, split.enabled, split.ids, split.orientation]);

  useEffect(() => {
    if (!activeId) return;
    openToContainerIfReady(activeId);
    fitActive();
    const inst = instanceRef.current.get(activeId);
    inst?.term?.focus?.();
  }, [activeId, fitActive, openToContainerIfReady]);

  const activeMeta = useMemo(() => terminals.find((t) => t.id === activeId) || null, [terminals, activeId]);
  const showSideList = terminals.length > 1;

  useEffect(() => {
    if (!split.enabled) return;
    const existing = new Set(terminals.map((t) => t.id));
    const prevIds = Array.isArray(split.ids) ? split.ids : [];
    const nextIds = Array.from(new Set(prevIds.filter((id) => existing.has(id))));
    if (nextIds.length <= 1) {
      setSplit((prev) => ({ ...prev, enabled: false, ids: [] }));
      if (nextIds[0]) setActiveId(nextIds[0]);
      return;
    }
    if (!nextIds.includes(activeId)) setActiveId(nextIds[0] || '');
    if (nextIds.length !== prevIds.length || nextIds.some((id, i) => id !== prevIds[i])) {
      setSplit((prev) => ({ ...prev, enabled: true, ids: nextIds }));
    }
  }, [activeId, split.enabled, split.ids, terminals]);

  if (typeof window === 'undefined') return null;

  const splitIds = split.enabled ? (Array.isArray(split.ids) ? split.ids : []) : [];
  const isTwoPaneSplit = split.enabled && splitIds.length === 2;
  const gridClass = split.enabled
    ? (isTwoPaneSplit
      ? `split ${split.orientation === 'horizontal' ? 'split-h' : 'split-v'}`
      : `multi-grid ${split.orientation === 'horizontal' ? 'rows' : 'cols'}`
    )
    : 'single';
  const leftId = isTwoPaneSplit ? splitIds[0] : '';
  const rightId = isTwoPaneSplit ? splitIds[1] : '';
  const splitPct = `${Math.round(clamp(split.size, 0.1, 0.9) * 1000) / 10}%`;

  return (
    <div className={`vscode-terminal-shell ${showSideList ? 'multi' : 'single'}`}>
      <div
        className={`vscode-terminal-main ${gridClass}`}
        ref={mainPaneRef}
        style={(() => {
          if (isTwoPaneSplit) return { '--terminal-split': splitPct };
          if (!split.enabled) return undefined;
          const n = splitIds.length || 1;
          if (split.orientation === 'horizontal') {
            return { gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: `repeat(${n}, minmax(0, 1fr))` };
          }
          return { gridTemplateRows: 'minmax(0, 1fr)', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` };
        })()}
      >
        {terminals.map((t) => (
          <div
            key={t.id}
            className={`vscode-terminal-instance ${t.id === activeId ? 'active' : ''}`}
            style={(() => {
              if (!split.enabled) return { display: t.id === activeId ? 'block' : 'none' };
              if (isTwoPaneSplit) {
                if (t.id === leftId) return split.orientation === 'horizontal' ? { display: 'block', gridRow: 1, gridColumn: 1 } : { display: 'block', gridRow: 1, gridColumn: 1 };
                if (t.id === rightId) return split.orientation === 'horizontal' ? { display: 'block', gridRow: 3, gridColumn: 1 } : { display: 'block', gridRow: 1, gridColumn: 3 };
                return { display: 'none' };
              }
              const idx = splitIds.indexOf(t.id);
              if (idx < 0) return { display: 'none' };
              if (split.orientation === 'horizontal') return { display: 'block', gridRow: idx + 1, gridColumn: 1 };
              return { display: 'block', gridRow: 1, gridColumn: idx + 1 };
            })()}
            onPointerDown={() => setActiveId(t.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setActiveId(t.id);
              setCtxMenu({ x: e.clientX, y: e.clientY, id: t.id });
            }}
            ref={(el) => {
              if (!el) return;
              containerRef.current.set(t.id, el);
              openToContainerIfReady(t.id);
            }}
            aria-label={`terminal-${t.title || t.id}`}
          />
        ))}

        {isTwoPaneSplit ? (
          <div
            className={`vscode-terminal-splitter ${split.orientation === 'horizontal' ? 'h' : 'v'}`}
            onPointerDown={onSplitterPointerDown}
            role="separator"
            aria-orientation={split.orientation === 'horizontal' ? 'horizontal' : 'vertical'}
            aria-label="Resize split panes"
          />
        ) : null}

        {find.open ? (
          <div className="vscode-terminal-find" role="dialog" aria-label="Find in Terminal">
            <span className="codicon codicon-search" aria-hidden />
            <input
              ref={findInputRef}
              className="vscode-terminal-find-input"
              value={find.query}
              placeholder="查找"
              onChange={(e) => setFind((prev) => ({ ...prev, query: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  closeFind();
                  return;
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  runFind(e.shiftKey ? 'prev' : 'next');
                }
              }}
            />
            <button
              type="button"
              className={`bottom-panel-icon-btn ${find.caseSensitive ? 'active' : ''}`}
              title="大小写敏感"
              onClick={() => setFind((prev) => ({ ...prev, caseSensitive: !prev.caseSensitive }))}
            >
              <span className="codicon codicon-case-sensitive" aria-hidden />
            </button>
            <button
              type="button"
              className={`bottom-panel-icon-btn ${find.wholeWord ? 'active' : ''}`}
              title="全词匹配"
              onClick={() => setFind((prev) => ({ ...prev, wholeWord: !prev.wholeWord }))}
            >
              <span className="codicon codicon-whole-word" aria-hidden />
            </button>
            <button
              type="button"
              className={`bottom-panel-icon-btn ${find.regex ? 'active' : ''}`}
              title="正则"
              onClick={() => setFind((prev) => ({ ...prev, regex: !prev.regex }))}
            >
              <span className="codicon codicon-regex" aria-hidden />
            </button>
            <div className="vscode-terminal-find-count" aria-label="Match count">
              {find.resultCount ? `${Math.max(1, find.resultIndex + 1)}/${find.resultCount}` : '0/0'}
            </div>
            <button type="button" className="bottom-panel-icon-btn" title="上一个" onClick={() => runFind('prev')}>
              <span className="codicon codicon-chevron-up" aria-hidden />
            </button>
            <button type="button" className="bottom-panel-icon-btn" title="下一个" onClick={() => runFind('next')}>
              <span className="codicon codicon-chevron-down" aria-hidden />
            </button>
            <button type="button" className="bottom-panel-icon-btn" title="关闭" onClick={closeFind}>
              <span className="codicon codicon-close" aria-hidden />
            </button>
          </div>
        ) : null}

        {ctxMenu ? (
          <div
            className="vscode-terminal-context"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            role="menu"
            aria-label="Terminal context menu"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button type="button" className="vscode-terminal-context-item" onClick={() => { copySelectionActive(); setCtxMenu(null); }}>
              复制
            </button>
            <button type="button" className="vscode-terminal-context-item" onClick={() => { pasteFromClipboardActive(); setCtxMenu(null); }}>
              粘贴
            </button>
            <button type="button" className="vscode-terminal-context-item" onClick={() => { clearActive(); setCtxMenu(null); }}>
              清空
            </button>
            <div className="vscode-terminal-context-sep" aria-hidden />
            <button type="button" className="vscode-terminal-context-item" onClick={() => { splitAddPane('vertical'); setCtxMenu(null); }}>
              向右分屏
            </button>
            <button type="button" className="vscode-terminal-context-item" onClick={() => { splitAddPane('horizontal'); setCtxMenu(null); }}>
              向下分屏
            </button>
            <button type="button" className="vscode-terminal-context-item" disabled={!split.enabled} onClick={() => { closeActivePane(); setCtxMenu(null); }}>
              关闭当前分屏
            </button>
            <div className="vscode-terminal-context-sep" aria-hidden />
            <button type="button" className="vscode-terminal-context-item" onClick={() => { renameActive(); setCtxMenu(null); }}>
              重命名…
            </button>
            <button type="button" className="vscode-terminal-context-item" onClick={() => { openFind(activeId); setCtxMenu(null); }}>
              查找…
            </button>
            <button type="button" className="vscode-terminal-context-item danger" onClick={() => { killActive(); setCtxMenu(null); }}>
              终止终端
            </button>
          </div>
        ) : null}

        {profileSettingsOpen ? (
          <div className="vscode-terminal-modal-backdrop" onMouseDown={() => setProfileSettingsOpen(false)}>
            <div className="vscode-terminal-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Terminal Profile Settings">
              <div className="vscode-terminal-modal-header">
                <div className="vscode-terminal-modal-title">Terminal Profile 配置</div>
                <button type="button" className="bottom-panel-icon-btn" onClick={() => setProfileSettingsOpen(false)} title="关闭">
                  <span className="codicon codicon-close" aria-hidden />
                </button>
              </div>
              <div className="vscode-terminal-modal-row">
                <div className="vscode-terminal-modal-label">Profile</div>
                <select
                  className="ghost-input bottom-panel-select"
                  value={profileEditing}
                  onChange={(e) => setProfileEditing(e.target.value)}
                >
                  <option value="cmd">cmd</option>
                  <option value="powershell">powershell</option>
                  <option value="bash">bash</option>
                </select>
              </div>
              <div className="vscode-terminal-modal-row">
                <div className="vscode-terminal-modal-label">Env</div>
                <div className="vscode-terminal-modal-hint">每行一个：`KEY=VALUE`（# 开头为注释）</div>
              </div>
              <textarea
                className="vscode-terminal-modal-textarea"
                value={profileEnvText?.[profileEditing] || ''}
                onChange={(e) => setProfileEnvText((prev) => ({ ...(prev || {}), [profileEditing]: e.target.value }))}
                placeholder={`例如：\nHTTP_PROXY=http://127.0.0.1:7890\nHTTPS_PROXY=http://127.0.0.1:7890`}
                spellCheck="false"
              />
              <div className="vscode-terminal-modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setProfileEnvText({ cmd: '', powershell: '', bash: '' })}>
                  清空全部
                </button>
                <button type="button" className="primary-btn" onClick={() => setProfileSettingsOpen(false)}>
                  保存
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {!connected ? (
          <div className="vscode-terminal-overlay">
            <div className="panel-empty-title">终端后端未连接</div>
            <div className="panel-empty-subtitle">请确认 `backend-node` 已启动（默认端口 8000）。</div>
          </div>
        ) : null}
        {connected && !terminals.length ? (
          <div className="vscode-terminal-overlay">
            <div className="panel-empty-title">正在创建终端…</div>
            <div className="panel-empty-subtitle">Profile: {DEFAULT_PROFILE}</div>
          </div>
        ) : null}
      </div>

      {showSideList ? (
        <div className="vscode-terminal-side" aria-label="Terminal List">
          <div className="vscode-terminal-side-header">
            <div className="vscode-terminal-side-title">TERMINALS</div>
            <div className="vscode-terminal-side-sub">{activeMeta?.cwd ? activeMeta.cwd : ''}</div>
          </div>
          <div className="vscode-terminal-list">
            {terminals.map((t, idx) => (
              // codicons: terminal, terminal-bash, terminal-powershell, terminal-cmd
              <button
                key={t.id}
                type="button"
                className={`vscode-terminal-item ${t.id === activeId ? 'active' : ''}`}
                onClick={() => setActiveId(t.id)}
                draggable
                onDragStart={() => setDragTerminalId(t.id)}
                onDragEnd={() => setDragTerminalId('')}
                onDragOver={(e) => {
                  if (!dragTerminalId || dragTerminalId === t.id) return;
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!dragTerminalId || dragTerminalId === t.id) return;
                  moveTerminalInList(dragTerminalId, t.id);
                  setDragTerminalId('');
                }}
                title={t.cwd || t.title}
              >
                <span
                  className={`codicon ${
                    String(t.profile || '').toLowerCase().includes('powershell') ? 'codicon-terminal-powershell'
                      : (String(t.profile || '').toLowerCase().includes('bash') ? 'codicon-terminal-bash'
                        : (String(t.profile || '').toLowerCase().includes('cmd') ? 'codicon-terminal-cmd' : 'codicon-terminal'))
                  }`}
                  aria-hidden
                />
                <span className="vscode-terminal-item-title">{t.title || t.label || t.profile || `terminal-${idx + 1}`}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default forwardRef(TerminalView);
