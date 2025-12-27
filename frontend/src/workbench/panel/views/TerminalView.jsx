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

const readCssVar = (name, fallback) => {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

function TerminalView({ workspacePath = '', onStateChange, autoConnect = true }, ref) {
  const wsRef = useRef(null);
  const pendingCreateRef = useRef(new Map());
  const instanceRef = useRef(new Map()); // id -> { term, fit }
  const containerRef = useRef(new Map()); // id -> HTMLElement
  const resizeObsRef = useRef(null);
  const fitRafRef = useRef(0);
  const mainPaneRef = useRef(null);
  const bootstrappedRef = useRef(false);
  const connectLoopRef = useRef({ running: false, timer: 0, abort: null });

  const [connected, setConnected] = useState(false);
  const [terminals, setTerminals] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [scrollLock, setScrollLock] = useState(false);

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
    };
  }, []);

  const emitState = useCallback((next) => {
    onStateChange?.(next);
  }, [onStateChange]);

  useEffect(() => {
    emitState({ connected, terminals, activeId, scrollLock });
  }, [connected, terminals, activeId, scrollLock, emitState]);

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

  const ensureXterm = useCallback((meta) => {
    if (!meta?.id) return;
    if (instanceRef.current.has(meta.id)) return;

    const term = new Terminal({
      fontFamily: 'Consolas, ui-monospace, SFMono-Regular, Menlo, Monaco, "Liberation Mono", "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
      convertEol: true,
      theme,
      scrollback: 4000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);

    term.onData((data) => {
      send({ type: 'input', id: meta.id, data });
    });

    instanceRef.current.set(meta.id, { term, fit });
  }, [send, theme]);

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
    if (!activeId) return;
    const inst = instanceRef.current.get(activeId);
    if (!inst) return;
    try {
      inst.fit.fit();
      send({ type: 'resize', id: activeId, cols: inst.term.cols, rows: inst.term.rows });
    } catch {}
  }, [activeId, send]);

  const createTerminal = useCallback(async (profile = DEFAULT_PROFILE) => {
    const reqId = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const ok = send({
      type: 'create',
      requestId: reqId,
      profile,
      cwd: workspacePath || '',
      cols: 80,
      rows: 24,
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
  }, [send, workspacePath]);

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

  useImperativeHandle(ref, () => ({
    createTerminal,
    killActive,
    disposeTerminal,
    setActive: (id) => setActiveId(String(id || '')),
    toggleScrollLock,
    focus: () => {
      const inst = instanceRef.current.get(activeId);
      inst?.term?.focus?.();
    },
    getState: () => ({ connected, terminals, activeId, scrollLock }),
  }), [activeId, connected, createTerminal, disposeTerminal, killActive, scrollLock, terminals, toggleScrollLock]);

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
      bootstrappedRef.current = false;

      ws.onopen = () => {
        setConnected(true);
        send({ type: 'list', requestId: 'boot' });
        if (!bootstrappedRef.current) {
          bootstrappedRef.current = true;
          createTerminal(DEFAULT_PROFILE).catch(() => {});
        }
      };

      ws.onclose = () => {
        setConnected(false);
      };

      ws.onerror = () => {
        setConnected(false);
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
          const items = msg.terminals
            .map((t) => ({
              id: String(t.id || ''),
              pid: Number(t.pid || 0),
              title: String(t.title || DEFAULT_PROFILE),
              profile: String(t.profile || DEFAULT_PROFILE),
              cwd: String(t.cwd || ''),
            }))
            .filter((t) => t.id);
          setTerminals(items.map((t, idx) => ({ ...t, label: `${t.title || t.profile || DEFAULT_PROFILE} (${idx + 1})` })));
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
    if (!activeId) return;
    openToContainerIfReady(activeId);
    fitActive();
    const inst = instanceRef.current.get(activeId);
    inst?.term?.focus?.();
  }, [activeId, fitActive, openToContainerIfReady]);

  const activeMeta = useMemo(() => terminals.find((t) => t.id === activeId) || null, [terminals, activeId]);
  const showSideList = terminals.length > 1;

  if (typeof window === 'undefined') return null;

  return (
    <div className={`vscode-terminal-shell ${showSideList ? 'multi' : 'single'}`}>
      <div className="vscode-terminal-main" ref={mainPaneRef}>
        {terminals.map((t) => (
          <div
            key={t.id}
            className="vscode-terminal-instance"
            style={{ display: t.id === activeId ? 'block' : 'none' }}
            ref={(el) => {
              if (!el) return;
              containerRef.current.set(t.id, el);
              openToContainerIfReady(t.id);
            }}
            aria-label={`terminal-${t.title || t.id}`}
          />
        ))}
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
              <button
                key={t.id}
                type="button"
                className={`vscode-terminal-item ${t.id === activeId ? 'active' : ''}`}
                onClick={() => setActiveId(t.id)}
                title={t.cwd || t.title}
              >
                <span className="codicon codicon-terminal" aria-hidden />
                <span className="vscode-terminal-item-title">{t.label || t.title || t.profile || `terminal-${idx + 1}`}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default forwardRef(TerminalView);
