import React from 'react';
import CommitList from '../CommitList';

export default function GraphSection({
  expanded,
  onToggle,
  onDragOver,
  onDrop,
  onDragStart,
  onDragEnd,
  gitLog,
  expandedCommits,
  loadingCommits,
  onToggleCommit,
  onOpenAllDiffs,
  onOpenCommitDiff,
  onCommitMouseEnter,
  onCommitMouseLeave,
  hoveredCommitHash,
  viewMode,
  setViewMode,
}) {
  return (
    <div
      className="sc-section"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        className="sc-section-header"
        onClick={onToggle}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        aria-label="拖动以调整图形分组顺序"
      >
        <div className="sc-section-icon">{expanded ? '▼' : '▶'}</div>
        <div className="sc-section-label">
          图形 <span className="sc-count-badge">{gitLog.length}</span>
        </div>
        <div className="sc-section-actions">
          <button
            className="sc-action-btn"
            onClick={(e) => { e.stopPropagation(); setViewMode((m) => (m === 'list' ? 'tree' : 'list')); }}
            title={viewMode === 'list' ? '切换为树形视图' : '切换为列表视图'}
            aria-label={viewMode === 'list' ? '切换为树形视图' : '切换为列表视图'}
          >
            <span
              className={`codicon ${viewMode === 'list' ? 'codicon-list-tree' : 'codicon-list-flat'}`}
              aria-hidden
              style={{ fontSize: '18px' }}
            />
          </button>
        </div>
      </div>
      {expanded && (
        <div style={{ paddingBottom: '10px' }}>
          <CommitList
            commits={gitLog}
            expandedCommits={expandedCommits}
            loadingCommits={loadingCommits}
            onToggleCommit={onToggleCommit}
            onOpenAllDiffs={onOpenAllDiffs}
            onOpenCommitDiff={onOpenCommitDiff}
            onCommitMouseEnter={onCommitMouseEnter}
            onCommitMouseLeave={onCommitMouseLeave}
            hoveredCommitHash={hoveredCommitHash}
            viewMode={viewMode}
          />
          {gitLog.length === 0 && (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>
              暂无提交记录，在上方完成一次提交后即可看到提交图形。
            </div>
          )}
        </div>
      )}
    </div>
  );
}

