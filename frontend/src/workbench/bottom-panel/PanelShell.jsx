import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import PanelTabBar from './PanelTabBar';
import PanelViewHost from './PanelViewHost';
import PanelToolbarHost from './PanelToolbarHost';
import { panelStore } from './panelStore';
import { viewRegistry } from './viewRegistry';
import { outputService } from '../services/outputService';
import { portsService } from '../services/portsService';
import { gitService } from '../services/gitService';
import { debugService } from '../services/debugService';

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const shallowEqual = (a, b) => {
  if (Object.is(a, b)) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
};

export default function PanelShell({ workspacePath = '', onOpenFile }) {
  const state = useSyncExternalStore(panelStore.subscribe, panelStore.getSnapshot, panelStore.getSnapshot);
  const { activeViewId, collapsed, hidden, maximized, height } = state;

  const panelRef = useRef(null);
  const lastHeightRef = useRef(height);
  const [isResizing, setIsResizing] = useState(false);

  const terminalRef = useRef(null);
  const terminalAutoCreateInFlightRef = useRef(false);
  const terminalCloseOnEmptyRef = useRef(false);
  const terminalPrevCountRef = useRef(0);
  const [terminalUi, setTerminalUi] = useState({ connected: false, listed: false, terminals: [], activeId: '', scrollLock: false, profile: 'cmd' });

  const [problemsFilter, setProblemsFilter] = useState('');
  const [outputChannelId, setOutputChannelId] = useState('Workbench');
  const [outputFilter, setOutputFilter] = useState('');

  useEffect(() => {
    outputService.installConsoleCapture();
    outputService.ensureChannel('Tasks', '任务');
    outputService.ensureChannel('Extensions', '扩展');
    outputService.ensureChannel('Git', 'Git');
  }, []);

  const mergeTerminalUi = useCallback((patch) => {
    setTerminalUi((prev) => {
      const next = { ...(prev || {}), ...(patch || {}) };
      return shallowEqual(prev, next) ? prev : next;
    });
  }, []);

  const onTerminalStateChange = useCallback((next) => {
    mergeTerminalUi(next || {});
  }, [mergeTerminalUi]);

  useEffect(() => {
    if (!collapsed && !maximized) lastHeightRef.current = height;
  }, [collapsed, maximized, height]);

  const views = useMemo(() => viewRegistry.list(), []);
  const activeView = useMemo(() => views.find((v) => v.id === activeViewId) || views.find((v) => v.id === 'terminal') || views[0], [activeViewId, views]);

  const ensureVisible = useCallback(() => {
    if (panelStore.getSnapshot().hidden) panelStore.setState({ hidden: false });
    if (panelStore.getSnapshot().collapsed) panelStore.setState({ collapsed: false });
  }, []);

  const onSelectView = useCallback((id) => {
    panelStore.setState({ activeViewId: id });
    ensureVisible();
  }, [ensureVisible]);

  const onClose = useCallback(() => {
    panelStore.setState({ hidden: true, maximized: false, collapsed: false });
  }, []);

  const toggleCollapsed = useCallback(() => {
    const prev = panelStore.getSnapshot();
    const next = !prev.collapsed;
    panelStore.setState({ collapsed: next, hidden: next ? prev.hidden : false });
  }, []);

  const toggleMaximize = useCallback(() => {
    const parentRect = panelRef.current?.parentElement?.getBoundingClientRect?.();
    const minHeight = 160;
    const max = parentRect ? Math.max(minHeight, Math.floor(parentRect.height - 6)) : 520;
    const prev = panelStore.getSnapshot();
    const next = !prev.maximized;
    ensureVisible();
    if (next) {
      lastHeightRef.current = prev.height;
      panelStore.setState({ maximized: true, height: clamp(max, minHeight, 9999), collapsed: false, hidden: false });
    } else {
      panelStore.setState({ maximized: false, height: clamp(lastHeightRef.current || 240, minHeight, max), collapsed: false, hidden: false });
    }
  }, [ensureVisible]);

  const onResizerPointerDown = useCallback((e) => {
    if (maximized || hidden) return;
    if (e.button !== 0) return;
    e.preventDefault();
    ensureVisible();

    const minHeight = 160;
    const parentRect = panelRef.current?.parentElement?.getBoundingClientRect?.();
    const maxHeight = parentRect ? Math.max(minHeight, Math.floor(parentRect.height - 6)) : 520;
    const startY = e.clientY;
    const startHeight = collapsed ? (lastHeightRef.current || height) : height;
    let pending = startHeight;
    let lastApplied = startHeight;
    let rafId = 0;

    panelStore.setState({ collapsed: false });
    setIsResizing(true);

    const apply = () => {
      rafId = 0;
      const el = panelRef.current;
      if (!el) return;
      el.style.height = `${pending}px`;
      lastApplied = pending;
    };

    const onMove = (ev) => {
      const delta = startY - ev.clientY;
      pending = clamp(startHeight + delta, minHeight, maxHeight);
      if (!rafId) rafId = window.requestAnimationFrame(apply);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      lastApplied = pending;
      const el = panelRef.current;
      if (el) el.style.height = '';
      setIsResizing(false);
      panelStore.setState({ height: lastApplied, collapsed: false });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [collapsed, ensureVisible, height, hidden, maximized]);

  const viewRefsById = useMemo(() => ({
    terminal: terminalRef,
  }), []);

  const viewPropsById = useMemo(() => ({
    problems: { filter: problemsFilter, onOpenFile },
    output: { channelId: outputChannelId, filter: outputFilter },
    debugConsole: {},
    terminal: {
      workspacePath,
      onStateChange: onTerminalStateChange,
      terminalRef,
      autoConnect: activeViewId === 'terminal' && !hidden && !collapsed,
      isResizing,
    },
    ports: {},
    gitlens: { workspacePath, onOpenFile, isResizing },
  }), [activeViewId, collapsed, hidden, isResizing, onOpenFile, onTerminalStateChange, outputChannelId, outputFilter, problemsFilter, workspacePath]);

  const toolbarPropsById = useMemo(() => ({
    problems: {
      filter: problemsFilter,
      onChangeFilter: setProblemsFilter,
      onClearFilter: () => setProblemsFilter(''),
    },
    output: {
      channelId: outputChannelId,
      filter: outputFilter,
      onChangeChannel: setOutputChannelId,
      onChangeFilter: setOutputFilter,
      onClear: () => outputService.clear(outputChannelId),
    },
    debugConsole: {
      onClear: () => debugService.clear(),
    },
    terminal: {
      terminal: {
        terminalRef,
        getTerminalUi: () => terminalUi,
        setTerminalUi: (patch) => mergeTerminalUi(patch || {}),
        onCloseOnEmpty: () => { terminalCloseOnEmptyRef.current = true; },
      },
    },
    ports: {
      ports: {
        refresh: () => portsService.refresh().catch(() => {}),
      },
    },
    gitlens: {
      gitlens: {
        refresh: () => gitService.refresh({ cwd: workspacePath }).catch(() => {}),
      },
    },
  }), [mergeTerminalUi, outputChannelId, outputFilter, problemsFilter, terminalUi, workspacePath]);

  useEffect(() => {
    const ui = terminalUi || {};
    const n = ui.terminals?.length || 0;
    const prev = terminalPrevCountRef.current;
    terminalPrevCountRef.current = n;
    if (n > 0) {
      terminalCloseOnEmptyRef.current = false;
      terminalAutoCreateInFlightRef.current = false;
      return;
    }
    if (!terminalCloseOnEmptyRef.current) return;
    if (prev <= 0) return;
    terminalCloseOnEmptyRef.current = false;
    onClose();
  });

  useEffect(() => {
    const ui = terminalUi || {};
    const n = ui.terminals?.length || 0;
    if (activeViewId !== 'terminal' || hidden || collapsed) {
      terminalAutoCreateInFlightRef.current = false;
      return;
    }
    if (!ui.connected || !ui.listed) {
      terminalAutoCreateInFlightRef.current = false;
      return;
    }
    if (terminalCloseOnEmptyRef.current) return;
    if (n > 0) {
      terminalAutoCreateInFlightRef.current = false;
      return;
    }
    if (terminalAutoCreateInFlightRef.current) return;
    terminalAutoCreateInFlightRef.current = true;
    Promise.resolve()
      .then(() => terminalRef.current?.createTerminal?.(ui.profile || 'cmd'))
      .catch(() => { terminalAutoCreateInFlightRef.current = false; });
  }, [activeViewId, collapsed, hidden, terminalUi]);

  const tabbarHeight = 30;
  const appliedHeight = hidden ? 22 : (collapsed ? tabbarHeight : height);

  return (
    <div
      ref={panelRef}
      className={`bottom-panel ${collapsed ? 'collapsed' : ''} ${maximized ? 'maximized' : ''} ${hidden ? 'hidden' : ''} ${isResizing ? 'resizing' : ''}`}
      style={{ height: appliedHeight }}
    >
      {!hidden ? <div className="bottom-panel-resizer" onPointerDown={onResizerPointerDown} title="拖动调整高度" /> : null}
      {hidden ? (
        <div className="bottom-panel-hidden">
          <button type="button" className="bottom-panel-hidden-btn" onClick={() => panelStore.setState({ hidden: false })}>
            <span className="codicon codicon-chevron-up" aria-hidden />
            打开面板
          </button>
          <div className="bottom-panel-hidden-meta">{views.find((v) => v.id === activeViewId)?.label || 'Panel'}</div>
        </div>
      ) : (
        <div className="bottom-panel-bar">
          <PanelTabBar views={views} activeId={activeViewId} onSelect={onSelectView} />
          <div className="bottom-panel-tools">
            <PanelToolbarHost activeView={activeView} viewPropsById={toolbarPropsById} />
            <span className="bottom-panel-sep" aria-hidden />
            <button type="button" className="bottom-panel-icon-btn" onClick={toggleCollapsed} title={collapsed ? '展开面板' : '折叠面板'}>
              <span className={`codicon ${collapsed ? 'codicon-chevron-up' : 'codicon-chevron-down'}`} aria-hidden />
            </button>
            <button type="button" className={`bottom-panel-icon-btn ${maximized ? 'active' : ''}`} onClick={toggleMaximize} title={maximized ? '还原' : '最大化'}>
              <span className={`codicon ${maximized ? 'codicon-screen-normal' : 'codicon-screen-full'}`} aria-hidden />
            </button>
            <button type="button" className="bottom-panel-icon-btn" onClick={onClose} title="关闭面板">
              <span className="codicon codicon-close" aria-hidden />
            </button>
          </div>
        </div>
      )}

      <div className="bottom-panel-content">
        <PanelViewHost
          views={views}
          activeId={activeViewId}
          viewPropsById={viewPropsById}
          viewRefsById={viewRefsById}
        />
      </div>
    </div>
  );
}
