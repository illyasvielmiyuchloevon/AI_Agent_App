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
  backendWorkspaces,
  onOpenFolder,
  onOpenFile,
  onNewFile,
  onPickFolderPath,
  onCloneRepository,
  onCreateTemplate,
  onOpenFolderWithPreferredRoot,
  onCancelOpen,
  onOpenRecent,
  onRemoveRecent,
  onOpenBackendWorkspace,
}) {
  const opening = bindingStatus === 'checking';
  const rootRef = useRef(null);
  const recentBtnRefs = useRef([]);
  const [filterText, setFilterText] = useState('');
  const [selectedRecentIndex, setSelectedRecentIndex] = useState(-1);
  const [statusText, setStatusText] = useState('');
  const [contextMenu, setContextMenu] = useState(null);
  const [cloneFormOpen, setCloneFormOpen] = useState(false);
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneDest, setCloneDest] = useState('');
  const [cloneFolderName, setCloneFolderName] = useState('');
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneResult, setCloneResult] = useState('');
  const [templatesFormOpen, setTemplatesFormOpen] = useState(false);
  const [templateId, setTemplateId] = useState('blank');
  const [templateName, setTemplateName] = useState('');
  const [templateDest, setTemplateDest] = useState('');
  const [templateBusy, setTemplateBusy] = useState(false);
  const activeWorkspaces = useMemo(() => (Array.isArray(backendWorkspaces) ? backendWorkspaces : []), [backendWorkspaces]);

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
  const visibleRecents = useMemo(() => filteredRecents.slice(0, 6), [filteredRecents]);

  useEffect(() => {
    setSelectedRecentIndex((prev) => {
      if (!visibleRecents.length) return -1;
      return clamp(prev, 0, visibleRecents.length - 1);
    });
  }, [visibleRecents.length]);

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

  useEffect(() => {
    const onGlobalKeyDown = (e) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) return;

      const tag = String(e.target?.tagName || '').toUpperCase();
      const isFormField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (e.key === 'Escape') {
        if (cloneFormOpen) {
          e.preventDefault();
          setCloneFormOpen(false);
          setCloneResult('');
          return;
        }
        if (templatesFormOpen) {
          e.preventDefault();
          setTemplatesFormOpen(false);
          return;
        }
        if (opening && onCancelOpen) {
          e.preventDefault();
          onCancelOpen().catch(() => {});
          return;
        }
      }

      if (isFormField) return;

      const key = String(e.key || '').toLowerCase();
      const mod = !!(e.metaKey || e.ctrlKey);
      if (!mod) return;

      if (key === 'o') {
        e.preventDefault();
        Promise.resolve(onOpenFile?.()).catch((err) => setStatusText(err?.message || 'Open file failed'));
      } else if (key === 'n') {
        e.preventDefault();
        Promise.resolve(onNewFile?.()).catch((err) => setStatusText(err?.message || 'New file failed'));
      }
    };

    document.addEventListener('keydown', onGlobalKeyDown);
    return () => document.removeEventListener('keydown', onGlobalKeyDown);
  }, [cloneFormOpen, onCancelOpen, onNewFile, onOpenFile, opening, templatesFormOpen]);

  const closeContextMenu = () => setContextMenu(null);

  const focusRecent = (idx) => {
    const btn = recentBtnRefs.current[idx];
    btn?.focus?.();
  };

  const openRecentAt = async (idx) => {
    const proj = visibleRecents[idx];
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
    const proj = visibleRecents[idx];
    if (!proj) return;
    try {
      await onRemoveRecent?.(proj);
      setStatusText('Removed from Recent');
    } catch (err) {
      setStatusText(err?.message || 'Remove failed');
    }
  };

  const onRecentKeyDown = (e) => {
    if (!visibleRecents.length) return;
    const key = e.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      const delta = key === 'ArrowDown' ? 1 : -1;
      setSelectedRecentIndex((prev) => {
        const next = clamp((prev < 0 ? 0 : prev) + delta, 0, visibleRecents.length - 1);
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
      hint: 'Ctrl+O / ⌘O',
      disabled: !onOpenFile,
      onClick: async () => {
        try {
          if (opening && onCancelOpen) {
            await onCancelOpen();
          }
          await onOpenFile?.();
        } catch (err) {
          setStatusText(err?.message || 'Open file failed');
        }
      },
    },
    {
      key: 'new-file',
      icon: 'codicon-new-file',
      label: 'New File…',
      hint: 'Ctrl+N / ⌘N',
      disabled: !onNewFile,
      onClick: async () => {
        try {
          if (opening && onCancelOpen) {
            await onCancelOpen();
          }
          await onNewFile?.();
        } catch (err) {
          setStatusText(err?.message || 'New file failed');
        }
      },
    },
    {
      key: 'clone',
      icon: 'codicon-repo-clone',
      label: 'Clone Repository…',
      hint: '',
      disabled: !onCloneRepository,
      onClick: () => {
        setCloneFormOpen(true);
        setCloneResult('');
        setStatusText('');
      },
    },
    {
      key: 'templates',
      icon: 'codicon-symbol-folder',
      label: 'Templates',
      hint: '',
      disabled: !onCreateTemplate,
      onClick: () => {
        setTemplatesFormOpen(true);
        setCloneFormOpen(false);
        setCloneResult('');
        setTemplateDest('');
        setStatusText('');
      },
    },
  ];

  const recentSectionTitle = useMemo(() => {
    if (!filterText.trim()) return 'Recent';
    return `Recent (${filteredRecents.length})`;
  }, [filterText, filteredRecents.length]);

  const deriveFolderNameFromUrl = (url) => {
    const raw = String(url || '').trim();
    if (!raw) return '';
    const last = raw.split('/').pop() || raw.split(':').pop() || '';
    return last.replace(/\.git$/i, '') || '';
  };

  const handleStartClone = async () => {
    if (!onCloneRepository) return;
    const url = String(cloneUrl || '').trim();
    const parentDir = String(cloneDest || '').trim();
    const folderName = String(cloneFolderName || '').trim() || deriveFolderNameFromUrl(url) || 'repo';
    if (!url) {
      setStatusText('Please enter a repository URL');
      return;
    }
    if (!parentDir) {
      setStatusText('Please choose a destination folder');
      return;
    }
    setCloneBusy(true);
    setStatusText('Cloning…');
    try {
      const res = await onCloneRepository({ url, parentDir, folderName });
      const targetPath = String(res?.targetPath || res || '').trim();
      if (!targetPath) throw new Error('Clone failed');
      setCloneResult(targetPath);
      setStatusText('Clone complete');
    } catch (err) {
      setStatusText(err?.message || 'Clone failed');
      setCloneResult('');
    } finally {
      setCloneBusy(false);
    }
  };

  const handleCreateTemplate = async () => {
    if (!onCreateTemplate) return;
    const name = String(templateName || '').trim();
    if (!name) {
      setStatusText('Please enter a project name');
      return;
    }
    setTemplateBusy(true);
    setStatusText('Creating…');
    try {
      const parentDir = String(templateDest || '').trim();
      const res = await onCreateTemplate({ templateId, projectName: name, parentDir });
      if (res?.queued) {
        setStatusText('Opening folder…');
      } else {
        setStatusText('Created');
        setTemplatesFormOpen(false);
      }
    } catch (err) {
      setStatusText(err?.message || 'Create template failed');
    } finally {
      setTemplateBusy(false);
    }
  };

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

              {cloneFormOpen ? (
                <div
                  className={styles.inlineForm}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setCloneFormOpen(false);
                      setCloneBusy(false);
                      setCloneResult('');
                      return;
                    }
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleStartClone();
                    }
                  }}
                >
                  <div className={styles.formRow}>
                    <div className={styles.formLabel}>Repository URL</div>
                    <input
                      className={styles.filterInput}
                      value={cloneUrl}
                      onChange={(e) => {
                        const next = e.target.value;
                        setCloneUrl(next);
                        if (!cloneFolderName) {
                          const inferred = deriveFolderNameFromUrl(next);
                          if (inferred) setCloneFolderName(inferred);
                        }
                      }}
                      placeholder="https://github.com/user/repo.git"
                      disabled={cloneBusy}
                    />
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formLabel}>Destination</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        disabled={cloneBusy || !onPickFolderPath}
                        onClick={async () => {
                          try {
                            const picked = await onPickFolderPath?.();
                            if (picked) setCloneDest(String(picked));
                          } catch (err) {
                            setStatusText(err?.message || 'Pick folder failed');
                          }
                        }}
                      >
                        <i className="codicon codicon-folder-opened" aria-hidden />
                        <span>Choose Folder…</span>
                      </button>
                      <div className={styles.pathBox} title={cloneDest || ''}>
                        {cloneDest ? cloneDest : 'No folder selected'}
                      </div>
                    </div>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formLabel}>Folder Name</div>
                    <input
                      className={styles.filterInput}
                      value={cloneFolderName}
                      onChange={(e) => setCloneFolderName(e.target.value)}
                      placeholder="repo"
                      disabled={cloneBusy}
                    />
                  </div>

                  {cloneResult ? (
                    <div className={styles.formRow}>
                      <div className={styles.formLabel}>Result</div>
                      <div className={styles.pathBox} title={cloneResult}>
                        {cloneResult}
                      </div>
                      <div className={styles.formActions} style={{ justifyContent: 'flex-start' }}>
                        <button
                          type="button"
                          className={styles.primaryButton}
                          disabled={!onOpenFolderWithPreferredRoot || opening}
                          onClick={async () => {
                            try {
                              await onOpenFolderWithPreferredRoot?.(cloneResult);
                            } catch (err) {
                              setStatusText(err?.message || 'Open folder failed');
                            }
                          }}
                        >
                          <i className="codicon codicon-folder-opened" aria-hidden />
                          <span>Open Cloned Folder…</span>
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className={styles.formActions}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={cloneBusy}
                      onClick={() => {
                        setCloneFormOpen(false);
                        setCloneResult('');
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      disabled={cloneBusy}
                      onClick={handleStartClone}
                      title="Ctrl/Cmd+Enter"
                    >
                      <i className={`codicon ${cloneBusy ? 'codicon-loading' : 'codicon-cloud-download'}`} aria-hidden />
                      <span>{cloneBusy ? 'Cloning…' : 'Clone'}</span>
                    </button>
                  </div>
                </div>
              ) : null}

              {templatesFormOpen ? (
                <div
                  className={styles.inlineForm}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setTemplatesFormOpen(false);
                      return;
                    }
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      handleCreateTemplate();
                    }
                  }}
                >
                  <div className={styles.formRow}>
                    <div className={styles.formLabel}>Template</div>
                    <select
                      className={styles.filterInput}
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value)}
                      disabled={templateBusy}
                    >
                      <option value="blank">Blank</option>
                      <option value="web">Web (index.html)</option>
                      <option value="react">React (src/App.jsx)</option>
                    </select>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formLabel}>Location</div>
                    <div className={styles.formInline}>
                      <input
                        className={styles.filterInput}
                        value={templateDest}
                        onChange={(e) => setTemplateDest(e.target.value)}
                        placeholder="Choose a destination folder (optional)"
                        disabled={templateBusy}
                      />
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        disabled={templateBusy || !onPickFolderPath}
                        onClick={async () => {
                          try {
                            const picked = await onPickFolderPath?.();
                            if (picked) setTemplateDest(String(picked || '').trim());
                          } catch (err) {
                            setStatusText(err?.message || 'Pick folder failed');
                          }
                        }}
                      >
                        Browse…
                      </button>
                    </div>
                  </div>

                  <div className={styles.formRow}>
                    <div className={styles.formLabel}>Project Name (folder)</div>
                    <input
                      className={styles.filterInput}
                      value={templateName}
                      onChange={(e) => setTemplateName(e.target.value)}
                      placeholder="my-project"
                      disabled={templateBusy}
                    />
                  </div>

                  <div className={styles.formActions}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={templateBusy}
                      onClick={() => setTemplatesFormOpen(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      disabled={templateBusy}
                      onClick={handleCreateTemplate}
                      title="Ctrl/Cmd+Enter"
                    >
                      <i className={`codicon ${templateBusy ? 'codicon-loading' : 'codicon-new-folder'}`} aria-hidden />
                      <span>{templateBusy ? 'Creating…' : 'Create'}</span>
                    </button>
                  </div>
                </div>
              ) : null}

              <div className={styles.statusBar}>
                <span>
                  Tips: <span className={styles.kbd}>↑</span>/<span className={styles.kbd}>↓</span> select recent,{' '}
                  <span className={styles.kbd}>Enter</span> open, <span className={styles.kbd}>Del</span> remove
                </span>
                {statusText ? <span>{statusText}</span> : <span />}
              </div>
      </div>
    </section>

    {activeWorkspaces.length ? (
      <section className={styles.section} aria-label="Active Workspaces">
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>Active Workspaces</div>
        </div>
        <div className={styles.sectionBody}>
          <div className={styles.recentList} role="listbox" aria-label="Active workspaces">
            {activeWorkspaces.map((ws, idx) => {
              const firstFolder = Array.isArray(ws.folders) && ws.folders[0] ? ws.folders[0].path : '';
              const name = ws.name || firstFolder || ws.id || `workspace-${idx}`;
              const secondary = firstFolder || ws.id || '';
              return (
                <button
                  key={ws.id || firstFolder || name}
                  type="button"
                  className={styles.recentItem}
                  onClick={() => onOpenBackendWorkspace?.(ws)}
                  title={secondary}
                >
                  <span className={styles.recentMain}>
                    <span className={styles.recentNameRow}>
                      <span className={styles.recentName}>{name}</span>
                    </span>
                    <span className={styles.recentPath}>{secondary || '—'}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>
    ) : null}

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
                    if (e.key === 'ArrowDown' && visibleRecents.length) {
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

              {!visibleRecents.length ? (
                <div className={styles.emptyState}>No recent folders</div>
              ) : (
                <div className={styles.recentList} role="listbox" aria-label="Recent folders" onKeyDown={onRecentKeyDown}>
                  {visibleRecents.map((proj, idx) => {
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
