import React from 'react';
import CommitDetails from './CommitDetails';

const CommitItem = ({
  commit,
  expanded,
  loading,
  files,
  onToggle,
  onOpenAllDiffs,
  onOpenCommitDiff,
  onMouseEnter,
  onMouseLeave,
  isHovered,
  viewMode,
}) => (
  <div
    className="sc-commit-item"
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
    style={{ position: 'relative' }}
  >
    <div className="sc-commit-dot"></div>
    <div
      className="sc-commit-header"
      onClick={() => onToggle(commit.hash)}
      style={{ display: 'flex', alignItems: 'center', height: '24px' }}
    >
      <div className="sc-commit-msg" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, fontWeight: 'normal' }}>
        {commit.message}
      </div>
      <button
        className="sc-action-btn"
        style={{
          marginLeft: 'auto',
          opacity: isHovered ? 1 : 0,
          width: '24px',
          height: '24px',
          pointerEvents: isHovered ? 'auto' : 'none',
          transition: 'opacity 0.2s',
        }}
        onClick={(e) => { e.stopPropagation(); onOpenAllDiffs(commit.hash); }}
        title="Open Diff View"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="3" width="6" height="18" rx="1" />
          <rect x="14" y="3" width="6" height="18" rx="1" />
        </svg>
      </button>
    </div>

    {loading && <div style={{ fontSize: '11px', paddingLeft: '8px', color: 'var(--muted)' }}>Loading files...</div>}

    {expanded && files && (
      <CommitDetails
        commitHash={commit.hash}
        files={files}
        viewMode={viewMode}
        onOpenCommitDiff={onOpenCommitDiff}
      />
    )}
  </div>
);

export default function CommitList({
  commits = [],
  expandedCommits,
  loadingCommits,
  onToggleCommit,
  onOpenAllDiffs,
  onOpenCommitDiff,
  onCommitMouseEnter,
  onCommitMouseLeave,
  hoveredCommitHash,
  viewMode,
}) {
  return commits.map((commit) => (
    <CommitItem
      key={commit.hash}
      commit={commit}
      expanded={!!expandedCommits?.[commit.hash]}
      loading={!!loadingCommits?.[commit.hash]}
      files={expandedCommits?.[commit.hash]}
      onToggle={onToggleCommit}
      onOpenAllDiffs={onOpenAllDiffs}
      onOpenCommitDiff={onOpenCommitDiff}
      onMouseEnter={(e) => onCommitMouseEnter(commit, e.currentTarget)}
      onMouseLeave={onCommitMouseLeave}
      isHovered={hoveredCommitHash === commit.hash}
      viewMode={viewMode}
    />
  ));
}

