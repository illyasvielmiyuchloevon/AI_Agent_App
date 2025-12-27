import React from 'react';

export default function PortsToolbar({ ports }) {
  return (
    <>
      <button type="button" className="bottom-panel-icon-btn" onClick={() => ports?.refresh?.()} title="刷新">
        <span className="codicon codicon-refresh" aria-hidden />
      </button>
    </>
  );
}

