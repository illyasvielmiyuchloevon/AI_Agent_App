import React, { useMemo } from 'react';

export default function OutputView({ lines = [], filter = '' }) {
  const filtered = useMemo(() => {
    const q = String(filter || '').trim().toLowerCase();
    if (!q) return lines;
    return lines.filter((line) => String(line).toLowerCase().includes(q));
  }, [lines, filter]);

  if (!filtered.length) {
    return (
      <div className="panel-empty">
        <div className="panel-empty-title">输出为空。</div>
        <div className="panel-empty-subtitle">选择通道并运行任务/扩展以产生日志。</div>
      </div>
    );
  }

  return (
    <pre className="panel-mono">
      {filtered.join('\n')}
    </pre>
  );
}

