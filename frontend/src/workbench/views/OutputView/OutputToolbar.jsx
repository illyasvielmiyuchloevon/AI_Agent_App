import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { outputService } from '../../services/outputService';

export default function OutputToolbar({
  channelId,
  channels: channelsProp,
  filter,
  onChangeChannel,
  onChangeFilter,
  onClear,
}) {
  const snap = useSyncExternalStore(outputService.subscribe, outputService.getSnapshot, outputService.getSnapshot);
  const bus = globalThis?.window?.electronAPI?.ideBus || null;
  const [traceMode, setTraceMode] = useState('slow');

  const channels = useMemo(() => {
    if (Array.isArray(channelsProp) && channelsProp.length) return channelsProp;
    const arr = Array.isArray(snap?.channels) ? snap.channels : [];
    return arr.map((c) => ({ id: c.id, label: c.label }));
  }, [channelsProp, snap?.channels]);

  const safeChannelId = useMemo(() => {
    const id = String(channelId || '').trim();
    if (!id && channels[0]) return channels[0].id;
    if (id && channels.some((c) => c.id === id)) return id;
    return channels[0]?.id || 'Workbench';
  }, [channelId, channels]);

  useEffect(() => {
    if (safeChannelId !== 'IdeBus') return undefined;
    if (!bus?.request) return undefined;
    let disposed = false;
    bus.request('telemetry/getRpcTraceConfig')
      .then((res) => {
        if (disposed) return;
        const mode = res?.config?.mode ? String(res.config.mode) : '';
        if (mode) setTraceMode(mode);
      })
      .catch(() => {});
    return () => { disposed = true; };
  }, [bus, safeChannelId]);

  const setMode = useCallback((nextMode) => {
    const next = String(nextMode || '').trim();
    if (!next) return;
    setTraceMode(next);
    if (!bus?.request) return;
    bus.request('telemetry/setRpcTraceConfig', { mode: next }).catch(() => {});
  }, [bus]);

  const dumpStats = useCallback(async () => {
    if (!bus?.request) return;
    const res = await bus.request('telemetry/getRpcStats').catch(() => null);
    const items = Array.isArray(res?.items) ? res.items : [];
    outputService.ensureChannel('IdeBus', 'IDE Bus');
    const lines = [];
    try {
      lines.push(`[stats] ${new Date().toLocaleTimeString()} items=${items.length}`);
    } catch {
      lines.push(`[stats] items=${items.length}`);
    }
    for (const s of items.slice(0, 30)) {
      const method = s?.method ? String(s.method) : '';
      if (!method) continue;
      const count = Number(s?.count) || 0;
      const avgMs = Number(s?.avgMs) || 0;
      const maxMs = Number(s?.maxMs) || 0;
      const ok = Number(s?.ok) || 0;
      const timeout = Number(s?.timeout) || 0;
      const cancelled = Number(s?.cancelled) || 0;
      const notFound = Number(s?.notFound) || 0;
      const error = Number(s?.error) || 0;
      lines.push(`${method} count=${count} avg=${avgMs}ms max=${maxMs}ms ok=${ok} err=${error} timeout=${timeout} cancelled=${cancelled} notFound=${notFound}`);
    }
    outputService.appendMany('IdeBus', lines, { label: 'IDE Bus' });
  }, [bus]);

  const resetStats = useCallback(async () => {
    if (!bus?.request) return;
    await bus.request('telemetry/resetRpcStats').catch(() => null);
    outputService.append('IdeBus', '[stats] reset', { label: 'IDE Bus' });
  }, [bus]);

  return (
    <>
      <select className="ghost-input bottom-panel-select" value={safeChannelId} onChange={(e) => onChangeChannel?.(e.target.value)} title="通道">
        {channels.map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </select>
      <div className="bottom-panel-tool">
        <span className="codicon codicon-filter" aria-hidden />
        <input
          className="ghost-input bottom-panel-filter"
          value={filter}
          onChange={(e) => onChangeFilter?.(e.target.value)}
          placeholder="筛选器"
          spellCheck={false}
        />
      </div>
      <button type="button" className="bottom-panel-icon-btn" onClick={() => onClear?.()} title="清空输出">
        <span className="codicon codicon-clear-all" aria-hidden />
      </button>
      {safeChannelId === 'IdeBus' && !!bus?.request ? (
        <>
          <select className="ghost-input bottom-panel-select" value={traceMode} onChange={(e) => setMode(e.target.value)} title="IDE Bus Trace">
            <option value="off">trace: off</option>
            <option value="slow">trace: slow</option>
            <option value="all">trace: all</option>
          </select>
          <button type="button" className="bottom-panel-icon-btn" onClick={dumpStats} title="输出 RPC 统计">
            <span className="codicon codicon-graph" aria-hidden />
          </button>
          <button type="button" className="bottom-panel-icon-btn" onClick={resetStats} title="重置 RPC 统计">
            <span className="codicon codicon-refresh" aria-hidden />
          </button>
        </>
      ) : null}
    </>
  );
}
