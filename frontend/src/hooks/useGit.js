import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitDriver } from '../utils/gitDriver';

export function useGit({
  backendWorkspaceRoot = '',
  backendBound = false,
  workspaceDriver = null,
  lspService = null,
  uiDiffMode = 'modal',
  openDiffModal,
  openDiffTabInWorkspace,
  setDiffModal,
  openFile,
  shouldHidePath,
  isMissingPathError,
  aiEngineClient,
  readTextResponseBody,
  currentSessionId = null,
  getBackendConfig,
} = {}) {
  const [gitStatus, setGitStatus] = useState(null);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitRemotes, setGitRemotes] = useState([]);
  const [gitLog, setGitLog] = useState([]);
  const [gitBranches, setGitBranches] = useState({ all: [], current: '', branches: {} });

  const refreshGitStatus = useCallback(async (rootOverride) => {
    const root = String(rootOverride ?? backendWorkspaceRoot).trim();
    if (!root || !GitDriver.isAvailable()) return;
    setGitLoading(true);
    const status = await GitDriver.status(root);
    setGitStatus(status);
    if (!status) {
      setGitRemotes([]);
      setGitLog([]);
      setGitLoading(false);
      return;
    }
    const remotes = await GitDriver.getRemotes(root);
    setGitRemotes(remotes);
    const log = await GitDriver.log(root);
    setGitLog(log?.all || []);
    const branches = await GitDriver.branch(root);
    setGitBranches(branches || { all: [], current: '', branches: {} });
    setGitLoading(false);
  }, [backendWorkspaceRoot]);

  useEffect(() => {
    if (!backendBound || !backendWorkspaceRoot) return;
    refreshGitStatus();
    const timer = setInterval(refreshGitStatus, 5000);
    return () => clearInterval(timer);
  }, [backendBound, backendWorkspaceRoot, refreshGitStatus]);

  const initRepo = useCallback(async () => {
    const root = String(backendWorkspaceRoot || '').trim();
    if (!root) return;
    await GitDriver.init(root);
    refreshGitStatus();
  }, [backendWorkspaceRoot, refreshGitStatus]);

  const createBranch = useCallback(async (name) => {
    if (!backendWorkspaceRoot) return;
    await GitDriver.createBranch(backendWorkspaceRoot, name);
    refreshGitStatus();
  }, [backendWorkspaceRoot, refreshGitStatus]);

  const deleteBranch = useCallback(async (name) => {
    if (!backendWorkspaceRoot) return;
    await GitDriver.deleteBranch(backendWorkspaceRoot, name);
    refreshGitStatus();
  }, [backendWorkspaceRoot, refreshGitStatus]);

  const checkoutBranch = useCallback(async (name) => {
    if (!backendWorkspaceRoot) return;
    await GitDriver.checkout(backendWorkspaceRoot, name);
    refreshGitStatus();
  }, [backendWorkspaceRoot, refreshGitStatus]);

  const resolveConflict = useCallback(async (file, type) => {
    if (!backendWorkspaceRoot) return;
    await GitDriver.resolve(backendWorkspaceRoot, file, type);
    refreshGitStatus();
  }, [backendWorkspaceRoot, refreshGitStatus]);

  const addRemote = useCallback(async (name, url) => {
    if (!backendWorkspaceRoot) return;
    await GitDriver.addRemote(backendWorkspaceRoot, name, url);
    refreshGitStatus();
  }, [backendWorkspaceRoot, refreshGitStatus]);

  const stage = useCallback(async (files) => {
    if (!backendWorkspaceRoot) return;
    await GitDriver.stage(backendWorkspaceRoot, files);
    refreshGitStatus();
  }, [backendWorkspaceRoot, refreshGitStatus]);

  const unstage = useCallback(async (files) => {
    if (!backendWorkspaceRoot) return;
    await GitDriver.unstage(backendWorkspaceRoot, files);
    refreshGitStatus();
  }, [backendWorkspaceRoot, refreshGitStatus]);

  const stageAll = useCallback(async () => {
    if (!backendWorkspaceRoot) return;
    await GitDriver.stage(backendWorkspaceRoot, ['.']);
    refreshGitStatus();
  }, [backendWorkspaceRoot, refreshGitStatus]);

  const unstageAll = useCallback(async () => {
    if (!backendWorkspaceRoot) return;
    const hasStaged = gitStatus?.files?.some((f) => ['A', 'M', 'D', 'R'].includes(f.working_dir) === false && ['A', 'M', 'D', 'R'].includes(f.index));
    if (!hasStaged) return;
    await GitDriver.unstage(backendWorkspaceRoot, '.');
    refreshGitStatus();
  }, [backendWorkspaceRoot, gitStatus, refreshGitStatus]);

  const restore = useCallback(async (files) => {
    if (!backendWorkspaceRoot) return;
    if (!window.confirm(`Are you sure you want to discard changes in ${files.length > 1 ? `${files.length} files` : files[0]}?`)) return;

    const untracked = [];
    const tracked = [];

    files.forEach((path) => {
      const file = gitStatus?.files?.find((f) => f.path === path);
      if (file && (file.working_dir === '?' || file.working_dir === 'U')) {
        untracked.push(path);
      } else {
        tracked.push(path);
      }
    });

    if (tracked.length > 0) {
      await GitDriver.restore(backendWorkspaceRoot, tracked);
    }
    if (untracked.length > 0 && workspaceDriver) {
      if (!workspaceDriver?.setFileOperationsHooks) {
        try { await lspService?.willDeleteFiles?.(untracked); } catch {}
      }
      for (const p of untracked) {
        try { await workspaceDriver.deletePath(p); } catch (e) { console.error(e); }
      }
      if (!workspaceDriver?.setFileOperationsHooks) {
        try { await lspService?.didDeleteFiles?.(untracked); } catch {}
      }
    }
    refreshGitStatus();
  }, [backendWorkspaceRoot, gitStatus, lspService, refreshGitStatus, workspaceDriver]);

  const restoreAll = useCallback(async () => {
    if (!backendWorkspaceRoot) return;
    if (!window.confirm('Are you sure you want to discard ALL changes? This cannot be undone.')) return;

    const files = gitStatus?.files?.filter((f) => ['A', 'M', 'D', 'R', '?'].includes(f.working_dir)) || [];
    const untracked = [];
    const tracked = [];

    files.forEach((f) => {
      if (f.working_dir === '?' || f.working_dir === 'U') untracked.push(f.path);
      else tracked.push(f.path);
    });

    if (tracked.length > 0) {
      await GitDriver.restore(backendWorkspaceRoot, tracked.length === files.length ? '.' : tracked);
    }
    if (untracked.length > 0 && workspaceDriver) {
      if (!workspaceDriver?.setFileOperationsHooks) {
        try { await lspService?.willDeleteFiles?.(untracked); } catch {}
      }
      for (const p of untracked) {
        try { await workspaceDriver.deletePath(p); } catch (e) { console.error(e); }
      }
      if (!workspaceDriver?.setFileOperationsHooks) {
        try { await lspService?.didDeleteFiles?.(untracked); } catch {}
      }
    }
    refreshGitStatus();
  }, [backendWorkspaceRoot, gitStatus, lspService, refreshGitStatus, workspaceDriver]);

  const commit = useCallback(async (msg) => {
    if (!backendWorkspaceRoot) return;
    await GitDriver.commit(backendWorkspaceRoot, msg);
    refreshGitStatus();
  }, [backendWorkspaceRoot, refreshGitStatus]);

  const pull = useCallback(async () => {
    if (!backendWorkspaceRoot) return;
    await GitDriver.pull(backendWorkspaceRoot);
    refreshGitStatus();
  }, [backendWorkspaceRoot, refreshGitStatus]);

  const push = useCallback(async () => {
    if (!backendWorkspaceRoot) return;
    await GitDriver.push(backendWorkspaceRoot);
    refreshGitStatus();
  }, [backendWorkspaceRoot, refreshGitStatus]);

  const publishBranch = useCallback(async (branch) => {
    if (!backendWorkspaceRoot) return;
    const target = branch || gitStatus?.current;
    if (!target) return;
    await GitDriver.publishBranch(backendWorkspaceRoot, target);
    refreshGitStatus();
  }, [backendWorkspaceRoot, gitStatus?.current, refreshGitStatus]);

  const setUpstream = useCallback(async (branch) => {
    if (!backendWorkspaceRoot) return;
    const target = branch || gitStatus?.current;
    if (!target) return;
    await GitDriver.setUpstream(backendWorkspaceRoot, target);
    refreshGitStatus();
  }, [backendWorkspaceRoot, gitStatus?.current, refreshGitStatus]);

  const sync = useCallback(async () => {
    if (!backendWorkspaceRoot) return;
    await GitDriver.pull(backendWorkspaceRoot);
    await GitDriver.push(backendWorkspaceRoot);
    refreshGitStatus();
  }, [backendWorkspaceRoot, refreshGitStatus]);

  const generateCommitMessage = useCallback(async () => {
    if (!gitStatus || !backendWorkspaceRoot) return '';
    const diff = await GitDriver.diff(backendWorkspaceRoot);
    if (!diff) return '';
    const diffText = typeof diff === 'string' ? diff : JSON.stringify(diff);
    const prompt = `Generate a concise git commit message (first line under 50 chars) for this diff:\n\n${diffText.slice(0, 2000)}`;
    if (!currentSessionId) return 'Error: Please open a chat session first.';
    try {
      const llmConfig = getBackendConfig?.();
      const res = await aiEngineClient?.chatStream?.({
        requestId: `git-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        sessionId: currentSessionId,
        workspaceRoot: backendWorkspaceRoot,
        message: prompt,
        mode: 'chat',
        llmConfig,
      });
      const result = await readTextResponseBody?.(res);
      return String(result || '').trim();
    } catch (e) {
      console.error(e);
      return 'Error generating message';
    }
  }, [aiEngineClient, backendWorkspaceRoot, currentSessionId, getBackendConfig, gitStatus, readTextResponseBody]);

  const getCommitDetails = useCallback(async (hash) => {
    if (!backendWorkspaceRoot) return [];
    return await GitDriver.getCommitDetails(backendWorkspaceRoot, hash);
  }, [backendWorkspaceRoot]);

  const getCommitStats = useCallback(async (hash) => {
    if (!backendWorkspaceRoot) return null;
    return await GitDriver.getCommitStats(backendWorkspaceRoot, hash);
  }, [backendWorkspaceRoot]);

  const openCommitDiff = useCallback(async (hash, path) => {
    if (!backendWorkspaceRoot) return;
    try {
      const before = await GitDriver.getFileContent(backendWorkspaceRoot, `${hash}~1`, path);
      const after = await GitDriver.getFileContent(backendWorkspaceRoot, hash, path);
      const diff = { path, before, after };
      if (uiDiffMode === 'editor') {
        openDiffTabInWorkspace?.(diff);
        setDiffModal?.(null);
      } else {
        openDiffModal?.(diff);
      }
    } catch (e) {
      console.error('Failed to open commit diff', e);
    }
  }, [backendWorkspaceRoot, openDiffModal, openDiffTabInWorkspace, setDiffModal, uiDiffMode]);

  const openAllCommitDiffs = useCallback(async (hash) => {
    if (!backendWorkspaceRoot) return;
    try {
      const files = await GitDriver.getCommitFileDiffs(backendWorkspaceRoot, hash);
      if (!files || files.length === 0) return;
      const diff = { files };
      if (uiDiffMode === 'editor') {
        openDiffTabInWorkspace?.(diff);
        setDiffModal?.(null);
      } else {
        openDiffModal?.(diff);
      }
    } catch (e) {
      console.error('Failed to open all commit diffs', e);
    }
  }, [backendWorkspaceRoot, openDiffModal, openDiffTabInWorkspace, setDiffModal, uiDiffMode]);

  const openWorkingCopyDiff = useCallback(async (path, staged = false) => {
    if (!backendWorkspaceRoot || !workspaceDriver) return;
    if (shouldHidePath?.(path)) return;
    try {
      let before = '';
      let after = '';

      if (staged) {
        before = await GitDriver.getFileContent(backendWorkspaceRoot, 'HEAD', path);
        after = await GitDriver.getFileContent(backendWorkspaceRoot, ':0', path);
      } else {
        before = await GitDriver.getFileContent(backendWorkspaceRoot, ':0', path);
        try {
          const fileData = await workspaceDriver.readFile(path);
          after = fileData.content || '';
        } catch (err) {
          if (isMissingPathError?.(err)) after = '';
          else throw err;
        }
      }
      const diff = { path, before, after };
      if (uiDiffMode === 'editor') {
        openDiffTabInWorkspace?.(diff);
        setDiffModal?.(null);
      } else {
        openDiffModal?.(diff);
      }
    } catch (e) {
      console.error('Failed to open working copy diff', e);
      openFile?.(path);
    }
  }, [backendWorkspaceRoot, isMissingPathError, openDiffModal, openDiffTabInWorkspace, openFile, setDiffModal, shouldHidePath, uiDiffMode, workspaceDriver]);

  const openBatchDiffs = useCallback(async (files, type = 'unstaged') => {
    if (!backendWorkspaceRoot || !workspaceDriver || !files || files.length === 0) return;
    try {
      const diffs = await Promise.all(files.map(async (file) => {
        const path = file.path;
        if (shouldHidePath?.(path)) return null;
        let before = '';
        let after = '';
        if (type === 'staged') {
          before = await GitDriver.getFileContent(backendWorkspaceRoot, 'HEAD', path);
          after = await GitDriver.getFileContent(backendWorkspaceRoot, ':0', path);
        } else {
          before = await GitDriver.getFileContent(backendWorkspaceRoot, ':0', path);
          try {
            const fileData = await workspaceDriver.readFile(path);
            after = fileData.content || '';
          } catch (err) {
            if (isMissingPathError?.(err)) after = '';
            else throw err;
          }
        }
        return { path, before, after };
      }));
      const validDiffs = diffs.filter(Boolean);
      if (!validDiffs.length) return;
      const diff = { files: validDiffs };
      if (uiDiffMode === 'editor') {
        openDiffTabInWorkspace?.(diff);
        setDiffModal?.(null);
      } else {
        openDiffModal?.(diff);
      }
    } catch (e) {
      console.error('Failed to open batch diffs', e);
    }
  }, [backendWorkspaceRoot, isMissingPathError, openDiffModal, openDiffTabInWorkspace, setDiffModal, shouldHidePath, uiDiffMode, workspaceDriver]);

  const gitBranch = gitStatus?.current || '';
  const gitBadgeCount = useMemo(() => {
    const files = gitStatus?.files || [];
    if (!Array.isArray(files) || files.length === 0) return 0;
    return files.filter((f) => {
      const wd = f.working_dir || '';
      const idx = f.index || '';
      const hasWorkingChange = ['A', 'M', 'D', 'R', '?'].includes(wd);
      const hasIndexChange = ['A', 'M', 'D', 'R'].includes(idx);
      return hasWorkingChange || hasIndexChange;
    }).length;
  }, [gitStatus]);

  return {
    gitStatus,
    gitLoading,
    gitRemotes,
    gitLog,
    gitBranches,
    gitBranch,
    gitBadgeCount,
    refreshGitStatus,
    initRepo,
    createBranch,
    deleteBranch,
    checkoutBranch,
    resolveConflict,
    addRemote,
    stage,
    unstage,
    stageAll,
    unstageAll,
    restore,
    restoreAll,
    commit,
    pull,
    push,
    publishBranch,
    setUpstream,
    sync,
    generateCommitMessage,
    getCommitDetails,
    getCommitStats,
    openCommitDiff,
    openAllCommitDiffs,
    openWorkingCopyDiff,
    openBatchDiffs,
  };
}

