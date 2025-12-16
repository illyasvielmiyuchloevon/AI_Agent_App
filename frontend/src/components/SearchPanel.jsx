
import React, { useState, useEffect, useCallback } from 'react';

const getIconClass = (fileName) => {
    if (!fileName) return 'codicon-file';
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'codicon-file-code';
    if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'codicon-file-code';
    if (lower.endsWith('.css') || lower.endsWith('.scss')) return 'codicon-paintcan';
    if (lower.endsWith('.html')) return 'codicon-file-code';
    if (lower.endsWith('.json')) return 'codicon-json';
    if (lower.endsWith('.md')) return 'codicon-markdown';
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.svg')) return 'codicon-file-media';
    return 'codicon-file';
};

function SearchPanel({
    onSearch,
    onOpenFile,
    projectLabel,
    initialQuery = ''
}) {
    const [searchQuery, setSearchQuery] = useState(initialQuery);
    const [replaceQuery, setReplaceQuery] = useState('');
    const [searchResults, setSearchResults] = useState(null);
    const [isSearching, setIsSearching] = useState(false);
    const [isCaseSensitive, setIsCaseSensitive] = useState(false);
    const [isRegex, setIsRegex] = useState(false);
    const [isExpanded, setIsExpanded] = useState(true);

    useEffect(() => {
        if (initialQuery) {
            setSearchQuery(initialQuery);
            // Optional: Auto-submit search if initialQuery provided?
            // For now just pre-fill.
        }
    }, [initialQuery]);

    const handleSearchSubmit = useCallback(async (e) => {
        if (e.key === 'Enter' && searchQuery.trim() && onSearch) {
            setIsSearching(true);
            try {
                // Pass options object if onSearch supports it (App.jsx handleGlobalSearch needs to be updated to pass options to driver)
                // For now, assume handleGlobalSearch accepts (query, options)
                const results = await onSearch(searchQuery, {
                    case_sensitive: isCaseSensitive,
                    regex: isRegex
                });
                setSearchResults(results);
            } catch (err) {
                console.error("Search error:", err);
                setSearchResults([]);
            } finally {
                setIsSearching(false);
            }
        }
    }, [searchQuery, isCaseSensitive, isRegex, onSearch]);

    const clearSearch = () => {
        setSearchQuery('');
        setSearchResults(null);
    };

    return (
        <div className="explorer-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="explorer-header">
                <div className="explorer-title">
                    <span className="explorer-label">SEARCH</span>
                </div>
                <div className="explorer-actions">
                    <button onClick={clearSearch} className="ghost-btn tiny" title="Clear Search">
                        <i className="codicon codicon-clear-all" />
                    </button>
                    <button onClick={() => setIsExpanded(!isExpanded)} className="ghost-btn tiny" title={isExpanded ? "Collapse" : "Expand"}>
                        <i className={`codicon codicon-chevron-${isExpanded ? 'up' : 'down'}`} />
                    </button>
                </div>
            </div>

            {isExpanded && (
                <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <div style={{ position: 'absolute', left: '6px', zIndex: 1, pointerEvents: 'none' }}>
                            <i className="codicon codicon-chevron-right" style={{ fontSize: '12px', transform: 'rotate(90deg)' }} />
                        </div>
                        <input 
                            style={{ 
                                flex: 1, 
                                background: 'var(--bg-subtle)', 
                                border: '1px solid var(--border)', 
                                color: 'var(--text)', 
                                padding: '6px 6px 6px 20px', 
                                fontSize: '12px', 
                                borderRadius: '3px',
                                outline: 'none'
                            }}
                            placeholder="Search"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            onKeyDown={handleSearchSubmit}
                        />
                        <div style={{ position: 'absolute', right: '4px', display: 'flex', gap: '2px' }}>
                            <button 
                                onClick={() => setIsCaseSensitive(!isCaseSensitive)} 
                                style={{ 
                                    background: isCaseSensitive ? 'var(--accent-subtle)' : 'transparent', 
                                    border: '1px solid transparent',
                                    borderColor: isCaseSensitive ? 'var(--accent)' : 'transparent',
                                    color: isCaseSensitive ? 'var(--accent)' : 'var(--muted)', 
                                    cursor: 'pointer', 
                                    padding: '2px 4px',
                                    borderRadius: '3px',
                                    fontSize: '11px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    minWidth: '20px'
                                }} 
                                title="Match Case"
                            >
                                Aa
                            </button>
                            <button 
                                onClick={() => setIsRegex(!isRegex)} 
                                style={{ 
                                    background: isRegex ? 'var(--accent-subtle)' : 'transparent', 
                                    border: '1px solid transparent',
                                    borderColor: isRegex ? 'var(--accent)' : 'transparent',
                                    color: isRegex ? 'var(--accent)' : 'var(--muted)', 
                                    cursor: 'pointer', 
                                    padding: '2px 4px',
                                    borderRadius: '3px',
                                    fontSize: '11px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    minWidth: '20px'
                                }} 
                                title="Use Regular Expression"
                            >
                                .*
                            </button>
                        </div>
                    </div>
                    
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                         <div style={{ position: 'absolute', left: '6px', zIndex: 1, pointerEvents: 'none' }}>
                            <i className="codicon codicon-chevron-right" style={{ fontSize: '12px', transform: 'rotate(90deg)' }} />
                        </div>
                        <input 
                            style={{ 
                                flex: 1, 
                                background: 'var(--bg-subtle)', 
                                border: '1px solid var(--border)', 
                                color: 'var(--text)', 
                                padding: '6px 6px 6px 20px', 
                                fontSize: '12px', 
                                borderRadius: '3px',
                                outline: 'none'
                            }}
                            placeholder="Replace"
                            value={replaceQuery}
                            onChange={e => setReplaceQuery(e.target.value)}
                        />
                         <div style={{ position: 'absolute', right: '4px', display: 'flex', gap: '2px' }}>
                             <button 
                                className="ghost-btn tiny"
                                style={{ 
                                    padding: '2px 4px',
                                    borderRadius: '3px',
                                    fontSize: '11px',
                                    color: 'var(--muted)',
                                    minWidth: '20px'
                                }}
                                title="Replace (Not implemented yet)"
                             >
                                 AB
                             </button>
                         </div>
                    </div>
                </div>
            )}

            <div className="search-results" style={{ overflowY: 'auto', flex: 1, paddingBottom: '20px' }}>
                {isSearching && <div style={{ padding: '8px', color: 'var(--muted)', fontSize: '12px' }}>Searching...</div>}
                
                {!isSearching && searchResults && searchResults.length === 0 && (
                    <div style={{ padding: '8px', color: 'var(--muted)', fontSize: '12px' }}>No results found.</div>
                )}
                
                {!isSearching && !searchResults && (
                    <div style={{ padding: '8px', color: 'var(--muted)', fontSize: '12px' }}>
                        {/* Placeholder or initial state */}
                    </div>
                )}

                {!isSearching && searchResults && searchResults.map((res, idx) => (
                    <div key={idx} className="search-result-item" style={{ padding: '6px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)' }} onClick={() => onOpenFile(res.path)}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                        <i className={`codicon ${getIconClass(res.path)}`} style={{ fontSize: '12px' }} />
                        <span style={{ fontWeight: '500', fontSize: '12px', color: 'var(--text-highlight)' }}>{res.path.split('/').pop()}</span>
                        <span style={{ fontSize: '10px', color: 'var(--muted)', marginLeft: 'auto' }}>{res.path}</span>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'monospace', paddingLeft: '18px' }}>
                        <span style={{ color: 'var(--primary)' }}>{res.line}</span>: {res.preview || res.context}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default SearchPanel;
