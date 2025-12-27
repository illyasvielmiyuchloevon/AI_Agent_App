import React from 'react';

export default function ProblemsToolbar({ filter, onChangeFilter, count = 0, onClearFilter }) {
  return (
    <div className="bottom-panel-tool">
      <span className="codicon codicon-filter" aria-hidden />
      <input
        className="ghost-input bottom-panel-filter"
        value={filter}
        onChange={(e) => onChangeFilter?.(e.target.value)}
        placeholder="筛选器"
        spellCheck={false}
      />
      {filter ? (
        <button type="button" className="bottom-panel-icon-btn" title="清除筛选" onClick={() => onClearFilter?.()}>
          <span className="codicon codicon-close" aria-hidden />
        </button>
      ) : null}
      <span className="bottom-panel-sep" aria-hidden />
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{count}</span>
    </div>
  );
}

