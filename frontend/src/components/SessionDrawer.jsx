import React, { useState } from 'react';

function SessionDrawer({ 
    sessions, 
    currentSessionId, 
    onSelectSession, 
    onDeleteSession,
    onRenameSession,
    onCreateSession,
    width,
    collapsed,
    isResizing = false
}) {
    const [editingId, setEditingId] = useState(null);
    const [draftTitle, setDraftTitle] = useState('');

    const startEdit = (session) => {
        setEditingId(session.id);
        setDraftTitle(session.title || '');
    };

    const commitEdit = () => {
        if (!editingId || !onRenameSession) return;
        onRenameSession(editingId, draftTitle);
        setEditingId(null);
    };

    const cancelEdit = () => {
        setEditingId(null);
        setDraftTitle('');
    };

    return (
        <div style={{ 
            width: '100%',
            minWidth: collapsed ? '0' : `${Math.max(width || 220, 220)}px`,
            borderRight: 'none',
            background: 'transparent',
            display: collapsed ? 'none' : 'flex', 
            flexDirection: 'column',
            overflow: 'hidden',
            transition: isResizing ? 'none' : 'width 0.15s ease, min-width 0.15s ease',
            flexShrink: 0
        }}>
            {!collapsed && (
                <>
                    <header className="explorer-header">
                        <div className="explorer-title">
                            <div className="explorer-label">SESSIONS</div>
                        </div>
                        <div className="explorer-actions">
                            <button
                                onClick={onCreateSession}
                                className="ghost-btn tiny"
                                title="新建会话"
                            >
                                +
                            </button>
                        </div>
                    </header>

                    <div className="session-list">
                        {sessions.length === 0 && <div style={{ textAlign: 'center', color: 'var(--muted)', marginTop: '1rem', fontSize: '0.9rem' }}>暂无会话</div>}
                        
                        {sessions.map(session => (
                            <div 
                                key={session.id}
                                onClick={() => onSelectSession(session.id)}
                                className={`session-item${currentSessionId === session.id ? ' active' : ''}`}
                            >
                                    <div className="session-item-main">
                                    {editingId === session.id ? (
                                        <input
                                            autoFocus
                                            value={draftTitle}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => setDraftTitle(e.target.value)}
                                            onBlur={commitEdit}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') commitEdit();
                                                if (e.key === 'Escape') cancelEdit();
                                            }}
                                            style={{ 
                                                width: '100%', 
                                                border: '1px solid var(--border)', 
                                                borderRadius: '8px',
                                                padding: '0.3rem 0.45rem',
                                                fontSize: '0.85rem',
                                                background: 'var(--panel-sub)'
                                            }}
                                        />
                                    ) : (
                                        <div 
                                            className="session-item-title"
                                            onDoubleClick={(e) => { e.stopPropagation(); startEdit(session); }}
                                            title="双击重命名"
                                        >
                                            {session.title || 'Untitled'}
                                        </div>
                                    )}
                                    <div className="session-item-meta">
                                        <div className="session-item-time">{new Date(session.updated_at).toLocaleString()}</div>
                                        <span className="session-item-mode">
                                            {(session.mode || 'chat').toUpperCase()}
                                        </span>
                                    </div>
                                </div>
                                <div className="session-item-actions">
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); startEdit(session); }}
                                        className="session-item-icon-btn"
                                        title="重命名"
                                    >
                                        <span className="codicon codicon-edit" aria-hidden />
                                    </button>
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id); }}
                                        className="session-item-icon-btn"
                                        title="删除"
                                    >
                                        <span className="codicon codicon-trash" aria-hidden />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

export default SessionDrawer;
