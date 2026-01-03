import React, { useState, useEffect, useRef } from 'react';
import { useSourceControlPreferences } from '../hooks/useSourceControlPreferences';
import CommitHoverCard from './sourceControl/CommitHoverCard';
import ConflictsSection from './sourceControl/sections/ConflictsSection';
import StagedSection from './sourceControl/sections/StagedSection';
import UnstagedSection from './sourceControl/sections/UnstagedSection';
import BranchesSection from './sourceControl/sections/BranchesSection';
import RemotesSection from './sourceControl/sections/RemotesSection';
import GraphSection from './sourceControl/sections/GraphSection';

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
    onSetUpstream,
    gitBranches,
    onCreateBranch,
    onDeleteBranch,
    onCheckoutBranch,
    onResolve
}) => {
    const [message, setMessage] = useState('');
    const { expanded, setExpanded, sectionOrder, setSectionOrder, viewMode, setViewMode } = useSourceControlPreferences();
    const [expandedCommits, setExpandedCommits] = useState({});
    const [loadingCommits, setLoadingCommits] = useState({});
    const [isAddingRemote, setIsAddingRemote] = useState(false);
    const [newRemoteName, setNewRemoteName] = useState('origin');
    const [newRemoteUrl, setNewRemoteUrl] = useState('');
    const [addRemoteError, setAddRemoteError] = useState('');
    const [addingRemote, setAddingRemote] = useState(false);
    const [isCreatingBranch, setIsCreatingBranch] = useState(false);
    const [newBranchName, setNewBranchName] = useState('');
    const [selectedFile, setSelectedFile] = useState(null);
    const [draggingSection, setDraggingSection] = useState(null);
    const messageRef = useRef(null);
    const listsRef = useRef(null);
    const [syncHint, setSyncHint] = useState(null);
    const [repoMenu, setRepoMenu] = useState(null);
    const [commitMenu, setCommitMenu] = useState(null);
    const commitDropdownRef = useRef(null);

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

    useEffect(() => {
        const el = messageRef.current;
        if (!el) return;
        el.style.height = 'auto';
        const lineHeight = 18;
        const maxHeight = lineHeight * 6;
        const next = Math.min(el.scrollHeight, maxHeight);
        el.style.height = `${next}px`;
    }, [message]);

    useEffect(() => {
        if (!repoMenu) return;
        const handler = (e) => {
            if (e.key === 'Escape') {
                setRepoMenu(null);
            }
        };
        window.addEventListener('keydown', handler);
        return () => {
            window.removeEventListener('keydown', handler);
        };
    }, [repoMenu]);

    useEffect(() => {
        if (!commitMenu) return;
        const handler = (e) => {
            if (e.key === 'Escape') {
                setCommitMenu(null);
            }
        };
        window.addEventListener('keydown', handler);
        return () => {
            window.removeEventListener('keydown', handler);
        };
    }, [commitMenu]);

    if (!gitStatus && !loading) {
        return (
            <div className="sc-panel" style={{ alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                <p style={{ marginBottom: '15px', textAlign: 'center', fontSize: '13px', color: 'var(--muted)' }}>当前文件夹不是 Git 仓库。</p>
                <button className="primary-btn" onClick={onInit}>初始化仓库</button>
            </div>
        );
    }

    const conflicts = gitStatus?.files?.filter(f => 
        (f.index === 'U' || f.working_dir === 'U') || 
        (f.index === 'A' && f.working_dir === 'A') || 
        (f.index === 'D' && f.working_dir === 'D') ||
        (f.index === 'U' && f.working_dir === 'D') ||
        (f.index === 'D' && f.working_dir === 'U') ||
        (f.index === 'A' && f.working_dir === 'U') ||
        (f.index === 'U' && f.working_dir === 'A')
    ) || [];

    const staged = (gitStatus?.files?.filter(f => ['A', 'M', 'D', 'R'].includes(f.index)) || [])
        .filter(f => !conflicts.includes(f));
        
    const changes = (gitStatus?.files?.filter(f => ['A', 'M', 'D', 'R', '?'].includes(f.working_dir)) || [])
        .filter(f => !conflicts.includes(f));
    const totalChanges = staged.length + changes.length + conflicts.length;

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

    const closeCommitMenu = () => setCommitMenu(null);

    const openCommitMenu = () => {
        const el = commitDropdownRef.current;
        if (!el || typeof el.getBoundingClientRect !== 'function') return;
        const rect = el.getBoundingClientRect();
        const menuWidth = 220;
        const gap = 6;
        const x = Math.max(8, Math.min((rect.right - menuWidth), (window.innerWidth - menuWidth - 8)));
        const y = Math.min(window.innerHeight - 8, rect.bottom + gap);
        setCommitMenu({ x, y });
    };

    const handleCommitMenuToggle = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (commitMenu) closeCommitMenu();
        else openCommitMenu();
    };

    const runMaybePromise = async (fn, ...args) => {
        if (typeof fn !== 'function') return;
        const res = fn(...args);
        if (res && typeof res.then === 'function') await res;
    };

    const runCommitFlow = async ({ after } = {}) => {
        const trimmed = message.trim();
        if (!trimmed || staged.length === 0) return;
        closeCommitMenu();
        setMessage('');
        await runMaybePromise(onCommit, trimmed);
        await runMaybePromise(after);
    };

    const renderCommitMenuItem = (label, action, { danger = false, disabled = false } = {}) => (
        <div
            className={`context-item ${danger ? 'danger' : ''} ${disabled ? 'disabled' : ''}`}
            style={{ padding: '8px 12px', ...(danger ? { color: 'var(--danger)' } : {}) }}
            onClick={async () => {
                if (disabled) return;
                if (action) {
                    await action();
                }
                closeCommitMenu();
            }}
        >
            {label}
        </div>
    );

    const handleCreateBranchConfirm = async () => {
        if (!newBranchName.trim()) return;
        try {
            await onCreateBranch(newBranchName.trim());
            setIsCreatingBranch(false);
            setNewBranchName('');
        } catch (e) {
            console.error(e);
        }
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
            setSyncHint(null);
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

    const handleToggleRepositories = () => {
        setExpanded(prev => {
            const nextOpen = !prev.repositories;
            if (!nextOpen) {
                setSyncHint(null);
            }
            return {
                ...prev,
                repositories: nextOpen
            };
        });
    };

    const openRepoMenu = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        setRepoMenu({
            x: rect.left,
            y: rect.bottom + 4
        });
    };

    const closeRepoMenu = () => setRepoMenu(null);

    const runSync = () => {
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

    const handleSyncClick = (e) => {
        e.stopPropagation();
        runSync();
    };

    const runPull = () => {
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

    const handlePullClick = (e) => {
        e.stopPropagation();
        runPull();
    };

    const runPush = () => {
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

    const handlePushClick = (e) => {
        e.stopPropagation();
        runPush();
    };

    const handleCopyBranchName = async () => {
        if (!gitStatus?.current) return;
        if (typeof navigator === 'undefined' || !navigator.clipboard || !navigator.clipboard.writeText) return;
        try {
            await navigator.clipboard.writeText(gitStatus.current);
        } catch {
        }
    };

    const handleCopyRemoteUrl = async () => {
        if (!gitRemotes || gitRemotes.length === 0) return;
        const origin = gitRemotes.find(r => r.name === 'origin') || gitRemotes[0];
        const url = origin?.refs?.fetch || origin?.refs?.push;
        if (!url) return;
        if (typeof navigator === 'undefined' || !navigator.clipboard || !navigator.clipboard.writeText) return;
        try {
            await navigator.clipboard.writeText(url);
        } catch {
        }
    };

    const renderRepoMenuItem = (label, action, { danger = false, disabled = false } = {}) => (
        <div
            className={`context-item ${danger ? 'danger' : ''} ${disabled ? 'disabled' : ''}`}
            style={{ padding: '8px 12px', ...(danger ? { color: 'var(--danger)' } : {}) }}
            onClick={() => {
                if (disabled) return;
                if (action) {
                    action();
                }
                closeRepoMenu();
            }}
        >
            {label}
        </div>
    );

    const handleToggleGraph = () => {
        setExpanded(prev => ({
            ...prev,
            graph: !prev.graph
        }));
    };

    const renderSection = (id) => {
        if (id === 'conflicts') {
            return (
                <ConflictsSection
                    expanded={expanded.conflicts}
                    onToggle={() => setExpanded(p => ({ ...p, conflicts: !p.conflicts }))}
                    onDragOver={handleSectionDragOver('conflicts')}
                    onDrop={handleSectionDragEnd}
                    onDragStart={handleSectionDragStart('conflicts')}
                    onDragEnd={handleSectionDragEnd}
                    conflicts={conflicts}
                    FileItem={FileItem}
                    onOpenFile={onOpenFile}
                    onDiff={onDiff}
                    selectedFile={selectedFile}
                    onSelectFile={setSelectedFile}
                    onResolve={onResolve}
                />
            );
        }

        if (id === 'staged') {
            if (!staged || staged.length === 0) return null;
            return (
                <StagedSection
                    expanded={expanded.staged}
                    onToggle={() => setExpanded(p => ({ ...p, staged: !p.staged }))}
                    onDragOver={handleSectionDragOver('staged')}
                    onDrop={handleSectionDragEnd}
                    onDragStart={handleSectionDragStart('staged')}
                    onDragEnd={handleSectionDragEnd}
                    staged={staged}
                    FileItem={FileItem}
                    onUnstage={onUnstage}
                    onOpenFile={onOpenFile}
                    onDiff={onDiff}
                    selectedFile={selectedFile}
                    onSelectFile={setSelectedFile}
                    canDiscardAll={totalChanges > 0 && !!onDiscardAll}
                    onDiscardAllClick={handleDiscardAllClick}
                    onUnstageAll={handleUnstageAllClick}
                    onViewAll={() => {
                        if (onOpenBatchDiffs) onOpenBatchDiffs(staged, 'staged');
                    }}
                />
            );
        }

        if (id === 'unstaged') {
            if (!changes || changes.length === 0) return null;
            return (
                <UnstagedSection
                    expanded={expanded.unstaged}
                    onToggle={() => setExpanded(p => ({ ...p, unstaged: !p.unstaged }))}
                    onDragOver={handleSectionDragOver('unstaged')}
                    onDrop={handleSectionDragEnd}
                    onDragStart={handleSectionDragStart('unstaged')}
                    onDragEnd={handleSectionDragEnd}
                    changes={changes}
                    FileItem={FileItem}
                    onStage={onStage}
                    onDiscard={onDiscard}
                    onOpenFile={onOpenFile}
                    onDiff={onDiff}
                    selectedFile={selectedFile}
                    onSelectFile={setSelectedFile}
                    canDiscardAll={totalChanges > 0 && !!onDiscardAll}
                    onDiscardAllClick={handleDiscardAllClick}
                    canOpenChangesDiff={changes.length > 0 && !!onOpenBatchDiffs}
                    onOpenChangesDiff={() => {
                        if (onOpenBatchDiffs) onOpenBatchDiffs(changes, 'unstaged');
                    }}
                    onStageAll={handleStageAllClick}
                />
            );
        }

        if (id === 'repositories') {
            return (
                <RemotesSection
                    expanded={expanded.repositories}
                    onToggle={handleToggleRepositories}
                    onDragOver={handleSectionDragOver('repositories')}
                    onDrop={handleSectionDragEnd}
                    onDragStart={handleSectionDragStart('repositories')}
                    onDragEnd={handleSectionDragEnd}
                    gitRemotes={gitRemotes}
                    repositoryLabel={repositoryLabel}
                    gitStatus={gitStatus}
                    syncHint={syncHint}
                    setSyncHint={setSyncHint}
                    isAddingRemote={isAddingRemote}
                    setIsAddingRemote={setIsAddingRemote}
                    newRemoteName={newRemoteName}
                    setNewRemoteName={setNewRemoteName}
                    newRemoteUrl={newRemoteUrl}
                    setNewRemoteUrl={setNewRemoteUrl}
                    addRemoteError={addRemoteError}
                    setAddRemoteError={setAddRemoteError}
                    addingRemote={addingRemote}
                    onAddRemoteSubmit={handleAddRemoteSubmit}
                    onPublishBranch={onPublishBranch}
                    onSetUpstream={onSetUpstream}
                    onSyncClick={handleSyncClick}
                    onOpenRepoMenu={openRepoMenu}
                />
            );
        }

        if (id === 'graph') {
            return (
                <GraphSection
                    expanded={expanded.graph}
                    onToggle={handleToggleGraph}
                    onDragOver={handleSectionDragOver('graph')}
                    onDrop={handleSectionDragEnd}
                    onDragStart={handleSectionDragStart('graph')}
                    onDragEnd={handleSectionDragEnd}
                    gitLog={gitLog}
                    expandedCommits={expandedCommits}
                    loadingCommits={loadingCommits}
                    onToggleCommit={toggleCommit}
                    onOpenAllDiffs={onOpenAllDiffs}
                    onOpenCommitDiff={onOpenCommitDiff}
                    onCommitMouseEnter={handleCommitMouseEnter}
                    onCommitMouseLeave={handleCommitMouseLeave}
                    hoveredCommitHash={hoveredCommit?.commit?.hash}
                    viewMode={viewMode}
                    setViewMode={setViewMode}
                />
            );
        }

        if (id === 'branches') {
            return (
                <BranchesSection
                    expanded={expanded.branches}
                    onToggle={() => setExpanded(p => ({ ...p, branches: !p.branches }))}
                    onDragOver={handleSectionDragOver('branches')}
                    onDrop={handleSectionDragEnd}
                    onDragStart={handleSectionDragStart('branches')}
                    onDragEnd={handleSectionDragEnd}
                    gitBranches={gitBranches}
                    isCreatingBranch={isCreatingBranch}
                    setIsCreatingBranch={setIsCreatingBranch}
                    newBranchName={newBranchName}
                    setNewBranchName={setNewBranchName}
                    onCreateBranchConfirm={handleCreateBranchConfirm}
                    onCheckoutBranch={onCheckoutBranch}
                    onDeleteBranch={onDeleteBranch}
                />
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
                     <button className="sc-action-btn" title="更多操作" onClick={openRepoMenu}>
                        <span className="codicon codicon-ellipsis" aria-hidden />
                     </button>
                </div>
            </div>

            <div
                className="sc-lists"
                ref={listsRef}
                style={draggingSection ? { overflowY: 'hidden' } : undefined}
            >
                <div className="sc-commit-block">
                    <div className="sc-commit-row">
                        <div className="sc-commit-input-wrapper">
                            <textarea
                                ref={messageRef}
                                className="sc-commit-input sc-commit-textarea sc-commit-textarea-main"
                                placeholder="Message (Ctrl+Enter to commit)"
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
                    <div className="sc-commit-actions-row sc-commit-actions-row-full">
                        <div className="sc-commit-button-group">
                            <button
                                className="sc-commit-primary"
                                onClick={handleCommit}
                                disabled={!canCommit}
                                type="button"
                                title="提交"
                                aria-label="提交"
                            >
                                <span className="codicon codicon-check" aria-hidden />
                                提交
                            </button>
                            <button
                                className="sc-commit-dropdown"
                                onClick={handleCommitMenuToggle}
                                disabled={!canCommit}
                                type="button"
                                title="更多操作"
                                aria-label="更多操作"
                                ref={commitDropdownRef}
                            >
                                <span className="codicon codicon-chevron-down" aria-hidden />
                            </button>
                        </div>
                    </div>
                </div>

                {sectionOrder.map((id) => (
                    <React.Fragment key={id}>
                        {renderSection(id)}
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

            {repoMenu && (
                <>
                    <div
                        style={{
                            position: 'fixed',
                            inset: 0,
                            zIndex: 99998
                        }}
                        onClick={closeRepoMenu}
                    />
                    <div
                        className="context-menu"
                        style={{
                            position: 'fixed',
                            top: repoMenu.y,
                            left: repoMenu.x,
                            background: 'var(--panel)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius)',
                            boxShadow: 'var(--shadow-soft)',
                            zIndex: 99999,
                            minWidth: 200,
                            padding: 4
                        }}
                    >
                        {renderRepoMenuItem('同步', runSync, { disabled: !onSync })}
                        {renderRepoMenuItem('拉取', runPull, { disabled: !onPull })}
                        {renderRepoMenuItem('推送', runPush, { disabled: !onPush })}
                        {renderRepoMenuItem('刷新', onRefresh, { disabled: !onRefresh })}
                        <div style={{ height: 1, margin: '4px 0', background: 'var(--border)' }} />
                        {renderRepoMenuItem(
                            '添加远程仓库',
                            () => {
                                setAddRemoteError('');
                                setIsAddingRemote(true);
                            }
                        )}
                        {renderRepoMenuItem(
                            '发布当前分支',
                            () => {
                                if (onPublishBranch && gitStatus?.current) {
                                    onPublishBranch(gitStatus.current);
                                }
                            },
                            { disabled: !onPublishBranch || !gitStatus?.current }
                        )}
                        {renderRepoMenuItem(
                            '设置上游分支',
                            () => {
                                if (onSetUpstream && gitStatus?.current) {
                                    onSetUpstream(gitStatus.current);
                                }
                            },
                            { disabled: !onSetUpstream || !gitStatus?.current }
                        )}
                        <div style={{ height: 1, margin: '4px 0', background: 'var(--border)' }} />
                        {renderRepoMenuItem(
                            '复制当前分支名',
                            handleCopyBranchName,
                            { disabled: !gitStatus?.current }
                        )}
                        {renderRepoMenuItem(
                            '复制远程地址',
                            handleCopyRemoteUrl,
                            { disabled: !gitRemotes || gitRemotes.length === 0 }
                        )}
                    </div>
                </>
            )}

            {commitMenu && (
                <>
                    <div
                        style={{
                            position: 'fixed',
                            inset: 0,
                            zIndex: 99998
                        }}
                        onClick={closeCommitMenu}
                    />
                    <div
                        className="context-menu"
                        style={{
                            position: 'fixed',
                            top: commitMenu.y,
                            left: commitMenu.x,
                            background: 'var(--panel)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius)',
                            boxShadow: 'var(--shadow-soft)',
                            zIndex: 99999,
                            minWidth: 220,
                            padding: 4
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {renderCommitMenuItem('提交', async () => runCommitFlow(), { disabled: !canCommit })}
                        {renderCommitMenuItem('提交(修改)', null, { disabled: true })}
                        {renderCommitMenuItem('提交并推送', async () => runCommitFlow({ after: onPush }), { disabled: !canCommit || typeof onPush !== 'function' })}
                        {renderCommitMenuItem('提交并同步', async () => runCommitFlow({ after: onSync }), { disabled: !canCommit || typeof onSync !== 'function' })}
                    </div>
                </>
            )}

            {/* Hover Popup */}
            {hoveredCommit && (
                <CommitHoverCard 
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

const FileItem = ({ file, onAction, actionIcon, onOpen, onDiff, onDiscard, selected, onSelect, isConflict, onResolve }) => {
    const getStatusColor = (code) => {
        if (code === 'M') return 'var(--warning)';
        if (code === 'A' || code === '?') return 'var(--success)';
        if (code === 'D') return 'var(--danger)';
        if (code === 'U') return 'var(--danger)';
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
                {isConflict ? (
                    <>
                        <button 
                            className="sc-item-btn" 
                            onClick={(e) => { e.stopPropagation(); onResolve && onResolve(file.path, 'ours'); }}
                            title="Accept Current Change"
                        >
                            <span style={{ fontSize: '10px', fontWeight: 'bold' }}>CUR</span>
                        </button>
                        <button 
                            className="sc-item-btn" 
                            onClick={(e) => { e.stopPropagation(); onResolve && onResolve(file.path, 'theirs'); }}
                            title="Accept Incoming Change"
                        >
                            <span style={{ fontSize: '10px', fontWeight: 'bold' }}>INC</span>
                        </button>
                    </>
                ) : (
                    <>
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
                    </>
                )}
            </div>
            <span className="sc-status-pill" style={{ color, borderColor: color }}>
                {status === '?' ? 'U' : status}
            </span>
        </div>
    );
};

export default SourceControlPanel;
