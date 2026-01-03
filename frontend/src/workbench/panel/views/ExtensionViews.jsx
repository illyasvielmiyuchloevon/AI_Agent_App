import React, { useMemo } from 'react';

function GitLensGraphPlaceholder({ commits = [], activeCommit, onSelectCommit }) {
  const selected = activeCommit || commits[0] || null;
  return (
    <div className="gitlens-shell">
      <div className="gitlens-left">
        <div className="gitlens-header">Commit Graph</div>
        <div className="gitlens-list">
          {commits.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`gitlens-row ${selected?.id === c.id ? 'active' : ''}`}
              onClick={() => onSelectCommit?.(c)}
            >
              <span className="gitlens-dot" aria-hidden />
              <div className="gitlens-row-main">
                <div className="gitlens-msg">{c.message}</div>
                <div className="gitlens-meta">{c.author} · {c.when}</div>
              </div>
              <span className="gitlens-hash">{c.id.slice(0, 7)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="gitlens-right">
        <div className="gitlens-header">Commit Details</div>
        {selected ? (
          <div className="gitlens-details">
            <div className="gitlens-details-title">{selected.message}</div>
            <div className="gitlens-details-meta">{selected.author} · {selected.when} · {selected.id}</div>
            <div className="gitlens-details-section">
              <div className="gitlens-details-section-title">Files Changed</div>
              <div className="gitlens-files">
                {(selected.files || []).map((f) => (
                  <div key={f} className="gitlens-file">
                    <span className="codicon codicon-file" aria-hidden />
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="panel-empty" style={{ paddingTop: 28 }}>
            <div className="panel-empty-title">暂无提交。</div>
            <div className="panel-empty-subtitle">GitLens 作为扩展视图可挂载到 Panel 中。</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ExtensionViews({ extensionKey = 'gitlens', state, onChangeState }) {
  const gitLensCommits = useMemo(() => ([
    { id: 'a3c1b2d4e', message: 'feat: bottom panel scaffold', author: 'you', when: 'just now', files: ['frontend/src/workbench/panel/Panel.jsx'] },
    { id: 'c8d7e6f5a', message: 'chore: tweak styles', author: 'you', when: 'today', files: ['frontend/src/index.css'] },
    { id: 'f1e2d3c4b', message: 'fix: workspace layout', author: 'you', when: 'yesterday', files: ['frontend/src/components/Workspace.jsx'] },
  ]), []);

  if (extensionKey !== 'gitlens') {
    return (
      <div className="panel-empty">
        <div className="panel-empty-title">未找到扩展视图：{extensionKey}</div>
        <div className="panel-empty-subtitle">扩展视图通过统一容器挂载，享受同样的 Tabs/工具栏体验。</div>
      </div>
    );
  }

  return (
    <GitLensGraphPlaceholder
      commits={state?.commits || gitLensCommits}
      activeCommit={state?.activeCommit || null}
      onSelectCommit={(c) => onChangeState?.({ ...(state || {}), activeCommit: c })}
    />
  );
}

