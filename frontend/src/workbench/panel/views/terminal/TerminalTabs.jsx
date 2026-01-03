import React from 'react';

const iconClassForProfile = (profile) => {
  const p = String(profile || '').toLowerCase();
  if (p.includes('powershell')) return 'codicon-terminal-powershell';
  if (p.includes('bash')) return 'codicon-terminal-bash';
  if (p.includes('cmd')) return 'codicon-terminal-cmd';
  return 'codicon-terminal';
};

export default function TerminalTabs({
  show,
  terminals,
  activeId,
  activeCwd,
  dragTerminalId,
  setDragTerminalId,
  onActivate,
  onMove,
  onDispose,
}) {
  if (!show) return null;

  return (
    <div className="vscode-terminal-side" aria-label="Terminal List">
      <div className="vscode-terminal-side-header">
        <div className="vscode-terminal-side-title">TERMINALS</div>
        <div className="vscode-terminal-side-sub">{activeCwd || ''}</div>
      </div>
      <div className="vscode-terminal-list">
        {(Array.isArray(terminals) ? terminals : []).map((t, idx) => (
          <div
            key={t.id}
            className={`vscode-terminal-item ${t.id === activeId ? 'active' : ''}`}
            onDragOver={(e) => {
              if (!dragTerminalId || dragTerminalId === t.id) return;
              e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (!dragTerminalId || dragTerminalId === t.id) return;
              onMove?.(dragTerminalId, t.id);
              setDragTerminalId?.('');
            }}
          >
            <button
              type="button"
              className="vscode-terminal-item-main"
              onClick={() => onActivate?.(t.id)}
              draggable
              onDragStart={() => setDragTerminalId?.(t.id)}
              onDragEnd={() => setDragTerminalId?.('')}
              title={t.cwd || t.title}
            >
              <span className={`codicon ${iconClassForProfile(t.profile)}`} aria-hidden />
              <span className="vscode-terminal-item-title">{t.title || t.label || t.profile || `terminal-${idx + 1}`}</span>
            </button>
            <button
              type="button"
              className="vscode-terminal-item-close"
              title="删除终端"
              aria-label="删除终端"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDispose?.(t.id);
              }}
            >
              <span className="codicon codicon-close" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

