import React, { useMemo } from 'react';

function severityIcon(severity) {
  if (severity === 'error') return 'codicon-error';
  if (severity === 'warning') return 'codicon-warning';
  return 'codicon-info';
}

export default function ProblemsView({ items = [], filter = '', onOpenLocation }) {
  const filtered = useMemo(() => {
    const q = String(filter || '').trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const hay = `${it.message || ''} ${it.source || ''} ${it.file || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, filter]);

  if (!filtered.length) {
    return (
      <div className="panel-empty">
        <div className="panel-empty-title">未在工作区检测到问题。</div>
        <div className="panel-empty-subtitle">来自语言服务/构建/任务的诊断会汇总在这里。</div>
      </div>
    );
  }

  return (
    <div className="panel-list">
      {filtered.map((it) => (
        <button
          key={it.id}
          type="button"
          className="panel-list-row"
          onClick={() => onOpenLocation?.(it)}
          title={it.message}
        >
          <span className={`codicon ${severityIcon(it.severity)}`} aria-hidden />
          <div className="panel-list-main">
            <div className="panel-list-title">{it.message}</div>
            <div className="panel-list-meta">
              <span className="panel-list-file">{it.file}</span>
              {it.line != null ? <span className="panel-list-pos">:{it.line}:{it.col || 1}</span> : null}
              {it.source ? <span className="panel-list-source">{it.source}</span> : null}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

