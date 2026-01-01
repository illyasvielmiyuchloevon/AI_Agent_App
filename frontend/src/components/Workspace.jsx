import React, { useMemo, useState, useEffect, Suspense, useCallback, useRef } from 'react';
import PanelShell from '../workbench/bottom-panel/PanelShell';
import { lspService } from '../workbench/services/lspService';
import ManagedDiffEditor from './ManagedDiffEditor';
import WorkspaceEditorGroups from './WorkspaceEditorGroups';
import { useWorkspaceAi, WorkspaceAiOverlay } from './WorkspaceAiOverlay';
import WorkspaceTaskReviewFloating from './WorkspaceTaskReviewFloating';
import { useWorkspaceTaskReviewMonaco } from './useWorkspaceTaskReviewMonaco';
import { useWorkspaceMonacoBinding } from './useWorkspaceMonacoBinding';
import { useWorkspaceLspEditorActions } from './useWorkspaceLspEditorActions';
import { useWorkbenchEditorEvents } from './useWorkbenchEditorEvents';
import { useStatusBarEditorPatch } from './useStatusBarEditorPatch';
import WorkspacePreviewPane from './WorkspacePreviewPane';
import { loadMonacoEditorWithUndoRedoPatch } from '../utils/appMonaco';
import { buildMonacoOptions, normalizeEditorSettings, resolveEditorNavigationMode } from '../utils/workspaceMonaco';
import { normalizeWorkspaceGroups, resolveActiveGroupId } from '../utils/workspaceGroups';
import {
  copyToClipboard,
  getFileIconClass,
  getKeybindingValue,
  getTabTitle,
  inferMonacoLanguage,
  isSpecialTabPath,
  parseMonacoKeybinding,
  pathJoinAbs,
  resolveDiffModelBaseForPath,
  resolveBlockPosition,
  toLines,
} from '../utils/appAlgorithms';

const MonacoEditor = React.lazy(() => loadMonacoEditorWithUndoRedoPatch());

