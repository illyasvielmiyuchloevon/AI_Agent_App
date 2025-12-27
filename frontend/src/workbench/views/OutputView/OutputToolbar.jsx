import React, { useMemo } from 'react';
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
    </>
  );
}
