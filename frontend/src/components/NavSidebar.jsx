import React from 'react';

const FolderIcon = ({ open = false }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {open ? (
      <>
        <path d="M3 7h6l2 2h9a1 1 0 0 1 .92 1.38l-2.4 6.4A2 2 0 0 1 16.61 18H5.39a2 2 0 0 1-1.87-1.22L2.1 9.62A2 2 0 0 1 3.94 7" />
        <path d="M3 7V6a2 2 0 0 1 2-2h4l2 2h5a2 2 0 0 1 2 2v1" />
      </>
    ) : (
      <>
        <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H9l2 2h7.5A2.5 2.5 0 0 1 21 10.5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        <path d="M3 10h18" opacity="0.35" />
      </>
    )}
  </svg>
);

const ChatIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-4l-3 3-3-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
    <path d="M8 10h8" />
    <path d="M8 13h5" />
  </svg>
);

function NavSidebar({ 
    activeSidebar,
    sidebarCollapsed,
    explorerOpen,
    onSelectSidebar,
    onToggleChatPanel,
    chatPanelCollapsed,
    onCreateSession,
    onToggleConfig,
    apiStatus
}) {
    const isSessionsActive = activeSidebar === 'sessions' && !sidebarCollapsed;
    const isExplorerActive = activeSidebar === 'explorer' && !sidebarCollapsed;

    return (
        <div className="activity-bar">
            <button 
                className={`activity-item ${isSessionsActive ? 'active' : ''}`} 
                onClick={() => onSelectSidebar('sessions')}
                title="会话列表"
            >
                <ChatIcon />
            </button>
            <button 
                className={`activity-item ${isExplorerActive ? 'active' : ''}`} 
                onClick={() => onSelectSidebar('explorer')}
                title="Explorer（资源管理器）"
            >
                <FolderIcon open={explorerOpen} />
            </button>
            <button 
                className="activity-item ghost" 
                onClick={onCreateSession} 
                title="新建会话" 
            >
                ➕
            </button>

            <div className="activity-spacer" />

            <button 
                className="activity-item ghost" 
                onClick={onToggleChatPanel} 
                title={chatPanelCollapsed ? "展开聊天区" : "收起聊天区"}
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 5h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-5l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"></path>
                    {chatPanelCollapsed ? (
                        <>
                            <polyline points="10 9 12 11 10 13" />
                            <polyline points="6 9 8 11 6 13" />
                        </>
                    ) : (
                        <>
                            <polyline points="14 9 12 11 14 13" />
                            <polyline points="18 9 16 11 18 13" />
                        </>
                    )}
                </svg>
            </button>

            <button 
                className="activity-item ghost" 
                onClick={onToggleConfig} 
                title="Settings" 
            >
                ⚙️
            </button>

            <div className="activity-status" title={`Status: ${apiStatus}`}>
                <span className={`status-dot ${apiStatus}`} />
            </div>
        </div>
    );
}

export default NavSidebar;
