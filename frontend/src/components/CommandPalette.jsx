
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';

const CommandPalette = ({
    isOpen,
    onClose,
    initialQuery = '',
    context = null,
    files = [],
    editorGroups = [],
    activeGroupId = '',
    onOpenFile,
    onCloseEditor,
    onSearchText,
    workspaceRoots = [],
    aiInvoker
}) => {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
            setQuery(String(initialQuery || ''));
            setSelectedIndex(0);
        }
    }, [isOpen, initialQuery]);

    const editorNavState = useMemo(() => {
        const raw = String(query || '').trim();
        const lower = raw.toLowerCase();
        const isEditorNav = lower === 'edt' || lower.startsWith('edt ') || lower.startsWith('>edt') || lower.startsWith('> edt');
        const normalized = lower.startsWith('>') ? lower.slice(1).trim() : lower;
        const filterText = normalized.startsWith('edt') ? normalized.slice(3).trim() : '';

        const groupIdHint = (context && typeof context === 'object' && context.type === 'editorNav' && context.groupId)
            ? String(context.groupId)
            : '';
        const groupId = groupIdHint || String(activeGroupId || '').trim() || (editorGroups[0]?.id ? String(editorGroups[0]?.id) : '');
        const groupIndex = editorGroups.findIndex((g) => String(g?.id) === groupId);
        const group = groupIndex >= 0 ? editorGroups[groupIndex] : (editorGroups[0] || null);

        return {
            isEditorNav,
            filterText,
            groupId: group ? String(group?.id || groupId) : groupId,
            groupIndex: groupIndex >= 0 ? groupIndex : (group ? 0 : -1),
            group,
        };
    }, [activeGroupId, context, editorGroups, query]);

    const getFileIcon = (path) => {
        const ext = String(path || '').split('.').pop()?.toLowerCase();
        const map = {
            js: 'codicon-file-code',
            jsx: 'codicon-file-code',
            ts: 'codicon-file-code',
            tsx: 'codicon-file-code',
            html: 'codicon-code',
            css: 'codicon-symbol-color',
            json: 'codicon-json',
            md: 'codicon-markdown',
            txt: 'codicon-file-text',
            py: 'codicon-symbol-keyword',
        };
        return map[ext] || 'codicon-file';
    };

    const filteredItems = useMemo(() => {
        const items = [];
        const q = query.toLowerCase();

        if (editorNavState.isEditorNav) {
            const group = editorNavState.group;
            const groupId = editorNavState.groupId;
            const filter = String(editorNavState.filterText || '').toLowerCase();
            const openTabs = Array.isArray(group?.openTabs) ? group.openTabs.filter(Boolean) : [];
            const active = String(group?.activeFile || '').trim();

            const ordered = active && openTabs.includes(active)
                ? [active, ...openTabs.filter((t) => t !== active)]
                : openTabs;

            ordered
                .filter((p) => {
                    if (!filter) return true;
                    const hay = `${p.split('/').pop()} ${p}`.toLowerCase();
                    return hay.includes(filter);
                })
                .slice(0, 80)
                .forEach((p) => {
                    items.push({
                        type: 'editor',
                        id: `editor:${groupId}:${p}`,
                        label: p.split('/').pop(),
                        description: p,
                        action: () => onOpenFile?.(p, { groupId, mode: 'persistent' }),
                        icon: getFileIcon(p),
                        closeAction: () => onCloseEditor?.(p, { groupId }),
                        isActive: active && p === active,
                    });
                });

            return items;
        }

        const inCommandMode = query.trim().startsWith('>');
        const commandQuery = inCommandMode ? query.trim().slice(1).trim().toLowerCase() : '';
        
        const pushIfMatch = (it) => {
            if (!inCommandMode) {
                items.push(it);
                return;
            }
            if (!commandQuery) {
                items.push(it);
                return;
            }
            const hay = `${it.label || ''} ${it.description || ''}`.toLowerCase();
            if (hay.includes(commandQuery)) items.push(it);
        };

        if (!inCommandMode && query) {
            items.push({
                type: 'action',
                id: 'search-text',
                label: `Search text "${query}"`,
                description: 'in all files',
                action: () => onSearchText(query),
                icon: 'codicon-search',
                shortcut: 'Ctrl + Shift + F'
            });
        }

        if (inCommandMode || !query) {
             pushIfMatch({
                type: 'action',
                id: 'search-files',
                label: 'Go to File...',
                description: 'Search files by name',
                action: () => {}, // No-op, just a hint or focus input
                icon: 'codicon-file',
                shortcut: 'Ctrl + P'
            });
            pushIfMatch({
                type: 'action',
                id: 'show-commands',
                label: 'Show and Run Commands >',
                description: 'Execute IDE commands',
                action: () => {}, 
                icon: 'codicon-terminal',
                shortcut: 'Ctrl + Shift + P'
            });
             pushIfMatch({
                type: 'action',
                id: 'search-text-placeholder',
                label: 'Search text %',
                description: 'Find in files',
                action: () => onSearchText(''),
                icon: 'codicon-search'
            });
             pushIfMatch({
                type: 'action',
                id: 'go-to-symbol',
                label: 'Go to Symbol in Editor @',
                description: 'Jump to symbol',
                action: () => {},
                icon: 'codicon-symbol-class',
                shortcut: 'Ctrl + Shift + O'
            });

            pushIfMatch({
                type: 'action',
                id: 'editor-nav',
                label: '编辑器：打开编辑器导航 (edt)',
                description: '显示当前组已打开的编辑器',
                action: () => setQuery('edt '),
                icon: 'codicon-list-selection',
            });

            if (aiInvoker && typeof aiInvoker.run === 'function') {
                pushIfMatch({ type: 'action', id: 'ai-explain', label: 'AI: Explain Code', description: 'Explain selection or file', action: () => aiInvoker.run('explain'), icon: 'codicon-lightbulb', shortcut: 'Ctrl + Alt + E' });
                pushIfMatch({ type: 'action', id: 'ai-tests', label: 'AI: Generate Unit Tests', description: 'Generate tests for selection or file', action: () => aiInvoker.run('generateTests'), icon: 'codicon-beaker', shortcut: 'Ctrl + Alt + T' });
                pushIfMatch({ type: 'action', id: 'ai-optimize', label: 'AI: Optimize Code', description: 'Optimize selection or file', action: () => aiInvoker.run('optimize'), icon: 'codicon-rocket', shortcut: 'Ctrl + Alt + O' });
                pushIfMatch({ type: 'action', id: 'ai-comments', label: 'AI: Generate Comments', description: 'Add comments following style', action: () => aiInvoker.run('generateComments'), icon: 'codicon-comment', shortcut: 'Ctrl + Alt + C' });
                pushIfMatch({ type: 'action', id: 'ai-review', label: 'AI: Code Review', description: 'Review selection or file', action: () => aiInvoker.run('review'), icon: 'codicon-checklist', shortcut: 'Ctrl + Alt + R' });
                pushIfMatch({ type: 'action', id: 'ai-rewrite', label: 'AI: Rewrite', description: 'Rewrite selection or file', action: () => aiInvoker.run('rewrite'), icon: 'codicon-replace', shortcut: 'Ctrl + Alt + W' });
                pushIfMatch({ type: 'action', id: 'ai-modify', label: 'AI: Modify with Instructions…', description: 'Edit using a custom instruction', action: () => aiInvoker.run('modify'), icon: 'codicon-edit', shortcut: 'Ctrl + Alt + M' });
                pushIfMatch({ type: 'action', id: 'ai-docs', label: 'AI: Generate Docs', description: 'Generate Markdown docs', action: () => aiInvoker.run('generateDocs'), icon: 'codicon-book', shortcut: 'Ctrl + Alt + D' });
            }
        }

        if (!inCommandMode && query) {
            // Simple fuzzy match: all chars must exist in order (or just includes for now for performance)
            const matchedFiles = files.filter(f => f.path.toLowerCase().includes(q)).slice(0, 50); // Limit to 50
            
            matchedFiles.forEach(f => {
                items.push({
                    type: 'file',
                    id: f.path,
                    label: f.path.split('/').pop(),
                    description: f.path,
                    action: () => onOpenFile(f.path),
                    icon: 'codicon-file' // Should use getIconClass ideally
                });
            });
        }

        return items;
    }, [aiInvoker, editorNavState, files, onCloseEditor, onOpenFile, onSearchText, query]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [filteredItems]);

    const handleKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => Math.min(prev + 1, filteredItems.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (filteredItems[selectedIndex]) {
                filteredItems[selectedIndex].action();
                // Only close if it's a real action, not just a hint
                if (filteredItems[selectedIndex].id !== 'search-files' && filteredItems[selectedIndex].id !== 'show-commands' && filteredItems[selectedIndex].id !== 'editor-nav') {
                     onClose();
                }
            }
        } else if (e.key === 'Escape') {
            onClose();
        }
    };

    // Scroll selected item into view
    useEffect(() => {
        if (listRef.current) {
            const selectedElement = listRef.current.children[selectedIndex];
            if (selectedElement) {
                selectedElement.scrollIntoView({ block: 'nearest' });
            }
        }
    }, [selectedIndex]);

    if (!isOpen) return null;

    const palettePlaceholder = editorNavState.isEditorNav
        ? 'edt <filter> (Editor Navigation)'
        : 'Search files by name (append :<line> to go to line)';

    const groupLabel = editorNavState.groupIndex >= 0
        ? `第 ${editorNavState.groupIndex + 1} 组`
        : (editorNavState.groupId ? String(editorNavState.groupId) : '');

    return createPortal(
        <div className="command-palette-overlay" onClick={onClose} style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100000, // Higher than everything
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            paddingTop: '6px'
        }}>
            <div 
                className="command-palette-container" 
                onClick={e => e.stopPropagation()}
                style={{
                    width: '600px',
                    maxWidth: '90vw',
                    background: 'var(--panel)',
                    borderRadius: '6px',
                    boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    border: '1px solid var(--border)',
                    boxSizing: 'border-box'
                }}
            >
                <div className="command-palette-input-wrapper" style={{ padding: '8px', boxSizing: 'border-box' }}>
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={palettePlaceholder}
                        style={{
                            width: '100%',
                            background: 'var(--bg-subtle)',
                            border: '1px solid var(--border)',
                            padding: '8px 12px',
                            color: 'var(--text)',
                            borderRadius: '4px',
                            fontSize: '14px',
                            outline: 'none',
                            boxSizing: 'border-box'
                        }}
                    />
                </div>

                {editorNavState.isEditorNav ? (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '6px 12px',
                        borderTop: '1px solid var(--border-subtle)',
                        borderBottom: '1px solid var(--border-subtle)',
                        background: 'var(--bg-subtle)'
                    }}>
                        <div style={{ flex: 1, color: 'var(--muted)', fontSize: 12 }}>
                            编辑器导航（当前组已打开的编辑器）
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text)' }}>
                            <span>{groupLabel}</span>
                            <button
                                type="button"
                                className="ghost-btn tiny"
                                style={{ height: 22, width: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                onClick={onClose}
                                title="Close"
                            >
                                <i className="codicon codicon-close" aria-hidden />
                            </button>
                        </div>
                    </div>
                ) : null}
                
                <div 
                    className="command-palette-list" 
                    ref={listRef}
                    style={{
                        maxHeight: '400px',
                        overflowY: 'auto',
                        borderTop: editorNavState.isEditorNav ? 'none' : '1px solid var(--border-subtle)'
                    }}
                >
                    {filteredItems.map((item, index) => (
                        <div
                            key={item.id}
                            className={`command-item ${index === selectedIndex ? 'selected' : ''}`}
                            onClick={() => {
                                item.action();
                                if (item.id !== 'search-files' && item.id !== 'show-commands' && item.id !== 'editor-nav') {
                                    onClose();
                                }
                            }}
                            onMouseEnter={() => setSelectedIndex(index)}
                            style={{
                                padding: '6px 12px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                cursor: 'pointer',
                                background: index === selectedIndex ? 'var(--list-active-selection-background)' : 'transparent',
                                color: index === selectedIndex ? 'var(--list-active-selection-foreground)' : 'var(--text)'
                            }}
                        >
                            {/* Icon */}
                            <div style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center', 
                                width: '20px', 
                                opacity: 0.8 
                            }}>
                                <i className={`codicon ${item.icon}`} style={{ fontSize: '16px' }} />
                            </div>

                            {/* Label & Description */}
                            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ fontSize: '13px', fontWeight: '500' }}>{item.label}</span>
                                    {item.description && (
                                        <span style={{ fontSize: '12px', opacity: 0.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {item.description}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Shortcut */}
                            {item.shortcut && (
                                <div style={{ 
                                    fontSize: '11px', 
                                    opacity: 0.6, 
                                    background: 'var(--bg-subtle)', 
                                    padding: '2px 6px', 
                                    borderRadius: '3px',
                                    marginLeft: '8px' 
                                }}>
                                    {item.shortcut}
                                </div>
                            )}

                            {editorNavState.isEditorNav && item.type === 'editor' && typeof item.closeAction === 'function' ? (
                                <button
                                    type="button"
                                    className="ghost-btn tiny"
                                    style={{ height: 22, width: 22, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 6 }}
                                    title="Close editor"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        item.closeAction();
                                    }}
                                >
                                    <i className="codicon codicon-close" aria-hidden />
                                </button>
                            ) : null}
                        </div>
                    ))}
                    {filteredItems.length === 0 && (
                        <div style={{ padding: '12px', color: 'var(--muted)', textAlign: 'center', fontSize: '13px' }}>
                            No results found
                        </div>
                    )}
                </div>
                {/* Optional Footer similar to VS Code */}
                 {!query && files.length > 0 && (
                    <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', fontSize: '11px', color: 'var(--muted)' }}>
                         Recently opened
                    </div>
                 )}
            </div>
        </div>,
        document.body
    );
};

export default CommandPalette;
