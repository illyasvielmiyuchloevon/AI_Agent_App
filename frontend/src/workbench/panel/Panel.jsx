import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PanelTabs from './PanelTabs';
import PanelViewManager from './PanelViewManager';
import ProblemsView from './views/ProblemsView';
import OutputView from './views/OutputView';
import DebugConsoleView from './views/DebugConsoleView';
import TerminalView from './views/TerminalView';
import PortsView from './views/PortsView';
import ExtensionViews from './views/ExtensionViews';

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

export default function Panel({ workspacePath = '' }) {
  const minHeight = 160;
  const tabbarHeight = 30;

  const [activeViewId, setActiveViewId] = useState(() => readString(STORAGE.active, 'terminal'));
  const [collapsed, setCollapsed] = useState(() => readBool(STORAGE.collapsed, false));
  const [hidden, setHidden] = useState(() => readBool(STORAGE.hidden, false));
  const [maximized, setMaximized] = useState(() => readBool(STORAGE.maximized, false));
  const [height, setHeight] = useState(() => clamp(readNumber(STORAGE.height, 240), minHeight, 520));

  const lastHeightRef = useRef(height);
  const panelRef = useRef(null);

  const [problemsFilter, setProblemsFilter] = useState('');
  const [problemsItems] = useState(() => []);

  const [outputChannel, setOutputChannel] = useState('任务');
  const [outputFilter, setOutputFilter] = useState('');
  const [outputLines, setOutputLines] = useState(() => []);

  const [debugSessionActive, setDebugSessionActive] = useState(false);
  const [debugLines, setDebugLines] = useState(() => []);
  const [debugInput, setDebugInput] = useState('');

  const [ports, setPorts] = useState(() => []);
  const terminalRef = useRef(null);
  const [terminalUi, setTerminalUi] = useState(() => ({ connected: false, terminals: [], activeId: '', scrollLock: false }));
  const [terminalCreateProfile, setTerminalCreateProfile] = useState('cmd');
  const terminalHadAnyRef = useRef(false);
  const terminalAutoCreateInFlightRef = useRef(false);
  const terminalCloseOnEmptyRef = useRef(false);
  const terminalPrevCountRef = useRef(0);

  const [gitLensState, setGitLensState] = useState(() => ({ commits: null, activeCommit: null }));

  useEffect(() => writeValue(STORAGE.active, activeViewId), [activeViewId]);
  useEffect(() => writeValue(STORAGE.collapsed, collapsed ? '1' : '0'), [collapsed]);
  useEffect(() => writeValue(STORAGE.hidden, hidden ? '1' : '0'), [hidden]);
  useEffect(() => writeValue(STORAGE.maximized, maximized ? '1' : '0'), [maximized]);
  useEffect(() => writeValue(STORAGE.height, height), [height]);

  useEffect(() => {
    if (!collapsed && !maximized) lastHeightRef.current = height;
  }, [collapsed, maximized, height]);

  const views = useMemo(() => ([
    { id: 'problems', label: '问题' },
    { id: 'output', label: '输出' },
    { id: 'debugConsole', label: '调试控制台' },
    { id: 'terminal', label: '终端' },
    { id: 'ports', label: '端口' },
    { id: 'gitlens', label: 'GITLENS' },
  ]), []);

  const activeView = useMemo(() => {
    const m = new Map([
      ['problems', ProblemsView],
      ['output', OutputView],
      ['debugConsole', DebugConsoleView],
      ['terminal', TerminalView],
      ['ports', PortsView],
      ['gitlens', ExtensionViews],
    ]);
    const Component = m.get(activeViewId) || TerminalView;
    const maybeRef = activeViewId === 'terminal' ? terminalRef : null;
    return { id: activeViewId, Component, ref: maybeRef };
  }, [activeViewId]);

  const viewPropsById = useMemo(() => ({
    problems: {
      items: problemsItems,
      filter: problemsFilter,
      onOpenLocation: () => {},
    },
    output: {
      lines: outputLines,
      filter: outputFilter,
    },
    debugConsole: {
      sessionActive: debugSessionActive,
      lines: debugLines,
      inputValue: debugInput,
      onChangeInput: setDebugInput,
      onSubmitExpression: (expr) => {
        setDebugLines((prev) => [...prev, `> ${expr}`, 'undefined']);
        setDebugInput('');
      },
    },
    terminal: {
      workspacePath,
      onStateChange: setTerminalUi,
    },
    ports: {
      ports,
      onForwardPort: () => {
        setPorts((prev) => {
          const nextPort = 3000 + prev.length;
          return [...prev, { host: 'localhost', port: nextPort, visibility: 'Local', label: `Forwarded ${nextPort}` }];
        });
      },
    },
    gitlens: {
      extensionKey: 'gitlens',
      state: gitLensState,
      onChangeState: setGitLensState,
    },
  }), [
    problemsItems,
    problemsFilter,
    outputLines,
    outputFilter,
    debugSessionActive,
    debugLines,
    debugInput,
    workspacePath,
    ports,
    gitLensState,
  ]);

  const ensureVisible = useCallback(() => {
    if (hidden) setHidden(false);
    if (collapsed) setCollapsed(false);
  }, [hidden, collapsed]);

  const onSelectView = useCallback((id) => {
    setActiveViewId(id);
    ensureVisible();
  }, [ensureVisible]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      if (!next) setHidden(false);
      return next;
    });
  }, []);

  const onClose = useCallback(() => {
    setHidden(true);
    setMaximized(false);
    setCollapsed(false);
  }, []);

  useEffect(() => {
    const n = terminalUi?.terminals?.length || 0;
    if (n > 0) terminalHadAnyRef.current = true;
  }, [terminalUi?.terminals?.length]);

  useEffect(() => {
    const n = terminalUi?.terminals?.length || 0;
    const prev = terminalPrevCountRef.current;
    terminalPrevCountRef.current = n;
    if (n > 0) {
      terminalCloseOnEmptyRef.current = false;
      return;
    }
    if (!terminalCloseOnEmptyRef.current) return;
    if (prev <= 0) return;
    terminalCloseOnEmptyRef.current = false;
    onClose();
  }, [terminalUi?.terminals?.length, onClose]);

  useEffect(() => {
    const n = terminalUi?.terminals?.length || 0;
    if (activeViewId !== 'terminal' || hidden || collapsed) {
      terminalAutoCreateInFlightRef.current = false;
      return;
    }
    if (!terminalUi?.connected) {
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
      .then(() => terminalRef.current?.createTerminal?.(terminalCreateProfile))
      .catch(() => {
        // allow retry later (e.g. backend still warming up)
        terminalAutoCreateInFlightRef.current = false;
      });
  }, [activeViewId, collapsed, hidden, terminalCreateProfile, terminalUi?.connected, terminalUi?.terminals?.length]);

  const toggleMaximize = useCallback(() => {
    const parentRect = panelRef.current?.parentElement?.getBoundingClientRect?.();
    const max = parentRect ? Math.max(minHeight, Math.floor(parentRect.height - 120)) : 520;
    setHidden(false);
    setCollapsed(false);
    setMaximized((prev) => {
      const next = !prev;
      if (next) {
        lastHeightRef.current = height;
        setHeight(clamp(max, minHeight, 9999));
      } else {
        setHeight(clamp(lastHeightRef.current || 240, minHeight, max));
      }
      return next;
    });
  }, [height, minHeight]);

  const onResizerPointerDown = useCallback((e) => {
    if (maximized || hidden) return;
    if (e.button !== 0) return;
    e.preventDefault();
    ensureVisible();

    const parentRect = panelRef.current?.parentElement?.getBoundingClientRect?.();
    const maxHeight = parentRect ? Math.max(minHeight, Math.floor(parentRect.height - 120)) : 520;
    const startY = e.clientY;
    const startHeight = collapsed ? (lastHeightRef.current || height) : height;

    setCollapsed(false);

    const onMove = (ev) => {
      const delta = startY - ev.clientY;
      setHeight(clamp(startHeight + delta, minHeight, maxHeight));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [collapsed, ensureVisible, height, hidden, maximized, minHeight]);

  const renderToolbar = () => {
    if (activeViewId === 'problems') {
      return (
        <>
          <div className="bottom-panel-tool">
            <span className="codicon codicon-filter" aria-hidden />
            <input
              className="ghost-input bottom-panel-filter"
              value={problemsFilter}
              onChange={(e) => setProblemsFilter(e.target.value)}
              placeholder="筛选器"
              spellCheck={false}
            />
          </div>
        </>
      );
    }

    if (activeViewId === 'output') {
      return (
        <>
          <select
            className="ghost-input bottom-panel-select"
            value={outputChannel}
            onChange={(e) => setOutputChannel(e.target.value)}
            title="通道"
          >
            <option value="任务">任务</option>
            <option value="扩展">扩展</option>
            <option value="工作台">工作台</option>
          </select>
          <div className="bottom-panel-tool">
            <span className="codicon codicon-filter" aria-hidden />
            <input
              className="ghost-input bottom-panel-filter"
              value={outputFilter}
              onChange={(e) => setOutputFilter(e.target.value)}
              placeholder="筛选器"
              spellCheck={false}
            />
          </div>
          <button
            type="button"
            className="bottom-panel-icon-btn"
            onClick={() => setOutputLines([])}
            title="清空输出"
          >
            <span className="codicon codicon-clear-all" aria-hidden />
          </button>
        </>
      );
    }

    if (activeViewId === 'debugConsole') {
      return (
        <>
          <button
            type="button"
            className="bottom-panel-icon-btn"
            onClick={() => setDebugLines([])}
            title="清空"
          >
            <span className="codicon codicon-clear-all" aria-hidden />
          </button>
          <button
            type="button"
            className={`bottom-panel-icon-btn ${debugSessionActive ? 'active' : ''}`}
            onClick={() => setDebugSessionActive((prev) => !prev)}
            title={debugSessionActive ? '结束调试会话（模拟）' : '开始调试会话（模拟）'}
          >
            <span className="codicon codicon-debug-start" aria-hidden />
          </button>
        </>
      );
    }

    if (activeViewId === 'terminal') {
      return (
        <>
          <button
            type="button"
            className="bottom-panel-icon-btn"
            onClick={() => {
              terminalRef.current?.createTerminal?.(terminalCreateProfile).catch?.(() => {});
            }}
            title="新建终端"
          >
            <span className="codicon codicon-add" aria-hidden />
          </button>
          <select
            className="ghost-input bottom-panel-select"
            value={terminalCreateProfile}
            onChange={(e) => setTerminalCreateProfile(e.target.value)}
            title="默认 Profile"
          >
            <option value="cmd">cmd</option>
            <option value="powershell">powershell</option>
            <option value="bash">bash</option>
          </select>
          <select
            className="ghost-input bottom-panel-select"
            value={terminalUi.activeId || ''}
            onChange={(e) => terminalRef.current?.setActive?.(e.target.value)}
            title="终端实例"
          >
            {(terminalUi.terminals || []).map((t, idx) => (
              <option key={t.id} value={t.id}>{t.label || t.title || t.profile || `terminal-${idx + 1}`}</option>
            ))}
          </select>
          <button
            type="button"
            className={`bottom-panel-icon-btn ${terminalUi.scrollLock ? 'active' : ''}`}
            onClick={() => terminalRef.current?.toggleScrollLock?.()}
            title={terminalUi.scrollLock ? '取消滚动锁定' : '滚动锁定'}
          >
            <span className={`codicon ${terminalUi.scrollLock ? 'codicon-debug-continue' : 'codicon-debug-pause'}`} aria-hidden />
          </button>
          <button
            type="button"
            className="bottom-panel-icon-btn"
            onClick={() => {
              const count = terminalUi?.terminals?.length || 0;
              if (count <= 1) terminalCloseOnEmptyRef.current = true;
              terminalRef.current?.killActive?.();
            }}
            title="删除终端"
          >
            <span className="codicon codicon-trash" aria-hidden />
          </button>
        </>
      );
    }

    if (activeViewId === 'ports') {
      return (
        <>
          <button type="button" className="bottom-panel-icon-btn" onClick={() => viewPropsById.ports.onForwardPort()} title="转发端口">
            <span className="codicon codicon-add" aria-hidden />
          </button>
        </>
      );
    }

    return null;
  };

  const appliedHeight = hidden ? 22 : (collapsed ? tabbarHeight : height);

  return (
    <div
      ref={panelRef}
      className={`bottom-panel ${collapsed ? 'collapsed' : ''} ${maximized ? 'maximized' : ''} ${hidden ? 'hidden' : ''}`}
      style={{ height: appliedHeight }}
    >
      {!hidden ? <div className="bottom-panel-resizer" onPointerDown={onResizerPointerDown} title="拖动调整高度" /> : null}
      {hidden ? (
        <div className="bottom-panel-hidden">
          <button type="button" className="bottom-panel-hidden-btn" onClick={() => setHidden(false)}>
            <span className="codicon codicon-chevron-up" aria-hidden />
            打开面板
          </button>
          <div className="bottom-panel-hidden-meta">{views.find((v) => v.id === activeViewId)?.label || 'Panel'}</div>
        </div>
      ) : (
        <div className="bottom-panel-bar">
          <PanelTabs views={views} activeViewId={activeViewId} onSelectView={onSelectView} />
          <div className="bottom-panel-tools">
            {renderToolbar()}
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
        <div className="bottom-panel-terminal-host" style={{ display: activeViewId === 'terminal' ? 'block' : 'none' }}>
          <TerminalView ref={terminalRef} {...viewPropsById.terminal} />
        </div>
        {activeViewId !== 'terminal' ? <PanelViewManager activeView={activeView} viewPropsById={viewPropsById} /> : null}
      </div>
    </div>
  );
}
