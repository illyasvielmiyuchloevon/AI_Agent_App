import React, { useState, useEffect } from 'react';

const SourceControlPanel = ({
    gitStatus,
    gitRemotes = [],
    gitLog = [],
    onCommit,
    onStage,
    onUnstage,
    onStageAll,
    onUnstageAll,
    onSync,
    onRefresh,
    onGenerateCommitMessage,
    onInit,
    onAddRemote,
    onOpenFile,
    onDiff,
    onGetCommitDetails,
    onOpenCommitDiff,
    onOpenAllDiffs,
    loading
}) => {
    const [message, setMessage] = useState('');
    const [expanded, setExpanded] = useState({ staged: true, changes: true, remotes: false, history: true });
    const [expandedCommits, setExpandedCommits] = useState({});
    const [loadingCommits, setLoadingCommits] = useState({});
    const [isAddingRemote, setIsAddingRemote] = useState(false);
    const [newRemoteName, setNewRemoteName] = useState('origin');
    const [newRemoteUrl, setNewRemoteUrl] = useState('');

    const toggleCommit = async (hash) => {
        if (expandedCommits[hash]) {
            setExpandedCommits(prev => {
                const next = { ...prev };
                delete next[hash];
                return next;
            });
            return;
        }
        setLoadingCommits(prev => ({ ...prev, [hash]: true }));
        try {
            const files = await onGetCommitDetails(hash);
            setExpandedCommits(prev => ({ ...prev, [hash]: files }));
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingCommits(prev => ({ ...prev, [hash]: false }));
        }
    };

    if (!gitStatus && !loading) {
        return (
            <div className="sc-panel" style={{ alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                <p style={{ marginBottom: '15px', textAlign: 'center', fontSize: '13px', color: 'var(--muted)' }}>The current folder is not a git repository.</p>
                <button className="primary-btn" onClick={onInit}>Initialize Repository</button>
            </div>
        );
    }

    const staged = gitStatus?.files?.filter(f => ['A', 'M', 'D', 'R'].includes(f.working_dir) === false && ['A', 'M', 'D', 'R'].includes(f.index)) || [];
    const changes = gitStatus?.files?.filter(f => ['A', 'M', 'D', 'R', '?'].includes(f.working_dir)) || [];

    const handleKeyDown = (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
            handleCommit();
        }
    };

    const handleCommit = () => {
        if (!message.trim()) return;
        onCommit(message);
        setMessage('');
    };

    const handleAddRemoteSubmit = async () => {
        if (!newRemoteName || !newRemoteUrl) return;
        await onAddRemote(newRemoteName, newRemoteUrl);
        setIsAddingRemote(false);
        setNewRemoteName('origin');
        setNewRemoteUrl('');
    };

    const handleAiGenerate = async () => {
        const msg = await onGenerateCommitMessage();
        if (msg) setMessage(msg);
    };

    return (
        <div className="sc-panel">
            <div className="sc-header">
                <span className="sc-title">Source Control</span>
                <div className="sc-header-actions">
                     <button className="sc-action-btn" onClick={onRefresh} title="Refresh">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                     </button>
                     <button className="sc-action-btn" onClick={onSync} title="Sync">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4"/></svg>
                     </button>
                </div>
            </div>

            <div className="sc-input-area">
                <div className="sc-input-wrapper">
                    <textarea 
                        className="sc-input"
                        placeholder="Message (Ctrl+Enter to commit)"
                        value={message}
                        onChange={e => setMessage(e.target.value)}
                        onKeyDown={handleKeyDown}
                    />
                    <button 
                        className="sc-ai-btn"
                        onClick={handleAiGenerate}
                        title="Generate Commit Message with AI"
                    >
                        ✨
                    </button>
                </div>
                <button 
                    className="sc-commit-btn" 
                    onClick={handleCommit}
                    disabled={staged.length === 0}
                >
                    Commit
                </button>
            </div>

            <div className="sc-lists">
                {/* Staged Changes */}
                <div className="sc-section">
                     <div 
                        className="sc-section-header" 
                        onClick={() => setExpanded(p => ({ ...p, staged: !p.staged }))}
                     >
                        <div className="sc-section-icon">{expanded.staged ? '▼' : '▶'}</div>
                        <div className="sc-section-label">
                            Staged Changes <span className="sc-count-badge">{staged.length}</span>
                        </div>
                        <div className="sc-section-actions">
                             <button onClick={(e) => { e.stopPropagation(); onUnstageAll(); }} className="sc-action-btn" title="Unstage All">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                             </button>
                        </div>
                     </div>
                     {expanded.staged && (
                        <div className="sc-file-list">
                            {staged.map(file => (
                                <FileItem 
                                    key={file.path} 
                                    file={file} 
                                    onAction={() => onUnstage([file.path])} 
                                    actionIcon="-" 
                                    onOpen={() => onOpenFile(file.path)}
                                    onDiff={() => onDiff(file.path)}
                                />
                            ))}
                        </div>
                     )}
                </div>

                {/* Changes */}
                <div className="sc-section">
                     <div 
                        className="sc-section-header" 
                        onClick={() => setExpanded(p => ({ ...p, changes: !p.changes }))}
                     >
                        <div className="sc-section-icon">{expanded.changes ? '▼' : '▶'}</div>
                        <div className="sc-section-label">
                            Changes <span className="sc-count-badge">{changes.length}</span>
                        </div>
                        <div className="sc-section-actions">
                             <button onClick={(e) => { e.stopPropagation(); onStageAll(); }} className="sc-action-btn" title="Stage All">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                             </button>
                        </div>
                     </div>
                     {expanded.changes && (
                        <div className="sc-file-list">
                            {changes.map(file => (
                                <FileItem 
                                    key={file.path} 
                                    file={file} 
                                    onAction={() => onStage([file.path])} 
                                    actionIcon="+" 
                                    onOpen={() => onOpenFile(file.path)}
                                    onDiff={() => onDiff(file.path)}
                                />
                            ))}
                        </div>
                     )}
                </div>

                {/* Remotes */}
                <div className="sc-section">
                     <div 
                        className="sc-section-header" 
                        onClick={() => setExpanded(p => ({ ...p, remotes: !p.remotes }))}
                     >
                        <div className="sc-section-icon">{expanded.remotes ? '▼' : '▶'}</div>
                        <div className="sc-section-label">
                            Remotes <span className="sc-count-badge">{gitRemotes.length}</span>
                        </div>
                        <div className="sc-section-actions">
                             <button onClick={(e) => { e.stopPropagation(); setIsAddingRemote(true); }} className="sc-action-btn" title="Add Remote">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                             </button>
                        </div>
                     </div>
                     {expanded.remotes && (
                        <div className="sc-remote-form">
                            {isAddingRemote && (
                                <div style={{ marginBottom: '10px' }}>
                                    <input 
                                        className="sc-input small"
                                        value={newRemoteName} 
                                        onChange={e => setNewRemoteName(e.target.value)} 
                                        placeholder="Remote Name (e.g. origin)"
                                    />
                                    <input 
                                        className="sc-input small"
                                        value={newRemoteUrl} 
                                        onChange={e => setNewRemoteUrl(e.target.value)} 
                                        placeholder="URL (https://...)"
                                    />
                                    <div className="sc-form-actions">
                                        <button className="sc-btn ghost" onClick={() => setIsAddingRemote(false)}>Cancel</button>
                                        <button className="sc-btn primary" onClick={handleAddRemoteSubmit}>Add Remote</button>
                                    </div>
                                </div>
                            )}
                            {gitRemotes.map(remote => (
                                <div key={remote.name} className="sc-file-item" style={{ height: 'auto', padding: '6px 0', alignItems: 'flex-start' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        <div style={{ fontWeight: 'bold' }}>{remote.name}</div>
                                        <div style={{ opacity: 0.7, fontSize: '11px' }}>{remote.refs.fetch}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                     )}
                </div>

                {/* History / Commits */}
                <div className="sc-section">
                     <div 
                        className="sc-section-header" 
                        onClick={() => setExpanded(p => ({ ...p, history: !p.history }))}
                     >
                        <div className="sc-section-icon">{expanded.history ? '▼' : '▶'}</div>
                        <div className="sc-section-label">
                            Commits <span className="sc-count-badge">{gitLog.length}</span>
                        </div>
                     </div>
                     {expanded.history && (
                        <div style={{ paddingBottom: '10px' }}>
                            {gitLog.map(commit => (
                                <div key={commit.hash} className="sc-commit-item">
                                    <div className="sc-commit-dot"></div>
                                    <div 
                                        className="sc-commit-header"
                                        onClick={() => toggleCommit(commit.hash)}
                                    >
                                        <div className="sc-commit-msg">{commit.message}</div>
                                        <div className="sc-commit-meta">
                                            <span>{commit.author_name}</span>
                                            <span>{new Date(commit.date).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                    
                                    <div className="sc-commit-actions">
                                        <button 
                                            className="sc-item-btn"
                                            onClick={(e) => { e.stopPropagation(); onOpenAllDiffs(commit.hash); }}
                                            title="Open All Diffs"
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                                        </button>
                                    </div>

                                    {loadingCommits[commit.hash] && <div style={{ fontSize: '11px', paddingLeft: '8px', color: 'var(--muted)' }}>Loading files...</div>}
                                    
                                    {expandedCommits[commit.hash] && (
                                        <div className="sc-file-list" style={{ marginTop: '4px', borderLeft: '1px solid var(--border)', marginLeft: '4px' }}>
                                            {expandedCommits[commit.hash].map(file => (
                                                <div 
                                                    key={file.path} 
                                                    className="sc-file-item"
                                                    style={{ height: '24px' }}
                                                    onClick={(e) => { e.stopPropagation(); onOpenCommitDiff(commit.hash, file.path); }}
                                                    title={`Click to diff ${file.path}`}
                                                >
                                                    <span className="sc-status-icon" style={{ 
                                                        color: file.status === 'M' ? 'var(--warning)' : (file.status === 'A' ? 'var(--success)' : (file.status === 'D' ? 'var(--danger)' : 'var(--muted)')), 
                                                    }}>
                                                        {file.status}
                                                    </span>
                                                    <span className="sc-file-name" style={{ fontSize: '12px' }}>{file.path}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                            {gitLog.length === 0 && (
                                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>No commits yet.</div>
                            )}
                        </div>
                     )}
                </div>
            </div>
        </div>
    );
};

const FileItem = ({ file, onAction, actionIcon, onOpen, onDiff }) => {
    const getStatusColor = (code) => {
        if (code === 'M') return 'var(--warning)';
        if (code === 'A' || code === '?') return 'var(--success)';
        if (code === 'D') return 'var(--danger)';
        return 'var(--muted)';
    };

    const status = file.working_dir !== ' ' ? file.working_dir : file.index;
    const color = getStatusColor(status);
    const fileName = file.path.split('/').pop();
    const dirName = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '';

    return (
        <div 
            className="sc-file-item" 
            onClick={onOpen}
            onContextMenu={(e) => { e.preventDefault(); onDiff(); }}
        >
            <span className="sc-status-icon" style={{ color }}>{status === '?' ? 'U' : status}</span>
            <span className="sc-file-name">
                {fileName} <span className="sc-file-path">{dirName}</span>
            </span>
            <div className="sc-file-actions">
                 <button 
                    className="sc-item-btn" 
                    onClick={(e) => { e.stopPropagation(); onDiff(); }}
                    title="Open Diff"
                 >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                 </button>
                 <button 
                    className="sc-item-btn" 
                    onClick={(e) => { e.stopPropagation(); onAction(); }}
                    title={actionIcon === '+' ? "Stage Changes" : "Unstage Changes"}
                 >
                    {actionIcon === '+' ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    )}
                 </button>
            </div>
        </div>
    );
};

export default SourceControlPanel;
