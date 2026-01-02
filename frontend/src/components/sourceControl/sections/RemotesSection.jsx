import React from 'react';

export default function RemotesSection({
  expanded,
  onToggle,
  onDragOver,
  onDrop,
  onDragStart,
  onDragEnd,
  gitRemotes,
  repositoryLabel,
  gitStatus,
  syncHint,
  setSyncHint,
  isAddingRemote,
  setIsAddingRemote,
  newRemoteName,
  setNewRemoteName,
  newRemoteUrl,
  setNewRemoteUrl,
  addRemoteError,
  setAddRemoteError,
  addingRemote,
  onAddRemoteSubmit,
  onPublishBranch,
  onSetUpstream,
  onSyncClick,
  onOpenRepoMenu,
}) {
  return (
    <div
      className="sc-section"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        className="sc-section-header"
        onClick={onToggle}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        aria-label="拖动以调整存储库分组顺序"
      >
        <div className="sc-section-icon">{expanded ? '▼' : '▶'}</div>
        <div className="sc-section-label">
          存储库 <span className="sc-count-badge">{gitRemotes.length}</span>
        </div>
        <div className="sc-section-actions">
          <button
            onClick={(e) => { e.stopPropagation(); setAddRemoteError(''); setIsAddingRemote(true); }}
            className="sc-action-btn"
            title="添加远程仓库"
            aria-label="添加远程仓库"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          </button>
        </div>
      </div>
      {expanded && (
        <>
          {syncHint === 'noRemote' && (
            <div className="sc-remote-error">
              未配置远程仓库，请先添加远程后再同步。
            </div>
          )}
          {syncHint === 'noUpstream' && gitStatus?.current && (
            <div className="sc-remote-error">
              <div style={{ marginBottom: '8px' }}>当前分支未设置上游分支：{gitStatus.current}</div>
              <div className="sc-remote-actions">
                {onPublishBranch && (
                  <button
                    className="sc-btn primary"
                    type="button"
                    onClick={() => {
                      onPublishBranch(gitStatus.current);
                      setSyncHint(null);
                    }}
                  >
                    发布分支
                  </button>
                )}
                {onSetUpstream && (
                  <button
                    className="sc-btn ghost"
                    type="button"
                    onClick={() => {
                      onSetUpstream(gitStatus.current);
                      setSyncHint(null);
                    }}
                  >
                    仅设置上游
                  </button>
                )}
                <button
                  className="sc-btn ghost"
                  type="button"
                  onClick={() => setSyncHint(null)}
                >
                  关闭
                </button>
              </div>
            </div>
          )}
          <div className="sc-repo-section">
            <div className="sc-repo-item">
              <div className="sc-repo-main">
                <div className="sc-repo-name">
                  {repositoryLabel || '未选择工作区'}
                </div>
                <div className="sc-repo-meta">
                  <span>{gitStatus?.current || '无分支'}</span>
                  {gitStatus?.tracking && (
                    <span className="sc-repo-badge">{gitStatus.tracking}</span>
                  )}
                  {(gitStatus?.ahead > 0 || gitStatus?.behind > 0) && (
                    <span className="sc-repo-sync">
                      {gitStatus.ahead > 0 && `↑${gitStatus.ahead} `}
                      {gitStatus.behind > 0 && `↓${gitStatus.behind}`}
                    </span>
                  )}
                </div>
              </div>
              <div className="sc-repo-actions">
                <button
                  className="sc-item-btn"
                  onClick={onSyncClick}
                  title="同步"
                  type="button"
                  aria-label="同步"
                >
                  ⟳
                </button>
                <button
                  className="sc-item-btn"
                  onClick={onOpenRepoMenu}
                  title="更多"
                  type="button"
                  aria-label="更多"
                >
                  <span className="codicon codicon-ellipsis" aria-hidden />
                </button>
              </div>
            </div>
          </div>
          {isAddingRemote && (
            <div className="sc-remote-form">
              <div className="sc-remote-header">
                <div className="sc-remote-title">添加远程仓库</div>
                <button className="sc-icon-btn" onClick={() => { setIsAddingRemote(false); setAddRemoteError(''); setSyncHint(null); }}>×</button>
              </div>
              <div className="sc-remote-field">
                <div className="sc-remote-label">远程名称</div>
                <input
                  className="sc-input small"
                  value={newRemoteName}
                  onChange={(e) => setNewRemoteName(e.target.value)}
                  placeholder="例如：origin"
                />
                <div className="sc-remote-hint">一般使用 origin 作为默认远程名称。</div>
              </div>
              <div className="sc-remote-field">
                <div className="sc-remote-label">远程地址</div>
                <input
                  className="sc-input small"
                  value={newRemoteUrl}
                  onChange={(e) => setNewRemoteUrl(e.target.value)}
                  placeholder="例如：https://github.com/user/repo.git 或 git@github.com:user/repo.git"
                />
              </div>
              {addRemoteError && (
                <div className="sc-remote-error">
                  {addRemoteError}
                </div>
              )}
              <div className="sc-remote-actions">
                <button
                  className="sc-btn ghost"
                  type="button"
                  onClick={() => {
                    setIsAddingRemote(false);
                    setAddRemoteError('');
                    setSyncHint(null);
                  }}
                >
                  取消
                </button>
                <button
                  className="sc-btn primary"
                  type="button"
                  onClick={onAddRemoteSubmit}
                  disabled={addingRemote}
                >
                  添加
                </button>
              </div>
            </div>
          )}
          {gitRemotes.length > 0 && (
            <div className="sc-remote-list">
              {gitRemotes.map((remote) => (
                <div key={remote.name} className="sc-file-item" style={{ height: 'auto', padding: '6px 16px', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontWeight: 'bold' }}>{remote.name}</div>
                    <div style={{ opacity: 0.7, fontSize: '11px' }}>{remote.refs.fetch}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

