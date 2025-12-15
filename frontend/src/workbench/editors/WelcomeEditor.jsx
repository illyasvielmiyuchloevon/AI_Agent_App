import React, { useEffect, useMemo, useRef, useState } from 'react';
import styles from './WelcomeEditor.module.css';

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeText(v) {
  return String(v || '').toLowerCase();
}

function getProjectDisplayName(proj) {
  if (!proj) return 'Untitled';
  return proj.name || proj.pathLabel || proj.fsPath || 'Untitled';
}

function getProjectSecondary(proj) {
  if (!proj) return '';
  return proj.fsPath || proj.pathLabel || '';
}

async function copyToClipboard(text) {
  const value = String(text || '');
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function ActionButton({ icon, label, hint, disabled, onClick, autoFocus, dataAction }) {
  return (
    <button
      className={styles.actionButton}
      type="button"
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled ? 'true' : 'false'}
      tabIndex={disabled ? -1 : 0}
      autoFocus={autoFocus}
      data-welcome-action={dataAction || undefined}
    >
      <span className={styles.actionIcon} aria-hidden>
        <i className={`codicon ${icon}`} />
      </span>
      <span className={styles.actionLabel}>{label}</span>
      {hint ? <span className={styles.actionHint}>{hint}</span> : null}
    </button>
  );
}

