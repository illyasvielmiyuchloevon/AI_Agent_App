import React from 'react';

export default function StagedSection({
  expanded,
  onToggle,
  onDragOver,
  onDrop,
  onDragStart,
  onDragEnd,
  staged,
  FileItem,
  onUnstage,
  onOpenFile,
  onDiff,
  selectedFile,
  onSelectFile,
  onUnstageAll,
  onViewAll,
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
        aria-label="拖动以调整暂存分组顺序"
      >
        <div className="sc-section-icon">{expanded ? '▼' : '▶'}</div>
        <div className="sc-section-label">
          暂存的更改
          <span className="sc-count-badge">{staged.length}</span>
        </div>
        <div className="sc-section-actions sc-section-actions-inline">
          <button
            className="sc-action-btn"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (onViewAll) onViewAll();
            }}
            disabled={!onViewAll || staged.length === 0}
            title="查看全部更改"
            aria-label="查看全部更改"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 5h8v14H3z" />
              <path d="M13 5h8v14h-8z" />
              <path d="M9 9h6" />
              <path d="M9 15h6" />
            </svg>
          </button>
          <button
            className="sc-action-btn"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUnstageAll();
            }}
            disabled={staged.length === 0}
            title="取消全部暂存"
            aria-label="取消全部暂存"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>
      {expanded && (
        <div className="sc-file-list">
          {staged.map((file) => (
            <FileItem
              key={`staged-${file.path}`}
              file={file}
              onAction={() => onUnstage([file.path])}
              actionIcon="-"
              onOpen={() => onOpenFile(file.path)}
              onDiff={() => onDiff(file.path, true)}
              onDiscard={null}
              selected={selectedFile === file.path}
              onSelect={() => onSelectFile(file.path)}
            />
          ))}
          {staged.length === 0 && (
            <div style={{ padding: '8px 16px', fontSize: '12px', color: 'var(--muted)' }}>
              当前没有暂存的更改。
            </div>
          )}
        </div>
      )}
    </div>
  );
}
