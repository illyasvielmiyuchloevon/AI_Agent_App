import React from 'react';

export default function CommitHoverCard({ commit, rect, stats, onMouseEnter, onMouseLeave, onOpenAllDiffs, remotes }) {
  if (!rect) return null;

  const getRemoteUrl = () => {
    if (!remotes || remotes.length === 0) return null;
    const origin = remotes.find((r) => r.name === 'origin') || remotes[0];
    let url = origin.refs.fetch || origin.refs.push;
    if (!url) return null;

    if (url.startsWith('git@')) {
      url = url.replace(':', '/').replace('git@', 'https://');
    }

    url = url.replace(/\.git$/, '');

    return `${url}/commit/${commit.hash}`;
  };

  const remoteUrl = getRemoteUrl();

  const style = {
    position: 'fixed',
    top: Math.min(rect.top, window.innerHeight - 200),
    left: rect.right + 10,
    width: '300px',
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
    zIndex: 99999,
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    fontSize: '13px',
  };

  if (style.left + 320 > window.innerWidth) {
    style.left = rect.left - 310;
  }

  return (
    <div
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div style={{ fontWeight: 'bold', fontSize: '14px', borderBottom: '1px solid var(--border)', paddingBottom: '4px', marginBottom: '4px' }}>
        Commit Details
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', alignItems: 'center' }}>
        <span style={{ color: 'var(--muted)' }}>Message:</span>
        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{commit.message}</span>

        <span style={{ color: 'var(--muted)' }}>Author:</span>
        <span>{commit.author_name}</span>

        <span style={{ color: 'var(--muted)' }}>Date:</span>
        <span>{new Date(commit.date).toLocaleString()}</span>

        <span style={{ color: 'var(--muted)' }}>Files:</span>
        <span>{stats ? stats.files : (commit.files_count || '...')}</span>

        {stats && (
          <>
            <span style={{ color: 'var(--muted)' }}>Lines:</span>
            <span style={{ display: 'flex', gap: '8px' }}>
              <span style={{ color: 'var(--success)' }}>+{stats.insertions}</span>
              <span style={{ color: 'var(--danger)' }}>-{stats.deletions}</span>
            </span>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button
          className="primary-btn"
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', height: '32px' }}
          onClick={(e) => { e.stopPropagation(); onOpenAllDiffs(commit.hash); }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="3" width="6" height="18" rx="1" />
            <rect x="14" y="3" width="6" height="18" rx="1" />
          </svg>
          Open Diff View
        </button>
        {remoteUrl && (
          <button
            className="ghost-btn"
            style={{ width: '32px', padding: 0 }}
            onClick={(e) => { e.stopPropagation(); window.open(remoteUrl, '_blank'); }}
            title="Open on Git"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
          </button>
        )}
      </div>
    </div>
  );
}

