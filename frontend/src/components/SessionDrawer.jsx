import React, { useState } from 'react';

function SessionDrawer({ 
    sessions, 
    currentSessionId, 
    onSelectSession, 
    onDeleteSession,
    onRenameSession,
    onCreateSession,
    onSwitchProject,
    projectPath,
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
            minWidth: collapsed ? '0' : `${Math.max(width || 200, 200)}px`,
            borderRight: '1px solid var(--border)',
            background: 'var(--panel)',
            display: collapsed ? 'none' : 'flex', 
            flexDirection: 'column',
            overflow: 'hidden',
            transition: isResizing ? 'none' : 'width 0.15s ease, min-width 0.15s ease',
            flexShrink: 0
        }}>
            {!collapsed && (
                <>

                    <header style={{ height: '50px', padding: '0 0.5rem', borderBottom: '1px solid var(--border)', background: 'var(--panel-sub)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ margin: 0, fontSize: '1rem' }}>会话</h3>
                        <button onClick={onCreateSession} style={{ border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', borderRadius: '4px', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', padding: 0, boxShadow: 'var(--shadow-soft)' }} title="新建会话">
                            +
                        </button>
                    </header>

                    <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
                        {sessions.length === 0 && <div style={{ textAlign: 'center', color: 'var(--muted)', marginTop: '1rem', fontSize: '0.9rem' }}>暂无会话</div>}
                        
                        {sessions.map(session => (
                            <div 
                                key={session.id}
                                onClick={() => onSelectSession(session.id)}
                                style={{
                                    padding: '0.8rem',
                                    borderRadius: 'var(--radius)',
                                    cursor: 'pointer',
                                    background: currentSessionId === session.id ? 'var(--sidebar-active)' : 'transparent',
                                    marginBottom: '0.5rem',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    border: currentSessionId === session.id ? `1px solid var(--sidebar-indicator)` : '1px solid transparent',
                                     fontSize: '0.85rem',
                                    boxShadow: currentSessionId === session.id ? `inset 3px 0 0 var(--sidebar-indicator)` : 'none'
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.border = '1px solid var(--border-strong)';
                                    if (currentSessionId !== session.id) e.currentTarget.style.background = 'var(--panel-sub)';
                                }}
                                onMouseLeave={(e) => {
                                     e.currentTarget.style.border = currentSessionId === session.id ? '1px solid var(--sidebar-indicator)' : '1px solid transparent';
                                     e.currentTarget.style.background = currentSessionId === session.id ? 'var(--sidebar-active)' : 'transparent';
                                }}
                            >
                                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
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
                                                borderRadius: 'var(--radius)',
                                                padding: '0.3rem 0.45rem',
                                                fontSize: '0.85rem'
                                            }}
                                        />
                                    ) : (
                                        <div 
                                            style={{ fontWeight: 'bold' }} 
                                            onDoubleClick={(e) => { e.stopPropagation(); startEdit(session); }}
                                            title="双击重命名"
                                        >
                                            {session.title || 'Untitled'}
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.15rem' }}>
                                        <div style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>{new Date(session.updated_at).toLocaleString()}</div>
                                        <span style={{ fontSize: '0.6rem', padding: '0.2rem 0.45rem', background: 'var(--tag-bg)', color: 'var(--tag-text)', borderRadius: '999px' }}>
                                            {(session.mode || 'chat').toUpperCase()}
                                        </span>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '0.25rem', marginLeft: '0.5rem' }}>
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); startEdit(session); }}
                                        style={{ 
                                            border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer',
                                            padding: '2px 5px'
                                        }}
                                        title="重命名"
                                    >
                                        ✏️
                                    </button>
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id); }}
                                        style={{ 
                                            border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer',
                                            padding: '2px 5px'
                                        }}
                                        title="删除"
                                    >
                                        ×
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
