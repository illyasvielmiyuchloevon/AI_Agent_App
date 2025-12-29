import React, { useEffect, useMemo, useRef, useState } from 'react';

export default function TerminalToolbar({ terminal }) {
  const ui = terminal?.getTerminalUi?.() || { terminals: [], activeId: '', scrollLock: false };
  const terminals = Array.isArray(ui.terminals) ? ui.terminals : [];
  const activeId = ui.activeId || '';
  const scrollLock = !!ui.scrollLock;
  const profile = ui.profile || 'cmd';
  const onOpenFile = terminal?.onOpenFile;
  const terminalSettingsTabPath = terminal?.terminalSettingsTabPath;
  const terminalEditorTabPath = terminal?.terminalEditorTabPath;
  const workspacePath = terminal?.workspacePath || '';
  const split = ui.split || {};
  const splitEnabled = !!split.enabled;
  const splitCount = splitEnabled ? (Array.isArray(split.ids) ? split.ids.length : 2) : 1;
  const showSideList = terminals.length > 1;

  const [newMenu, setNewMenu] = useState(null);
  const [moreMenu, setMoreMenu] = useState(null);
  const [subMenu, setSubMenu] = useState(null); // { kind, left, top }
  const [tasksState, setTasksState] = useState({ loading: false, error: '', tasks: [] });
  const plusBtnRef = useRef(null);
  const moreBtnRef = useRef(null);

  const activeLabel = useMemo(() => {
    const t = terminals.find((x) => x.id === activeId);
    return t?.title || t?.label || t?.profile || '';
  }, [terminals, activeId]);

  const closeMenus = () => {
    setNewMenu(null);
    setMoreMenu(null);
    setSubMenu(null);
  };

  const placeMenu = (rect, width = 260) => {
    const gap = 6;
    const maxX = Math.max(8, (window?.innerWidth || 0) - width - 8);
    const left = clampNumber(rect.left, 8, maxX);
    const top = rect.bottom + gap;
    return { left, top };
  };

  useEffect(() => {
    if (!newMenu && !moreMenu && !subMenu) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closeMenus();
    };
    const onDown = () => closeMenus();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('blur', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [newMenu, moreMenu, subMenu]);

  const openNewMenu = () => {
    try {
      const rect = plusBtnRef.current?.getBoundingClientRect?.();
      if (!rect) return;
      setMoreMenu(null);
      setSubMenu(null);
      setNewMenu(placeMenu(rect));
    } catch {}
  };

  const openMoreMenu = () => {
    try {
      const rect = moreBtnRef.current?.getBoundingClientRect?.();
      if (!rect) return;
      setNewMenu(null);
      setSubMenu(null);
      setMoreMenu(placeMenu(rect));
    } catch {}
  };

  const placeSubMenu = (rect, width = 260) => {
    const gap = 6;
    const minX = 8;
    const maxX = Math.max(minX, (window?.innerWidth || 0) - width - 8);
    const left = clampNumber(rect.right + gap, minX, maxX);
    const top = clampNumber(rect.top - 6, 8, Math.max(8, (window?.innerHeight || 0) - 8));
    return { left, top };
  };

  const openSubMenu = (kind, evOrEl) => {
    try {
      const el = evOrEl?.currentTarget || evOrEl;
      const rect = el?.getBoundingClientRect?.();
      if (!rect) return;
      setSubMenu({ kind, ...placeSubMenu(rect) });
    } catch {}
  };

  const create = (p = profile) => {
    terminal?.terminalRef?.current?.createTerminal?.(String(p || profile)).catch?.(() => {});
  };

  const openTerminalSettingsTab = (section = 'integrated') => {
    const path = String(terminalSettingsTabPath || '').trim();
    if (!path || typeof onOpenFile !== 'function') return;
    onOpenFile(path, { mode: 'persistent' });
    window.setTimeout(() => {
      try {
        window.dispatchEvent(new CustomEvent('workbench:openTerminalSettings', { detail: { section } }));
      } catch {}
    }, 0);
  };

  const kill = () => {
    const count = terminals.length;
    if (count <= 1) terminal?.onCloseOnEmpty?.();
    terminal?.terminalRef?.current?.killActive?.();
  };

  const openTerminalWindow = async (nextProfile = '') => {
    const desiredProfile = String(nextProfile || profile || '').trim();

    const payload = {
      workspaceFsPath: String(workspacePath || ''),
      terminalProfile: desiredProfile,
    };

    try {
      const api = typeof window !== 'undefined' ? window.electronAPI : null;
      if (api?.window?.openTerminalWindow) {
        await api.window.openTerminalWindow(payload);
        closeMenus();
        return;
      }
    } catch {}

    try {
      const url = new URL(window.location.href);
      url.searchParams.set('terminalWindow', '1');
      if (workspacePath) url.searchParams.set('workspaceFsPath', String(workspacePath || ''));
      if (desiredProfile) url.searchParams.set('terminalProfile', desiredProfile);
      window.open(url.toString(), '_blank', 'noopener,noreferrer');
    } catch {}

    closeMenus();
  };

  const setDefaultProfile = (p) => {
    const next = String(p || '').trim();
    if (!next) return;
    try { terminal?.setTerminalUi?.({ profile: next }); } catch {}
    try { window.dispatchEvent(new CustomEvent('workbench:terminalUiPatch', { detail: { profile: next } })); } catch {}
    closeMenus();
  };

  const getWorkspaceReadUrl = (relPath, allowMissing = false) => {
    const qs = new URLSearchParams();
    qs.set('path', String(relPath || ''));
    if (allowMissing) qs.set('allow_missing', '1');
    const proto = typeof window !== 'undefined' ? window.location.protocol : '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    if (proto === 'file:' || origin === 'null') return `http://127.0.0.1:8000/workspace/read?${qs.toString()}`;
    return `/api/workspace/read?${qs.toString()}`;
  };

  const getWorkspaceWriteUrl = () => {
    const proto = typeof window !== 'undefined' ? window.location.protocol : '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    if (proto === 'file:' || origin === 'null') return 'http://127.0.0.1:8000/workspace/write';
    return '/api/workspace/write';
  };

  const openOrCreateTasksFile = async () => {
    if (!workspacePath || typeof onOpenFile !== 'function') return;
    const rel = '.vscode/tasks.json';
    try {
      const res = await fetch(getWorkspaceReadUrl(rel, true), {
        method: 'GET',
        headers: { 'x-workspace-root': String(workspacePath || '') },
      });
      const data = await res.json().catch(() => null);
      const exists = !!data?.exists;
      if (!exists) {
        const template = JSON.stringify({
          version: '2.0.0',
          tasks: [
            { label: 'echo hello', type: 'shell', command: 'echo hello' },
          ],
        }, null, 2);
        await fetch(getWorkspaceWriteUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-workspace-root': String(workspacePath || '') },
          body: JSON.stringify({ path: rel, content: template, create_directories: true }),
        }).catch(() => {});
      }
      onOpenFile(rel, { mode: 'persistent' });
    } catch {}
  };

  const normalizeTaskCommand = (task) => {
    if (!task || typeof task !== 'object') return '';
    const cmd = typeof task.command === 'string' ? task.command : '';
    if (!cmd) return '';
    const args = Array.isArray(task.args) ? task.args : null;
    if (!args || !args.length) return cmd;
    const rendered = args.map((a) => {
      const s = String(a ?? '');
      return /\s/.test(s) ? JSON.stringify(s) : s;
    }).join(' ');
    return `${cmd} ${rendered}`.trim();
  };

  const loadTasks = async () => {
    if (!workspacePath) {
      setTasksState({ loading: false, error: '未打开工作区', tasks: [] });
      return;
    }
    setTasksState((prev) => ({ ...(prev || {}), loading: true, error: '' }));
    const rel = '.vscode/tasks.json';
    try {
      const res = await fetch(getWorkspaceReadUrl(rel, true), { method: 'GET', headers: { 'x-workspace-root': String(workspacePath || '') } });
      const data = await res.json().catch(() => null);
      const exists = data?.exists !== false;
      if (!exists) {
        setTasksState({ loading: false, error: '未找到 .vscode/tasks.json', tasks: [] });
        return;
      }
      const raw = typeof data?.content === 'string' ? data.content : '';
      const json = JSON.parse(raw || '{}');
      const tasks = Array.isArray(json?.tasks) ? json.tasks : [];
      const list = tasks.map((t, idx) => ({
        id: String(t?.label || t?.name || `task-${idx + 1}`),
        label: String(t?.label || t?.name || `task-${idx + 1}`),
        command: normalizeTaskCommand(t),
      })).filter((t) => t.command);
      setTasksState({ loading: false, error: '', tasks: list });
    } catch (e) {
      setTasksState({ loading: false, error: '解析 tasks.json 失败', tasks: [] });
    }
  };

  const runTask = async (task) => {
    const cmd = String(task?.command || '').trim();
    if (!cmd) return;
    try {
      const ref = terminal?.terminalRef?.current;
      if (!ref?.createTerminal) return;
      const meta = await ref.createTerminal(String(profile || 'cmd')).catch(() => null);
      const id = String(meta?.id || '');
      if (!id) return;
      ref.sendInput?.(id, `${cmd}\r`);
    } catch {}
    closeMenus();
  };

  const profiles = useMemo(() => ([
    { id: 'powershell', label: 'PowerShell' },
    { id: 'bash', label: 'Git Bash' },
    { id: 'cmd', label: 'Command Prompt' },
  ]), []);

  return (
    <>
      <div className="terminal-toolbar-group" role="group" aria-label="New Terminal">
        <button
          type="button"
          className="bottom-panel-icon-btn"
          onClick={() => create(profile)}
          title="新建终端"
        >
          <span className="codicon codicon-add" aria-hidden />
        </button>
        <button
          ref={plusBtnRef}
          type="button"
          className="bottom-panel-icon-btn terminal-toolbar-split"
          onClick={() => (newMenu ? closeMenus() : openNewMenu())}
          title="新建终端…"
        >
          <span className="codicon codicon-chevron-down" aria-hidden />
        </button>
      </div>

      {newMenu ? (
        <div
          className="vscode-terminal-context vscode-terminal-toolbar-menu"
          style={{ left: newMenu.left, top: newMenu.top }}
          role="menu"
          aria-label="Terminal new menu"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button type="button" className="vscode-terminal-context-item vscode-terminal-menu-item" onClick={() => { create(profile); closeMenus(); }}>
            <span>新建终端</span>
            <span className="vscode-terminal-menu-kbd">Ctrl+Shift+`</span>
          </button>
          <button type="button" className="vscode-terminal-context-item vscode-terminal-menu-item" onClick={() => openTerminalWindow('')}>
            <span>新建终端窗口</span>
            <span className="vscode-terminal-menu-kbd">Ctrl+Shift+Alt+`</span>
          </button>
          <div className="vscode-terminal-context-sep" aria-hidden />
          {profiles.map((p) => (
            <button key={p.id} type="button" className="vscode-terminal-context-item vscode-terminal-menu-item" onClick={() => { create(p.id); closeMenus(); }}>
              <span>{p.label}{String(profile) === p.id ? '（默认）' : ''}</span>
            </button>
          ))}
          <div className="vscode-terminal-context-sep" aria-hidden />
          <button type="button" className="vscode-terminal-context-item vscode-terminal-menu-item" onClick={() => { terminal?.terminalRef?.current?.splitAddVertical?.(); closeMenus(); }}>
            <span>拆分终端（向右）</span>
            <span className="vscode-terminal-menu-kbd">Ctrl+Shift+5</span>
          </button>
          <button type="button" className="vscode-terminal-context-item vscode-terminal-menu-item" onClick={() => { terminal?.terminalRef?.current?.splitAddHorizontal?.(); closeMenus(); }}>
            <span>拆分终端（向下）</span>
            <span className="vscode-terminal-menu-kbd">Ctrl+Shift+6</span>
          </button>
          <button
            type="button"
            className="vscode-terminal-context-item vscode-terminal-menu-item"
            onMouseEnter={(e) => openSubMenu('splitProfiles', e)}
            onClick={(e) => openSubMenu('splitProfiles', e)}
          >
            <span className="vscode-terminal-menu-item-left">具有配置文件的拆分终端</span>
            <span className="codicon codicon-chevron-right" aria-hidden />
          </button>
          <div className="vscode-terminal-context-sep" aria-hidden />
          <button type="button" className="vscode-terminal-context-item vscode-terminal-menu-item" onClick={() => { openTerminalSettingsTab('integrated'); closeMenus(); }}>
            <span>配置终端设置</span>
          </button>
          <button
            type="button"
            className="vscode-terminal-context-item vscode-terminal-menu-item"
            onMouseEnter={(e) => openSubMenu('defaultProfile', e)}
            onClick={(e) => openSubMenu('defaultProfile', e)}
          >
            <span className="vscode-terminal-menu-item-left">选择默认配置文件</span>
            <span className="codicon codicon-chevron-right" aria-hidden />
          </button>
          <div className="vscode-terminal-context-sep" aria-hidden />
          <button
            type="button"
            className="vscode-terminal-context-item vscode-terminal-menu-item"
            onClick={async (e) => {
              openSubMenu('tasks', e);
              await loadTasks();
            }}
          >
            <span className="vscode-terminal-menu-item-left">运行任务…</span>
            <span className="codicon codicon-chevron-right" aria-hidden />
          </button>
          <button type="button" className="vscode-terminal-context-item vscode-terminal-menu-item" onClick={() => { openOrCreateTasksFile(); closeMenus(); }}>
            <span>配置任务</span>
          </button>
        </div>
      ) : null}

      {newMenu && subMenu ? (
        <div
          className="vscode-terminal-context vscode-terminal-toolbar-menu"
          style={{ left: subMenu.left, top: subMenu.top }}
          role="menu"
          aria-label="Terminal submenu"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {subMenu.kind === 'defaultProfile' ? (
            profiles.map((p) => (
              <button key={p.id} type="button" className="vscode-terminal-context-item vscode-terminal-menu-item" onClick={() => setDefaultProfile(p.id)}>
                <span>{p.label}{String(profile) === p.id ? '（当前默认）' : ''}</span>
              </button>
            ))
          ) : null}
          {subMenu.kind === 'splitProfiles' ? (
            profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                className="vscode-terminal-context-item vscode-terminal-menu-item"
                onClick={() => { terminal?.terminalRef?.current?.splitAddVerticalWithProfile?.(p.id); closeMenus(); }}
              >
                <span>{p.label}</span>
              </button>
            ))
          ) : null}
          {subMenu.kind === 'tasks' ? (
            tasksState.loading ? (
              <div className="vscode-terminal-context-item vscode-terminal-menu-item" aria-disabled="true">
                <span>正在读取 tasks.json…</span>
              </div>
            ) : (tasksState.error ? (
              <>
                <div className="vscode-terminal-context-item vscode-terminal-menu-item" aria-disabled="true">
                  <span>{tasksState.error}</span>
                </div>
                <button type="button" className="vscode-terminal-context-item vscode-terminal-menu-item" onClick={() => { openOrCreateTasksFile(); closeMenus(); }}>
                  <span>创建并打开 tasks.json</span>
                </button>
              </>
            ) : (
              tasksState.tasks.length ? tasksState.tasks.map((t) => (
                <button key={t.id} type="button" className="vscode-terminal-context-item vscode-terminal-menu-item" onClick={() => runTask(t)}>
                  <span>{t.label}</span>
                </button>
              )) : (
                <div className="vscode-terminal-context-item vscode-terminal-menu-item" aria-disabled="true">
                  <span>未定义可运行任务</span>
                </div>
              )
            ))
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        className={`bottom-panel-icon-btn ${splitEnabled ? 'active' : ''}`}
        onClick={() => terminal?.terminalRef?.current?.splitAddVertical?.()}
        title="向右分屏（新终端）"
      >
        <span className="codicon codicon-split-horizontal" aria-hidden />
      </button>
      <button
        type="button"
        className="bottom-panel-icon-btn"
        onClick={() => terminal?.terminalRef?.current?.splitAddHorizontal?.()}
        title="向下分屏（新终端）"
      >
        <span className="codicon codicon-split-vertical" aria-hidden />
      </button>
      <button
        type="button"
        className="bottom-panel-icon-btn"
        onClick={() => terminal?.terminalRef?.current?.closeActivePane?.()}
        title={splitCount > 1 ? '关闭当前分屏' : '无分屏可关闭'}
        disabled={splitCount <= 1}
      >
        <span className="codicon codicon-close" aria-hidden />
      </button>
      <select
        className="ghost-input bottom-panel-select terminal-toolbar-select"
        value={activeId}
        onChange={(e) => terminal?.terminalRef?.current?.setActive?.(e.target.value)}
        title={activeLabel || '终端实例'}
      >
        {terminals.map((t, idx) => (
          <option key={t.id} value={t.id}>{t.title || t.label || t.profile || `terminal-${idx + 1}`}</option>
        ))}
      </select>
      {!showSideList ? (
        <button
          type="button"
          className="bottom-panel-icon-btn"
          onClick={kill}
          title="删除终端"
        >
          <span className="codicon codicon-trash" aria-hidden />
        </button>
      ) : null}

      <button
        ref={moreBtnRef}
        type="button"
        className={`bottom-panel-icon-btn ${moreMenu ? 'active' : ''}`}
        onClick={() => (moreMenu ? closeMenus() : openMoreMenu())}
        title="更多操作…"
      >
        <span className="codicon codicon-ellipsis" aria-hidden />
      </button>

      {moreMenu ? (
        <div
          className="vscode-terminal-context vscode-terminal-toolbar-menu"
          style={{ left: moreMenu.left, top: moreMenu.top }}
          role="menu"
          aria-label="Terminal actions menu"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button type="button" className="vscode-terminal-context-item vscode-terminal-menu-item" onClick={() => { terminal?.terminalRef?.current?.openFind?.(); closeMenus(); }}>
            <span>查找…</span>
            <span className="vscode-terminal-menu-kbd">Ctrl+F</span>
          </button>
          <button type="button" className="vscode-terminal-context-item vscode-terminal-menu-item" onClick={() => { terminal?.terminalRef?.current?.clearActive?.(); closeMenus(); }}>
            <span>清除终端</span>
          </button>
          <button type="button" className="vscode-terminal-context-item vscode-terminal-menu-item" onClick={() => { terminal?.terminalRef?.current?.copySelection?.(); closeMenus(); }}>
            <span>复制</span>
          </button>
          <button type="button" className="vscode-terminal-context-item vscode-terminal-menu-item" onClick={() => { terminal?.terminalRef?.current?.pasteFromClipboard?.(); closeMenus(); }}>
            <span>粘贴</span>
          </button>
          <div className="vscode-terminal-context-sep" aria-hidden />
          <button type="button" className="vscode-terminal-context-item vscode-terminal-menu-item" onClick={() => { terminal?.terminalRef?.current?.renameActive?.(); closeMenus(); }}>
            <span>重命名…</span>
          </button>
          <button type="button" className="vscode-terminal-context-item vscode-terminal-menu-item" onClick={() => { terminal?.terminalRef?.current?.toggleScrollLock?.(); closeMenus(); }}>
            <span>{scrollLock ? '取消滚动锁定' : '滚动锁定'}</span>
          </button>
          <div className="vscode-terminal-context-sep" aria-hidden />
          <button type="button" className="vscode-terminal-context-item vscode-terminal-menu-item" onClick={() => { openTerminalSettingsTab('integrated'); closeMenus(); }}>
            <span>配置终端设置</span>
          </button>
          <button type="button" className="vscode-terminal-context-item vscode-terminal-menu-item danger" onClick={() => { kill(); closeMenus(); }}>
            <span>终止终端</span>
          </button>
        </div>
      ) : null}
    </>
  );
}

function clampNumber(value, min, max) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
