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

const SessionsIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 7h12" />
    <path d="M6 12h12" />
    <path d="M6 17h12" />
  </svg>
);

const ChatIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-4l-3 3-3-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
    <path d="M8 10h8" />
    <path d="M8 13h5" />
  </svg>
);

const SearchIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
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
    onCreateSession,
    onToggleConfig,
    apiStatus,
    gitBadgeCount = 0,
    language = 'en'
}) {
    const isSessionsActive = activeSidebar === 'sessions' && !sidebarCollapsed;
    const isChatActive = activeSidebar === 'chat' && !sidebarCollapsed;
    const isExplorerActive = activeSidebar === 'explorer' && !sidebarCollapsed;
    const isSearchActive = activeSidebar === 'search' && !sidebarCollapsed;
    const isGitActive = activeSidebar === 'git' && !sidebarCollapsed;
    const t = (key) => getTranslation(language, key);

    return (
        <div className="activity-bar">
            <button 
                className={`activity-item ${isSessionsActive ? 'active' : ''}`} 
                onClick={() => onSelectSidebar('sessions')}
                title={t('sessionList')}
            >
                <SessionsIcon />
            </button>
            <button 
                className={`activity-item ${isChatActive ? 'active' : ''}`} 
                onClick={() => onSelectSidebar('chat')}
                title={t('chat')}
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
                className={`activity-item ${isSearchActive ? 'active' : ''}`} 
                onClick={() => onSelectSidebar('search')}
                title={t('search') || 'Search'}
            >
                <SearchIcon />
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
