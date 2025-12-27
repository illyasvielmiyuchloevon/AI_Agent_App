import React from 'react';

export default function DebugConsoleToolbar({ onClear }) {
  return (
    <>
      <button type="button" className="bottom-panel-icon-btn" onClick={() => onClear?.()} title="清空">
        <span className="codicon codicon-clear-all" aria-hidden />
      </button>
    </>
  );
}

