import React from 'react';
import { getTranslation } from '../utils/i18n';

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

const PlusIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="7.5" />
    <line x1="12" y1="9" x2="12" y2="15" />
    <line x1="9" y1="12" x2="15" y2="12" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.17a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15 1.65 1.65 0 0 0 3.09 14H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9 1.65 1.65 0 0 0 4.27 7.18l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8.92 4.02 1.65 1.65 0 0 0 10 2.5V2.33a2 2 0 0 1 4 0V2.5a1.65 1.65 0 0 0 1.08 1.55 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15Z" />
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
    apiStatus,
    gitBadgeCount = 0,
    language = 'en'
}) {
    const isSessionsActive = activeSidebar === 'sessions' && !sidebarCollapsed;
    const isExplorerActive = activeSidebar === 'explorer' && !sidebarCollapsed;
    const isGitActive = activeSidebar === 'git' && !sidebarCollapsed;
    const t = (key) => getTranslation(language, key);

    return (
        <div className="activity-bar">
            <button 
                className={`activity-item ${isSessionsActive ? 'active' : ''}`} 
                onClick={() => onSelectSidebar('sessions')}
                title={t('sessionList')}
            >
                <ChatIcon />
            </button>
            <button 
                className={`activity-item ${isExplorerActive ? 'active' : ''}`} 
                onClick={() => onSelectSidebar('explorer')}
                title={t('explorer')}
            >
                <FolderIcon open={explorerOpen} />
            </button>
            <button 
                className={`activity-item ${isGitActive ? 'active' : ''}`} 
                onClick={() => onSelectSidebar('git')}
                title={t('sourceControl')}
                style={{ position: 'relative' }}
            >
                <span className="codicon codicon-source-control activity-git-icon" aria-hidden />
                {gitBadgeCount > 0 && (
                    <span className="activity-badge">{gitBadgeCount}</span>
                )}
            </button>
            <button 
                className="activity-item ghost" 
                onClick={onCreateSession} 
                title={t('newSession')} 
            >
                <PlusIcon />
            </button>

            <div className="activity-spacer" />

            <button 
                className="activity-item ghost" 
                onClick={onToggleChatPanel} 
                title={chatPanelCollapsed ? t('expandChat') : t('collapseChat')}
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
                title={t('settings')} 
            >
                <SettingsIcon />
            </button>

            <div className="activity-status" title={`${t('statusPrefix')}${apiStatus}`}>
                <span className={`status-dot ${apiStatus}`} />
            </div>
        </div>
    );
}

export default NavSidebar;
