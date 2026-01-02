import React from 'react';
import NavSidebar from './components/NavSidebar';
import SessionDrawer from './components/SessionDrawer';
import ExplorerPanel from './components/ExplorerPanel';
import ChatArea from './components/ChatArea';
import LogPanel from './components/LogPanel';
import ConfigPanel from './components/ConfigPanel';
import TerminalSettingsTab from './components/TerminalSettingsTab';
import TerminalEditorTab from './components/TerminalEditorTab';
import TitleBar from './components/TitleBar';
import EditorArea from './workbench/layout/EditorArea';
import WorkbenchShell from './workbench/WorkbenchShell';
import DiffModal from './components/DiffModal';
import SourceControlPanel from './components/SourceControlPanel';
import WelcomeEditor from './workbench/editors/WelcomeEditor';
import ConnectRemoteModal from './components/ConnectRemoteModal';
import CloneRepositoryModal from './components/CloneRepositoryModal';
import SearchPanel from './components/SearchPanel';
import CommandPalette from './components/CommandPalette';
import Modal from './components/Modal';
import StatusBar from './components/StatusBar';
import InputModal from './components/InputModal';
import { outputService } from './workbench/services/outputService';

function AppShell({
  theme,
  projectMeta,
  handleSelectWorkspace,
  workspaceController,
  openHelpModal,
  closeHelpModal,
  helpModal,
  closeWorkspaceToWelcome,
  promptOpenWorkspace,
  handleToggleTheme,
  language,
  workspaceState,
  setWorkspaceState,
  handleAddFile,
  handleAddFolder,
  syncWorkspaceFromDisk,
  handleRefreshPreview,
  workspaceDriver,
  workspaceBindingError,
  workspaceRootLabel,
  recentProjects,
  isAbsolutePath,
  setShowCloneModal,
  setShowRemoteModal,
  openCommandPalette,
  showResizeOverlay,
  handleMouseMove,
  stopResize,
  showConfig,
  setShowConfig,
  config,
  setConfig,
  toolSettings,
  persistToolSettings,
  handleConfigSubmit,
  setConfigFullscreen,
  configFullscreen,
  checkApiStatus,
  apiStatus,
  apiMessage,
  userThemePreferenceRef,
  handleThemeModeChange,
  handleLanguageChange,
  uiDisplayPreferences,
  handleChangeDisplayPreference,
  handleOpenConfigInEditor,
  projectConfig,
  setProjectConfig,
  showCommandPalette,
  closeCommandPalette,
  commandPaletteInitialQuery,
  commandPaletteContext,
  workspaceProps,
  openFile,
  closeFile,
  setGlobalSearchQuery,
  handleSidebarTabChange,
  lspService,
  editorAiInvoker,
  activeSidebarPanel,
  sidebarCollapsed,
  explorerReveal,
  sidebarWidth,
  activeResizeTarget,
  sidebarResizerGhostRef,
  startResize,
  createSession,
  gitBadgeCount,
  sessions,
  currentSessionId,
  selectSession,
  deleteSession,
  renameSession,
  messages,
  input,
  setInput,
  loadingSessions,
  handleSend,
  handleStop,
  setShowLogs,
  showLogs,
  currentSession,
  logStatus,
  currentMode,
  modeOptions,
  handleModeChange,
  toolRuns,
  handleOpenDiff,
  taskReview,
  toggleTaskReview,
  keepAllTaskFiles,
  revertAllTaskFiles,
  keepTaskFile,
  revertTaskFile,
  resetTaskFile,
  workspaceLoading,
  hotReloadToken,
  backendWorkspaceRoot,
  handleDeletePath,
  handleRenamePath,
  gitStatus,
  handleGlobalSearch,
  globalSearchQuery,
  gitRemotes,
  gitLog,
  gitBranches,
  handleGitCommit,
  handleGitStage,
  handleGitUnstage,
  handleGitStageAll,
  handleGitUnstageAll,
  handleGitRestore,
  handleGitRestoreAll,
  handleGitSync,
  handleGitPull,
  handleGitPush,
  handleGitPublishBranch,
  handleGitSetUpstream,
  refreshGitStatus,
  handleGenerateCommitMessage,
  handleGitInit,
  handleGitAddRemote,
  handleGitCreateBranch,
  handleGitDeleteBranch,
  handleGitCheckoutBranch,
  handleGitResolve,
  handleOpenWorkingCopyDiff,
  handleGetCommitDetails,
  handleGetCommitStats,
  handleOpenCommitDiff,
  handleOpenAllCommitDiffs,
  handleOpenBatchDiffs,
  gitLoading,
  workspaceShellVisible,
  workspaceVisible,
  diffTabs,
  diffModal,
  closeDiffModal,
  handleOpenDiffInWorkspace,
  logs,
  gitBranch,
  workspaceBindingStatus,
  setSidebarCollapsed,
  setActiveSidebarPanel,
  showRemoteModal,
  handleConnectRemote,
  showCloneModal,
  cloneRepositoryFromWelcome,
  pickNativeFolderPath,
  handleOpenFileFromWelcome,
  handleNewFileFromWelcome,
  activeWorkspaces,
  createTemplateProjectInWorkspace,
  openWorkspaceWithPreferredRoot,
  removeRecentProject,
  handleOpenBackendWorkspaceFromList,
  handleFileChange,
  handleActiveEditorChange,
  handleActiveGroupChange,
  handleTabReorder,
  toggleGroupLocked,
  togglePreviewEditorEnabled,
  toggleTabPinned,
  toggleTabKeptOpen,
  closeEditors,
  splitEditor,
  applyWorkspaceEditCreateFile,
  applyWorkspaceEditRenamePath,
  applyWorkspaceEditDeletePath,
  applyWorkspaceEditReadFile,
  applyWorkspaceEditWriteFile,
  settingsTabPath,
  terminalSettingsTabPath,
  terminalEditorTabPath,
  welcomeTabPath,
  aiEngineClient,
  getBackendConfig,
  backendWorkspaceId,
  setEditorAiInvoker,
  undoRedoLimit,
  changeEditorNavigationMode,
  keepTaskBlock,
  revertTaskBlock,
  resetTaskBlock,
  setTaskReviewCursor,
  diffTabPrefix,
  inputModal,
}) {
  const [infoToasts, setInfoToasts] = React.useState([]);

  React.useEffect(() => {
    const bus = globalThis?.window?.electronAPI?.ideBus;
    if (!bus?.onNotification) return undefined;
    const dispose = bus.onNotification('window/showInformationMessage', (payload) => {
      const message = payload?.message ? String(payload.message) : '';
      const items = Array.isArray(payload?.items) ? payload.items.map((x) => String(x)) : [];
      if (message) outputService.append('Extensions', `[INFO] ${message}`);

      const id = `toast:${Date.now()}:${Math.random().toString(16).slice(2)}`;
      const toast = { id, message, items, ts: Date.now() };
      setInfoToasts((prev) => [...(Array.isArray(prev) ? prev : []), toast].slice(-4));
      window.setTimeout(() => {
        setInfoToasts((prev) => (Array.isArray(prev) ? prev.filter((t) => t?.id !== id) : []));
      }, 4200);
    });
    return () => dispose?.();
  }, []);

  return (
    <WorkbenchShell theme={theme}>
      <TitleBar
        projectMeta={projectMeta}
        onSelectProject={handleSelectWorkspace}
        onOpenWelcome={() => workspaceController.openWelcomeTab({ focus: true })}
        onOpenDocumentation={() => openHelpModal('docs')}
        onOpenAbout={() => openHelpModal('about')}
        onCloseWorkspace={closeWorkspaceToWelcome}
        onBindBackend={promptOpenWorkspace}
        onToggleTheme={handleToggleTheme}
        theme={theme}
        language={language}
        viewMode={workspaceState.view}
        onToggleView={() => setWorkspaceState((prev) => ({ ...prev, view: prev.view === 'code' ? 'preview' : 'code' }))}
        onAddFile={() => handleAddFile()}
        onAddFolder={() => handleAddFolder()}
        onSync={() => syncWorkspaceFromDisk({ includeContent: true, highlight: false })}
        onRefreshPreview={handleRefreshPreview}
        hasDriver={!!workspaceDriver}
        bindingError={workspaceBindingError}
        workspaceRoots={workspaceProps.workspaceRoots}
        workspaceRootLabel={workspaceRootLabel}
        recentProjects={recentProjects}
        onOpenRecent={(proj) => {
          const candidate = proj?.fsPath || proj?.pathLabel || proj?.backendRoot || '';
          const target = isAbsolutePath(candidate) ? candidate : (proj?.id || null);
          workspaceController.openWorkspace(target, { preferredRoot: candidate });
        }}
        onCloneRepository={() => setShowCloneModal(true)}
        onConnectRemote={() => setShowRemoteModal(true)}
        onOpenCommandPalette={() => openCommandPalette()}
      />
      {showResizeOverlay && (
        <div
          onMouseMove={handleMouseMove}
          onMouseUp={stopResize}
          onPointerMove={handleMouseMove}
          onPointerUp={stopResize}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 99999,
            cursor: 'col-resize',
            background: 'transparent',
            touchAction: 'none',
          }}
        />
      )}
      {showConfig && (
        <ConfigPanel
          config={config}
          setConfig={setConfig}
          toolSettings={toolSettings}
          onToolSettingsChange={persistToolSettings}
          onSave={handleConfigSubmit}
          onClose={() => { setConfigFullscreen(false); setShowConfig(false); }}
          checkApiStatus={checkApiStatus}
          apiStatus={apiStatus}
          apiMessage={apiMessage}
          appearanceMode={userThemePreferenceRef.current ? (theme === 'dark' ? 'dark' : 'light') : 'system'}
          onChangeAppearanceMode={handleThemeModeChange}
          language={language}
          onLanguageChange={handleLanguageChange}
          displayPreferences={uiDisplayPreferences}
          onChangeDisplayPreference={handleChangeDisplayPreference}
          onOpenInEditor={handleOpenConfigInEditor}
          fullscreen={configFullscreen}
          onToggleFullscreen={() => setConfigFullscreen((prev) => !prev)}
          variant="modal"
          lspConfig={projectConfig?.lsp || {}}
          onChangeLspConfig={(next) => {
            const v = next && typeof next === 'object' ? next : {};
            setProjectConfig((prev) => ({ ...prev, lsp: v }));
          }}
        />
      )}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={closeCommandPalette}
        initialQuery={commandPaletteInitialQuery}
        context={commandPaletteContext}
        files={workspaceProps.files}
        editorGroups={workspaceState.editorGroups}
        activeGroupId={workspaceState.activeGroupId}
        onOpenFile={openFile}
        onCloseEditor={closeFile}
        onSearchText={(text) => {
          setGlobalSearchQuery(text);
          handleSidebarTabChange('search');
        }}
        onSearchWorkspaceSymbols={(q) => lspService.searchWorkspaceSymbols(q)}
        onSearchDocumentSymbols={(modelPath) => lspService.searchDocumentSymbols(modelPath)}
        aiInvoker={editorAiInvoker}
      />
      <div className="app-body">
        <NavSidebar
          activeSidebar={activeSidebarPanel}
          sidebarCollapsed={sidebarCollapsed}
          explorerOpen={!sidebarCollapsed && activeSidebarPanel === 'explorer'}
          onSelectSidebar={handleSidebarTabChange}
          onToggleConfig={() => {
            if (uiDisplayPreferences.settings === 'editor') {
              handleOpenConfigInEditor();
            } else {
              setConfigFullscreen(false);
              setShowConfig(true);
            }
          }}
          apiStatus={apiStatus}
          gitBadgeCount={gitBadgeCount}
          language={language}
        />
        <div
          className={`sidebar-panel-shell ${sidebarCollapsed ? 'collapsed' : ''} sidebar-${activeSidebarPanel}-panel`}
          style={{
            width: sidebarCollapsed ? '0px' : `${sidebarWidth}px`,
            minWidth: sidebarCollapsed ? '0' : '220px',
            maxWidth: sidebarCollapsed ? '0' : 'none',
            transition: activeResizeTarget === 'sidebar' ? 'none' : 'width 0.2s ease, min-width 0.2s ease',
            pointerEvents: sidebarCollapsed ? 'none' : 'auto'
          }}
        >
          {!sidebarCollapsed && activeSidebarPanel === 'sessions' && (
            <SessionDrawer
              sessions={sessions}
              currentSessionId={currentSessionId}
              onSelectSession={selectSession}
              onDeleteSession={deleteSession}
              onRenameSession={renameSession}
              onCreateSession={createSession}
              setActiveSidebarPanel={setActiveSidebarPanel}
              width={sidebarWidth}
              collapsed={sidebarCollapsed}
              isResizing={activeResizeTarget === 'sidebar'}
            />
          )}
          {!sidebarCollapsed && activeSidebarPanel === 'chat' && (
            <ChatArea
              messages={messages}
              input={input}
              setInput={setInput}
              loading={loadingSessions.has(currentSessionId)}
              onSend={handleSend}
              onStop={handleStop}
              onOpenFile={openFile}
              onToggleLogs={() => setShowLogs(!showLogs)}
              currentSession={currentSession}
              logStatus={logStatus}
              mode={currentMode}
              modeOptions={modeOptions}
              onModeChange={handleModeChange}
              toolRuns={toolRuns}
              onOpenDiff={handleOpenDiff}
              taskReview={taskReview}
              onTaskToggle={toggleTaskReview}
              onTaskKeepAll={keepAllTaskFiles}
              onTaskRevertAll={revertAllTaskFiles}
              onTaskKeepFile={keepTaskFile}
              onTaskRevertFile={revertTaskFile}
              onTaskResetFile={resetTaskFile}
            />
          )}
          {!sidebarCollapsed && activeSidebarPanel === 'explorer' && (
            <ExplorerPanel
              files={workspaceProps.files}
              fileTree={workspaceProps.fileTree}
              projectLabel={workspaceRootLabel}
              workspaceRoots={workspaceProps.workspaceRoots}
              loading={workspaceLoading}
              activeFile={workspaceState.activeFile}
              backendRoot={backendWorkspaceRoot}
              editorGroups={workspaceState.editorGroups}
              activeGroupId={workspaceState.activeGroupId}
              tabMeta={workspaceState.tabMeta}
              previewEditorEnabled={workspaceState.previewEditorEnabled}
              revealPath={explorerReveal.path}
              revealNonce={explorerReveal.nonce}
              onOpenFile={openFile}
              onAddFile={handleAddFile}
              onAddFolder={handleAddFolder}
              onDeletePath={handleDeletePath}
              onRenamePath={handleRenamePath}
              onSyncStructure={() => syncWorkspaceFromDisk({ includeContent: true, highlight: false })}
              hasWorkspace={!!workspaceDriver}
              gitStatus={gitStatus}
            />
          )}
          {!sidebarCollapsed && activeSidebarPanel === 'search' && (
            <SearchPanel
              onSearch={handleGlobalSearch}
              onOpenFile={openFile}
              projectLabel={workspaceRootLabel}
              initialQuery={globalSearchQuery}
            />
          )}
          {!sidebarCollapsed && activeSidebarPanel === 'git' && (
            <SourceControlPanel
              gitStatus={gitStatus}
              gitRemotes={gitRemotes}
              gitLog={gitLog}
              gitBranches={gitBranches}
              onCommit={handleGitCommit}
              onStage={handleGitStage}
              onUnstage={handleGitUnstage}
              onStageAll={handleGitStageAll}
              onUnstageAll={handleGitUnstageAll}
              onDiscard={handleGitRestore}
              onDiscardAll={handleGitRestoreAll}
              onSync={handleGitSync}
              onPull={handleGitPull}
              onPush={handleGitPush}
              onPublishBranch={handleGitPublishBranch}
              onSetUpstream={handleGitSetUpstream}
              onRefresh={refreshGitStatus}
              onGenerateCommitMessage={handleGenerateCommitMessage}
              onInit={handleGitInit}
              onAddRemote={handleGitAddRemote}
              onCreateBranch={handleGitCreateBranch}
              onDeleteBranch={handleGitDeleteBranch}
              onCheckoutBranch={handleGitCheckoutBranch}
              onResolve={handleGitResolve}
              onOpenFile={openFile}
              onDiff={handleOpenWorkingCopyDiff}
              onGetCommitDetails={handleGetCommitDetails}
              onGetCommitStats={handleGetCommitStats}
              onOpenCommitDiff={handleOpenCommitDiff}
              onOpenAllDiffs={handleOpenAllCommitDiffs}
              onOpenBatchDiffs={handleOpenBatchDiffs}
              loading={gitLoading}
              repositoryLabel={workspaceRootLabel}
            />
          )}
        </div>
        <div
          ref={sidebarResizerGhostRef}
          onMouseDown={startResize('sidebar')}
          onPointerDown={startResize('sidebar')}
          className={`sidebar-resizer ${sidebarCollapsed ? 'collapsed' : ''}`}
          title={sidebarCollapsed ? "向右拖动展开侧边栏" : "拖动调整侧边栏宽度"}
          aria-label="Sidebar Resizer"
          aria-valuenow={sidebarWidth}
          aria-valuemin={220}
        >
          <div className="sidebar-resizer-hit">
            <div className="sidebar-resizer-visual" />
          </div>
        </div>
        <div style={{
          flex: workspaceShellVisible ? 1 : 0,
          position: 'relative',
          display: workspaceShellVisible ? 'flex' : 'none',
          flexDirection: 'column',
          background: 'var(--bg)',
          minWidth: 0,
        }}>
          {workspaceVisible && (
            <EditorArea
              files={workspaceProps.files}
              openTabs={workspaceProps.openTabs}
              activeFile={workspaceState.activeFile}
              editorGroups={workspaceState.editorGroups}
              activeGroupId={workspaceState.activeGroupId}
              editorLayout={workspaceState.editorLayout}
              previewEditorEnabled={workspaceState.previewEditorEnabled}
              tabMeta={workspaceState.tabMeta}
              tabHistory={workspaceState.tabHistory}
              viewMode={workspaceState.view}
              livePreviewContent={workspaceState.livePreview}
              entryCandidates={workspaceState.entryCandidates}
              loading={workspaceLoading}
              hasWorkspace={!!workspaceDriver}
              workspaceRootLabel={workspaceRootLabel}
              workspaceRoots={workspaceProps.workspaceRoots}
              bindingStatus={workspaceBindingStatus}
              bindingError={workspaceBindingError}
              hotReloadToken={hotReloadToken}
              theme={theme}
              backendRoot={backendWorkspaceRoot}
              keybindings={config?.keybindings}
              editorSettings={config?.editor}
              aiEngineClient={aiEngineClient}
              getBackendConfig={getBackendConfig}
              currentSessionId={currentSessionId}
              backendWorkspaceId={backendWorkspaceId}
              onRegisterEditorAiInvoker={setEditorAiInvoker}
              undoRedoLimit={undoRedoLimit}
              onChangeEditorNavigationMode={changeEditorNavigationMode}
              welcomeTabPath={welcomeTabPath}
              onOpenWelcomeTab={() => workspaceController.openWelcomeTab({ focus: true })}
              renderWelcomeTab={() => (
                <WelcomeEditor
                  theme={theme}
                  bindingStatus={workspaceBindingStatus}
                  bindingError={workspaceBindingError}
                  recentProjects={recentProjects}
                  backendWorkspaces={activeWorkspaces}
                  onOpenFolder={() => handleSelectWorkspace()}
                  onOpenFile={handleOpenFileFromWelcome}
                  onNewFile={handleNewFileFromWelcome}
                  onPickFolderPath={pickNativeFolderPath}
                  onCloneRepository={cloneRepositoryFromWelcome}
                  onCreateTemplate={createTemplateProjectInWorkspace}
                  onOpenFolderWithPreferredRoot={openWorkspaceWithPreferredRoot}
                  onCancelOpen={() => closeWorkspaceToWelcome()}
                  onOpenRecent={(proj) => workspaceController.openWorkspace(proj?.fsPath || proj?.id || null, { preferredRoot: proj?.fsPath || '' })}
                  onRemoveRecent={(proj) => removeRecentProject(proj)}
                  onOpenBackendWorkspace={handleOpenBackendWorkspaceFromList}
                />
              )}
              onSelectFolder={handleSelectWorkspace}
              onBindBackendRoot={promptOpenWorkspace}
              onOpenFile={openFile}
              onCloseFile={closeFile}
              onFileChange={handleFileChange}
              onActiveFileChange={handleActiveEditorChange}
              onActiveGroupChange={handleActiveGroupChange}
              onTabReorder={handleTabReorder}
              onToggleGroupLocked={toggleGroupLocked}
              onTogglePreviewEditorEnabled={togglePreviewEditorEnabled}
              onToggleTabPinned={toggleTabPinned}
              onToggleTabKeptOpen={toggleTabKeptOpen}
              onCloseEditors={closeEditors}
              onSplitEditor={splitEditor}
              onAddFile={handleAddFile}
              onAddFolder={handleAddFolder}
              onRefreshPreview={handleRefreshPreview}
              onToggleTheme={handleToggleTheme}
              onToggleView={() => setWorkspaceState((prev) => {
                const nextView = prev.view === 'code' ? 'preview' : 'code';
                const nextPreviewEntry = prev.activeFile || prev.previewEntry;
                return { ...prev, view: nextView, previewEntry: nextPreviewEntry };
              })}
              onSyncStructure={() => syncWorkspaceFromDisk({ includeContent: true, highlight: false })}
              onWorkspaceCreateFile={applyWorkspaceEditCreateFile}
              onWorkspaceRenamePath={applyWorkspaceEditRenamePath}
              onWorkspaceDeletePath={applyWorkspaceEditDeletePath}
              onWorkspaceReadFile={applyWorkspaceEditReadFile}
              onWorkspaceWriteFile={applyWorkspaceEditWriteFile}
              previewEntry={workspaceState.previewEntry}
              onPreviewEntryChange={(value) => setWorkspaceState((prev) => ({ ...prev, previewEntry: value }))}
              settingsTabPath={settingsTabPath}
              renderSettingsTab={() => (
                <ConfigPanel
                  config={config}
                  setConfig={setConfig}
                  toolSettings={toolSettings}
                  onToolSettingsChange={persistToolSettings}
                  onSave={handleConfigSubmit}
                  onClose={() => closeFile(settingsTabPath)}
                  checkApiStatus={checkApiStatus}
                  apiStatus={apiStatus}
                  apiMessage={apiMessage}
                  appearanceMode={userThemePreferenceRef.current ? (theme === 'dark' ? 'dark' : 'light') : 'system'}
                  onChangeAppearanceMode={handleThemeModeChange}
                  language={language}
                  onLanguageChange={handleLanguageChange}
                  displayPreferences={uiDisplayPreferences}
                  onChangeDisplayPreference={handleChangeDisplayPreference}
                  onOpenInEditor={handleOpenConfigInEditor}
                  fullscreen={false}
                  onToggleFullscreen={() => {}}
                  variant="inline"
                  lspConfig={projectConfig?.lsp || {}}
                  onChangeLspConfig={(next) => {
                    const v = next && typeof next === 'object' ? next : {};
                    setProjectConfig((prev) => ({ ...prev, lsp: v }));
                  }}
                />
              )}
              terminalSettingsTabPath={terminalSettingsTabPath}
              renderTerminalSettingsTab={() => (
                <TerminalSettingsTab
                  workspacePath={backendWorkspaceRoot}
                  onClose={() => closeFile(terminalSettingsTabPath)}
                />
              )}
              terminalEditorTabPath={terminalEditorTabPath}
              renderTerminalEditorTab={() => (
                <TerminalEditorTab
                  workspacePath={backendWorkspaceRoot}
                  onOpenFile={openFile}
                  terminalSettingsTabPath={terminalSettingsTabPath}
                  terminalEditorTabPath={terminalEditorTabPath}
                  onClose={() => closeFile(terminalEditorTabPath)}
                />
              )}
              taskReview={taskReview}
              onTaskKeepFile={keepTaskFile}
              onTaskRevertFile={revertTaskFile}
              onTaskKeepBlock={keepTaskBlock}
              onTaskRevertBlock={revertTaskBlock}
              onTaskResetBlock={resetTaskBlock}
              onTaskResetFile={resetTaskFile}
              onTaskSetCursor={setTaskReviewCursor}
              diffTabPrefix={diffTabPrefix}
              diffTabs={diffTabs}
              diffViewMode={uiDisplayPreferences?.diffView || 'compact'}
              onOpenEditorNavigation={(groupId) => openCommandPalette({ initialQuery: 'edt ', context: { type: 'editorNav', groupId } })}
            />
          )}
          {showLogs && (
            <LogPanel
              logs={logs}
              onClose={() => setShowLogs(false)}
            />
          )}
        </div>
      </div>
      <StatusBar
        gitBranch={gitBranch}
        gitStatus={gitStatus}
        workspaceBindingStatus={workspaceBindingStatus}
        onClickGit={() => {
          if (sidebarCollapsed) setSidebarCollapsed(false);
          setActiveSidebarPanel('git');
        }}
      />
      <ConnectRemoteModal
        isOpen={showRemoteModal}
        onClose={() => setShowRemoteModal(false)}
        onConnect={handleConnectRemote}
      />
      <CloneRepositoryModal
        isOpen={showCloneModal}
        onClose={() => setShowCloneModal(false)}
        onClone={async (data) => {
          const res = await cloneRepositoryFromWelcome(data);
          if (res?.targetPath) {
            await workspaceController.openWorkspace(null, { preferredRoot: res.targetPath });
          }
        }}
        onPickFolder={pickNativeFolderPath}
      />
      <DiffModal
        diff={diffModal}
        onClose={closeDiffModal}
        theme={theme}
        onOpenFile={openFile}
        onOpenDiffInWorkspace={handleOpenDiffInWorkspace}
        diffViewMode={uiDisplayPreferences?.diffView || 'compact'}
        onDiffViewModeChange={(mode) => handleChangeDisplayPreference('diffView', mode)}
      />
      <InputModal
        isOpen={inputModal.isOpen}
        title={inputModal.title}
        label={inputModal.label}
        defaultValue={inputModal.defaultValue}
        placeholder={inputModal.placeholder}
        confirmText={inputModal.confirmText}
        icon={inputModal.icon}
        onConfirm={inputModal.onConfirm}
        onClose={inputModal.onClose}
      />
      <Modal
        isOpen={helpModal.isOpen}
        onClose={closeHelpModal}
        title={helpModal.type === 'about' ? '关于' : '文档'}
        width="640px"
      >
        {helpModal.type === 'about' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="codicon codicon-info" aria-hidden style={{ fontSize: 18 }} />
              <div style={{ fontWeight: 700, fontSize: 14 }}>AI Agent IDE</div>
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
              <div>Version: {helpModal.appInfo?.version || helpModal.appInfo?.appVersion || '—'}</div>
              <div>Platform: {helpModal.appInfo?.platform || (typeof navigator !== 'undefined' ? navigator.platform : '—')}</div>
              <div>Electron: {helpModal.appInfo?.electron || '—'}</div>
              <div>Chrome: {helpModal.appInfo?.chrome || '—'}</div>
              <div>Node: {helpModal.appInfo?.node || '—'}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="ghost-btn" onClick={() => openHelpModal('docs')}>打开文档</button>
              <button type="button" className="primary-btn" onClick={closeHelpModal}>关闭</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>快捷入口</div>
              <div>Command Palette：{config?.keybindings?.['app.commandPalette'] || 'Ctrl+Shift+P'}</div>
              <div>快速打开：{config?.keybindings?.['app.quickOpen'] || 'Ctrl+P'}</div>
              <div>编辑器导航：{config?.keybindings?.['editor.openEditors'] || 'Ctrl+E'}（按组生效）</div>
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>编辑器操作</div>
              <div>标签页右键：关闭/批量关闭/拆分/在资源管理器高亮/复制路径等。</div>
              <div>编辑器导航菜单：组锁定/预览编辑器/导航模式（Breadcrumb vs Sticky Scroll）/Settings。</div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="ghost-btn" onClick={() => workspaceController.openWelcomeTab({ focus: true })}>打开 Welcome</button>
              <button type="button" className="ghost-btn" onClick={() => openFile(settingsTabPath, { mode: 'persistent' })}>打开 Settings</button>
              <button type="button" className="primary-btn" onClick={closeHelpModal}>关闭</button>
            </div>
          </div>
        )}
      </Modal>
      {infoToasts.length ? (
        <div style={{ position: 'fixed', right: 12, bottom: 52, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420 }}>
          {infoToasts.map((t) => (
            <div
              key={t.id}
              style={{
                background: 'var(--panel-background)',
                border: '1px solid var(--border-subtle)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                borderRadius: 8,
                padding: '10px 12px',
                color: 'var(--text)',
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontWeight: 700 }}>提示</div>
                <button
                  type="button"
                  className="ghost-btn"
                  style={{ height: 24, padding: '0 8px' }}
                  onClick={() => setInfoToasts((prev) => prev.filter((x) => x.id !== t.id))}
                >
                  关闭
                </button>
              </div>
              <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{t.message || ''}</div>
              {t.items?.length ? (
                <div style={{ marginTop: 6, color: 'var(--muted)' }}>
                  {t.items.slice(0, 6).join('  •  ')}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </WorkbenchShell>
  );
}

export default AppShell;
