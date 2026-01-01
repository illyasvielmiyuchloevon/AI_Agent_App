import React from 'react';

export default function TerminalContextMenu({
  ctxMenu,
  splitEnabled,
  onClose,
  onCopy,
  onPaste,
  onClear,
  onSplitVertical,
  onSplitHorizontal,
  onClosePane,
  onRename,
  onFind,
  onKill,
}) {
  if (!ctxMenu) return null;

  return (
    <div
      className="vscode-terminal-context"
      style={{ left: ctxMenu.x, top: ctxMenu.y }}
      role="menu"
      aria-label="Terminal context menu"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button type="button" className="vscode-terminal-context-item" onClick={() => { onCopy?.(); onClose?.(); }}>
        复制
      </button>
      <button type="button" className="vscode-terminal-context-item" onClick={() => { onPaste?.(); onClose?.(); }}>
        粘贴
      </button>
      <button type="button" className="vscode-terminal-context-item" onClick={() => { onClear?.(); onClose?.(); }}>
        清空
      </button>
      <div className="vscode-terminal-context-sep" aria-hidden />
      <button type="button" className="vscode-terminal-context-item" onClick={() => { onSplitVertical?.(); onClose?.(); }}>
        向右分屏
      </button>
      <button type="button" className="vscode-terminal-context-item" onClick={() => { onSplitHorizontal?.(); onClose?.(); }}>
        向下分屏
      </button>
      <button type="button" className="vscode-terminal-context-item" disabled={!splitEnabled} onClick={() => { onClosePane?.(); onClose?.(); }}>
        关闭当前分屏
      </button>
      <div className="vscode-terminal-context-sep" aria-hidden />
      <button type="button" className="vscode-terminal-context-item" onClick={() => { onRename?.(); onClose?.(); }}>
        重命名…
      </button>
      <button type="button" className="vscode-terminal-context-item" onClick={() => { onFind?.(); onClose?.(); }}>
        查找…
      </button>
      <button type="button" className="vscode-terminal-context-item danger" onClick={() => { onKill?.(); onClose?.(); }}>
        终止终端
      </button>
    </div>
  );
}

