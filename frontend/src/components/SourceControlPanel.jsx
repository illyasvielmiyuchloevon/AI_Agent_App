import React, { useState, useEffect, useRef, useMemo } from 'react';

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
    onPull,
    onPush,
    onRefresh,
    onGenerateCommitMessage,
    onInit,
    onAddRemote,
    onOpenFile,
    onDiff,
    onGetCommitDetails,
    onGetCommitStats,
    onOpenCommitDiff,
    onOpenAllDiffs,
    onOpenBatchDiffs,
    onDiscard,
    onDiscardAll,
    loading,
    repositoryLabel,
    onPublishBranch,
    onSetUpstream
}) => {
    const [message, setMessage] = useState('');
    const [expanded, setExpanded] = useState(() => {
        if (typeof window !== 'undefined') {
            try {
                const stored = window.localStorage.getItem('sc-expanded-v2');
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed && typeof parsed === 'object') {
                        const defaults = { staged: true, unstaged: true, repositories: true, graph: true };
                        return { ...defaults, ...parsed };
                    }
                }
            } catch {
            }
        }
        return { staged: true, unstaged: true, repositories: true, graph: true };
    });
    const [expandedCommits, setExpandedCommits] = useState({});
    const [loadingCommits, setLoadingCommits] = useState({});
    const [isAddingRemote, setIsAddingRemote] = useState(false);
    const [newRemoteName, setNewRemoteName] = useState('origin');
    const [newRemoteUrl, setNewRemoteUrl] = useState('');
    const [addRemoteError, setAddRemoteError] = useState('');
    const [addingRemote, setAddingRemote] = useState(false);
    const [viewMode, setViewMode] = useState('list');
    const [selectedFile, setSelectedFile] = useState(null);
    const [sectionOrder, setSectionOrder] = useState(() => {
        if (typeof window !== 'undefined') {
            try {
                const stored = window.localStorage.getItem('sc-section-order-v2');
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (Array.isArray(parsed) && parsed.length) {
                        const allowed = ['staged', 'unstaged', 'repositories', 'graph'];
                        const filtered = parsed.filter(id => allowed.includes(id));
                        const missing = allowed.filter(id => !filtered.includes(id));
                        const next = [...filtered, ...missing];
                        if (next.length) return next;
                    }
                }
            } catch {
            }
        }
        return ['staged', 'unstaged', 'repositories', 'graph'];
    });
    const [layout, setLayout] = useState(() => {
        if (typeof window !== 'undefined') {
            try {
                const stored = window.localStorage.getItem('sc-layout-v2');
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed && typeof parsed === 'object') {
                        return {
                            staged: typeof parsed.staged === 'number' ? parsed.staged : 220,
                            unstaged: typeof parsed.unstaged === 'number' ? parsed.unstaged : 260,
                            repositories: typeof parsed.repositories === 'number' ? parsed.repositories : 180,
                            graph: typeof parsed.graph === 'number' ? parsed.graph : 260
                        };
                    }
                }
            } catch {
            }
        }
        return { staged: 220, unstaged: 260, repositories: 180, graph: 260 };
    });
    const [draggingSection, setDraggingSection] = useState(null);
    const messageRef = useRef(null);
    const listsRef = useRef(null);
    const [syncHint, setSyncHint] = useState(null);

    // Hover state management
    const [hoveredCommit, setHoveredCommit] = useState(null); // { commit, rect }
    const [statsCache, setStatsCache] = useState({}); // { hash: { files, insertions, deletions } }
    const hoverTimeoutRef = useRef(null);

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

    const handleCommitMouseEnter = (commit, element) => {
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = null;
        }
        
        const rect = element.getBoundingClientRect();
        setHoveredCommit({ commit, rect });

        if (!statsCache[commit.hash] && onGetCommitStats) {
            onGetCommitStats(commit.hash).then(stats => {
                if (stats) {
                    setStatsCache(prev => ({ ...prev, [commit.hash]: stats }));
                }
            }).catch(console.error);
        }
    };

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem('sc-layout-v2', JSON.stringify(layout));
        } catch {
        }
    }, [layout]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem('sc-expanded-v2', JSON.stringify(expanded));
        } catch {
        }
    }, [expanded]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem('sc-section-order-v2', JSON.stringify(sectionOrder));
        } catch {
        }
    }, [sectionOrder]);

    const handleCommitMouseLeave = () => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        // Short timeout to allow moving to popup
        hoverTimeoutRef.current = setTimeout(() => {
            setHoveredCommit(null);
        }, 150); 
    };

    const handlePopupMouseEnter = () => {
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = null;
        }
    };

    if (!gitStatus && !loading) {
        return (
            <div className="sc-panel" style={{ alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                <p style={{ marginBottom: '15px', textAlign: 'center', fontSize: '13px', color: 'var(--muted)' }}>当前文件夹不是 Git 仓库。</p>
                <button className="primary-btn" onClick={onInit}>初始化仓库</button>
            </div>
        );
    }

    const staged = gitStatus?.files?.filter(f => ['A', 'M', 'D', 'R'].includes(f.working_dir) === false && ['A', 'M', 'D', 'R'].includes(f.index)) || [];
    const changes = gitStatus?.files?.filter(f => ['A', 'M', 'D', 'R', '?'].includes(f.working_dir)) || [];
    const totalChanges = staged.length + changes.length;

    const handleKeyDown = (e) => {
        if (e.ctrlKey && e.key === 'Enter') {
            handleCommit();
        }
    };

    const handleCommit = () => {
        const trimmed = message.trim();
        if (!trimmed || staged.length === 0) return;
        onCommit(trimmed);
        setMessage('');
    };

    const handleAddRemoteSubmit = async () => {
        if (addingRemote) return;
        const name = newRemoteName.trim();
        const url = newRemoteUrl.trim();
        if (!name) {
            setAddRemoteError('远程名称不能为空');
            return;
        }
        if (!url) {
            setAddRemoteError('远程地址不能为空');
            return;
        }
        const isHttp = /^https?:\/\//i.test(url);
        const isSsh = /^git@[^:]+:[^/]+\/.+/i.test(url);
        if (!isHttp && !isSsh) {
            setAddRemoteError('远程地址格式不正确，请使用 https 或 ssh URL');
            return;
        }
        setAddingRemote(true);
        setAddRemoteError('');
        try {
            await onAddRemote(name, url);
            setIsAddingRemote(false);
            setNewRemoteName('origin');
            setNewRemoteUrl('');
            if (onRefresh) {
                onRefresh();
            }
        } catch (e) {
            const raw = e && e.message ? String(e.message) : String(e || '');
            const lower = raw.toLowerCase();
            let next = '添加远程仓库失败，请检查配置后重试。';
            if (lower.includes('exists') || lower.includes('already')) {
                next = '远程名称已存在，请使用其他名称。';
            } else if (lower.includes('url') || lower.includes('invalid')) {
                next = '远程地址无效，请检查 URL 是否正确。';
            }
            setAddRemoteError(next);
        } finally {
            setAddingRemote(false);
        }
    };

    const handleAiGenerate = async () => {
        const msg = await onGenerateCommitMessage();
        if (msg) setMessage(msg);
    };

    useEffect(() => {
        const el = messageRef.current;
        if (!el) return;
        el.style.height = 'auto';
        const lineHeight = 18;
        const maxHeight = lineHeight * 6;
        const next = Math.min(el.scrollHeight, maxHeight);
        el.style.height = `${next}px`;
    }, [message]);

    const canCommit = !!message.trim() && staged.length > 0;

    const handleDiscardAllClick = () => {
        if (!onDiscardAll) return;
        if (totalChanges === 0) return;
        onDiscardAll();
    };

    const handleStageAllClick = () => {
        if (!onStageAll) return;
        if (changes.length === 0) return;
        onStageAll();
    };

    const handleUnstageAllClick = () => {
        if (!onUnstageAll) return;
        if (staged.length === 0) return;
        onUnstageAll();
    };

    const handleSectionDragStart = (id) => (e) => {
        setDraggingSection(id);
        if (e.dataTransfer) {
            try {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', id);
            } catch {
            }
        }
    };

    const handleSectionDragOver = (targetId) => (e) => {
        e.preventDefault();
        if (!draggingSection || draggingSection === targetId) return;
        setSectionOrder(prev => {
            const fromIndex = prev.indexOf(draggingSection);
            const toIndex = prev.indexOf(targetId);
            if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev;
            const next = prev.slice();
            next.splice(fromIndex, 1);
            next.splice(toIndex, 0, draggingSection);
            return next;
        });
    };

    const handleSectionDragEnd = () => {
        setDraggingSection(null);
    };

    const startResize = (topId, bottomId) => (e) => {
        if (draggingSection) return;
        e.preventDefault();
        e.stopPropagation();
        const pointerId = e.pointerId;
        const target = e.currentTarget;
        if (target && typeof target.setPointerCapture === 'function') {
            try {
                target.setPointerCapture(pointerId);
            } catch {
            }
        }
        if (typeof document !== 'undefined') {
            document.body.style.userSelect = 'none';
        }
        let lastY = e.clientY;
        const handleMove = (event) => {
            if (event.pointerId !== pointerId) return;
            const delta = event.clientY - lastY;
            if (!delta) return;
            lastY = event.clientY;
            setLayout(prev => {
                const minHeight = 96;
                if (!topId || !bottomId || !(topId in prev) || !(bottomId in prev)) {
                    return prev;
                }
                let topHeight = prev[topId] + delta;
                let bottomHeight = prev[bottomId] - delta;
                const total = topHeight + bottomHeight;
                if (topHeight < minHeight) {
                    topHeight = minHeight;
                    bottomHeight = total - minHeight;
                } else if (bottomHeight < minHeight) {
                    bottomHeight = minHeight;
                    topHeight = total - minHeight;
                }
                return {
                    ...prev,
                    [topId]: Math.max(topHeight, minHeight),
                    [bottomId]: Math.max(bottomHeight, minHeight)
                };
            });
        };
        const handleUp = (event) => {
            if (event.pointerId !== pointerId) return;
            if (target && typeof target.releasePointerCapture === 'function') {
                try {
                    target.releasePointerCapture(pointerId);
                } catch {
                }
            }
            if (typeof document !== 'undefined') {
                document.body.style.userSelect = '';
            }
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
        };
        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
    };

    const handleSyncClick = (e) => {
        e.stopPropagation();
        if (!onSync) return;
        const hasRemote = Array.isArray(gitRemotes) && gitRemotes.length > 0;
        const hasUpstream = !!gitStatus?.tracking;
        if (!hasRemote) {
            setSyncHint('noRemote');
            setIsAddingRemote(true);
            return;
        }
        if (!hasUpstream) {
            setSyncHint('noUpstream');
            return;
        }
        onSync();
    };

    const handlePullClick = (e) => {
        e.stopPropagation();
        const hasRemote = Array.isArray(gitRemotes) && gitRemotes.length > 0;
        const hasUpstream = !!gitStatus?.tracking;
        if (!hasRemote) {
            setSyncHint('noRemote');
            setIsAddingRemote(true);
            return;
        }
        if (!hasUpstream) {
            setSyncHint('noUpstream');
            return;
        }
        if (onPull) {
            onPull();
        }
    };

    const handlePushClick = (e) => {
        e.stopPropagation();
        const hasRemote = Array.isArray(gitRemotes) && gitRemotes.length > 0;
        const hasUpstream = !!gitStatus?.tracking;
        if (!hasRemote) {
            setSyncHint('noRemote');
            setIsAddingRemote(true);
            return;
        }
        if (!hasUpstream) {
            setSyncHint('noUpstream');
            return;
        }
        if (onPush) {
            onPush();
        }
    };

    const handleToggleGraph = () => {
        setExpanded(prev => {
            const wasExpanded = prev.graph;
            const next = { ...prev, graph: !prev.graph };
            if (!wasExpanded) {
                setLayout(prevLayout => {
                    const minHeight = 96;
                    const container = listsRef.current;
                    const containerHeight = container ? container.clientHeight : 0;
                    let targetHeight = prevLayout.graph;
                    if (containerHeight > 0) {
                        const half = containerHeight * 0.5;
                        let remaining = half;
                        if (sectionOrder[sectionOrder.length - 1] === 'graph') {
                            const others = sectionOrder
                                .filter(id => id !== 'graph')
                                .reduce((sum, id) => sum + (prevLayout[id] || minHeight), 0);
                            remaining = Math.max(containerHeight - others, half);
                        }
                        targetHeight = Math.max(remaining, minHeight);
                    } else {
                        targetHeight = Math.max(prevLayout.graph, 260);
                    }
                    return {
                        ...prevLayout,
                        graph: targetHeight
                    };
                });
            } else {
                setLayout(prevLayout => ({
                    ...prevLayout,
                    graph: Math.max(96, prevLayout.graph || 96)
                }));
            }
            return next;
        });
    };

    const renderSection = (id) => {
        if (id === 'staged') {
            return (
                <div className="sc-section" style={{ minHeight: Math.max(layout.staged, 96) }} onDragOver={handleSectionDragOver('staged')} onDrop={handleSectionDragEnd}>
                    <div
                        className="sc-section-header"
                        onClick={() => setExpanded(p => ({ ...p, staged: !p.staged }))}
                        draggable
                        onDragStart={handleSectionDragStart('staged')}
                        onDragEnd={handleSectionDragEnd}
                        aria-label="拖动以调整暂存分组顺序"
                    >
                        <div className="sc-section-icon">{expanded.staged ? '▼' : '▶'}</div>
                        <div className="sc-section-label">
                            暂存的更改
                            <span className="sc-count-badge">{staged.length}</span>
                        </div>
                        <div className="sc-section-actions sc-section-actions-inline">
                            <button
                                className="sc-action-btn"
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleUnstageAllClick();
                                }}
                                disabled={staged.length === 0}
                                title="取消全部暂存"
                                aria-label="取消全部暂存"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="5" y1="12" x2="19" y2="12" />
                                </svg>
                            </button>
                        </div>
                    </div>
                    {expanded.staged && (
                        <div className="sc-file-list">
                            {staged.map(file => (
                                <FileItem
                                    key={`staged-${file.path}`}
                                    file={file}
                                    onAction={() => onUnstage([file.path])}
                                    actionIcon="-"
                                    onOpen={() => onOpenFile(file.path)}
                                    onDiff={() => onDiff(file.path, true)}
                                    onDiscard={null}
                                    selected={selectedFile === file.path}
                                    onSelect={() => setSelectedFile(file.path)}
                                />
                            ))}
                            {staged.length === 0 && (
                                <div style={{ padding: '8px 16px', fontSize: '12px', color: 'var(--muted)' }}>
                                    当前没有暂存的更改。
                                </div>
                            )}
                        </div>
                    )}
                </div>
            );
        }

        if (id === 'unstaged') {
            return (
                <div className="sc-section" style={{ minHeight: Math.max(layout.unstaged, 96) }} onDragOver={handleSectionDragOver('unstaged')} onDrop={handleSectionDragEnd}>
                    <div
                        className="sc-section-header"
                        onClick={() => setExpanded(p => ({ ...p, unstaged: !p.unstaged }))}
                        draggable
                        onDragStart={handleSectionDragStart('unstaged')}
                        onDragEnd={handleSectionDragEnd}
                        aria-label="拖动以调整更改分组顺序"
                    >
                        <div className="sc-section-icon">{expanded.unstaged ? '▼' : '▶'}</div>
                        <div className="sc-section-label">
                            更改
                            <span className="sc-count-badge">{changes.length}</span>
                        </div>
                        <div className="sc-section-actions sc-section-actions-inline">
                            <button
                                className="sc-action-btn"
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleStageAllClick();
                                }}
                                disabled={changes.length === 0}
                                title="全部暂存"
                                aria-label="全部暂存"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="12" y1="5" x2="12" y2="19" />
                                    <line x1="5" y1="12" x2="19" y2="12" />
                                </svg>
                            </button>
                            <button
                                className="sc-action-btn"
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleDiscardAllClick();
                                }}
                                disabled={changes.length === 0 || !onDiscardAll}
                                title="全部丢弃更改"
                                aria-label="全部丢弃更改"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M9 14 4 9l5-5" />
                                    <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11" />
                                </svg>
                            </button>
                        </div>
                    </div>
                    {expanded.unstaged && (
                        <div className="sc-file-list">
                            {changes.map(file => (
                                <FileItem
                                    key={`change-${file.path}`}
                                    file={file}
                                    onAction={() => onStage([file.path])}
                                    actionIcon="+"
                                    onDiscard={() => onDiscard && onDiscard([file.path])}
                                    onOpen={() => onOpenFile(file.path)}
                                    onDiff={() => onDiff(file.path, false)}
                                    selected={selectedFile === file.path}
                                    onSelect={() => setSelectedFile(file.path)}
                                />
                            ))}
                            {changes.length === 0 && (
                                <div style={{ padding: '8px 16px', fontSize: '12px', color: 'var(--muted)' }}>
                                    当前没有未暂存的更改。
                                </div>
                            )}
                        </div>
                    )}
                </div>
            );
        }

        if (id === 'repositories') {
            return (
                <div className="sc-section" style={{ minHeight: Math.max(layout.repositories, 96) }} onDragOver={handleSectionDragOver('repositories')} onDrop={handleSectionDragEnd}>
                    <div
                        className="sc-section-header"
                        onClick={() => setExpanded(p => ({ ...p, repositories: !p.repositories }))}
                        draggable
                        onDragStart={handleSectionDragStart('repositories')}
                        onDragEnd={handleSectionDragEnd}
                        aria-label="拖动以调整存储库分组顺序"
                    >
                        <div className="sc-section-icon">{expanded.repositories ? '▼' : '▶'}</div>
                        <div className="sc-section-label">
                            存储库 <span className="sc-count-badge">{gitRemotes.length}</span>
                        </div>
                        <div className="sc-section-actions">
                            <button onClick={(e) => { e.stopPropagation(); setAddRemoteError(''); setIsAddingRemote(true); }} className="sc-action-btn" title="添加远程仓库" aria-label="添加远程仓库">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                            </button>
                        </div>
                    </div>
                    {expanded.repositories && (
                        <>
                            {syncHint === 'noRemote' && (
                                <div className="sc-remote-error">
                                    当前仓库未配置远程，请先添加远程或发布仓库后再同步。
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
                                        <span className="sc-repo-mode">GIT 集成</span>
                                        <button
                                            className="sc-item-btn"
                                            onClick={handleSyncClick}
                                            title="同步"
                                            type="button"
                                            aria-label="同步"
                                        >
                                            ⟳
                                        </button>
                                        <button
                                            className="sc-item-btn"
                                            onClick={(e) => { e.stopPropagation(); }}
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
                                        <div className="sc-remote-subtitle">推荐使用 https 或 ssh 地址，添加后可用于推送和拉取。</div>
                                    </div>
                                    <div className="sc-remote-field">
                                        <div className="sc-remote-label">远程名称</div>
                                        <input
                                            className="sc-input small"
                                            value={newRemoteName}
                                            onChange={e => setNewRemoteName(e.target.value)}
                                            placeholder="例如：origin"
                                        />
                                        <div className="sc-remote-hint">一般使用 origin 作为默认远程名称。</div>
                                    </div>
                                    <div className="sc-remote-field">
                                        <div className="sc-remote-label">远程地址</div>
                                        <input
                                            className="sc-input small"
                                            value={newRemoteUrl}
                                            onChange={e => setNewRemoteUrl(e.target.value)}
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
                                            }}
                                        >
                                            取消
                                        </button>
                                        <button
                                            className="sc-btn primary"
                                            type="button"
                                            onClick={handleAddRemoteSubmit}
                                            disabled={addingRemote}
                                        >
                                            添加
                                        </button>
                                    </div>
                                </div>
                            )}
                            {gitRemotes.length > 0 && (
                                <div className="sc-remote-list">
                                    {gitRemotes.map(remote => (
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

        if (id === 'graph') {
            return (
                <div className="sc-section" style={{ minHeight: Math.max(layout.graph, 96) }} onDragOver={handleSectionDragOver('graph')} onDrop={handleSectionDragEnd}>
                    <div
                        className="sc-section-header"
                        onClick={handleToggleGraph}
                        draggable
                        onDragStart={handleSectionDragStart('graph')}
                        onDragEnd={handleSectionDragEnd}
                        aria-label="拖动以调整图形分组顺序"
                    >
                        <div className="sc-section-icon">{expanded.graph ? '▼' : '▶'}</div>
                        <div className="sc-section-label">
                            图形 <span className="sc-count-badge">{gitLog.length}</span>
                        </div>
                        <div className="sc-section-actions">
                            <button
                                className="sc-action-btn"
                                onClick={(e) => { e.stopPropagation(); setViewMode(m => m === 'list' ? 'tree' : 'list'); }}
                                title={viewMode === 'list' ? '切换为树形视图' : '切换为列表视图'}
                                aria-label={viewMode === 'list' ? '切换为树形视图' : '切换为列表视图'}
                            >
                                <span
                                    className={`codicon ${viewMode === 'list' ? 'codicon-list-tree' : 'codicon-list-flat'}`}
                                    aria-hidden
                                    style={{ fontSize: '18px' }}
                                />
                            </button>
                        </div>
                    </div>
                    {expanded.graph && (
                        <div style={{ paddingBottom: '10px' }}>
                            {gitLog.map(commit => (
                                <CommitItem
                                    key={commit.hash}
                                    commit={commit}
                                    expanded={!!expandedCommits[commit.hash]}
                                    loading={!!loadingCommits[commit.hash]}
                                    files={expandedCommits[commit.hash]}
                                    onToggle={toggleCommit}
                                    onOpenAllDiffs={onOpenAllDiffs}
                                    onOpenCommitDiff={onOpenCommitDiff}
                                    onMouseEnter={(e) => handleCommitMouseEnter(commit, e.currentTarget)}
                                    onMouseLeave={handleCommitMouseLeave}
                                    isHovered={hoveredCommit?.commit?.hash === commit.hash}
                                    viewMode={viewMode}
                                />
                            ))}
                            {gitLog.length === 0 && (
                                <div style={{ padding: '16px', textAlign: 'center', color: 'var(--muted)', fontSize: '12px' }}>暂无提交记录，在上方完成一次提交后即可看到提交图形。</div>
                            )}
                        </div>
                    )}
                </div>
            );
        }

        return null;
    };

    return (
        <div className="sc-panel">
            <div className="sc-header">
                <span className="sc-title">源代码管理</span>
                <div className="sc-header-actions">
                     <button className="sc-action-btn" onClick={handlePullClick} title="拉取">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
                     </button>
                     <button className="sc-action-btn" onClick={handlePushClick} title="推送">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
                     </button>
                     <button className="sc-action-btn" onClick={onRefresh} title="刷新">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                     </button>
                     <button className="sc-action-btn" title="更多操作">
                        <span className="codicon codicon-ellipsis" aria-hidden />
                     </button>
                </div>
            </div>

            <div className="sc-lists" ref={listsRef}>
                <div className="sc-commit-block">
                    <div className="sc-commit-row">
                        <div className="sc-commit-input-shell sc-commit-input-shell-multiline">
                            <textarea
                                ref={messageRef}
                                className="sc-commit-input sc-commit-textarea"
                                placeholder="提交变更内容(Ctrl+Enter 在“GIT集成”提交)"
                                value={message}
                                onChange={e => setMessage(e.target.value)}
                                onKeyDown={handleKeyDown}
                            />
                            <button
                                className="sc-commit-status-btn"
                                onClick={handleAiGenerate}
                                title="生成提交说明"
                                type="button"
                            >
                                ✨
                            </button>
                        </div>
                    </div>
                    <div className="sc-commit-actions-row">
                        <div className="sc-commit-buttons">
                            <button
                                className="sc-commit-primary"
                                onClick={handleCommit}
                                disabled={!canCommit}
                                type="button"
                            >
                                提交
                                <span className="sc-commit-kbd">Ctrl+Enter</span>
                            </button>
                            <button
                                className="sc-commit-dropdown"
                                type="button"
                                title="更多提交选项"
                            >
                                ▾
                            </button>
                        </div>
                    </div>
                    <div className="sc-bulk-actions-bar">
                        <button
                            className="sc-action-btn"
                            type="button"
                            onClick={handleStageAllClick}
                            disabled={changes.length === 0}
                            title="全部暂存"
                            aria-label="全部暂存"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                        </button>
                        <button
                            className="sc-action-btn"
                            type="button"
                            onClick={handleUnstageAllClick}
                            disabled={staged.length === 0}
                            title="取消全部暂存"
                            aria-label="取消全部暂存"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                        </button>
                        <button
                            className="sc-action-btn"
                            type="button"
                            onClick={handleDiscardAllClick}
                            disabled={totalChanges === 0 || !onDiscardAll}
                            title="全部丢弃更改"
                            aria-label="全部丢弃更改"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9 14 4 9l5-5" />
                                <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5 5.5 5.5 0 0 1-5.5 5.5H11" />
                            </svg>
                        </button>
                    </div>
                </div>

                {sectionOrder.map((id, index) => (
                    <React.Fragment key={id}>
                        {renderSection(id)}
                        {index < sectionOrder.length - 1 && (
                            <div
                                className="sc-splitter"
                                onPointerDown={startResize(id, sectionOrder[index + 1])}
                            />
                        )}
                    </React.Fragment>
                ))}
                <div
                    className="sc-dropzone-bottom"
                    onDragOver={(e) => {
                        e.preventDefault();
                        if (!draggingSection) return;
                        setSectionOrder(prev => {
                            const fromIndex = prev.indexOf(draggingSection);
                            if (fromIndex === -1 || fromIndex === prev.length - 1) return prev;
                            const next = prev.slice();
                            next.splice(fromIndex, 1);
                            next.push(draggingSection);
                            return next;
                        });
                    }}
                    onDrop={handleSectionDragEnd}
                />
            </div>

            {/* Hover Popup */}
            {hoveredCommit && (
                <CommitDetailsPopup 
                    commit={hoveredCommit.commit}
                    rect={hoveredCommit.rect}
                    stats={statsCache[hoveredCommit.commit.hash]}
                    onMouseEnter={handlePopupMouseEnter}
                    onMouseLeave={handleCommitMouseLeave}
                    onOpenAllDiffs={onOpenAllDiffs}
                    remotes={gitRemotes}
                />
            )}
        </div>
    );
};

const FileItem = ({ file, onAction, actionIcon, onOpen, onDiff, onDiscard, selected, onSelect }) => {
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
    const ext = fileName.includes('.') ? fileName.split('.').pop().toUpperCase().slice(0, 3) : '';
    const iconLabel = ext || 'FILE';
    const isDeleted = status === 'D';

    return (
        <div 
            className={`sc-file-item${selected ? ' selected' : ''}`} 
            onClick={() => {
                if (onSelect) onSelect();
                onOpen();
            }}
            onContextMenu={(e) => { e.preventDefault(); onDiff(); }}
        >
            <span className="sc-file-type">{iconLabel}</span>
            <span className="sc-file-name" style={{ textDecoration: isDeleted ? 'line-through' : 'none', opacity: isDeleted ? 0.6 : 1 }}>
                {fileName} <span className="sc-file-path">{dirName}</span>
            </span>
            <div className="sc-file-actions">
                 {onDiscard && (
                    <button 
                        className="sc-item-btn" 
                        onClick={(e) => { e.stopPropagation(); onDiscard(); }}
                        title="Discard Changes"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>
                    </button>
                 )}
                 <button 
                    className="sc-item-btn" 
                    onClick={(e) => { e.stopPropagation(); onDiff(); }}
                    title="Open Diff"
                 >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="4" y="3" width="6" height="18" rx="1" />
                        <rect x="14" y="3" width="6" height="18" rx="1" />
                    </svg>
                 </button>
                 <button 
                    className="sc-item-btn" 
                    onClick={(e) => { e.stopPropagation(); onAction(); }}
                    title={actionIcon === '+' ? "Stage Changes" : "Unstage Changes"}
                 >
                    {actionIcon === '+' ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    )}
                 </button>
            </div>
            <span className="sc-status-pill" style={{ color, borderColor: color }}>
                {status === '?' ? 'U' : status}
            </span>
        </div>
    );
};

const buildFileTree = (files) => {
    const root = {};
    files.forEach(file => {
        const parts = file.path.split('/');
        let current = root;
        parts.forEach((part, index) => {
            if (!current[part]) {
                current[part] = {
                    name: part,
                    path: parts.slice(0, index + 1).join('/'),
                    children: {},
                    file: index === parts.length - 1 ? file : null
                };
            }
            current = current[part].children;
        });
    });
    return root;
};

const FileTreeItem = ({ node, depth = 0, onOpenCommitDiff, commitHash }) => {
    const [expanded, setExpanded] = useState(true);
    const hasChildren = Object.keys(node.children).length > 0;
    const isFile = !!node.file;

    return (
        <div>
            <div 
                className="sc-file-item" 
                style={{ paddingLeft: `${depth * 12 + 4}px`, height: '24px' }}
                onClick={(e) => {
                    e.stopPropagation();
                    if (isFile) {
                        onOpenCommitDiff(commitHash, node.file.path);
                    } else {
                        setExpanded(!expanded);
                    }
                }}
            >
                {hasChildren && (
                    <span 
                        style={{ marginRight: '4px', fontSize: '10px', width: '10px', display: 'inline-block' }}
                        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                    >
                        {expanded ? '▼' : '▶'}
                    </span>
                )}
                {!hasChildren && <span style={{ width: '14px' }}></span>}
                
                {isFile && (
                    <span className="sc-status-icon" style={{ 
                        color: node.file.status === 'M' ? 'var(--warning)' : (node.file.status === 'A' ? 'var(--success)' : (node.file.status === 'D' ? 'var(--danger)' : 'var(--muted)')), 
                        marginRight: '6px'
                    }}>
                        {node.file.status}
                    </span>
                )}
                <span className="sc-file-name" style={{ fontSize: '12px' }}>{node.name}</span>
            </div>
            {expanded && hasChildren && (
                <div>
                    {Object.values(node.children).map(child => (
                        <FileTreeItem 
                            key={child.path} 
                            node={child} 
                            depth={depth + 1} 
                            onOpenCommitDiff={onOpenCommitDiff}
                            commitHash={commitHash}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const CommitItem = ({ commit, expanded, loading, files, onToggle, onOpenAllDiffs, onOpenCommitDiff, onMouseEnter, onMouseLeave, isHovered, viewMode }) => {
    const treeRoot = useMemo(() => expanded && files && viewMode === 'tree' ? buildFileTree(files) : null, [files, expanded, viewMode]);

    return (
        <div 
            className="sc-commit-item" 
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            style={{ position: 'relative' }}
        >
            <div className="sc-commit-dot"></div>
            <div 
                className="sc-commit-header"
                onClick={() => onToggle(commit.hash)}
                style={{ display: 'flex', alignItems: 'center', height: '24px' }}
            >
                <div className="sc-commit-msg" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, fontWeight: 'normal' }}>
                    {commit.message}
                </div>
                <button 
                    className="sc-action-btn"
                    style={{ 
                        marginLeft: 'auto', 
                        opacity: isHovered ? 1 : 0, 
                        width: '24px', 
                        height: '24px',
                        pointerEvents: isHovered ? 'auto' : 'none',
                        transition: 'opacity 0.2s'
                    }}
                    onClick={(e) => { e.stopPropagation(); onOpenAllDiffs(commit.hash); }}
                    title="Open Diff View"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="4" y="3" width="6" height="18" rx="1" />
                        <rect x="14" y="3" width="6" height="18" rx="1" />
                    </svg>
                </button>
            </div>

            {loading && <div style={{ fontSize: '11px', paddingLeft: '8px', color: 'var(--muted)' }}>Loading files...</div>}
            
            {expanded && files && (
                <div className="sc-file-list" style={{ marginTop: '4px', borderLeft: '1px solid var(--border)', marginLeft: '4px' }}>
                    {viewMode === 'list' ? (
                        files.map(file => (
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
                        ))
                    ) : (
                        Object.values(treeRoot).map(node => (
                            <FileTreeItem 
                                key={node.path} 
                                node={node} 
                                onOpenCommitDiff={onOpenCommitDiff}
                                commitHash={commit.hash}
                            />
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

const CommitDetailsPopup = ({ commit, rect, stats, onMouseEnter, onMouseLeave, onOpenAllDiffs, remotes }) => {
    if (!rect) return null;

    const getRemoteUrl = () => {
        if (!remotes || remotes.length === 0) return null;
        const origin = remotes.find(r => r.name === 'origin') || remotes[0];
        let url = origin.refs.fetch || origin.refs.push;
        if (!url) return null;
        
        // Handle git@github.com:user/repo.git -> https://github.com/user/repo
        if (url.startsWith('git@')) {
            url = url.replace(':', '/').replace('git@', 'https://');
        }
        
        // Remove .git suffix
        url = url.replace(/\.git$/, '');

        // Standardize: github.com/user/repo -> github.com/user/repo/commit/hash
        // This works for GitHub, GitLab, Bitbucket usually
        return `${url}/commit/${commit.hash}`;
    };

    const remoteUrl = getRemoteUrl();

    // Position calculation: To the right of the item
    const style = {
        position: 'fixed',
        top: Math.min(rect.top, window.innerHeight - 200), // Prevent going off bottom
        left: rect.right + 10,
        width: '300px',
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
        zIndex: 99999,
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        fontSize: '13px' // Increased font size
    };

    // If it goes off the right edge, flip to left
    if (style.left + 320 > window.innerWidth) {
        style.left = rect.left - 310; 
    }

    return (
        <div 
            style={style}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
        >
            <div style={{ fontWeight: 'bold', fontSize: '14px', borderBottom: '1px solid var(--border)', paddingBottom: '4px', marginBottom: '4px' }}>
                Commit Details
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', alignItems: 'center' }}>
                <span style={{ color: 'var(--muted)' }}>Message:</span>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{commit.message}</span>
                
                <span style={{ color: 'var(--muted)' }}>Author:</span>
                <span>{commit.author_name}</span>
                
                <span style={{ color: 'var(--muted)' }}>Date:</span>
                <span>{new Date(commit.date).toLocaleString()}</span>
                
                <span style={{ color: 'var(--muted)' }}>Files:</span>
                <span>{stats ? stats.files : (commit.files_count || '...')}</span>

                {stats && (
                    <>
                        <span style={{ color: 'var(--muted)' }}>Lines:</span>
                        <span style={{ display: 'flex', gap: '8px' }}>
                            <span style={{ color: 'var(--success)' }}>+{stats.insertions}</span>
                            <span style={{ color: 'var(--danger)' }}>-{stats.deletions}</span>
                        </span>
                    </>
                )}
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <button 
                    className="primary-btn" 
                    style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', height: '32px' }}
                    onClick={(e) => { e.stopPropagation(); onOpenAllDiffs(commit.hash); }}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="4" y="3" width="6" height="18" rx="1" />
                        <rect x="14" y="3" width="6" height="18" rx="1" />
                    </svg>
                    Open Diff View
                </button>
                {remoteUrl && (
                    <button 
                        className="ghost-btn" 
                        style={{ width: '32px', padding: 0 }}
                        onClick={(e) => { e.stopPropagation(); window.open(remoteUrl, '_blank'); }}
                        title="Open on Git"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
                    </button>
                )}
            </div>
        </div>
    );
};

export default SourceControlPanel;
