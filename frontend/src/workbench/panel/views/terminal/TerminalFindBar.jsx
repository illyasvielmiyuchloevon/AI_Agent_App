import React from 'react';

export default function TerminalFindBar({
  open,
  find,
  findInputRef,
  setFind,
  closeFind,
  runFind,
}) {
  if (!open) return null;

  return (
    <div className="vscode-terminal-find" role="dialog" aria-label="Find in Terminal">
      <span className="codicon codicon-search" aria-hidden />
      <input
        ref={findInputRef}
        className="vscode-terminal-find-input"
        value={find?.query || ''}
        placeholder="查找"
        onChange={(e) => setFind?.((prev) => ({ ...prev, query: e.target.value }))}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            closeFind?.();
            return;
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            runFind?.(e.shiftKey ? 'prev' : 'next');
          }
        }}
      />
      <button
        type="button"
        className={`bottom-panel-icon-btn ${find?.caseSensitive ? 'active' : ''}`}
        title="大小写敏感"
        onClick={() => setFind?.((prev) => ({ ...prev, caseSensitive: !prev.caseSensitive }))}
      >
        <span className="codicon codicon-case-sensitive" aria-hidden />
      </button>
      <button
        type="button"
        className={`bottom-panel-icon-btn ${find?.wholeWord ? 'active' : ''}`}
        title="全词匹配"
        onClick={() => setFind?.((prev) => ({ ...prev, wholeWord: !prev.wholeWord }))}
      >
        <span className="codicon codicon-whole-word" aria-hidden />
      </button>
      <button
        type="button"
        className={`bottom-panel-icon-btn ${find?.regex ? 'active' : ''}`}
        title="正则"
        onClick={() => setFind?.((prev) => ({ ...prev, regex: !prev.regex }))}
      >
        <span className="codicon codicon-regex" aria-hidden />
      </button>
      <div className="vscode-terminal-find-count" aria-label="Match count">
        {find?.resultCount ? `${Math.max(1, (find?.resultIndex || 0) + 1)}/${find.resultCount}` : '0/0'}
      </div>
      <button type="button" className="bottom-panel-icon-btn" title="上一个" onClick={() => runFind?.('prev')}>
        <span className="codicon codicon-chevron-up" aria-hidden />
      </button>
      <button type="button" className="bottom-panel-icon-btn" title="下一个" onClick={() => runFind?.('next')}>
        <span className="codicon codicon-chevron-down" aria-hidden />
      </button>
      <button type="button" className="bottom-panel-icon-btn" title="关闭" onClick={closeFind}>
        <span className="codicon codicon-close" aria-hidden />
      </button>
    </div>
  );
}

