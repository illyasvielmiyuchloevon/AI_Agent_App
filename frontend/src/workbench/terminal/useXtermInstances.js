import { useCallback, useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';

export const useXtermInstances = ({
  integratedSettings,
  theme,
  getActiveId,
  send,
  openExternal,
  onFindResults,
  onOpenFind,
  onCreateTerminal,
  getTerminalProfile,
  onSplitAddPane,
  onCloseActivePane,
  onFocusPaneDelta,
  readClipboard,
  writeClipboard,
  onPersistMeta,
  onUpdateTerminalTitle,
}) => {
  const instancesRef = useRef(new Map());
  const containersRef = useRef(new Map());

  const handlersRef = useRef({
    getActiveId: null,
    send: null,
    openExternal: null,
    onFindResults: null,
    onOpenFind: null,
    onCreateTerminal: null,
    getTerminalProfile: null,
    onSplitAddPane: null,
    onCloseActivePane: null,
    onFocusPaneDelta: null,
    readClipboard: null,
    writeClipboard: null,
    onPersistMeta: null,
    onUpdateTerminalTitle: null,
  });

  handlersRef.current.getActiveId = typeof getActiveId === 'function' ? getActiveId : null;
  handlersRef.current.send = typeof send === 'function' ? send : null;
  handlersRef.current.openExternal = typeof openExternal === 'function' ? openExternal : null;
  handlersRef.current.onFindResults = typeof onFindResults === 'function' ? onFindResults : null;
  handlersRef.current.onOpenFind = typeof onOpenFind === 'function' ? onOpenFind : null;
  handlersRef.current.onCreateTerminal = typeof onCreateTerminal === 'function' ? onCreateTerminal : null;
  handlersRef.current.getTerminalProfile = typeof getTerminalProfile === 'function' ? getTerminalProfile : null;
  handlersRef.current.onSplitAddPane = typeof onSplitAddPane === 'function' ? onSplitAddPane : null;
  handlersRef.current.onCloseActivePane = typeof onCloseActivePane === 'function' ? onCloseActivePane : null;
  handlersRef.current.onFocusPaneDelta = typeof onFocusPaneDelta === 'function' ? onFocusPaneDelta : null;
  handlersRef.current.readClipboard = typeof readClipboard === 'function' ? readClipboard : null;
  handlersRef.current.writeClipboard = typeof writeClipboard === 'function' ? writeClipboard : null;
  handlersRef.current.onPersistMeta = typeof onPersistMeta === 'function' ? onPersistMeta : null;
  handlersRef.current.onUpdateTerminalTitle = typeof onUpdateTerminalTitle === 'function' ? onUpdateTerminalTitle : null;

  const getInstance = useCallback((id) => instancesRef.current.get(String(id || '')) || null, []);

  const openToContainerIfReady = useCallback((id) => {
    const key = String(id || '');
    if (!key) return;
    const inst = instancesRef.current.get(key);
    const el = containersRef.current.get(key);
    if (!inst || !el) return;
    if (el.dataset.xtermOpened === '1') return;
    el.dataset.xtermOpened = '1';
    inst.term.open(el);
    try {
      inst.fit.fit();
    } catch {}
    try {
      const sendNow = handlersRef.current.send;
      sendNow?.({ type: 'resize', id: key, cols: inst.term.cols, rows: inst.term.rows });
    } catch {}
  }, []);

  const setContainer = useCallback((id, el) => {
    const key = String(id || '');
    if (!key || !el) return;
    containersRef.current.set(key, el);
    openToContainerIfReady(key);
  }, [openToContainerIfReady]);

  const ensureXterm = useCallback((meta) => {
    const id = String(meta?.id || '');
    if (!id) return;
    if (instancesRef.current.has(id)) return;

    const term = new Terminal({
      fontFamily: integratedSettings.fontFamily,
      fontSize: integratedSettings.fontSize,
      lineHeight: integratedSettings.lineHeight,
      cursorBlink: integratedSettings.cursorBlink,
      cursorStyle: integratedSettings.cursorStyle,
      convertEol: integratedSettings.convertEol,
      theme,
      scrollback: integratedSettings.scrollback,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);

    term.loadAddon(new WebLinksAddon((event, uri) => {
      try { event?.preventDefault?.(); } catch {}
      try { handlersRef.current.openExternal?.(uri); } catch {}
    }));

    const resultsDispose = search.onDidChangeResults((ev) => {
      try {
        const active = handlersRef.current.getActiveId?.();
        if (active !== id) return;
        handlersRef.current.onFindResults?.(id, ev);
      } catch {}
    });

    term.onData((data) => {
      try { handlersRef.current.send?.({ type: 'input', id, data }); } catch {}
    });

    term.attachCustomKeyEventHandler((ev) => {
      try {
        const key = String(ev?.key || '').toLowerCase();
        const ctrlOrCmd = !!(ev?.ctrlKey || ev?.metaKey);

        if (ctrlOrCmd && ev.shiftKey && !ev.altKey && (ev.code === 'Backquote' || key === '`')) {
          const prof = String(handlersRef.current.getTerminalProfile?.() || '').trim();
          handlersRef.current.onCreateTerminal?.(prof).catch?.(() => {});
          return false;
        }
        if (ctrlOrCmd && !ev.altKey && key === 'f') {
          handlersRef.current.onOpenFind?.(id);
          return false;
        }
        if (ctrlOrCmd && ev.shiftKey && !ev.altKey && key === '5') {
          handlersRef.current.onSplitAddPane?.('vertical');
          return false;
        }
        if (ctrlOrCmd && ev.shiftKey && !ev.altKey && key === '6') {
          handlersRef.current.onSplitAddPane?.('horizontal');
          return false;
        }
        if (ctrlOrCmd && ev.shiftKey && !ev.altKey && key === 'w') {
          handlersRef.current.onCloseActivePane?.();
          return false;
        }
        if (ctrlOrCmd && ev.altKey && (key === 'arrowright' || key === 'arrowdown')) {
          handlersRef.current.onFocusPaneDelta?.(1);
          return false;
        }
        if (ctrlOrCmd && ev.altKey && (key === 'arrowleft' || key === 'arrowup')) {
          handlersRef.current.onFocusPaneDelta?.(-1);
          return false;
        }
        if (ctrlOrCmd && !ev.altKey && key === 'c' && !ev.shiftKey) {
          if (term.hasSelection()) {
            handlersRef.current.writeClipboard?.(term.getSelection());
            return false;
          }
          return true;
        }
        if (ctrlOrCmd && !ev.altKey && key === 'c' && ev.shiftKey) {
          if (term.hasSelection()) handlersRef.current.writeClipboard?.(term.getSelection());
          return false;
        }
        if (ev?.ctrlKey && key === 'insert') {
          if (term.hasSelection()) handlersRef.current.writeClipboard?.(term.getSelection());
          return false;
        }
        if ((ctrlOrCmd && !ev.altKey && key === 'v') || (ev?.shiftKey && key === 'insert')) {
          handlersRef.current.readClipboard?.().then((text) => {
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
      try { handlersRef.current.onPersistMeta?.(id, { title: nextTitle }); } catch {}
      try { handlersRef.current.onUpdateTerminalTitle?.(id, nextTitle); } catch {}
    });

    instancesRef.current.set(id, { term, fit, search, resultsDispose });
    openToContainerIfReady(id);
  }, [integratedSettings, openToContainerIfReady, theme]);

  const disposeXterm = useCallback((id) => {
    const key = String(id || '');
    if (!key) return;
    const inst = instancesRef.current.get(key);
    if (inst) {
      try { inst.resultsDispose?.dispose?.(); } catch {}
      try { inst.search?.dispose?.(); } catch {}
      try { inst.term.dispose(); } catch {}
      instancesRef.current.delete(key);
    }
    containersRef.current.delete(key);
  }, []);

  const resetAll = useCallback(() => {
    for (const [id, inst] of Array.from(instancesRef.current.entries())) {
      try { inst?.resultsDispose?.dispose?.(); } catch {}
      try { inst?.search?.dispose?.(); } catch {}
      try { inst?.term?.dispose?.(); } catch {}
      instancesRef.current.delete(id);
    }
    containersRef.current.clear();
  }, []);

  const fitAndResize = useCallback((ids) => {
    const sendNow = handlersRef.current.send;
    const list = Array.isArray(ids) ? ids.map((x) => String(x || '')).filter(Boolean) : [];
    for (const id of list) {
      const inst = instancesRef.current.get(id);
      if (!inst) continue;
      try {
        inst.fit.fit();
        sendNow?.({ type: 'resize', id, cols: inst.term.cols, rows: inst.term.rows });
      } catch {}
    }
  }, []);

  useEffect(() => {
    instancesRef.current.forEach((inst) => {
      try { inst.term.options.theme = theme; } catch {}
      try { inst.term.refresh(0, Math.max(0, inst.term.rows - 1)); } catch {}
    });
  }, [theme]);

  useEffect(() => {
    instancesRef.current.forEach((inst) => {
      try { inst.term.options.fontFamily = integratedSettings.fontFamily; } catch {}
      try { inst.term.options.fontSize = integratedSettings.fontSize; } catch {}
      try { inst.term.options.lineHeight = integratedSettings.lineHeight; } catch {}
      try { inst.term.options.cursorBlink = integratedSettings.cursorBlink; } catch {}
      try { inst.term.options.cursorStyle = integratedSettings.cursorStyle; } catch {}
      try { inst.term.options.scrollback = integratedSettings.scrollback; } catch {}
      try { inst.term.options.convertEol = integratedSettings.convertEol; } catch {}
      try { inst.term.refresh(0, Math.max(0, inst.term.rows - 1)); } catch {}
    });
  }, [
    integratedSettings.convertEol,
    integratedSettings.cursorBlink,
    integratedSettings.cursorStyle,
    integratedSettings.fontFamily,
    integratedSettings.fontSize,
    integratedSettings.lineHeight,
    integratedSettings.scrollback,
  ]);

  return {
    getInstance,
    setContainer,
    ensureXterm,
    openToContainerIfReady,
    disposeXterm,
    resetAll,
    fitAndResize,
  };
};

