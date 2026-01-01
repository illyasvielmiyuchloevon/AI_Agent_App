import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getTranslation } from '../utils/i18n';

const SNAP_LAYOUTS = [
    {
        id: 'halves',
        label: 'Halves',
        columns: 2,
        rows: 1,
        zones: [
            { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
            { col: 2, row: 1, colSpan: 1, rowSpan: 1 },
        ],
    },
    {
        id: 'thirds',
        label: 'Thirds',
        columns: 3,
        rows: 1,
        zones: [
            { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
            { col: 2, row: 1, colSpan: 1, rowSpan: 1 },
            { col: 3, row: 1, colSpan: 1, rowSpan: 1 },
        ],
    },
    {
        id: 'grid',
        label: 'Grid',
        columns: 2,
        rows: 2,
        zones: [
            { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
            { col: 2, row: 1, colSpan: 1, rowSpan: 1 },
            { col: 1, row: 2, colSpan: 1, rowSpan: 1 },
            { col: 2, row: 2, colSpan: 1, rowSpan: 1 },
        ],
    },
];

const SNAP_PANEL_WIDTH = 240;
const SNAP_PANEL_GAP = 6;

const Icon = ({ name, ...props }) => {
    const common = {
        stroke: 'currentColor',
        fill: 'none',
        strokeWidth: 1.75,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
    };
    const svgProps = { width: 18, height: 18, viewBox: '0 0 24 24', ...common, ...props };
    switch (name) {
        case 'git':
            return (
                <svg {...svgProps}>
                    <path d="M11.5 20.5l9.5-9.5c.6-.6.6-1.5 0-2.1l-6.8-6.8c-.6-.6-1.5-.6-2.1 0L2.5 11.5c-.6.6-.6 1.5 0 2.1l6.8 6.8c.6.6 1.5.6 2.1 0z" />
                    <path d="M12 8v7" />
                    <circle cx="12" cy="17" r="1" />
                    <circle cx="12" cy="6" r="1" />
                </svg>
            );
        case 'folder-open':
            return (
                <svg {...svgProps}>
                    <path d="M3.5 7.5h6l2 2H20a1.5 1.5 0 0 1 1.5 1.5v6.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5V9A1.5 1.5 0 0 1 5 7.5Z" />
                    <path d="M3.5 10.5h17" />
                </svg>
            );
        case 'link':
            return (
                <svg {...svgProps}>
                    <path d="M9.5 14.5 7 17a3 3 0 1 1-4.24-4.24l3.3-3.3A3 3 0 0 1 9.5 8.5" />
                    <path d="M14.5 9.5 17 7a3 3 0 1 1 4.24 4.24l-3.3 3.3A3 3 0 0 1 14.5 15.5" />
                    <path d="M9.75 14.25 14.25 9.75" />
                </svg>
            );
        case 'sun':
            return (
                <svg {...svgProps}>
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 3v2.2M12 18.8V21M4.6 4.6 6.2 6.2M17.8 17.8 19.4 19.4M3 12h2.2M18.8 12H21M4.6 19.4 6.2 17.8M17.8 6.2l1.6-1.6" />
                </svg>
            );
        case 'moon':
            return (
                <svg {...svgProps}>
                    <path d="M20 14.5A7.5 7.5 0 0 1 12 4a7.5 7.5 0 1 0 8 10.5Z" />
                </svg>
            );
        case 'eye':
            return (
                <svg {...svgProps}>
                    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
                    <circle cx="12" cy="12" r="2.8" />
                </svg>
            );
        case 'code':
            return (
                <svg {...svgProps}>
                    <path d="M15 6.5 20.5 12 15 17.5" />
                    <path d="M9 6.5 3.5 12 9 17.5" />
                </svg>
            );
        case 'doc-plus':
            return (
                <svg {...svgProps}>
                    <path d="M8 3.5h5l3.5 3.5V18a2.5 2.5 0 0 1-2.5 2.5H8A2.5 2.5 0 0 1 5.5 18V6A2.5 2.5 0 0 1 8 3.5Z" />
                    <path d="M13 3.5V7h3.5" />
                    <path d="M12 11v5" />
                    <path d="M9.5 13.5h5" />
                </svg>
            );
        case 'folder-plus':
            return (
                <svg {...svgProps}>
                    <path d="M3.5 8h6l2 2h9a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 20.5 19H5a1.5 1.5 0 0 1-1.5-1.5V9.5A1.5 1.5 0 0 1 5 8Z" />
                    <path d="M12.5 12.5v4" />
                    <path d="M10.5 14.5h4" />
                </svg>
            );
        case 'sync':
            return (
                <svg {...svgProps}>
                    <path d="M5 8.5a7 7 0 0 1 11-2l1.5 1.5" />
                    <path d="M4 6.5v3h3" />
                    <path d="M19 15.5a7 7 0 0 1-11 2L6.5 16" />
                    <path d="M20 17.5v-3h-3" />
                </svg>
            );
        case 'refresh':
            return (
                <svg {...svgProps}>
                    <path d="M20 4v5h-5" />
                    <path d="M4 20v-5h5" />
                    <path d="M5 9a7 7 0 0 1 12-2l2 2" />
                    <path d="M19 15a7 7 0 0 1-12 2l-2-2" />
                </svg>
            );
        case 'git-branch':
            return (
                <svg {...svgProps}>
                    <path d="M6 3v12" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="6" cy="6" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                    <circle cx="18" cy="6" r="3" />
                </svg>
            );
        case 'remote':
            return (
                <svg {...svgProps}>
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                    <path d="M13 2v7h7" />
                </svg>
            );
        case 'desktop':
            return (
                <svg {...svgProps}>
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
            );
        case 'search':
            return (
                <svg {...svgProps}>
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                </svg>
            );
        case 'minimize':
            return (
                <svg {...svgProps}>
                    <path d="M5 12h14" />
                </svg>
            );
        case 'maximize':
            return (
                <svg {...svgProps}>
                    <rect x="6" y="6" width="12" height="12" rx="1.5" />
                </svg>
            );
        case 'restore':
            return (
                <svg {...svgProps}>
                    <path d="M8 8h10v10" />
                    <path d="M6 16V6h10" />
                </svg>
            );
        case 'close':
            return (
                <svg {...svgProps}>
                    <path d="M6 6l12 12" />
                    <path d="M18 6 6 18" />
                </svg>
            );
        default:
            return null;
    }
};

const TitleBar = ({
    projectMeta,
    onSelectProject,
    onOpenWelcome,
    onOpenDocumentation,
    onOpenAbout,
    onCloseWorkspace,
    onBindBackend,
    onToggleTheme,
    theme,
    viewMode,
    onToggleView,
    onAddFile,
    onAddFolder,
    onSync,
    onRefreshPreview,
    hasDriver,
    bindingError,
    workspaceRoots = [],
    workspaceRootLabel = '',
    recentProjects = [],
    onOpenRecent,
    onCloneRepository,
    onConnectRemote,
    onOpenCommandPalette,
    language = 'en',
}) => {
    const [activeMenu, setActiveMenu] = useState(null);
    const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
    const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
    const [isMaximized, setIsMaximized] = useState(false);
    const [showSnapLayouts, setShowSnapLayouts] = useState(false);
    const [snapAnchor, setSnapAnchor] = useState({ top: 0, left: 0 });
    const menuRef = useRef(null);
    const workspaceMenuRef = useRef(null);
    const maximizeBtnRef = useRef(null);
    const snapOpenTimerRef = useRef(null);
    const snapCloseTimerRef = useRef(null);
    const t = (key) => getTranslation(language, key);
    const windowApi = typeof window !== 'undefined' ? window.electronAPI?.window : null;

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setActiveMenu(null);
            }
            if (showWorkspaceMenu && workspaceMenuRef.current && !workspaceMenuRef.current.contains(event.target)) {
                // Also check if click is inside the portal menu (we'll give it a class or id)
                const portalMenu = document.querySelector('.workspace-portal-menu');
                if (portalMenu && portalMenu.contains(event.target)) return;
                setShowWorkspaceMenu(false);
            }
        };
        const handleResize = () => setShowWorkspaceMenu(false);
        document.addEventListener('mousedown', handleClickOutside);
        window.addEventListener('resize', handleResize);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            window.removeEventListener('resize', handleResize);
        };
    }, [showWorkspaceMenu]);

    useEffect(() => {
        if (!windowApi?.isMaximized) return;
        windowApi.isMaximized().then((res) => {
            setIsMaximized(!!res?.maximized);
        }).catch(() => {});
    }, [windowApi]);

    useEffect(() => {
        return () => {
            if (snapOpenTimerRef.current) clearTimeout(snapOpenTimerRef.current);
            if (snapCloseTimerRef.current) clearTimeout(snapCloseTimerRef.current);
        };
    }, []);

    useEffect(() => {
        if (!showSnapLayouts) return;
        const handleResize = () => {
            if (!maximizeBtnRef.current) return;
            const rect = maximizeBtnRef.current.getBoundingClientRect();
            const left = Math.max(8, Math.round(rect.right - SNAP_PANEL_WIDTH));
            const top = Math.round(rect.bottom + SNAP_PANEL_GAP);
            setSnapAnchor({ top, left });
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [showSnapLayouts]);

    const toggleMenu = (menuName) => {
        setActiveMenu(activeMenu === menuName ? null : menuName);
    };

    const handleMenuItemClick = (action) => {
        setActiveMenu(null);
        if (action) action();
    };

    const handleLabelClick = (e) => {
        if (showWorkspaceMenu) {
            setShowWorkspaceMenu(false);
        } else {
            const rect = e.currentTarget.getBoundingClientRect();
            setMenuPosition({ top: rect.bottom + 4, left: rect.left });
            setShowWorkspaceMenu(true);
        }
    };

    const getFolderName = (path) => {
        if (!path) return '';
        const normalized = path.replace(/\\/g, '/');
        const parts = normalized.split('/').filter(Boolean);
        return parts.length > 0 ? parts[parts.length - 1] : path;
    };

    const projectLabel = (() => {
        if (Array.isArray(workspaceRoots) && workspaceRoots.length > 1) {
            const names = workspaceRoots.map((r) => (r && (r.name || getFolderName(r.path))) || '').filter(Boolean);
            if (names.length > 0) return names.join(' • ');
        }
        if (workspaceRootLabel) return getFolderName(workspaceRootLabel);
        if (projectMeta && projectMeta.pathLabel) return getFolderName(projectMeta.pathLabel);
        return projectMeta && projectMeta.name ? projectMeta.name : '';
    })();

    const menus = {
        [t('file')]: [
            { label: t('newFile'), action: onAddFile, shortcut: 'Ctrl+N', disabled: !hasDriver },
            { label: t('newFolder'), action: onAddFolder, shortcut: 'Ctrl+Shift+N', disabled: !hasDriver },
            { label: t('newWindow'), action: () => {
                try {
                    if (windowApi?.openNewWindow) {
                        windowApi.openNewWindow({});
                        return;
                    }
                } catch {
                    // ignore
                }
                try {
                    const url = new URL(window.location.href);
                    url.search = '';
                    url.searchParams.set('newWindow', '1');
                    window.open(url.toString(), '_blank', 'noopener,noreferrer');
                } catch {
                    // ignore
                }
            }, shortcut: 'Ctrl+Shift+Alt+N' },
            { type: 'separator' },
            { label: t('openFolder'), action: () => onSelectProject(), shortcut: 'Ctrl+O' },
            { label: t('closeFolder'), action: onCloseWorkspace, disabled: !hasDriver },
            { label: t('save'), action: onSync, shortcut: 'Ctrl+S', disabled: !hasDriver },
            { type: 'separator' },
            { label: t('exit'), action: () => window.close() }
        ],
        [t('edit')]: [
            { label: t('undo'), shortcut: 'Ctrl+Z' },
            { label: t('redo'), shortcut: 'Ctrl+Y' },
            { type: 'separator' },
            { label: t('cut'), shortcut: 'Ctrl+X' },
            { label: t('copy'), shortcut: 'Ctrl+C' },
            { label: t('paste'), shortcut: 'Ctrl+V' }
        ],
        [t('view')]: [
            { label: t('toggleSideBar'), shortcut: 'Ctrl+B' },
            { label: viewMode === 'code' ? t('switchToPreview') : t('switchToCode'), action: onToggleView },
            { label: t('toggleTheme'), action: onToggleTheme }
        ],
        [t('window')]: [
            { label: t('minimize'), action: () => windowApi?.minimize?.() }, 
            { label: t('maximize'), action: () => windowApi?.toggleMaximize?.() },
            { label: t('close'), action: () => (windowApi?.close?.() ?? window.close()) }
        ],
        [t('help')]: [
            { label: t('welcome'), action: onOpenWelcome },
            { label: t('documentation'), action: onOpenDocumentation },
            { label: t('about'), action: onOpenAbout }
        ]
    };

    const handleMinimize = () => {
        windowApi?.minimize?.();
    };

    const scheduleSnapOpen = () => {
        if (!windowApi?.applySnapLayout) return;
        if (snapCloseTimerRef.current) {
            clearTimeout(snapCloseTimerRef.current);
            snapCloseTimerRef.current = null;
        }
        if (snapOpenTimerRef.current) {
            clearTimeout(snapOpenTimerRef.current);
        }
        snapOpenTimerRef.current = setTimeout(() => {
            if (!maximizeBtnRef.current) return;
            const rect = maximizeBtnRef.current.getBoundingClientRect();
            const left = Math.max(8, Math.round(rect.right - SNAP_PANEL_WIDTH));
            const top = Math.round(rect.bottom + SNAP_PANEL_GAP);
            setSnapAnchor({ top, left });
            setShowSnapLayouts(true);
        }, 120);
    };

    const scheduleSnapClose = () => {
        if (snapOpenTimerRef.current) {
            clearTimeout(snapOpenTimerRef.current);
            snapOpenTimerRef.current = null;
        }
        if (snapCloseTimerRef.current) {
            clearTimeout(snapCloseTimerRef.current);
        }
        snapCloseTimerRef.current = setTimeout(() => {
            setShowSnapLayouts(false);
        }, 160);
    };

    const handleSnapSelection = async (layoutId, zoneIndex) => {
        if (!windowApi?.applySnapLayout) return;
        setShowSnapLayouts(false);
        try {
            await windowApi.applySnapLayout(layoutId, zoneIndex);
        } catch {}
    };

    const handleToggleMaximize = async () => {
        if (!windowApi?.toggleMaximize) return;
        try {
            const res = await windowApi.toggleMaximize();
            setIsMaximized(!!res?.maximized);
        } catch {}
    };

    const handleClose = () => {
        if (windowApi?.close) windowApi.close();
        else window.close();
    };

    return (
        <div
            className="title-bar"
            onDoubleClick={(e) => {
                if (e.target.closest('.menu-item, .menu-dropdown, .dropdown-item, .project-info, .title-bar-search-button, .window-actions, .window-controls')) return;
                handleToggleMaximize();
            }}
        >
            {/* Menu Section */}
            <div className="title-bar-menu" ref={menuRef}>
                {Object.keys(menus).map((menuName) => (
                    <div 
                        key={menuName} 
                        className={`menu-item ${activeMenu === menuName ? 'active' : ''}`}
                        onClick={() => toggleMenu(menuName)}
                    >
                        {menuName}
                        {activeMenu === menuName && (
                            <div className="menu-dropdown">
                                {menus[menuName].map((item, index) => (
                                    item.type === 'separator' ? (
                                        <div key={index} className="dropdown-separator"></div>
                                    ) : (
                                        <div 
                                            key={index} 
                                            className={`dropdown-item ${item.disabled ? 'disabled' : ''}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (!item.disabled) handleMenuItemClick(item.action);
                                            }}
                                        >
                                            <span>{item.label}</span>
                                            {item.shortcut && <span className="shortcut">{item.shortcut}</span>}
                                        </div>
                                    )
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Project Info & Actions */}
            <div className="title-bar-content">
                <div style={{ display: 'flex', alignItems: 'center' }}>
                <div 
                    className="project-info" 
                    onClick={handleLabelClick} 
                    title={projectLabel || 'Switch Project'}
                    ref={workspaceMenuRef}
                >
                    <span className="project-label">{t('workspace')}:</span>
                    <span className="project-value">
                        {projectLabel || projectMeta.name || t('untitled')}
                    </span>
                    {showWorkspaceMenu && createPortal(
                        <div 
                            className="menu-dropdown workspace-menu-dropdown workspace-portal-menu" 
                            style={{ 
                                top: menuPosition.top, 
                                left: menuPosition.left,
                                position: 'fixed',
                                zIndex: 100000 
                            }}
                        >
                            <div className="dropdown-item" onClick={(e) => { e.stopPropagation(); setShowWorkspaceMenu(false); onSelectProject(); }}>
                                <Icon name="folder-open" width={16} height={16} style={{ marginRight: 8 }} />
                                <span>{t('openFolder')}...</span>
                            </div>
                            <div className="dropdown-item" onClick={(e) => { e.stopPropagation(); setShowWorkspaceMenu(false); if (onCloneRepository) onCloneRepository(); }}>
                                <Icon name="git" width={16} height={16} style={{ marginRight: 8 }} />
                                <span>{t('cloneGitRepository')}...</span>
                            </div>
                            <div className="dropdown-item" onClick={(e) => { e.stopPropagation(); setShowWorkspaceMenu(false); if (onConnectRemote) onConnectRemote(); }}>
                                <Icon name="desktop" width={16} height={16} style={{ marginRight: 8 }} />
                                <span>{t('connectRemoteHost')}...</span>
                            </div>
                            
                            {recentProjects.length > 0 && (
                                <>
                                    <div className="dropdown-separator"></div>
                                    <div className="dropdown-section-header">{t('recent')}</div>
                                    {recentProjects.map((proj) => (
                                        <div 
                                            key={proj.id} 
                                            className="dropdown-item recent-project-item" 
                                            onClick={(e) => { e.stopPropagation(); setShowWorkspaceMenu(false); if (onOpenRecent) onOpenRecent(proj); }}
                                        >
                                            <span className="recent-project-name">{proj.name || getFolderName(proj.pathLabel)}</span>
                                            <span className="recent-project-path">
                                                {proj.pathLabel || proj.backendRoot}
                                            </span>
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>,
                        document.body
                    )}
                </div>

                <div 
                    className="title-bar-search-button"
                    onClick={onOpenCommandPalette}
                    title="Search files (Ctrl+P)"
                >
                    <Icon name="search" width={14} height={14} />
                    <span>Search</span>
                </div>
                </div>

                <div className="title-bar-actions">
                <div className="window-actions">
                    <button className="icon-action" onClick={onToggleTheme} title={t('toggleTheme')}>
                        <Icon name={theme === 'dark' ? 'moon' : 'sun'} />
                    </button>
                    <button className="icon-action" onClick={onToggleView} title={t('toggleView')}>
                        <Icon name={viewMode === 'code' ? 'eye' : 'code'} />
                    </button>
                </div>
                <div className="window-controls" style={{ display: windowApi ? 'flex' : 'none' }}>
                    <button className="window-control-btn" onClick={handleMinimize} title={t('minimize')}>
                        <Icon name="minimize" />
                    </button>
                    <button
                        className="window-control-btn"
                        onClick={handleToggleMaximize}
                        onMouseEnter={scheduleSnapOpen}
                        onMouseLeave={scheduleSnapClose}
                        ref={maximizeBtnRef}
                        title={t('maximize')}
                    >
                        <Icon name={isMaximized ? 'restore' : 'maximize'} />
                    </button>
                    <button className="window-control-btn close" onClick={handleClose} title={t('close')}>
                        <Icon name="close" />
                    </button>
                </div>
                {showSnapLayouts && windowApi?.applySnapLayout && createPortal(
                    <div
                        className="snap-layout-panel"
                        style={{ top: snapAnchor.top, left: snapAnchor.left }}
                        onMouseEnter={scheduleSnapOpen}
                        onMouseLeave={scheduleSnapClose}
                    >
                        {SNAP_LAYOUTS.map((layout) => (
                            <div key={layout.id} className="snap-layout-card">
                                <div
                                    className="snap-layout-grid"
                                    style={{
                                        gridTemplateColumns: `repeat(${layout.columns}, 1fr)`,
                                        gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
                                    }}
                                    aria-label={layout.label}
                                >
                                    {layout.zones.map((zone, zoneIndex) => (
                                        <button
                                            key={`${layout.id}-${zoneIndex}`}
                                            className="snap-layout-zone"
                                            style={{
                                                gridColumn: `${zone.col} / span ${zone.colSpan}`,
                                                gridRow: `${zone.row} / span ${zone.rowSpan}`,
                                            }}
                                            onClick={() => handleSnapSelection(layout.id, zoneIndex)}
                                            type="button"
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>,
                    document.body
                )}
                </div>
            </div>
        </div>
    );
};

export default TitleBar;
