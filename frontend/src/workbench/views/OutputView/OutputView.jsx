import React, { useMemo } from 'react';
import { List } from 'react-window';
import { useSyncExternalStore } from 'react';
import { outputService } from '../../services/outputService';

const RowHeight = 20;

export default function OutputView({ channelId = 'Workbench', filter = '' }) {
  useSyncExternalStore(outputService.subscribe, outputService.getSnapshot, outputService.getSnapshot);
  const all = outputService.getChannelLines(channelId);

  const filtered = useMemo(() => {
    const q = String(filter || '').trim().toLowerCase();
    if (!q) return all;
    return all.filter((l) => String(l).toLowerCase().includes(q));
  }, [all, filter]);

  if (!filtered.length) {
    return (
      <div className="panel-empty">
        <div className="panel-empty-title">输出为空。</div>
        <div className="panel-empty-subtitle">该视图聚合只读日志流（按通道）。</div>
      </div>
    );
  }

  const Row = ({ index, style }) => (
    <div style={{ ...style, height: RowHeight }} className="panel-mono">
      {filtered[index]}
    </div>
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <List
        defaultHeight={240}
        overscanCount={8}
        style={{ height: '100%', width: '100%' }}
        rowCount={filtered.length}
        rowHeight={RowHeight}
        rowComponent={Row}
        rowProps={{}}
      />
    </div>
  );
}
