
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';

const CommandPalette = ({
    isOpen,
    onClose,
    files = [],
    onOpenFile,
    onSearchText,
    workspaceRoots = []
}) => {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
            setQuery('');
            setSelectedIndex(0);
        }
    }, [isOpen]);

    const filteredItems = useMemo(() => {
        const items = [];
        const q = query.toLowerCase();
        
        // 1. "Search text" action (if query exists)
        if (query) {
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

        // 2. Default actions when query is empty
        if (!query) {
             items.push({
                type: 'action',
                id: 'search-files',
                label: 'Go to File...',
                description: 'Search files by name',
                action: () => {}, // No-op, just a hint or focus input
                icon: 'codicon-file',
                shortcut: 'Ctrl + P'
            });
            items.push({
                type: 'action',
                id: 'show-commands',
                label: 'Show and Run Commands >',
                description: 'Execute IDE commands',
                action: () => {}, 
                icon: 'codicon-terminal',
                shortcut: 'Ctrl + Shift + P'
            });
             items.push({
                type: 'action',
                id: 'search-text-placeholder',
                label: 'Search text %',
                description: 'Find in files',
                action: () => onSearchText(''),
                icon: 'codicon-search'
            });
             items.push({
                type: 'action',
                id: 'go-to-symbol',
                label: 'Go to Symbol in Editor @',
                description: 'Jump to symbol',
                action: () => {},
                icon: 'codicon-symbol-class',
                shortcut: 'Ctrl + Shift + O'
            });
        }

        // 3. Files
        if (query) {
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
    }, [query, files, onSearchText, onOpenFile]);

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
                if (filteredItems[selectedIndex].id !== 'search-files' && filteredItems[selectedIndex].id !== 'show-commands') {
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
                        placeholder="Search files by name (append :<line> to go to line)"
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
                
                <div 
                    className="command-palette-list" 
                    ref={listRef}
                    style={{
                        maxHeight: '400px',
                        overflowY: 'auto',
                        borderTop: '1px solid var(--border-subtle)'
                    }}
                >
                    {filteredItems.map((item, index) => (
                        <div
                            key={item.id}
                            className={`command-item ${index === selectedIndex ? 'selected' : ''}`}
                            onClick={() => {
                                item.action();
                                if (item.id !== 'search-files' && item.id !== 'show-commands') {
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
