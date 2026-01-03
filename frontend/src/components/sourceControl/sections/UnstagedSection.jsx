import React from 'react';

export default function UnstagedSection({
  expanded,
  onToggle,
  onDragOver,
  onDrop,
  onDragStart,
  onDragEnd,
  changes,
  FileItem,
  onStage,
  onDiscard,
  onOpenFile,
  onDiff,
  selectedFile,
  onSelectFile,
  canDiscardAll,
  onDiscardAllClick,
  canOpenChangesDiff,
  onOpenChangesDiff,
  onStageAll,
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
        aria-label="拖动以调整更改分组顺序"
      >
        <div className="sc-section-icon">{expanded ? '▼' : '▶'}</div>
        <div className="sc-section-label">
          更改
          <span className="sc-count-badge">{changes.length}</span>
        </div>
        <div className="sc-section-actions sc-section-actions-inline">
          <button
            className="sc-action-btn"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (onDiscardAllClick) onDiscardAllClick();
            }}
            disabled={!canDiscardAll}
            title="放弃所有更改"
            aria-label="放弃所有更改"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 14 4 9l5-5" />
              <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11" />
            </svg>
          </button>
          <button
            className="sc-action-btn"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (onOpenChangesDiff) onOpenChangesDiff();
            }}
            disabled={!canOpenChangesDiff}
            title="打开更改的diff"
            aria-label="打开更改的diff"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="3" width="6" height="18" rx="1" />
              <rect x="14" y="3" width="6" height="18" rx="1" />
            </svg>
          </button>
          <button
            className="sc-action-btn"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onStageAll();
            }}
            disabled={changes.length === 0}
            title="全部暂存"
            aria-label="全部暂存"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>
      {expanded && (
        <div className="sc-file-list">
          {changes.map((file) => (
            <FileItem
              key={`change-${file.path}`}
              file={file}
              onAction={() => onStage([file.path])}
              actionIcon="+"
              onDiscard={() => onDiscard && onDiscard([file.path])}
              onOpen={() => onOpenFile(file.path)}
              onDiff={() => onDiff(file.path, false)}
              selected={selectedFile === file.path}
              onSelect={() => onSelectFile(file.path)}
            />
          ))}
          {changes.length === 0 && (
            <div style={{ padding: '8px 16px', fontSize: '12px', color: 'var(--muted)' }}>
              当前没有未暂存的更改。
            </div>
          )}
        </div>
      )}
    </div>
  );
}
