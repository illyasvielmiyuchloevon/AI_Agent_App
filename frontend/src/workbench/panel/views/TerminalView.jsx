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
import '@xterm/xterm/css/xterm.css';
import { readJson, writeJson } from '../../terminal/terminalStorage';
import {
  DEFAULT_INTEGRATED_SETTINGS,
  normalizeIntegratedOverrides,
  normalizeIntegratedSettings,
} from '../../terminal/terminalSettings';
import { useTerminalConnection } from '../../terminal/useTerminalConnection';
import { useXtermInstances } from '../../terminal/useXtermInstances';
import TerminalContextMenu from './terminal/TerminalContextMenu';
import TerminalFindBar from './terminal/TerminalFindBar';
import TerminalSplitLayout from './terminal/TerminalSplitLayout';
import TerminalTabs from './terminal/TerminalTabs';

const DEFAULT_PROFILE = 'cmd';
const USER_SETTINGS_KEY = 'terminal:settings:user';

const computeLabel = (base, existing) => {
  const name = String(base || DEFAULT_PROFILE) || DEFAULT_PROFILE;
  const count = (existing || []).filter((t) => (t.title || '') === name).length;
  return count > 0 ? `${name} (${count + 1})` : name;
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

function TerminalView({
  workspacePath = '',
  onStateChange,
  terminalUi = null,
  onTerminalUiChange,
  autoConnect = true,
  isResizing = false,
}, ref) {
  const sendRef = useRef(() => false);
  const createTerminalRef = useRef(async () => null);
  const persistMetaRef = useRef(() => {});
  const updateTerminalTitleRef = useRef(() => {});
  const openFindRef = useRef(() => {});
  const pendingCreateRef = useRef(new Map());
  const resizeObsRef = useRef(null);
  const fitRafRef = useRef(0);
  const mainPaneRef = useRef(null);
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

  const [listed, setListed] = useState(false);
  const [terminals, setTerminals] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [scrollLock, setScrollLock] = useState(false);
  const scrollLockRef = useRef(false);
  const isResizingRef = useRef(false);
  const [themeTick, setThemeTick] = useState(0);
  const [split, setSplit] = useState({ enabled: false, orientation: 'vertical', ids: [], size: 0.5 });
  const [dragTerminalId, setDragTerminalId] = useState('');
  const [ctxMenu, setCtxMenu] = useState(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTargetId, setRenameTargetId] = useState('');
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef(null);
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
  const settingsKey = useMemo(() => `${storageBase}:settings`, [storageBase]);

  const [userIntegratedSettings, setUserIntegratedSettings] = useState(() => normalizeIntegratedOverrides(readJson(USER_SETTINGS_KEY, null)));
  const [workspaceIntegratedSettings, setWorkspaceIntegratedSettings] = useState(() => normalizeIntegratedOverrides(readJson(settingsKey, null)));

  useEffect(() => {
    setWorkspaceIntegratedSettings(normalizeIntegratedOverrides(readJson(settingsKey, null)));
  }, [settingsKey]);

  useEffect(() => {
    writeJson(USER_SETTINGS_KEY, userIntegratedSettings);
  }, [userIntegratedSettings]);

  useEffect(() => {
    writeJson(settingsKey, workspaceIntegratedSettings);
  }, [settingsKey, workspaceIntegratedSettings]);

  const integratedSettings = useMemo(() => {
    const user = userIntegratedSettings && typeof userIntegratedSettings === 'object' ? userIntegratedSettings : {};
    const ws = workspaceIntegratedSettings && typeof workspaceIntegratedSettings === 'object' ? workspaceIntegratedSettings : {};
    return normalizeIntegratedSettings({ ...DEFAULT_INTEGRATED_SETTINGS, ...user, ...ws });
  }, [userIntegratedSettings, workspaceIntegratedSettings]);

  useEffect(() => {
    const onSettingsChanged = (e) => {
      const detail = e?.detail;
      if (!detail || typeof detail !== 'object') return;

      if (detail.userOverrides && typeof detail.userOverrides === 'object') {
        setUserIntegratedSettings(normalizeIntegratedOverrides(detail.userOverrides));
      }

      if (detail.workspaceOverrides && typeof detail.workspaceOverrides === 'object') {
        setWorkspaceIntegratedSettings(normalizeIntegratedOverrides(detail.workspaceOverrides));
      }

      const prof = detail.profiles && typeof detail.profiles === 'object' ? detail.profiles : null;
      const envText = prof?.envText && typeof prof.envText === 'object' ? prof.envText : null;
      if (envText) {
        setProfileEnvText((prev) => ({
          ...(prev || { cmd: '', powershell: '', bash: '' }),
          cmd: typeof envText.cmd === 'string' ? envText.cmd : (prev?.cmd || ''),
          powershell: typeof envText.powershell === 'string' ? envText.powershell : (prev?.powershell || ''),
          bash: typeof envText.bash === 'string' ? envText.bash : (prev?.bash || ''),
        }));
      }

      const defaultProfile = typeof prof?.defaultProfile === 'string' ? String(prof.defaultProfile || '') : '';
      if (defaultProfile) onTerminalUiChange?.({ profile: defaultProfile });
    };

    window.addEventListener('workbench:terminalSettingsChanged', onSettingsChanged);
    return () => window.removeEventListener('workbench:terminalSettingsChanged', onSettingsChanged);
  }, [onTerminalUiChange]);

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
    scrollLockRef.current = !!scrollLock;
  }, [scrollLock]);

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
    if (typeof window === 'undefined' || typeof MutationObserver === 'undefined') return undefined;
    const el = document.documentElement;
    if (!el) return undefined;
    const obs = new MutationObserver(() => setThemeTick((v) => v + 1));
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      try { obs.disconnect(); } catch {}
    };
  }, []);

  const onRemoteState = useCallback((data) => {
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

    const defaultProfile = typeof prof?.defaultProfile === 'string' ? String(prof.defaultProfile || '') : '';
    if (defaultProfile) onTerminalUiChange?.({ profile: defaultProfile });

    const settings = data.settings && typeof data.settings === 'object' ? data.settings : null;
    const integrated = settings?.integrated && typeof settings.integrated === 'object' ? settings.integrated : null;
    if (integrated) setWorkspaceIntegratedSettings(normalizeIntegratedOverrides(integrated));
  }, [onTerminalUiChange]);

  const stateSyncPayload = useMemo(() => ({
    split: {
      enabled: !!split.enabled,
      orientation: split.orientation === 'horizontal' ? 'horizontal' : 'vertical',
      size: clamp(split.size, 0.1, 0.9),
      ids: Array.isArray(split.ids) ? split.ids : [],
    },
    profiles: {
      envText: profileEnvText,
      defaultProfile: String(terminalUi?.profile || DEFAULT_PROFILE),
    },
    settings: {
      integrated: workspaceIntegratedSettings,
    },
  }), [
    profileEnvText,
    split.enabled,
    split.ids,
    split.orientation,
    split.size,
    terminalUi?.profile,
    workspaceIntegratedSettings,
  ]);

  const onFindResults = useCallback((_id, ev) => {
    setFind((prev) => (prev.open ? { ...prev, resultIndex: ev.resultIndex, resultCount: ev.resultCount } : prev));
  }, []);

  const {
    getInstance: getXtermInstance,
    setContainer: setXtermContainer,
    ensureXterm: ensureXtermInstance,
    openToContainerIfReady: openXtermIfReady,
    disposeXterm: disposeXtermInstance,
    resetAll: resetAllXterms,
    fitAndResize: fitAndResizeXterms,
  } = useXtermInstances({
    integratedSettings,
    theme,
    getActiveId: () => String(activeIdRef.current || ''),
    send: (msg) => sendRef.current(msg),
    openExternal,
    onFindResults,
    onOpenFind: (id) => openFindRef.current(id),
    onCreateTerminal: (profile) => createTerminalRef.current(profile),
    getTerminalProfile: () => String(terminalUi?.profile || DEFAULT_PROFILE),
    onSplitAddPane: (orientation) => splitAddPaneRef.current?.(orientation),
    onCloseActivePane: () => closeActivePaneRef.current?.(),
    onFocusPaneDelta: (delta) => focusPaneDeltaRef.current?.(delta),
    readClipboard,
    writeClipboard,
    onPersistMeta: (id, patch) => persistMetaRef.current(id, patch),
    onUpdateTerminalTitle: (id, title) => updateTerminalTitleRef.current(id, title),
  });

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

  persistMetaRef.current = persistMeta;

  const updateTerminalTitle = useCallback((id, title) => {
    const key = String(id || '');
    const nextTitle = String(title || '').trim();
    if (!key || !nextTitle) return;
    setTerminals((prev) => {
      const items = Array.isArray(prev) ? prev : [];
      if (!items.some((t) => t.id === key)) return prev;
      const others = items.filter((t) => t.id !== key);
      const label = computeLabel(nextTitle, others);
      return items.map((t) => (t.id === key ? { ...t, title: nextTitle, label } : t));
    });
  }, []);

  updateTerminalTitleRef.current = updateTerminalTitle;

  const fitVisible = useCallback(() => {
    const ids = split.enabled ? (Array.isArray(split.ids) ? split.ids : []) : (activeId ? [activeId] : []);
    fitAndResizeXterms(ids);
  }, [activeId, fitAndResizeXterms, split.enabled, split.ids]);

  const resetClientState = useCallback(() => {
    pendingCreateRef.current.clear();
    activeIdRef.current = '';
    splitIdsRef.current = [];
    terminalsRef.current = [];

    setTerminals([]);
    setActiveId('');
    setListed(false);
    setScrollLock(false);
    setSplit({ enabled: false, orientation: 'vertical', ids: [], size: 0.5 });
    resetAllXterms();
  }, [resetAllXterms]);

  const handleServerMessage = useCallback((msg) => {
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
      ensureXtermInstance(meta);
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
      items.forEach(ensureXtermInstance);
      return;
    }

    if (msg.type === 'data') {
      const id = String(msg.id || '');
      const data = typeof msg.data === 'string' ? msg.data : String(msg.data || '');
      const inst = getXtermInstance(id);
      if (!inst?.term) return;

      const preserve = !!scrollLockRef.current && id === String(activeIdRef.current || '');
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
      const inst = getXtermInstance(id);
      if (inst?.term) {
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
      disposeXtermInstance(id);
      return;
    }

    if (msg.type === 'hello') return;
  }, [disposeXtermInstance, ensureXtermInstance, getPersistedMeta, getXtermInstance]);

  const { connected, send } = useTerminalConnection({
    workspacePath,
    autoConnect,
    onMessage: handleServerMessage,
    onReset: resetClientState,
    onOpen: ({ send: sendNow }) => {
      setListed(false);
      sendNow({ type: 'list', requestId: 'boot' });
    },
    onClose: () => {
      setListed(false);
    },
    stateSync: {
      enabled: !!workspacePath,
      payload: stateSyncPayload,
      onRemoteState,
    },
  });

  sendRef.current = send;

  const emitState = useCallback((next) => {
    onStateChange?.(next);
  }, [onStateChange]);

  useEffect(() => {
    emitState({ connected, listed, terminals, activeId, scrollLock, split });
  }, [connected, listed, terminals, activeId, scrollLock, split, emitState]);

  const copySelectionActive = useCallback(() => {
    const id = String(activeId || '');
    if (!id) return;
    const inst = getXtermInstance(id);
    if (!inst?.term?.hasSelection?.() || !inst.term.hasSelection()) return;
    try { writeClipboard(inst.term.getSelection()); } catch {}
  }, [activeId, getXtermInstance, writeClipboard]);

  const pasteFromClipboardActive = useCallback(() => {
    const id = String(activeId || '');
    if (!id) return;
    const inst = getXtermInstance(id);
    if (!inst?.term) return;
    readClipboard().then((text) => {
      const value = String(text || '');
      if (!value) return;
      try { inst.term.paste(value); } catch {}
    });
  }, [activeId, getXtermInstance, readClipboard]);

  const clearActive = useCallback(() => {
    const id = String(activeId || '');
    if (!id) return;
    const inst = getXtermInstance(id);
    if (!inst?.term) return;
    const meta = terminals.find((t) => t.id === id);
    const profile = String(meta?.profile || meta?.title || DEFAULT_PROFILE).toLowerCase();
    const cmd = profile.includes('bash') ? 'clear\r' : 'cls\r';
    try { inst.term.paste(cmd); } catch {}
  }, [activeId, getXtermInstance, terminals]);

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

  openFindRef.current = openFind;

  const closeFind = useCallback(() => {
    setFind((prev) => ({ ...prev, open: false, resultIndex: 0, resultCount: 0 }));
    try {
      const inst = getXtermInstance(String(activeId || ''));
      inst?.search?.clearDecorations?.();
    } catch {}
  }, [activeId, getXtermInstance]);

  const runFind = useCallback((direction = 'next') => {
    const inst = getXtermInstance(String(activeId || ''));
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
  }, [activeId, find.caseSensitive, find.query, find.regex, find.wholeWord, findDecorations, getXtermInstance]);

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
    if (!renameOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setRenameOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => {
      try { renameInputRef.current?.focus?.(); } catch {}
      try { renameInputRef.current?.select?.(); } catch {}
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [renameOpen]);

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

  createTerminalRef.current = createTerminal;

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

  const splitAddPaneWithProfile = useCallback(async (profileOverride, orientation = splitRef.current.orientation) => {
    const dir = orientation === 'horizontal' ? 'horizontal' : 'vertical';
    const currentTerminals = Array.isArray(terminalsRef.current) ? terminalsRef.current : [];
    const baseId = String(activeIdRef.current || currentTerminals[0]?.id || '');
    if (!baseId) return;

    const currentSplit = splitRef.current;
    const prevIds = currentSplit.enabled ? (Array.isArray(currentSplit.ids) ? currentSplit.ids : []) : [baseId];
    const ids = prevIds.includes(baseId) ? [...prevIds] : [baseId, ...prevIds];

    const prof = String(profileOverride || '').trim() || DEFAULT_PROFILE;
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
    setRenameTargetId(id);
    setRenameDraft(String(current || ''));
    setRenameOpen(true);
  }, [activeId, terminals]);

  const applyRename = useCallback(() => {
    const id = String(renameTargetId || activeId || '');
    if (!id) return;
    const value = String(renameDraft || '').trim();
    if (!value) {
      setRenameOpen(false);
      return;
    }
    persistMeta(id, { title: value });
    setTerminals((prev) => {
      const others = prev.filter((t) => t.id !== id);
      const label = computeLabel(value, others);
      return prev.map((t) => (t.id === id ? { ...t, title: value, label } : t));
    });
    setRenameOpen(false);
  }, [activeId, persistMeta, renameDraft, renameTargetId]);

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
      fitRafRef.current = requestAnimationFrame(() => fitVisible());
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [fitVisible, split.enabled, split.orientation, split.size]);

  useImperativeHandle(ref, () => ({
    createTerminal,
    clearActive,
    killActive,
    disposeTerminal,
    sendInput: (id, data) => send({ type: 'input', id: String(id || ''), data: String(data ?? '') }),
    setActive: (id) => setActiveId(String(id || '')),
    toggleScrollLock,
    toggleSplit,
    closeActivePane,
    splitAddVertical: () => splitAddPane('vertical'),
    splitAddHorizontal: () => splitAddPane('horizontal'),
    splitAddVerticalWithProfile: (p) => splitAddPaneWithProfile(p, 'vertical'),
    splitAddHorizontalWithProfile: (p) => splitAddPaneWithProfile(p, 'horizontal'),
    toggleSplitOrientation,
    openFind: () => openFind(activeId),
    closeFind,
    findNext: () => runFind('next'),
    findPrev: () => runFind('prev'),
    renameActive,
    copySelection: copySelectionActive,
    pasteFromClipboard: pasteFromClipboardActive,
    focus: () => {
      const inst = getXtermInstance(activeId);
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
    renameActive,
    runFind,
    scrollLock,
    splitAddPane,
    splitAddPaneWithProfile,
    split,
    terminals,
    toggleScrollLock,
    toggleSplit,
    toggleSplitOrientation,
    getXtermInstance,
    send,
  ]);

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
      fitRafRef.current = requestAnimationFrame(() => fitVisible());
    });
    obs.observe(root);
    resizeObsRef.current = obs;
    return () => {
      try { obs.disconnect(); } catch {}
    };
  }, [fitVisible]);

  useEffect(() => {
    isResizingRef.current = !!isResizing;
    if (isResizing) return;
    if (fitRafRef.current) cancelAnimationFrame(fitRafRef.current);
    fitRafRef.current = requestAnimationFrame(() => fitVisible());
  }, [fitVisible, isResizing]);

  useEffect(() => {
    if (isResizingRef.current) return;
    if (fitRafRef.current) cancelAnimationFrame(fitRafRef.current);
    fitRafRef.current = requestAnimationFrame(() => fitVisible());
  }, [fitVisible, split.enabled, split.ids, split.orientation]);

  useEffect(() => {
    if (!activeId) return;
    openXtermIfReady(activeId);
    fitVisible();
    const inst = getXtermInstance(activeId);
    inst?.term?.focus?.();
  }, [activeId, fitVisible, getXtermInstance, openXtermIfReady]);

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
      <TerminalSplitLayout
        mainPaneRef={mainPaneRef}
        gridClass={gridClass}
        split={split}
        splitIds={splitIds}
        isTwoPaneSplit={isTwoPaneSplit}
        leftId={leftId}
        rightId={rightId}
        splitPct={splitPct}
        terminals={terminals}
        activeId={activeId}
        onActivate={setActiveId}
        onContextMenu={(e, terminalId) => {
          e.preventDefault();
          setActiveId(terminalId);
          setCtxMenu({ x: e.clientX, y: e.clientY, id: terminalId });
        }}
        onSplitterPointerDown={onSplitterPointerDown}
        setXtermContainer={setXtermContainer}
      >
        <TerminalFindBar
          open={find.open}
          find={find}
          findInputRef={findInputRef}
          setFind={setFind}
          closeFind={closeFind}
          runFind={runFind}
        />
        <TerminalContextMenu
          ctxMenu={ctxMenu}
          splitEnabled={split.enabled}
          onClose={() => setCtxMenu(null)}
          onCopy={copySelectionActive}
          onPaste={pasteFromClipboardActive}
          onClear={clearActive}
          onSplitVertical={() => splitAddPane('vertical')}
          onSplitHorizontal={() => splitAddPane('horizontal')}
          onClosePane={closeActivePane}
          onRename={renameActive}
          onFind={() => openFind(activeId)}
          onKill={killActive}
        />

        {renameOpen ? (
          <div className="vscode-terminal-modal-backdrop" onMouseDown={() => setRenameOpen(false)}>
            <div className="vscode-terminal-modal vscode-terminal-modal-small" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Rename Terminal">
              <div className="vscode-terminal-modal-header">
                <div className="vscode-terminal-modal-title">重命名终端</div>
                <button type="button" className="bottom-panel-icon-btn" onClick={() => setRenameOpen(false)} title="关闭">
                  <span className="codicon codicon-close" aria-hidden />
                </button>
              </div>
              <div className="vscode-terminal-modal-row">
                <div className="vscode-terminal-modal-label">名称</div>
                <input
                  ref={renameInputRef}
                  className="ghost-input vscode-terminal-modal-input"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      applyRename();
                    }
                  }}
                  placeholder="Terminal"
                />
              </div>
              <div className="vscode-terminal-modal-actions">
                <button type="button" className="ghost-btn" onClick={() => setRenameOpen(false)}>
                  取消
                </button>
                <button type="button" className="primary-btn" onClick={applyRename}>
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
      </TerminalSplitLayout>

      <TerminalTabs
        show={showSideList}
        terminals={terminals}
        activeId={activeId}
        activeCwd={activeMeta?.cwd ? activeMeta.cwd : ''}
        dragTerminalId={dragTerminalId}
        setDragTerminalId={setDragTerminalId}
        onActivate={setActiveId}
        onMove={moveTerminalInList}
        onDispose={disposeTerminal}
      />
    </div>
  );
}

export default forwardRef(TerminalView);
