import React, { useEffect, useMemo, useState } from 'react';

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

const toLanguageLabel = (languageId) => {
  const id = String(languageId || '').trim();
  if (!id) return 'Plain Text';
  if (id === 'typescript') return 'TypeScript';
  if (id === 'javascript') return 'JavaScript';
  if (id === 'json') return 'JSON';
  return id.replace(/(^|[-_])([a-z])/g, (_, p1, p2) => `${p1 ? ' ' : ''}${p2.toUpperCase()}`).trim();
};

const summarizeLspStatus = (byServerId, languageId) => {
  const entries = Array.from((byServerId && typeof byServerId === 'object') ? Object.entries(byServerId) : []);
  if (entries.length === 0) {
    const lang = String(languageId || '').trim();
    if (lang === 'typescript' || lang === 'javascript') return { label: 'LSP: Not Started', tone: 'muted' };
    return { label: 'LSP: —', tone: 'muted' };
  }

  const statuses = entries.map(([, v]) => String(v?.status || '')).filter(Boolean);
  const errors = entries.map(([, v]) => String(v?.error || '')).filter(Boolean);
  const hasError = statuses.some((s) => s === 'error' || s === 'restart_giveup');
  const hasRestarting = statuses.some((s) => s === 'restarting' || s === 'starting');
  const hasReady = statuses.some((s) => s === 'ready');

  if (hasReady) return { label: hasRestarting ? 'LSP: Starting…' : 'LSP: Ready', tone: hasRestarting ? 'warning' : 'ok' };
  if (hasError) {
    const merged = errors.join(' ').toLowerCase();
    if (merged.includes('enoent') || merged.includes('not found')) return { label: 'LSP: Not Installed', tone: 'danger' };
    return { label: 'LSP: Error', tone: 'danger' };
  }
  if (hasRestarting) return { label: 'LSP: Starting…', tone: 'warning' };
  return { label: 'LSP: Idle', tone: 'muted' };
};

export default function StatusBar({
  gitBranch = '',
  gitStatus = null,
  onClickGit = null,
  workspaceBindingStatus = '',
}) {
  const [editorState, setEditorState] = useState({
    filePath: '',
    languageId: '',
    line: 1,
    column: 1,
    selectionLength: 0,
    tabSize: 4,
    insertSpaces: true,
    eol: 'LF',
    encoding: 'UTF-8',
  });

  const [lspByServerId, setLspByServerId] = useState({});

  useEffect(() => {
    const onPatch = (e) => {
      const detail = e?.detail;
      if (!detail || typeof detail !== 'object') return;
      setEditorState((prev) => {
        const next = { ...(prev || {}), ...(detail || {}) };
        return shallowEqual(prev, next) ? prev : next;
      });
    };
    window.addEventListener('workbench:statusBarEditorPatch', onPatch);
    return () => window.removeEventListener('workbench:statusBarEditorPatch', onPatch);
  }, []);

  useEffect(() => {
    const onLsp = (e) => {
      const detail = e?.detail;
      const serverId = detail?.serverId ? String(detail.serverId) : '';
      if (!serverId) return;
      setLspByServerId((prev) => {
        const next = { ...(prev || {}), [serverId]: { ...(prev?.[serverId] || {}), ...(detail || {}) } };
        return shallowEqual(prev, next) ? prev : next;
      });
    };
    window.addEventListener('workbench:lspServerStatus', onLsp);
    return () => window.removeEventListener('workbench:lspServerStatus', onLsp);
  }, []);

  const gitMeta = useMemo(() => {
    const ahead = Number(gitStatus?.ahead || 0);
    const behind = Number(gitStatus?.behind || 0);
    const parts = [];
    if (Number.isFinite(ahead) && ahead > 0) parts.push(`↑${ahead}`);
    if (Number.isFinite(behind) && behind > 0) parts.push(`↓${behind}`);
    return parts.join(' ');
  }, [gitStatus]);

  const languageLabel = useMemo(() => toLanguageLabel(editorState.languageId), [editorState.languageId]);
  const lspSummary = useMemo(() => summarizeLspStatus(lspByServerId, editorState.languageId), [lspByServerId, editorState.languageId]);

  const line = Number(editorState.line) || 1;
  const column = Number(editorState.column) || 1;
  const selectionLength = Number(editorState.selectionLength) || 0;
  const tabSize = Number(editorState.tabSize) || 4;
  const insertSpaces = !!editorState.insertSpaces;
  const eol = String(editorState.eol || 'LF');
  const encoding = String(editorState.encoding || 'UTF-8');

  return (
    <div className="status-bar" role="status" aria-label="Status Bar">
      <div className="status-bar-left">
        <button type="button" className="status-item" onClick={onClickGit || undefined} title="Source Control">
          <span className="codicon codicon-git-branch" aria-hidden />
          <span className="status-item-text">{gitBranch || 'Git'}</span>
          {gitMeta ? <span className="status-item-text status-item-muted">{gitMeta}</span> : null}
        </button>

        {workspaceBindingStatus === 'error' ? (
          <div className="status-pill status-pill-danger" title="Workspace connection error">
            Connection Error
          </div>
        ) : null}
      </div>

      <div className="status-bar-center" aria-hidden />

      <div className="status-bar-right">
        <div className="status-item status-item-noclick" title={editorState.filePath || ''}>
          Ln {line}, Col {column}{selectionLength > 0 ? ` (${selectionLength} sel)` : ''}
        </div>
        <span className="status-sep" aria-hidden />
        <div className="status-item status-item-noclick" title="Indentation">
          {insertSpaces ? `Spaces: ${tabSize}` : `Tab Size: ${tabSize}`}
        </div>
        <span className="status-sep" aria-hidden />
        <div className="status-item status-item-noclick" title="Encoding">
          {encoding}
        </div>
        <span className="status-sep" aria-hidden />
        <div className="status-item status-item-noclick" title="End of Line">
          {eol}
        </div>
        <span className="status-sep" aria-hidden />
        <div className="status-item status-item-noclick" title="Language Mode">
          {languageLabel}
        </div>
        <span className="status-sep" aria-hidden />
        <div className={`status-item status-item-noclick status-tone-${lspSummary.tone}`} title="Language Server Protocol">
          {lspSummary.label}
        </div>
      </div>
    </div>
  );
}