function Workspace({
  files,
  openTabs: legacyOpenTabs,
  activeFile: legacyActiveFile,
  editorGroups,
  activeGroupId: activeGroupIdProp,
  editorLayout,
  previewEditorEnabled,
  tabMeta,
  tabHistory,
  viewMode,
  livePreviewContent,
  entryCandidates,
  loading,
  hasWorkspace,
  workspaceRootLabel,
  workspaceRoots,
  bindingStatus,
  bindingError,
  hotReloadToken,
  theme,
  backendRoot,
  keybindings,
  editorSettings,
  onChangeEditorNavigationMode,
  welcomeTabPath,
  renderWelcomeTab,
  onOpenWelcomeTab,
  previewEntry = '',
  onSelectFolder,
  onBindBackendRoot,
  onOpenFile,
  onCloseFile,
  onFileChange,
  onActiveFileChange,
  onActiveGroupChange,
  onOpenEditorNavigation,
  onTabReorder,
  onToggleGroupLocked,
  onTogglePreviewEditorEnabled,
  onToggleTabPinned,
  onToggleTabKeptOpen,
  onCloseEditors,
  onSplitEditor,
  onAddFile,
  onAddFolder,
  onRefreshPreview,
  onToggleTheme,
  onToggleView,
  onSyncStructure,
  onWorkspaceCreateFile,
  onWorkspaceRenamePath,
  onWorkspaceDeletePath,
  onWorkspaceReadFile,
  onWorkspaceWriteFile,
  onPreviewEntryChange,
  settingsTabPath,
  renderSettingsTab,
  terminalSettingsTabPath,
  renderTerminalSettingsTab,
  terminalEditorTabPath,
  renderTerminalEditorTab,
  taskReview,
  onTaskKeepFile,
  onTaskRevertFile,
  onTaskKeepBlock,
  onTaskRevertBlock,
  onTaskResetBlock,
  onTaskResetFile,
  onTaskSetCursor,
  diffTabPrefix,
  diffTabs,
  diffViewMode = 'compact',
  aiEngineClient,
  getBackendConfig,
  currentSessionId,
  backendWorkspaceId,
  onRegisterEditorAiInvoker,
  undoRedoLimit = 16,
}) {
  const monacoTheme = useMemo(() => {
    if (theme === 'high-contrast') return 'hc-black';
    return theme === 'dark' ? 'vs-dark' : 'vs';
  }, [theme]);

  const normalizedEditorSettings = useMemo(() => normalizeEditorSettings(editorSettings), [editorSettings]);

  const editorNavigationMode = useMemo(() => resolveEditorNavigationMode(editorSettings), [editorSettings]);

  const monacoOptions = useMemo(
    () => buildMonacoOptions(normalizedEditorSettings, editorNavigationMode),
    [editorNavigationMode, normalizedEditorSettings]
  );
  const compactDiff = diffViewMode === 'compact';

  const previewEnabled = previewEditorEnabled !== false;

  const groups = useMemo(() => {
    return normalizeWorkspaceGroups(editorGroups, legacyOpenTabs, legacyActiveFile);
  }, [editorGroups, legacyActiveFile, legacyOpenTabs]);

  const activeGroupId = useMemo(() => {
    return resolveActiveGroupId(activeGroupIdProp, groups);
  }, [activeGroupIdProp, groups]);

  const activeGroup = useMemo(() => groups.find((g) => g.id === activeGroupId) || groups[0] || { id: activeGroupId, openTabs: [], activeFile: '' }, [activeGroupId, groups]);
  const openTabs = activeGroup?.openTabs || [];
  const activeFile = activeGroup?.activeFile || '';

  const activeContent = files.find((f) => f.path === activeFile)?.content || '';
  const diffModelBase = useMemo(() => {
    if (!diffTabPrefix || !activeFile || !activeFile.startsWith(diffTabPrefix)) return activeFile || 'diff';
    const diff = diffTabs && diffTabs[activeFile];
    return (diff && (diff.id || diff.diff_id || diff.path)) || activeFile || 'diff';
  }, [activeFile, diffTabPrefix, diffTabs]);
  
  const updatedPaths = useMemo(
    () => new Set(files.filter((f) => f.dirty).map((f) => f.path)),
    [files]
  );

  const projectLabel = useMemo(() => {
    if (workspaceRoots && Array.isArray(workspaceRoots) && workspaceRoots.length > 1) {
      const names = workspaceRoots.map((r) => (r && (r.name || r.path)) || '').filter(Boolean);
      if (names.length > 0) return names.join(' • ');
    }
    return workspaceRootLabel;
  }, [workspaceRootLabel, workspaceRoots]);

  const canUseEditorAi = !!aiEngineClient && !!activeFile
    && !(settingsTabPath && activeFile === settingsTabPath)
    && !(welcomeTabPath && activeFile === welcomeTabPath)
    && !(diffTabPrefix && activeFile && activeFile.startsWith(diffTabPrefix));

  const filesRef = useRef(files);
  const activeGroupIdRef = useRef(activeGroupId);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    activeGroupIdRef.current = activeGroupId;
  }, [activeGroupId]);

  const getFilesForLsp = useCallback(() => filesRef.current, []);
  const getActiveGroupIdForLsp = useCallback(() => activeGroupIdRef.current || 'group-1', []);

  const lspUiContext = useMemo(() => ({
    getFiles: getFilesForLsp,
    onFileChange,
    onOpenFile,
    onSyncStructure,
    onWorkspaceCreateFile,
    onWorkspaceRenamePath,
    onWorkspaceDeletePath,
    onWorkspaceReadFile,
    onWorkspaceWriteFile,
    getActiveGroupId: getActiveGroupIdForLsp,
  }), [
    getActiveGroupIdForLsp,
    getFilesForLsp,
    onFileChange,
    onOpenFile,
    onSyncStructure,
    onWorkspaceCreateFile,
    onWorkspaceDeletePath,
    onWorkspaceReadFile,
    onWorkspaceRenamePath,
    onWorkspaceWriteFile,
  ]);

  useEffect(() => {
    lspService.updateUiContext(lspUiContext);
  }, [lspUiContext]);

  const taskReviewFile = useMemo(() => {
    const list = taskReview?.files;
    if (!activeFile || !Array.isArray(list)) return null;
    return list.find((f) => f && f.path === activeFile) || null;
  }, [activeFile, taskReview]);

  const taskBlocks = useMemo(() => (
    taskReviewFile && Array.isArray(taskReviewFile.blocks) ? taskReviewFile.blocks : []
  ), [taskReviewFile]);

  const taskCursorIndex = useMemo(() => {
    const raw = taskReview?.cursorByPath && activeFile ? taskReview.cursorByPath[activeFile] : 0;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
  }, [activeFile, taskReview]);

  const taskActiveIndex = useMemo(() => {
    if (!taskBlocks.length) return 0;
    return Math.min(taskCursorIndex, taskBlocks.length - 1);
  }, [taskBlocks.length, taskCursorIndex]);

  const pendingBlocks = useMemo(() => (
    taskBlocks.filter(b => b.action === 'pending')
  ), [taskBlocks]);

  const currentPendingIndex = useMemo(() => {
    if (!pendingBlocks.length) return -1;
    const activeBlockId = taskBlocks[taskActiveIndex]?.id;
    return pendingBlocks.findIndex(b => b.id === activeBlockId);
  }, [pendingBlocks, taskBlocks, taskActiveIndex]);

  const hasTaskReview = !!activeFile
    && !(settingsTabPath && activeFile === settingsTabPath)
    && !(welcomeTabPath && activeFile === welcomeTabPath)
    && !(diffTabPrefix && activeFile && activeFile.startsWith(diffTabPrefix))
    && !!taskReviewFile
    && taskBlocks.length > 0;

  const shouldShowTaskReviewUI = hasTaskReview && taskBlocks.some(b => b.action === 'pending');

  const normalizedUndoRedoLimit = useMemo(() => {
    const raw = Number(undoRedoLimit);
    const normalized = Number.isFinite(raw) ? Math.max(8, Math.min(64, Math.round(raw))) : 16;
    return normalized;
  }, [undoRedoLimit]);

  const {
    editorRef,
    monacoRef,
    editorVersion,
    handleEditorMountForGroup,
    getEditorInstanceByGroupId,
  } = useWorkspaceMonacoBinding({
    backendRoot,
    backendWorkspaceId,
    lspUiContext,
    normalizedUndoRedoLimit,
    activeGroupId,
    onOpenFile,
  });

  const ai = useWorkspaceAi({
    canUseEditorAi,
    editorRef,
    monacoRef,
    editorVersion,
    activeFile,
    keybindings,
    aiEngineClient,
    getBackendConfig,
    currentSessionId,
    backendWorkspaceId,
    backendRoot,
    onRegisterEditorAiInvoker,
  });

  const getKeybinding = useCallback((id, fallback = '') => {
    return getKeybindingValue(keybindings, id, fallback);
  }, [keybindings]);

  const taskActiveBlock = useMemo(() => {
    if (!taskBlocks.length) return null;
    return taskBlocks[taskActiveIndex] || null;
  }, [taskActiveIndex, taskBlocks]);

  const { setTaskCursor } = useWorkspaceTaskReviewMonaco({
    editorRef,
    monacoRef,
    editorVersion,
    activeFile,
    hasTaskReview,
    taskBlocks,
    pendingBlocks,
    taskActiveIndex,
    taskActiveBlock,
    getKeybinding,
    onTaskSetCursor,
    onTaskKeepBlock,
    onTaskRevertBlock,
    onTaskResetBlock,
    resolveBlockPosition,
    toLines,
    parseMonacoKeybinding,
  });

  useWorkspaceLspEditorActions({ editorRef, monacoRef, editorVersion });

  useStatusBarEditorPatch({ editorRef, monacoRef, activeFile, editorVersion });

  useWorkbenchEditorEvents({
    activeGroupId,
    getEditorInstanceByGroupId,
    onOpenFile,
  });

  const renderEditorForGroup = (group) => {
    const filePath = String(group.activeFile || '');
    const diffModelBaseForGroup = resolveDiffModelBaseForPath(filePath, { diffTabPrefix, diffTabs });
    const content = files.find((f) => f.path === filePath)?.content || '';

    if (!filePath) {
      return (
        <div className="monaco-empty" aria-label="No file open" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {!hasWorkspace && onOpenWelcomeTab ? (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No editor open</div>
              <div style={{ color: 'var(--muted)', marginBottom: 12 }}>打开 Welcome 或选择项目文件夹开始</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="primary-btn" onClick={onOpenWelcomeTab}>Open Welcome</button>
                <button className="ghost-btn" onClick={onSelectFolder}>📁 Open Folder</button>
              </div>
            </div>
          ) : null}
        </div>
      );
    }

    if (settingsTabPath && filePath === settingsTabPath && renderSettingsTab) return renderSettingsTab();
    if (terminalSettingsTabPath && filePath === terminalSettingsTabPath && renderTerminalSettingsTab) return renderTerminalSettingsTab();
    if (terminalEditorTabPath && filePath === terminalEditorTabPath && renderTerminalEditorTab) return renderTerminalEditorTab();
    if (welcomeTabPath && filePath === welcomeTabPath && renderWelcomeTab) return renderWelcomeTab();

    if (diffTabPrefix && filePath.startsWith(diffTabPrefix) && diffTabs && diffTabs[filePath]) {
      const diff = diffTabs[filePath];
      return (
        <Suspense fallback={<div className="monaco-fallback">Loading Diff Editor…</div>}>
          {diff.files ? (
            <div style={{ height: '100%', overflowY: 'auto' }}>
              {diff.files.map((file) => (
                <div key={file.path} style={{ height: '300px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
                  <div style={{
                    padding: '8px 16px',
                    background: 'var(--panel-sub)',
                    borderBottom: '1px solid var(--border)',
                    fontSize: '13px',
                    fontWeight: '600',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}>
                    <span style={{
                      color: file.status === 'M' ? '#e2c08d' : (file.status === 'A' ? '#73c991' : (file.status === 'D' ? '#f14c4c' : '#999')),
                      fontWeight: 'bold',
                      width: '16px',
                      textAlign: 'center'
                    }}>
                      {file.status}
                    </span>
                    {file.path}
                  </div>
                  <div style={{ flex: 1, minHeight: 0 }}>
                    <ManagedDiffEditor
                      height="100%"
                      language={inferMonacoLanguage(file.path || '')}
                      original={file.before || ''}
                      modified={file.after || ''}
                      theme={monacoTheme}
                      originalModelPath={`diff-tab-original://${diffModelBaseForGroup}/${file.path}`}
                      modifiedModelPath={`diff-tab-modified://${diffModelBaseForGroup}/${file.path}`}
                      options={{
                        ...monacoOptions,
                        readOnly: true,
                        renderSideBySide: true,
                        wordWrap: 'off',
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        padding: { top: 8, bottom: 8 },
                        hideUnchangedRegions: compactDiff ? { enabled: true, revealLinePadding: 3, contextLineCount: 3 } : { enabled: false }
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ManagedDiffEditor
              height="100%"
              language={inferMonacoLanguage(diff.path || filePath)}
              original={diff.before || ''}
              modified={diff.after || ''}
              theme={monacoTheme}
              originalModelPath={`diff-tab-original://${diffModelBaseForGroup}`}
              modifiedModelPath={`diff-tab-modified://${diffModelBaseForGroup}`}
              options={{
                ...monacoOptions,
                readOnly: true,
                renderSideBySide: true,
                wordWrap: 'off',
                hideUnchangedRegions: compactDiff ? { enabled: true, revealLinePadding: 3, contextLineCount: 3 } : { enabled: false }
              }}
            />
          )}
        </Suspense>
      );
    }

    return (
      <Suspense fallback={<div className="monaco-fallback">Loading Monaco Editor…</div>}>
        <div style={{ height: '100%', width: '100%' }}>
          <MonacoEditor
            height="100%"
            path={filePath}
            language={inferMonacoLanguage(filePath)}
            theme={monacoTheme}
            value={content}
            options={monacoOptions}
            saveViewState
            keepCurrentModel
            onMount={handleEditorMountForGroup(group.id)}
            onChange={(value) => onFileChange?.(filePath, value ?? '', { groupId: group.id })}
          />
        </div>
      </Suspense>
    );
  };

  const editorPane = (
    <WorkspaceEditorGroups
      groups={groups}
      activeGroupId={activeGroupId}
      editorLayout={editorLayout}
      editorNavigationMode={editorNavigationMode}
      previewEnabled={previewEnabled}
      tabMeta={tabMeta}
      updatedPaths={updatedPaths}
      backendRoot={backendRoot}
      diffTabPrefix={diffTabPrefix}
      diffTabs={diffTabs}
      settingsTabPath={settingsTabPath}
      terminalSettingsTabPath={terminalSettingsTabPath}
      terminalEditorTabPath={terminalEditorTabPath}
      welcomeTabPath={welcomeTabPath}
      onActiveGroupChange={onActiveGroupChange}
      onActiveFileChange={onActiveFileChange}
      onTabReorder={onTabReorder}
      onCloseFile={onCloseFile}
      onCloseEditors={onCloseEditors}
      onToggleTabPinned={onToggleTabPinned}
      onToggleTabKeptOpen={onToggleTabKeptOpen}
      onOpenFile={onOpenFile}
      onSplitEditor={onSplitEditor}
      onToggleGroupLocked={onToggleGroupLocked}
      onTogglePreviewEditorEnabled={onTogglePreviewEditorEnabled}
      onChangeEditorNavigationMode={onChangeEditorNavigationMode}
      onOpenEditorNavigation={onOpenEditorNavigation}
      renderGroupMain={(group, { isActiveGroup }) => (
        <>
          <WorkspaceTaskReviewFloating
            visible={isActiveGroup && shouldShowTaskReviewUI}
            activeFile={group?.activeFile || activeFile}
            pendingBlocks={pendingBlocks}
            currentPendingIndex={currentPendingIndex}
            taskBlocks={taskBlocks}
            onTaskRevertFile={onTaskRevertFile}
            onTaskKeepFile={onTaskKeepFile}
            onTaskResetFile={onTaskResetFile}
            setTaskCursor={setTaskCursor}
          />

          {renderEditorForGroup(group)}

          <WorkspaceAiOverlay enabled={isActiveGroup && canUseEditorAi} ai={ai} />
        </>
      )}
    />
  );

  return (
    <div className="workspace-shell">
      <div className={`workspace-body ${viewMode === 'preview' ? 'preview-only' : 'code-only'}`}>
        {viewMode === 'code' || viewMode === 'diff' ? (
          editorPane
        ) : (
          <WorkspacePreviewPane
            files={files}
            livePreviewContent={livePreviewContent}
            entryCandidates={entryCandidates}
            previewEntry={previewEntry}
            onPreviewEntryChange={onPreviewEntryChange}
            onToggleView={onToggleView}
            onRefreshPreview={onRefreshPreview}
            hotReloadToken={hotReloadToken}
          />
        )}
      </div>
      <PanelShell
        workspacePath={backendRoot || workspaceRoots?.[0]?.path || workspaceRoots?.[0] || ''}
        onOpenFile={onOpenFile}
        terminalSettingsTabPath={terminalSettingsTabPath}
        terminalEditorTabPath={terminalEditorTabPath}
      />
    </div>
  );
}

export default React.memo(Workspace);
