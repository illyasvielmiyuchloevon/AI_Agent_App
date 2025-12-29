import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TerminalView from '../workbench/panel/views/TerminalView';
import TerminalToolbar from '../workbench/views/TerminalView/TerminalToolbar';

const shallowEqual = (a, b) => {
  if (Object.is(a, b)) return true;
  if (!a || !b) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!Object.is(a[k], b[k])) return false;
  }
  return true;
};

export default function TerminalEditorTab({
  workspacePath = '',
  onOpenFile,
  terminalSettingsTabPath = '',
  terminalEditorTabPath = '',
  onClose,
  forceNewSession = false,
  initialProfile = '',
}) {
  const terminalRef = useRef(null);
  const didAutoCreateRef = useRef(false);
  const forceCreatedRef = useRef(false);
  const [terminalUi, setTerminalUi] = useState({
    connected: false,
    listed: false,
    terminals: [],
    activeId: '',
    scrollLock: false,
    profile: 'cmd',
  });

  const mergeTerminalUi = useCallback((patch) => {
    setTerminalUi((prev) => {
      const next = { ...(prev || {}), ...(patch || {}) };
      return shallowEqual(prev, next) ? prev : next;
    });
  }, []);

  const terminalFacade = useMemo(() => ({
    terminalRef,
    getTerminalUi: () => terminalUi,
    setTerminalUi: (patch) => mergeTerminalUi(patch || {}),
    onCloseOnEmpty: () => {},
    onOpenFile,
    terminalSettingsTabPath,
    terminalEditorTabPath,
    workspacePath,
  }), [mergeTerminalUi, onOpenFile, terminalEditorTabPath, terminalSettingsTabPath, terminalUi, workspacePath]);

  useEffect(() => {
    const onCreate = (e) => {
      const detail = e?.detail;
      const profile = typeof detail?.profile === 'string' ? detail.profile : (terminalUi?.profile || 'cmd');
      terminalRef.current?.createTerminal?.(profile)
        .then(() => { didAutoCreateRef.current = true; })
        .catch?.(() => {});
    };
    window.addEventListener('workbench:terminalEditorCreate', onCreate);
    return () => window.removeEventListener('workbench:terminalEditorCreate', onCreate);
  }, [terminalUi?.profile]);

  useEffect(() => {
    const connected = !!terminalUi?.connected;
    const listed = !!terminalUi?.listed;
    const terminals = Array.isArray(terminalUi?.terminals) ? terminalUi.terminals : [];
    if (!connected || !listed) return;
    if (forceNewSession && !forceCreatedRef.current) {
      forceCreatedRef.current = true;
      const prof = String(initialProfile || terminalUi?.profile || 'cmd');
      terminalRef.current?.createTerminal?.(prof).catch?.(() => {});
      return;
    }
    if (terminals.length > 0) return;
    if (didAutoCreateRef.current) return;
    terminalRef.current?.createTerminal?.(terminalUi?.profile || 'cmd')
      .then(() => { didAutoCreateRef.current = true; })
      .catch?.(() => {});
  }, [terminalUi?.connected, terminalUi?.listed, terminalUi?.profile, terminalUi?.terminals]);

  const handleTerminalUiChange = useCallback((patch) => mergeTerminalUi(patch || {}), [mergeTerminalUi]);
  const handleTerminalStateChange = useCallback((next) => mergeTerminalUi(next || {}), [mergeTerminalUi]);

  return (
    <div className="terminal-editor-tab" role="region" aria-label="Terminal Editor">
      <div className="terminal-editor-toolbar">
        <TerminalToolbar terminal={terminalFacade} />
        {typeof onClose === 'function' ? (
          <button type="button" className="bottom-panel-icon-btn" onClick={onClose} title="关闭终端编辑器">
            <span className="codicon codicon-close" aria-hidden />
          </button>
        ) : null}
      </div>
      <div className="terminal-editor-body">
        <TerminalView
          ref={terminalRef}
          workspacePath={workspacePath}
          terminalUi={terminalUi}
          onTerminalUiChange={handleTerminalUiChange}
          onStateChange={handleTerminalStateChange}
          autoConnect
          isResizing={false}
        />
      </div>
    </div>
  );
}