function ContextMenu({ x, y, onClose, items }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const onDocMouseDown = (e) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target)) onClose();
    };
    const onDocKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onDocKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const first = menuRef.current?.querySelector('button:not([disabled])');
    first?.focus?.();
  }, []);

  return (
    <div ref={menuRef} className={styles.contextMenu} style={{ left: x, top: y }} role="menu" aria-label="Recent item menu">
      {items.map((it, idx) => {
        if (it.type === 'sep') return <div key={`sep-${idx}`} className={styles.contextSep} role="separator" />;
        const disabled = !!it.disabled;
        return (
          <button
            key={it.key || idx}
            type="button"
            role="menuitem"
            className={`${styles.contextItem} ${disabled ? styles.contextItemDisabled : ''}`}
            onClick={disabled ? undefined : it.onSelect}
            disabled={disabled}
          >
            <span className={styles.actionIcon} aria-hidden>
              <i className={`codicon ${it.icon}`} />
            </span>
            <span>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function WelcomeEditor({
  theme,
  bindingStatus,
  bindingError,
  recentProjects,
  onOpenFolder,
  onCancelOpen,
  onOpenRecent,
  onRemoveRecent,
}) {
  const opening = bindingStatus === 'checking';
  const rootRef = useRef(null);
  const recentBtnRefs = useRef([]);
  const [filterText, setFilterText] = useState('');
  const [selectedRecentIndex, setSelectedRecentIndex] = useState(-1);
  const [statusText, setStatusText] = useState('');
  const [contextMenu, setContextMenu] = useState(null);

  const filteredRecents = useMemo(() => {
    const list = Array.isArray(recentProjects) ? recentProjects : [];
    const q = normalizeText(filterText).trim();
    if (!q) return list;
    return list.filter((p) => {
      const name = normalizeText(getProjectDisplayName(p));
      const secondary = normalizeText(getProjectSecondary(p));
      return name.includes(q) || secondary.includes(q) || normalizeText(p?.id).includes(q);
    });
  }, [filterText, recentProjects]);

  useEffect(() => {
    setSelectedRecentIndex((prev) => {
      if (!filteredRecents.length) return -1;
      return clamp(prev, 0, filteredRecents.length - 1);
    });
  }, [filteredRecents.length]);

  useEffect(() => {
    if (!statusText) return undefined;
    const t = setTimeout(() => setStatusText(''), 3000);
    return () => clearTimeout(t);
  }, [statusText]);

  useEffect(() => {
    if (bindingStatus === 'error' && bindingError) {
      setStatusText(bindingError);
    }
  }, [bindingError, bindingStatus]);

  const closeContextMenu = () => setContextMenu(null);

  const focusRecent = (idx) => {
    const btn = recentBtnRefs.current[idx];
    btn?.focus?.();
  };

  const openRecentAt = async (idx) => {
    const proj = filteredRecents[idx];
    if (!proj) return;
    if (proj.missing) {
      setStatusText('Folder is missing. You can remove it from Recent.');
    }
    try {
      await onOpenRecent?.(proj);
    } catch (err) {
      setStatusText(err?.message || 'Open failed');
    }
  };

  const handleOpenFolder = async () => {
    try {
      if (opening && onCancelOpen) {
        await onCancelOpen();
      }
      await onOpenFolder?.();
    } catch (err) {
      setStatusText(err?.message || 'Open folder failed');
    }
  };

  const removeRecentAt = async (idx) => {
    const proj = filteredRecents[idx];
    if (!proj) return;
    try {
      await onRemoveRecent?.(proj);
      setStatusText('Removed from Recent');
    } catch (err) {
      setStatusText(err?.message || 'Remove failed');
    }
  };

  const onRecentKeyDown = (e) => {
    if (!filteredRecents.length) return;
    const key = e.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      const delta = key === 'ArrowDown' ? 1 : -1;
      setSelectedRecentIndex((prev) => {
        const next = clamp((prev < 0 ? 0 : prev) + delta, 0, filteredRecents.length - 1);
        requestAnimationFrame(() => focusRecent(next));
        return next;
      });
      return;
    }
    if (key === 'Enter') {
      e.preventDefault();
      const idx = selectedRecentIndex >= 0 ? selectedRecentIndex : 0;
      openRecentAt(idx);
      return;
    }
    if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault();
      const idx = selectedRecentIndex >= 0 ? selectedRecentIndex : 0;
      removeRecentAt(idx);
      return;
    }
    if (key === 'Escape') {
      e.preventDefault();
      setSelectedRecentIndex(-1);
      rootRef.current?.querySelector(`button[data-welcome-action="open-folder"]`)?.focus?.();
    }
  };

  const primaryActions = [
    {
      key: 'open-folder',
      icon: 'codicon-folder-opened',
      label: 'Open Folder…',
      hint: '',
      disabled: false,
      onClick: handleOpenFolder,
      autoFocus: true,
      dataAction: 'open-folder',
    },
    {
      key: 'open-file',
      icon: 'codicon-go-to-file',
      label: 'Open File…',
      hint: 'Coming soon',
      disabled: true,
      onClick: () => {},
    },
    {
      key: 'new-file',
      icon: 'codicon-new-file',
      label: 'New File…',
      hint: 'Coming soon',
      disabled: true,
      onClick: () => {},
    },
    {
      key: 'clone',
      icon: 'codicon-repo-clone',
      label: 'Clone Repository…',
      hint: 'Coming soon',
      disabled: true,
      onClick: () => {},
    },
    {
      key: 'templates',
      icon: 'codicon-symbol-folder',
      label: 'Templates',
      hint: 'Coming soon',
      disabled: true,
      onClick: () => {},
    },
  ];

  const recentSectionTitle = useMemo(() => {
    if (!filterText.trim()) return 'Recent';
    return `Recent (${filteredRecents.length})`;
  }, [filterText, filteredRecents.length]);

  return (
    <div className={styles.root} ref={rootRef}>
      <div className={styles.content}>
        <div className={styles.header}>
          <div className={styles.titleWrap}>
            <div className={styles.title}>Welcome</div>
            <div className={styles.subtitle}>
              {opening ? 'Opening workspace…' : 'Choose an action to get started.'}
            </div>
          </div>
          <div className={styles.headerRight} aria-live="polite">
            {opening ? (
              <>
                <span className={styles.spinner} aria-hidden>
                  <i className="codicon codicon-loading" />
                </span>
                <span>Initializing</span>
                {onCancelOpen ? (
                  <button
                    type="button"
                    className={styles.headerButton}
                    onClick={async () => {
                      try {
                        await onCancelOpen();
                        setStatusText('Canceled');
                      } catch (err) {
                        setStatusText(err?.message || 'Cancel failed');
                      }
                    }}
                  >
                    <i className="codicon codicon-close" aria-hidden />
                    <span>Cancel</span>
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        {bindingStatus === 'error' && bindingError ? <div className={styles.errorBox}>{bindingError}</div> : null}

        <div className={styles.grid}>
          <section className={styles.section} aria-label="Start">
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>Start</div>
            </div>
            <div className={styles.sectionBody}>
              <div className={styles.actionList}>
                {primaryActions.map((a) => (
                  <div key={a.key}>
                    <ActionButton
                      icon={a.icon}
                      label={a.label}
                      hint={a.hint}
                      disabled={!!a.disabled}
                      onClick={a.onClick}
                      autoFocus={!!a.autoFocus}
                      dataAction={a.dataAction}
                    />
                    {a.key === 'open-folder' ? (
                      <div className={styles.divider} aria-hidden />
                    ) : null}
                  </div>
                ))}
              </div>
              <div className={styles.statusBar}>
                <span>
                  Tips: <span className={styles.kbd}>↑</span>/<span className={styles.kbd}>↓</span> select recent,{' '}
                  <span className={styles.kbd}>Enter</span> open, <span className={styles.kbd}>Del</span> remove
                </span>
                {statusText ? <span>{statusText}</span> : <span />}
              </div>
            </div>
          </section>

          <section className={styles.section} aria-label="Recent">
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>{recentSectionTitle}</div>
            </div>
            <div className={styles.sectionBody}>
              <div className={styles.filterRow}>
                <input
                  className={styles.filterInput}
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="Filter recent"
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' && filteredRecents.length) {
                      e.preventDefault();
                      const next = selectedRecentIndex >= 0 ? selectedRecentIndex : 0;
                      setSelectedRecentIndex(next);
                      requestAnimationFrame(() => focusRecent(next));
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setFilterText('');
                    }
                  }}
                />
              </div>

              {!filteredRecents.length ? (
                <div className={styles.emptyState}>No recent folders</div>
              ) : (
                <div className={styles.recentList} role="listbox" aria-label="Recent folders" onKeyDown={onRecentKeyDown}>
                  {filteredRecents.map((proj, idx) => {
                    const selected = idx === selectedRecentIndex;
                    const inTabOrder = selectedRecentIndex < 0 ? idx === 0 : selected;
                    const name = getProjectDisplayName(proj);
                    const secondary = getProjectSecondary(proj);
                    return (
                      <div
                        key={proj.id || `${name}-${idx}`}
                        ref={(el) => {
                          recentBtnRefs.current[idx] = el;
                        }}
                        className={`${styles.recentItem} ${selected ? styles.recentItemSelected : ''}`}
                        role="option"
                        aria-selected={selected ? 'true' : 'false'}
                        tabIndex={inTabOrder ? 0 : -1}
                        title={secondary}
                        onClick={() => {
                          setSelectedRecentIndex(idx);
                          openRecentAt(idx);
                        }}
                        onFocus={() => setSelectedRecentIndex(idx)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedRecentIndex(idx);
                            openRecentAt(idx);
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setSelectedRecentIndex(idx);
                          const fsPath = proj?.fsPath || '';
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            idx,
                            fsPath,
                          });
                        }}
                      >
                        <span className={styles.recentMain}>
                          <span className={styles.recentNameRow}>
                            <span className={styles.recentName}>{name}</span>
                            {proj.missing ? <span className={`${styles.tag} ${styles.tagMissing}`}>Missing</span> : null}
                          </span>
                          <span className={styles.recentPath}>{secondary || '—'}</span>
                        </span>
                        <span className={styles.recentActions} aria-label="Recent item actions">
                          <button
                            className={styles.iconButton}
                            type="button"
                            title="Remove from Recent"
                            tabIndex={-1}
                            onClick={(ev) => {
                              ev.preventDefault();
                              ev.stopPropagation();
                              removeRecentAt(idx);
                            }}
                            onKeyDown={(ev) => ev.stopPropagation()}
                          >
                            <i className="codicon codicon-trash" />
                          </button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={closeContextMenu}
          items={[
            {
              key: 'open',
              icon: 'codicon-go-to-file',
              label: 'Open',
              onSelect: () => {
                closeContextMenu();
                openRecentAt(contextMenu.idx);
              },
            },
            {
              key: 'remove',
              icon: 'codicon-trash',
              label: 'Remove from Recent',
              onSelect: () => {
                closeContextMenu();
                removeRecentAt(contextMenu.idx);
              },
            },
            { type: 'sep' },
            {
              key: 'copy',
              icon: 'codicon-copy',
              label: 'Copy Path',
              disabled: !contextMenu.fsPath,
              onSelect: async () => {
                const ok = await copyToClipboard(contextMenu.fsPath);
                closeContextMenu();
                setStatusText(ok ? 'Copied' : 'Copy failed');
              },
            },
          ]}
        />
      ) : null}
    </div>
  );
}
