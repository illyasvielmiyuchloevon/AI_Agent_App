import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  copyToClipboard,
  getFileIconClass,
  getTabIconClass,
  getTabTitle,
  isSpecialTabPath,
  pathJoinAbs,
} from '../utils/appAlgorithms';

function WorkspaceEditorGroups({
  groups = [],
  activeGroupId = 'group-1',
  editorLayout = null,
  editorNavigationMode = 'breadcrumbs',
  previewEnabled = true,
  tabMeta = null,
  updatedPaths = null,
  backendRoot = '',
  diffTabPrefix = '',
  diffTabs = null,
  settingsTabPath = '',
  terminalSettingsTabPath = '',
  terminalEditorTabPath = '',
  welcomeTabPath = '',
  onActiveGroupChange,
  onActiveFileChange,
  onTabReorder,
  onCloseFile,
  onCloseEditors,
  onToggleTabPinned,
  onToggleTabKeptOpen,
  onOpenFile,
  onSplitEditor,
  onToggleGroupLocked,
  onTogglePreviewEditorEnabled,
  onChangeEditorNavigationMode,
  onOpenEditorNavigation,
  renderGroupMain,
}) {
  const [tabContextMenu, setTabContextMenu] = useState(null);
  const [editorNavMenu, setEditorNavMenu] = useState(null);

  const isUpdated = useCallback((path) => {
    if (!updatedPaths || typeof updatedPaths.has !== 'function') return false;
    return updatedPaths.has(path);
  }, [updatedPaths]);

  const getTabFlags = useCallback((groupId, tabPath) => {
    const key = `${String(groupId || '')}::${String(tabPath || '')}`;
    const v = tabMeta && typeof tabMeta === 'object' ? tabMeta[key] : null;
    return {
      pinned: !!v?.pinned,
      keptOpen: !!v?.keptOpen,
      preview: !!v?.preview,
    };
  }, [tabMeta]);

  useEffect(() => {
    const onDocClick = () => {
      setTabContextMenu(null);
      setEditorNavMenu(null);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setTabContextMenu(null);
        setEditorNavMenu(null);
      }
    };
    window.addEventListener('click', onDocClick);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', onDocClick);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const renderContextItem = useCallback((label, action, { danger = false, disabled = false } = {}) => (
    <div
      className={`context-item ${danger ? 'danger' : ''} ${disabled ? 'disabled' : ''}`}
      style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, ...(danger ? { color: 'var(--danger)' } : {}) }}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        action?.();
        setTabContextMenu(null);
        setEditorNavMenu(null);
      }}
    >
      {label}
    </div>
  ), []);

  const renderSeparator = useCallback(() => <div className="context-sep" />, []);

  const openTabMenuAt = useCallback((e, groupId, tabPath) => {
    e.preventDefault();
    e.stopPropagation();
    setEditorNavMenu(null);
    setTabContextMenu({ x: e.clientX, y: e.clientY, groupId: String(groupId || ''), tabPath: String(tabPath || '') });
  }, []);

  const openNavMenuAt = useCallback((e, groupId) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect?.();
    const x = rect ? Math.max(8, Math.min(rect.left, window.innerWidth - 340)) : e.clientX;
    const y = rect ? rect.bottom + 6 : e.clientY;
    setTabContextMenu(null);
    setEditorNavMenu({ x, y, groupId: String(groupId || '') });
  }, []);

  const openInNewWindow = useCallback(async ({ path, groupId, mode }) => {
    const p = String(path || '');
    if (!p) return false;
    const payload = {
      openFile: p,
      groupId: String(groupId || ''),
      workspaceFsPath: String(backendRoot || ''),
      openMode: mode === 'copy' ? 'copy' : 'move',
    };
    try {
      const api = globalThis?.window?.electronAPI?.window;
      if (api?.openNewWindow) {
        const res = await api.openNewWindow(payload);
        return !!res?.ok;
      }
    } catch {}
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('openFile', p);
      url.searchParams.set('openMode', mode === 'copy' ? 'copy' : 'move');
      window.open(url.toString(), '_blank');
      return true;
    } catch {
      return false;
    }
  }, [backendRoot]);

  const revealInExplorer = useCallback((path) => {
    const p = String(path || '');
    if (!p) return;
    try {
      window.dispatchEvent(new CustomEvent('workbench:revealInExplorer', { detail: { path: p } }));
    } catch {}
  }, []);

  const layoutDirection = useMemo(() => {
    const g = Array.isArray(groups) ? groups : [];
    if (editorLayout && editorLayout.mode === 'split' && g.length > 1) {
      return editorLayout.direction === 'horizontal' ? 'horizontal' : 'vertical';
    }
    return g.length > 1 ? 'vertical' : 'single';
  }, [editorLayout, groups]);

  const renderGroupTabs = useCallback((group) => {
    const isActiveGroup = group.id === activeGroupId;
    const showControls = isActiveGroup && group.activeFile && !isSpecialTabPath(group.activeFile, {
      settingsTabPath,
      terminalSettingsTabPath,
      terminalEditorTabPath,
      welcomeTabPath,
      diffTabPrefix,
    });
    return (
      <div className="tab-row">
        <div className="tab-row-tabs">
          {(group.openTabs || []).map((path, idx) => {
            const flags = getTabFlags(group.id, path);
            const isPreviewTab = previewEnabled && !group.locked && flags.preview && group.previewTab === path;
            const tabIconClass = getTabIconClass(path, {
              settingsTabPath,
              terminalSettingsTabPath,
              terminalEditorTabPath,
              welcomeTabPath,
              diffTabPrefix,
            });
            const tabClass = [
              'tab',
              (group.activeFile === path ? 'active' : ''),
              (isUpdated(path) ? 'tab-updated' : ''),
              (isPreviewTab ? 'tab-preview' : ''),
              (flags.pinned ? 'tab-pinned' : ''),
            ].filter(Boolean).join(' ');

            return (
              <div
                key={`${group.id}:${path}`}
                className={tabClass}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', idx.toString())}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = Number(e.dataTransfer.getData('text/plain'));
                  onTabReorder?.(from, idx, { groupId: group.id });
                }}
                onContextMenu={(e) => openTabMenuAt(e, group.id, path)}
              >
                <button
                  className="tab-main"
                  onClick={() => {
                    onActiveGroupChange?.(group.id);
                    onActiveFileChange?.(path, { groupId: group.id });
                  }}
                  title={path}
                  type="button"
                >
                  <i className={`codicon ${tabIconClass} tab-file-icon`} aria-hidden />
                  {flags.pinned ? <i className="codicon codicon-pin tab-flag" aria-hidden /> : null}
                  {flags.keptOpen && !flags.pinned ? <i className="codicon codicon-lock tab-flag" aria-hidden /> : null}
                  <span className="tab-text">{getTabTitle(path, {
                    settingsTabPath,
                    terminalSettingsTabPath,
                    terminalEditorTabPath,
                    welcomeTabPath,
                    diffTabPrefix,
                    diffTabs,
                  })}</span>
                  {isUpdated(path) ? <span className="tab-dirty codicon codicon-circle-filled" aria-label="未保存更改" /> : null}
                </button>
                <button onClick={() => onCloseFile?.(path, { groupId: group.id })} className="tab-close" title="Close tab">
                  <i className="codicon codicon-close" aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
        {showControls ? (
          <div className="tab-row-actions">
            <button
              type="button"
              className="ghost-btn tiny"
              title={`向右拆分编辑器 (Ctrl+\\)\n[Alt] 向下拆分编辑器`}
              onClick={(e) => {
                e.stopPropagation();
                onSplitEditor?.({ direction: e.altKey ? 'down' : 'right', groupId: group.id, tabPath: group.activeFile, move: false });
              }}
              style={{ height: 28 }}
            >
              <i className="codicon codicon-split-horizontal" aria-hidden />
            </button>
            <button
              type="button"
              className="ghost-btn tiny"
              title="编辑器导航菜单"
              onClick={(e) => openNavMenuAt(e, group.id)}
              style={{ height: 28 }}
            >
              ⋯
            </button>
          </div>
        ) : null}
      </div>
    );
  }, [
    activeGroupId,
    diffTabPrefix,
    diffTabs,
    getTabFlags,
    isUpdated,
    onActiveFileChange,
    onActiveGroupChange,
    onCloseFile,
    onSplitEditor,
    onTabReorder,
    openNavMenuAt,
    openTabMenuAt,
    previewEnabled,
    settingsTabPath,
    terminalEditorTabPath,
    terminalSettingsTabPath,
    welcomeTabPath,
  ]);

  const renderBreadcrumbsForGroup = useCallback((group) => {
    if (editorNavigationMode !== 'breadcrumbs') return null;
    const f = String(group.activeFile || '');
    if (!f || isSpecialTabPath(f, {
      settingsTabPath,
      terminalSettingsTabPath,
      terminalEditorTabPath,
      welcomeTabPath,
      diffTabPrefix,
    })) return <div className="editor-breadcrumbs" role="navigation" aria-label="Breadcrumbs" />;
    const parts = f.split('/').filter(Boolean);
    const fileIcon = getFileIconClass(f);
    return (
      <div className="editor-breadcrumbs" role="navigation" aria-label="Breadcrumbs">
        {parts.map((part, idx) => (
          <span key={`${group.id}:${part}-${idx}`} className="breadcrumb-part">
            {idx > 0 ? <i className="codicon codicon-chevron-right" aria-hidden /> : null}
            {idx === parts.length - 1 ? <i className={`codicon ${fileIcon} breadcrumb-file-icon`} aria-hidden /> : null}
            <span>{part}</span>
          </span>
        ))}
      </div>
    );
  }, [
    diffTabPrefix,
    editorNavigationMode,
    settingsTabPath,
    terminalEditorTabPath,
    terminalSettingsTabPath,
    welcomeTabPath,
  ]);

  const renderTabContextMenu = useCallback(() => {
    if (!tabContextMenu?.tabPath || !tabContextMenu?.groupId) return null;
    const group = (Array.isArray(groups) ? groups : []).find((g) => g.id === tabContextMenu.groupId);
    if (!group) return null;
    const path = tabContextMenu.tabPath;
    const groupId = tabContextMenu.groupId;
    const flags = getTabFlags(groupId, path);
    const isPreviewTab = previewEnabled && !group.locked && flags.preview && group.previewTab === path;
    const absPath = backendRoot ? pathJoinAbs(backendRoot, path) : path;

    return (
      <div
        className="context-menu"
        style={{
          position: 'fixed',
          top: tabContextMenu.y,
          left: tabContextMenu.x,
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-soft)',
          zIndex: 200,
          minWidth: 240,
          padding: 4,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {renderContextItem('关闭当前编辑器', () => onCloseFile?.(path, { groupId }))}
        {renderContextItem('关闭其他编辑器', () => onCloseEditors?.('closeOthers', { groupId, tabPath: path }))}
        {renderContextItem('关闭右侧标签页', () => onCloseEditors?.('closeRight', { groupId, tabPath: path }))}
        {renderContextItem('关闭已保存的编辑器', () => onCloseEditors?.('closeSaved', { groupId }))}
        {renderContextItem('关闭全部编辑器', () => onCloseEditors?.('closeAll', { groupId }))}
        {renderSeparator()}
        {renderContextItem(flags.keptOpen ? '取消保持打开' : '保持打开状态（防止被自动替换）', () => onToggleTabKeptOpen?.(groupId, path))}
        {renderContextItem(flags.pinned ? '取消固定编辑器' : '固定编辑器', () => onToggleTabPinned?.(groupId, path))}
        {renderContextItem(isPreviewTab ? '转为持久编辑器' : '设为预览态编辑器', () => onOpenFile?.(path, { groupId, mode: isPreviewTab ? 'persistent' : 'preview' }), { disabled: !previewEnabled || !!group.locked })}
        {renderSeparator()}
        {renderContextItem('复制相对路径', () => copyToClipboard(path))}
        {renderContextItem('复制文件路径', () => copyToClipboard(absPath), { disabled: !backendRoot })}
        {renderContextItem('在文件资源管理器中显示', async () => {
          const api = globalThis?.window?.electronAPI?.shell;
          if (api?.showItemInFolder) {
            await api.showItemInFolder(absPath);
            return;
          }
          await copyToClipboard(absPath);
        }, { disabled: !backendRoot })}
        {renderContextItem('在资源管理器视图中高亮', () => {
          onActiveGroupChange?.(groupId);
          onActiveFileChange?.(path, { groupId });
          revealInExplorer(path);
        })}
        {renderSeparator()}
        {renderContextItem('向右拆分编辑器', () => onSplitEditor?.({ direction: 'right', groupId, tabPath: path, move: false }))}
        {renderContextItem('向下拆分编辑器', () => onSplitEditor?.({ direction: 'down', groupId, tabPath: path, move: false }))}
        {renderContextItem('拆分并移动到新编辑器组', () => onSplitEditor?.({ direction: 'right', groupId, tabPath: path, move: true }))}
        {renderSeparator()}
        {renderContextItem('移动到新窗口', async () => {
          const ok = await openInNewWindow({ path, groupId, mode: 'move' });
          if (ok) onCloseFile?.(path, { groupId });
        })}
        {renderContextItem('复制到新窗口', async () => {
          await openInNewWindow({ path, groupId, mode: 'copy' });
        })}
      </div>
    );
  }, [
    backendRoot,
    getTabFlags,
    groups,
    onActiveFileChange,
    onActiveGroupChange,
    onCloseEditors,
    onCloseFile,
    onOpenFile,
    onSplitEditor,
    onToggleTabKeptOpen,
    onToggleTabPinned,
    openInNewWindow,
    previewEnabled,
    renderContextItem,
    renderSeparator,
    revealInExplorer,
    tabContextMenu,
  ]);

  const renderEditorNavMenu = useCallback(() => {
    if (!editorNavMenu?.groupId) return null;
    const groupId = editorNavMenu.groupId;
    const group = (Array.isArray(groups) ? groups : []).find((g) => g.id === groupId);
    if (!group) return null;

    const navModeLabel = editorNavigationMode === 'stickyScroll'
      ? 'Sticky Scroll（粘性滚动）'
      : 'Breadcrumb Navigation（面包屑）';
    const nextNavMode = editorNavigationMode === 'stickyScroll' ? 'breadcrumbs' : 'stickyScroll';

    return (
      <div
        className="context-menu"
        style={{
          position: 'fixed',
          top: editorNavMenu.y,
          left: editorNavMenu.x,
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-soft)',
          zIndex: 200,
          width: 340,
          padding: 4,
          maxHeight: 'min(70vh, 520px)',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {renderContextItem(group.locked ? '解锁当前编辑器组' : '锁定当前编辑器组', () => onToggleGroupLocked?.(groupId))}
        {renderContextItem(previewEnabled ? '关闭预览编辑器模式' : '启用预览编辑器模式', () => onTogglePreviewEditorEnabled?.())}
        {renderSeparator()}
        <div style={{ padding: '6px 12px', color: 'var(--muted)', fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' }}>
          Navigation
        </div>
        {renderContextItem(navModeLabel, () => onChangeEditorNavigationMode?.(nextNavMode))}
        {renderSeparator()}
        {renderContextItem('打开编辑器导航（Command Palette）', () => onOpenEditorNavigation?.(groupId))}
        {renderSeparator()}
        {renderContextItem('全部关闭', () => onCloseEditors?.('closeAll', { scope: 'all' }))}
        {renderContextItem('关闭已保存', () => onCloseEditors?.('closeSaved', { scope: 'all' }))}
        {renderContextItem('编辑器配置入口（Settings）', () => onOpenFile?.(settingsTabPath, { groupId, mode: 'persistent' }))}
      </div>
    );
  }, [
    editorNavMenu,
    editorNavigationMode,
    groups,
    onChangeEditorNavigationMode,
    onCloseEditors,
    onOpenEditorNavigation,
    onOpenFile,
    onToggleGroupLocked,
    onTogglePreviewEditorEnabled,
    previewEnabled,
    renderContextItem,
    renderSeparator,
    settingsTabPath,
  ]);

  return (
    <div className="workspace-editor">
      <div className={`editor-groups editor-groups-${layoutDirection}`}>
        {(Array.isArray(groups) ? groups : []).map((group) => {
          const isActiveGroup = group.id === activeGroupId;
          return (
            <div
              key={group.id}
              className={`editor-group-pane ${isActiveGroup ? 'active' : ''}`}
              onMouseDown={() => onActiveGroupChange?.(group.id)}
            >
              {renderGroupTabs(group)}
              {renderBreadcrumbsForGroup(group)}
              <div className="monaco-shell" style={{ position: 'relative' }}>
                {renderGroupMain?.(group, { isActiveGroup })}
              </div>
            </div>
          );
        })}
      </div>
      {renderTabContextMenu()}
      {renderEditorNavMenu()}
    </div>
  );
}

export default React.memo(WorkspaceEditorGroups);
