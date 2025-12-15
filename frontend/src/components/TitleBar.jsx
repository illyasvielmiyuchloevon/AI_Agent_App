import React, { useState, useEffect, useRef } from 'react';

const Icon = ({ name }) => {
    const common = {
        stroke: 'currentColor',
        fill: 'none',
        strokeWidth: 1.75,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
    };
    const props = { width: 18, height: 18, viewBox: '0 0 24 24', ...common };
    switch (name) {
        case 'folder-open':
            return (
                <svg {...props}>
                    <path d="M3.5 7.5h6l2 2H20a1.5 1.5 0 0 1 1.5 1.5v6.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5V9A1.5 1.5 0 0 1 5 7.5Z" />
                    <path d="M3.5 10.5h17" />
                </svg>
            );
        case 'link':
            return (
                <svg {...props}>
                    <path d="M9.5 14.5 7 17a3 3 0 1 1-4.24-4.24l3.3-3.3A3 3 0 0 1 9.5 8.5" />
                    <path d="M14.5 9.5 17 7a3 3 0 1 1 4.24 4.24l-3.3 3.3A3 3 0 0 1 14.5 15.5" />
                    <path d="M9.75 14.25 14.25 9.75" />
                </svg>
            );
        case 'sun':
            return (
                <svg {...props}>
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 3v2.2M12 18.8V21M4.6 4.6 6.2 6.2M17.8 17.8 19.4 19.4M3 12h2.2M18.8 12H21M4.6 19.4 6.2 17.8M17.8 6.2l1.6-1.6" />
                </svg>
            );
        case 'moon':
            return (
                <svg {...props}>
                    <path d="M20 14.5A7.5 7.5 0 0 1 12 4a7.5 7.5 0 1 0 8 10.5Z" />
                </svg>
            );
        case 'eye':
            return (
                <svg {...props}>
                    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
                    <circle cx="12" cy="12" r="2.8" />
                </svg>
            );
        case 'code':
            return (
                <svg {...props}>
                    <path d="M15 6.5 20.5 12 15 17.5" />
                    <path d="M9 6.5 3.5 12 9 17.5" />
                </svg>
            );
        case 'doc-plus':
            return (
                <svg {...props}>
                    <path d="M8 3.5h5l3.5 3.5V18a2.5 2.5 0 0 1-2.5 2.5H8A2.5 2.5 0 0 1 5.5 18V6A2.5 2.5 0 0 1 8 3.5Z" />
                    <path d="M13 3.5V7h3.5" />
                    <path d="M12 11v5" />
                    <path d="M9.5 13.5h5" />
                </svg>
            );
        case 'folder-plus':
            return (
                <svg {...props}>
                    <path d="M3.5 8h6l2 2h9a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 20.5 19H5a1.5 1.5 0 0 1-1.5-1.5V9.5A1.5 1.5 0 0 1 5 8Z" />
                    <path d="M12.5 12.5v4" />
                    <path d="M10.5 14.5h4" />
                </svg>
            );
        case 'sync':
            return (
                <svg {...props}>
                    <path d="M5 8.5a7 7 0 0 1 11-2l1.5 1.5" />
                    <path d="M4 6.5v3h3" />
                    <path d="M19 15.5a7 7 0 0 1-11 2L6.5 16" />
                    <path d="M20 17.5v-3h-3" />
                </svg>
            );
        case 'refresh':
            return (
                <svg {...props}>
                    <path d="M20 4v5h-5" />
                    <path d="M4 20v-5h5" />
                    <path d="M5 9a7 7 0 0 1 12-2l2 2" />
                    <path d="M19 15a7 7 0 0 1-12 2l-2-2" />
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
    bindingError
}) => {
    const [activeMenu, setActiveMenu] = useState(null);
    const menuRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setActiveMenu(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const toggleMenu = (menuName) => {
        setActiveMenu(activeMenu === menuName ? null : menuName);
    };

    const handleMenuItemClick = (action) => {
        setActiveMenu(null);
        if (action) action();
    };

    const menus = {
        File: [
            { label: 'New File', action: onAddFile, shortcut: 'Ctrl+N', disabled: !hasDriver },
            { label: 'New Folder', action: onAddFolder, shortcut: 'Ctrl+Shift+N', disabled: !hasDriver },
            { type: 'separator' },
            { label: 'Open Folder', action: () => onSelectProject(), shortcut: 'Ctrl+O' },
            { label: 'Close Folder', action: onCloseWorkspace, disabled: !hasDriver },
            { label: 'Save', action: onSync, shortcut: 'Ctrl+S', disabled: !hasDriver },
            { type: 'separator' },
            { label: 'Exit', action: () => window.close() }
        ],
        Edit: [
            { label: 'Undo', shortcut: 'Ctrl+Z' },
            { label: 'Redo', shortcut: 'Ctrl+Y' },
            { type: 'separator' },
            { label: 'Cut', shortcut: 'Ctrl+X' },
            { label: 'Copy', shortcut: 'Ctrl+C' },
            { label: 'Paste', shortcut: 'Ctrl+V' }
        ],
        View: [
            { label: 'Toggle Side Bar', shortcut: 'Ctrl+B' },
            { label: viewMode === 'code' ? 'Switch to Preview' : 'Switch to Code', action: onToggleView },
            { label: 'Toggle Theme', action: onToggleTheme }
        ],
        Window: [
            { label: 'Minimize', action: () => {} }, 
            { label: 'Maximize', action: () => {} },
            { label: 'Close', action: () => window.close() }
        ],
        Help: [
            { label: 'Welcome', action: onOpenWelcome },
            { label: 'Documentation', action: () => console.log('Docs') },
            { label: 'About', action: () => console.log('About') }
        ]
    };

    return (
        <div className="title-bar">
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
                <div className="project-info" onClick={() => onSelectProject(projectMeta.id)} title="Switch Project">
                    <span className="project-label">Project:</span>
                    <span className="project-value">{projectMeta.name || 'Untitled'}</span>
                </div>

                <div className="window-actions">
                     <button className="icon-action" onClick={() => onSelectProject()} title="Open Folder">
                        <Icon name="folder-open" />
                    </button>
                    <button className="icon-action" onClick={onBindBackend} title="Bind Backend">
                        <Icon name="link" />
                    </button>
                    <button className="icon-action" onClick={onToggleTheme} title="Toggle Theme">
                        <Icon name={theme === 'dark' ? 'moon' : 'sun'} />
                    </button>
                    <button className="icon-action" onClick={onToggleView} title="Toggle View">
                        <Icon name={viewMode === 'code' ? 'eye' : 'code'} />
                    </button>
                    <button className="icon-action" onClick={onAddFile} disabled={!hasDriver} title="New File">
                        <Icon name="doc-plus" />
                    </button>
                    <button className="icon-action" onClick={onAddFolder} disabled={!hasDriver} title="New Folder">
                        <Icon name="folder-plus" />
                    </button>
                    <button className="icon-action" onClick={onSync} disabled={!hasDriver} title="Sync">
                        <Icon name="sync" />
                    </button>
                    <button className="icon-action" onClick={onRefreshPreview} disabled={!hasDriver} title="Refresh">
                        <Icon name="refresh" />
                    </button>
                    {bindingError && <span className="error-badge">!</span>}
                </div>
            </div>
            
            {/* Spacer for Window Controls (Electron overlay) */}
            <div style={{ width: '140px', flexShrink: 0 }}></div> 
        </div>
    );
};

export default TitleBar;
