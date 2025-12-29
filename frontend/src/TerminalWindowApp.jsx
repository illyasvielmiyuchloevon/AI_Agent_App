import React, { useEffect, useMemo } from 'react';
import TerminalEditorTab from './components/TerminalEditorTab';
import './index.css';

export default function TerminalWindowApp() {
  const params = useMemo(() => {
    try {
      const url = new URL(window.location.href);
      return {
        workspaceFsPath: String(url.searchParams.get('workspaceFsPath') || '').trim(),
        profile: String(url.searchParams.get('terminalProfile') || '').trim(),
      };
    } catch {
      return { workspaceFsPath: '', profile: '' };
    }
  }, []);

  useEffect(() => {
    window.setTimeout(() => {
      try {
        window.dispatchEvent(new CustomEvent('workbench:terminalEditorCreate', { detail: params.profile ? { profile: params.profile } : {} }));
      } catch {}
    }, 0);
  }, [params.profile]);

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <TerminalEditorTab
        workspacePath={params.workspaceFsPath}
        terminalSettingsTabPath="__system__/terminal-settings"
        forceNewSession
        initialProfile={params.profile}
      />
    </div>
  );
}
