import React from 'react';

export default function BranchesSection({
  expanded,
  onToggle,
  onDragOver,
  onDrop,
  onDragStart,
  onDragEnd,
  gitBranches,
  isCreatingBranch,
  setIsCreatingBranch,
  newBranchName,
  setNewBranchName,
  onCreateBranchConfirm,
  onCheckoutBranch,
  onDeleteBranch,
}) {
  const list = gitBranches?.all || [];

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
        aria-label="拖动以调整分支分组顺序"
      >
        <div className="sc-section-icon">{expanded ? '▼' : '▶'}</div>
        <div className="sc-section-label">
          分支 <span className="sc-count-badge">{list.length}</span>
        </div>
        <div className="sc-section-actions">
          <button
            className="sc-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              setIsCreatingBranch(true);
            }}
            title="新建分支"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
        </div>
      </div>
      {expanded && (
        <>
          {isCreatingBranch && (
            <div className="sc-remote-form">
              <div className="sc-remote-header">
                <span>新建分支</span>
                <button className="sc-icon-btn" onClick={() => setIsCreatingBranch(false)}>×</button>
              </div>
              <input
                className="sc-remote-input"
                placeholder="分支名称"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onCreateBranchConfirm();
                  if (e.key === 'Escape') setIsCreatingBranch(false);
                }}
                autoFocus
              />
              <div className="sc-remote-actions">
                <button
                  className="sc-btn primary"
                  onClick={onCreateBranchConfirm}
                  disabled={!newBranchName.trim()}
                >
                  创建
                </button>
              </div>
            </div>
          )}
          <div className="sc-file-list">
            {list.map((b) => (
              <div key={b} className="sc-repo-item" style={{ padding: '4px 16px' }}>
                <div className="sc-repo-main" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span style={{
                    fontWeight: b === gitBranches.current ? 'bold' : 'normal',
                    color: b === gitBranches.current ? 'var(--accent)' : 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                  >
                    {b === gitBranches.current && <span style={{ fontSize: '10px' }}>●</span>}
                    {b}
                  </span>
                  <div className="sc-repo-actions" style={{ opacity: 0.7 }}>
                    {b !== gitBranches.current && (
                      <button className="sc-item-btn" onClick={() => onCheckoutBranch && onCheckoutBranch(b)} title="切换分支">
                        ✓
                      </button>
                    )}
                    {b !== gitBranches.current && (
                      <button className="sc-item-btn" onClick={() => onDeleteBranch && onDeleteBranch(b)} title="删除分支">
                        🗑
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

