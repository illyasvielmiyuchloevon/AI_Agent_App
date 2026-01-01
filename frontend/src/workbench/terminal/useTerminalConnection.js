import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getTerminalPingUrl, getTerminalStateUrl, getTerminalWsUrl } from './terminalUrls';

export const useTerminalConnection = ({
  workspacePath = '',
  autoConnect = true,
  onMessage,
  onReset,
  onOpen,
  onClose,
  stateSync,
}) => {
  const wsRef = useRef(null);
  const wsUrlRef = useRef('');
  const connectLoopRef = useRef({ running: false, timer: 0, abort: null });
  const [connected, setConnected] = useState(false);

  const handlersRef = useRef({
    onMessage: null,
    onReset: null,
    onOpen: null,
    onClose: null,
    onRemoteState: null,
  });

  handlersRef.current.onMessage = typeof onMessage === 'function' ? onMessage : null;
  handlersRef.current.onReset = typeof onReset === 'function' ? onReset : null;
  handlersRef.current.onOpen = typeof onOpen === 'function' ? onOpen : null;
  handlersRef.current.onClose = typeof onClose === 'function' ? onClose : null;
  handlersRef.current.onRemoteState = typeof stateSync?.onRemoteState === 'function' ? stateSync.onRemoteState : null;

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

  const closeWs = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    wsUrlRef.current = '';
    setConnected(false);
    try { ws?.close?.(); } catch {}
  }, []);

  const stateUrl = useMemo(() => getTerminalStateUrl(), []);

  useEffect(() => {
    const onRemoteState = handlersRef.current.onRemoteState;
    if (!onRemoteState) return undefined;
    if (!stateUrl || !workspacePath) return undefined;

    const ctl = new AbortController();
    fetch(stateUrl, {
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
        try { onRemoteState(data); } catch {}
      })
      .catch(() => {});

    return () => {
      try { ctl.abort(); } catch {}
    };
  }, [stateUrl, workspacePath, stateSync?.enabled]);

  useEffect(() => {
    if (!stateSync?.enabled) return undefined;
    if (!stateUrl || !workspacePath) return undefined;

    const payload = stateSync?.payload;
    if (!payload || typeof payload !== 'object') return undefined;

    const t = window.setTimeout(() => {
      fetch(stateUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-workspace-root': String(workspacePath || ''),
        },
        body: JSON.stringify({ ...payload, updatedAt: Date.now() }),
      }).catch(() => {});
    }, 500);

    return () => window.clearTimeout(t);
  }, [stateUrl, stateSync?.enabled, stateSync?.payload, workspacePath]);

  useEffect(() => {
    const url = getTerminalWsUrl(workspacePath);
    if (!url) return undefined;
    if (!autoConnect) return undefined;

    if (connectLoopRef.current.running && wsUrlRef.current && wsUrlRef.current !== url) {
      try { window.clearTimeout(connectLoopRef.current.timer); } catch {}
      connectLoopRef.current.timer = 0;
      try { connectLoopRef.current.abort?.abort?.(); } catch {}
      connectLoopRef.current.abort = null;
      connectLoopRef.current.running = false;
    }

    if (wsRef.current && wsUrlRef.current === url) return undefined;

    if (wsRef.current && wsUrlRef.current && wsUrlRef.current !== url) {
      closeWs();
      try { handlersRef.current.onReset?.(); } catch {}
    }

    if (connectLoopRef.current.running) return undefined;
    connectLoopRef.current.running = true;
    wsUrlRef.current = url;

    const pingUrl = getTerminalPingUrl();
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

      ws.onopen = () => {
        setConnected(true);
        try { handlersRef.current.onOpen?.({ send }); } catch {}
      };

      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        setConnected(false);
        try { handlersRef.current.onClose?.(); } catch {}
      };

      ws.onerror = () => {
        if (wsRef.current === ws) wsRef.current = null;
        setConnected(false);
        try { handlersRef.current.onClose?.(); } catch {}
      };

      ws.onmessage = (ev) => {
        let msg;
        try {
          msg = JSON.parse(String(ev.data || ''));
        } catch {
          return;
        }
        if (!msg || typeof msg !== 'object') return;
        try { handlersRef.current.onMessage?.(msg); } catch {}
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
  }, [autoConnect, closeWs, send, workspacePath]);

  useEffect(() => () => {
    try { window.clearTimeout(connectLoopRef.current.timer); } catch {}
    connectLoopRef.current.timer = 0;
    try { connectLoopRef.current.abort?.abort?.(); } catch {}
    connectLoopRef.current.abort = null;
    closeWs();
  }, [closeWs]);

  return {
    connected,
    send,
    close: closeWs,
  };
};

