import React from 'react';

export default function GitLensToolbar({ gitlens }) {
  return (
    <>
      <button type="button" className="bottom-panel-icon-btn" onClick={() => gitlens?.refresh?.()} title="刷新">
        <span className="codicon codicon-refresh" aria-hidden />
      </button>
    </>
  );
}

