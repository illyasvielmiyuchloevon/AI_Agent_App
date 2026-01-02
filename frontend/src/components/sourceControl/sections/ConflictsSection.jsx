import React from 'react';

export default function ConflictsSection({
  expanded,
  onToggle,
  onDragOver,
  onDrop,
  onDragStart,
  onDragEnd,
  conflicts,
  FileItem,
  onOpenFile,
  onDiff,
  selectedFile,
  onSelectFile,
  onResolve,
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
        aria-label="拖动以调整冲突分组顺序"
      >
        <div className="sc-section-icon">{expanded ? '▼' : '▶'}</div>
        <div className="sc-section-label">
          合并冲突
          <span className="sc-count-badge" style={{ background: 'var(--danger)', color: '#fff' }}>{conflicts.length}</span>
        </div>
      </div>
      {expanded && (
        <div className="sc-file-list">
          {conflicts.map((file) => (
            <FileItem
              key={`conflict-${file.path}`}
              file={file}
              onAction={null}
              actionIcon="!"
              onDiscard={null}
              onOpen={() => onOpenFile(file.path)}
              onDiff={() => onDiff(file.path, true)}
              selected={selectedFile === file.path}
              onSelect={() => onSelectFile(file.path)}
              isConflict={true}
              onResolve={onResolve}
            />
          ))}
          {conflicts.length === 0 && (
            <div style={{ padding: '8px 16px', fontSize: '12px', color: 'var(--muted)' }}>
              当前没有冲突的文件。
            </div>
          )}
        </div>
      )}
    </div>
  );
}

