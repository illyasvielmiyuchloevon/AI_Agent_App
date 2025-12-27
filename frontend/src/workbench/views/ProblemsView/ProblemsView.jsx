import React, { useMemo } from 'react';
import { List } from 'react-window';
import { useSyncExternalStore } from 'react';
import { diagnosticsService } from '../../services/diagnosticsService';
import { useMeasuredHeight } from '../_shared/useMeasuredHeight';

const RowHeight = 34;

function iconFor(severity) {
  if (severity === 'error') return 'codicon-error';
  if (severity === 'warning') return 'codicon-warning';
  return 'codicon-info';
}

export default function ProblemsView({ filter = '', onOpenFile }) {
  const snap = useSyncExternalStore(diagnosticsService.subscribe, diagnosticsService.getSnapshot, diagnosticsService.getSnapshot);
  const problems = Array.isArray(snap?.problems) ? snap.problems : [];
  const [containerRef, height] = useMeasuredHeight();

  const filtered = useMemo(() => {
    const q = String(filter || '').trim().toLowerCase();
    if (!q) return problems;
    return problems.filter((p) => {
      const hay = `${p.message || ''} ${p.source || ''} ${p.file || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [problems, filter]);

  if (!filtered.length) {
    return (
      <div className="panel-empty">
        <div className="panel-empty-title">未在工作区检测到问题。</div>
        <div className="panel-empty-subtitle">来自 Monaco 语言服务/校验器的诊断会汇总在这里。</div>
      </div>
    );
  }

  const Row = ({ index, style }) => {
    const it = filtered[index];
    return (
      <button
        type="button"
        className="panel-list-row"
        style={{ ...style, height: RowHeight }}
        onClick={() => {
          if (!it?.file) return;
          onOpenFile?.(it.file);
          setTimeout(() => {
            try {
              window.dispatchEvent(new CustomEvent('workbench:revealInActiveEditor', { detail: { line: it.line, column: it.col } }));
            } catch {}
          }, 60);
        }}
        title={`${it.file}:${it.line}:${it.col} ${it.message}`}
      >
        <span className={`codicon ${iconFor(it.severity)}`} aria-hidden />
        <div className="panel-list-main">
          <div className="panel-list-title" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {it.message}
          </div>
          <div className="panel-list-meta">
            <span className="panel-list-file">{it.file}</span>
            <span className="panel-list-pos">:{it.line}:{it.col}</span>
            {it.source ? <span className="panel-list-source">{it.source}</span> : null}
          </div>
        </div>
      </button>
    );
  };

  return (
    <div ref={containerRef} style={{ height: '100%' }}>
      <List
        style={{ height: Math.max(120, height || 0), width: '100%' }}
        rowCount={filtered.length}
        rowHeight={RowHeight}
        rowComponent={Row}
        rowProps={{}}
      />
    </div>
  );
}
