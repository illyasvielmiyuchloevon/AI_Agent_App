import React, { useEffect, useMemo, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { List } from 'react-window';
import { gitService } from '../../services/gitService';
import { useMeasuredHeight } from '../_shared/useMeasuredHeight';

const RowHeight = 32;

export default function GitLensView({ workspacePath = '' }) {
  const snap = useSyncExternalStore(gitService.subscribe, gitService.getSnapshot, gitService.getSnapshot);
  const [details, setDetails] = useState({ stats: null, files: [] });
  const [listRef, listHeight] = useMeasuredHeight();

  useEffect(() => {
    gitService.refresh({ cwd: workspacePath }).catch(() => {});
  }, [workspacePath]);

  useEffect(() => {
    const selected = snap.selected;
    const hash = selected?.hash || selected?.id || '';
    if (!hash) return;
    let cancelled = false;
    Promise.all([
      gitService.getCommitStats({ cwd: workspacePath, hash }),
      gitService.getCommitDetails({ cwd: workspacePath, hash }),
    ]).then(([stats, files]) => {
      if (cancelled) return;
      setDetails({ stats: stats || null, files: Array.isArray(files) ? files : [] });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [snap.selected, workspacePath]);

  const commits = Array.isArray(snap.commits) ? snap.commits : [];
  const selected = snap.selected || commits[0] || null;

  const Row = ({ index, style }) => {
    const c = commits[index];
    const isActive = !!selected && (selected.hash === c.hash);
    return (
      <button
        type="button"
        className={`gitlens-row ${isActive ? 'active' : ''}`}
        style={{ ...style, height: RowHeight }}
        onClick={() => gitService.select(c)}
        title={c.message}
      >
        <span className="gitlens-dot" aria-hidden />
        <div className="gitlens-row-main">
          <div className="gitlens-msg">{c.message}</div>
          <div className="gitlens-meta">{c.author_name || c.author || '—'} · {c.date || c.when || ''}</div>
        </div>
        <span className="gitlens-hash">{String(c.hash || '').slice(0, 7)}</span>
      </button>
    );
  };

  if (snap.loading) {
    return (
      <div className="panel-empty">
        <div className="panel-empty-title">加载 Git 历史…</div>
        <div className="panel-empty-subtitle">需要 Electron Git IPC 可用。</div>
      </div>
    );
  }

  if (snap.error) {
    return (
      <div className="panel-empty">
        <div className="panel-empty-title">GitLens 不可用</div>
        <div className="panel-empty-subtitle">{snap.error}</div>
      </div>
    );
  }

  if (!commits.length) {
    return (
      <div className="panel-empty">
        <div className="panel-empty-title">暂无提交。</div>
        <div className="panel-empty-subtitle">初始化 Git 仓库或在 Electron 环境打开。</div>
      </div>
    );
  }

  const selectedHash = selected?.hash || '';
  const selectedTitle = selected?.message || '';
  const selectedMeta = `${selected?.author_name || '—'} · ${selected?.date || ''} · ${selectedHash}`;

  const files = Array.isArray(details.files) ? details.files : [];
  const stats = details.stats;

  return (
    <div className="gitlens-shell">
      <div className="gitlens-left">
        <div className="gitlens-header">Commit Graph</div>
        <div ref={listRef} className="gitlens-list">
          <List
            style={{ height: Math.max(120, listHeight || 0), width: '100%' }}
            rowCount={commits.length}
            rowHeight={RowHeight}
            rowComponent={Row}
            rowProps={{}}
          />
        </div>
      </div>
      <div className="gitlens-right">
        <div className="gitlens-header">Commit Details</div>
        <div className="gitlens-details">
          <div className="gitlens-details-title">{selectedTitle}</div>
          <div className="gitlens-details-meta">{selectedMeta}</div>
          {stats ? (
            <div className="panel-list-meta" style={{ marginBottom: 10 }}>
              <span>{stats.files} files</span>
              <span>+{stats.insertions}</span>
              <span>-{stats.deletions}</span>
            </div>
          ) : null}
          <div className="gitlens-details-section">
            <div className="gitlens-details-section-title">Files Changed</div>
            <div className="gitlens-files">
              {files.map((f) => (
                <div key={f.path || f} className="gitlens-file">
                  <span className="codicon codicon-file" aria-hidden />
                  <span>{f.path || String(f)}</span>
                  {f.status ? <span style={{ marginLeft: 8, color: 'var(--muted)', fontSize: 12 }}>{f.status}</span> : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
