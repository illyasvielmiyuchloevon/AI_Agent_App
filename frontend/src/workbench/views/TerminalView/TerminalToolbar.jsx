import React, { useMemo } from 'react';

export default function TerminalToolbar({ terminal }) {
  const ui = terminal?.getTerminalUi?.() || { terminals: [], activeId: '', scrollLock: false };
  const terminals = Array.isArray(ui.terminals) ? ui.terminals : [];
  const activeId = ui.activeId || '';
  const scrollLock = !!ui.scrollLock;
  const profile = ui.profile || 'cmd';

  const activeLabel = useMemo(() => {
    const t = terminals.find((x) => x.id === activeId);
    return t?.label || t?.title || t?.profile || '';
  }, [terminals, activeId]);

  return (
    <>
      <button
        type="button"
        className="bottom-panel-icon-btn"
        onClick={() => terminal?.terminalRef?.current?.createTerminal?.(profile).catch?.(() => {})}
        title="新建终端"
      >
        <span className="codicon codicon-add" aria-hidden />
      </button>
      <select
        className="ghost-input bottom-panel-select"
        value={profile}
        onChange={(e) => terminal?.setTerminalUi?.({ profile: e.target.value })}
        title="默认 Profile"
      >
        <option value="cmd">cmd</option>
        <option value="powershell">powershell</option>
        <option value="bash">bash</option>
      </select>
      <select
        className="ghost-input bottom-panel-select"
        value={activeId}
        onChange={(e) => terminal?.terminalRef?.current?.setActive?.(e.target.value)}
        title={activeLabel || '终端实例'}
      >
        {terminals.map((t, idx) => (
          <option key={t.id} value={t.id}>{t.label || t.title || t.profile || `terminal-${idx + 1}`}</option>
        ))}
      </select>
      <button
        type="button"
        className={`bottom-panel-icon-btn ${scrollLock ? 'active' : ''}`}
        onClick={() => terminal?.terminalRef?.current?.toggleScrollLock?.()}
        title={scrollLock ? '取消滚动锁定' : '滚动锁定'}
      >
        <span className={`codicon ${scrollLock ? 'codicon-debug-continue' : 'codicon-debug-pause'}`} aria-hidden />
      </button>
      <button
        type="button"
        className="bottom-panel-icon-btn"
        onClick={() => {
          const count = terminals.length;
          if (count <= 1) terminal?.onCloseOnEmpty?.();
          terminal?.terminalRef?.current?.killActive?.();
        }}
        title="删除终端"
      >
        <span className="codicon codicon-trash" aria-hidden />
      </button>
    </>
  );
}

