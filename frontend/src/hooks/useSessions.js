import { useCallback, useEffect, useRef, useReducer } from 'react';
import { SESSION_STORAGE_KEY } from '../utils/appPersistence';
import { buildLineDiffBlocks, safeDiffStat, shouldHidePath } from '../utils/appAlgorithms';

const resolveNextValue = (prev, next) => (typeof next === 'function' ? next(prev) : next);
const TASK_REVIEW_STORAGE_PREFIX = 'ai_agent_task_review_v1:';

const initialState = {
  sessions: [],
  currentSessionId: null,
  messages: [],
  toolRuns: {},
  input: '',
  taskReview: { taskId: null, files: [], status: 'idle', expanded: false },
  loadingSessions: new Set(),
  currentMode: 'chat',
  showLogs: false,
  logs: [],
};

function reducer(state, action) {
  switch (action.type) {
    case 'setSessions':
      return { ...state, sessions: resolveNextValue(state.sessions, action.next) };
    case 'setCurrentSessionId':
      return { ...state, currentSessionId: resolveNextValue(state.currentSessionId, action.next) };
    case 'setMessages':
      return { ...state, messages: resolveNextValue(state.messages, action.next) };
    case 'setToolRuns':
      return { ...state, toolRuns: resolveNextValue(state.toolRuns, action.next) };
    case 'setInput':
      return { ...state, input: resolveNextValue(state.input, action.next) };
    case 'setTaskReview':
      return { ...state, taskReview: resolveNextValue(state.taskReview, action.next) };
    case 'setLoadingSessions':
      return { ...state, loadingSessions: resolveNextValue(state.loadingSessions, action.next) };
    case 'setCurrentMode':
      return { ...state, currentMode: resolveNextValue(state.currentMode, action.next) };
    case 'setShowLogs':
      return { ...state, showLogs: resolveNextValue(state.showLogs, action.next) };
    case 'setLogs':
      return { ...state, logs: resolveNextValue(state.logs, action.next) };
    case 'deleteSessionLocal': {
      const id = String(action.id || '');
      if (!id) return state;
      const remaining = (state.sessions || []).filter((s) => s?.id !== id);
      if (state.currentSessionId !== id) return { ...state, sessions: remaining };
      return {
        ...state,
        sessions: remaining,
        currentSessionId: remaining[0]?.id || null,
        messages: [],
        toolRuns: {},
      };
    }
    default:
      return state;
  }
}

export function useSessions({
  projectFetch,
  aiEngineClient,
  getBackendConfig,
  backendWorkspaceRoot,
  workspaceDriver,
  toolSettings,
  sidebarCollapsed,
  setSidebarCollapsed,
  setActiveSidebarPanel,
  setProjectConfig,
  syncWorkspaceFromDisk,
  setWorkspaceState,
  lspService,
} = {}) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const {
    sessions,
    currentSessionId,
    messages,
    toolRuns,
    input,
    taskReview,
    loadingSessions,
    currentMode,
    showLogs,
    logs,
  } = state;

  const setSessions = useCallback((next) => dispatch({ type: 'setSessions', next }), []);
  const setCurrentSessionId = useCallback((next) => dispatch({ type: 'setCurrentSessionId', next }), []);
  const setMessages = useCallback((next) => dispatch({ type: 'setMessages', next }), []);
  const setToolRuns = useCallback((next) => dispatch({ type: 'setToolRuns', next }), []);
  const setInput = useCallback((next) => dispatch({ type: 'setInput', next }), []);
  const setTaskReview = useCallback((next) => dispatch({ type: 'setTaskReview', next }), []);
  const setLoadingSessions = useCallback((next) => dispatch({ type: 'setLoadingSessions', next }), []);
  const setCurrentMode = useCallback((next) => dispatch({ type: 'setCurrentMode', next }), []);
  const setShowLogs = useCallback((next) => dispatch({ type: 'setShowLogs', next }), []);
  const setLogs = useCallback((next) => dispatch({ type: 'setLogs', next }), []);

  const abortControllerRef = useRef(null);
  const streamBufferRef = useRef('');
  const toolRunSyncTimerRef = useRef(null);
  const taskSnapshotRef = useRef(null);

  const taskReviewStorageKey = useCallback((sessionId) => `${TASK_REVIEW_STORAGE_PREFIX}${String(sessionId || '')}`, []);

  useEffect(() => {
    if (!currentSessionId) return;
    let restored = null;
    try {
      const raw = localStorage.getItem(taskReviewStorageKey(currentSessionId));
      if (raw) restored = JSON.parse(raw);
    } catch {
      restored = null;
    }
    if (restored && typeof restored === 'object' && Array.isArray(restored.files)) {
      setTaskReview(restored);
    } else {
      setTaskReview({ taskId: null, files: [], status: 'idle', expanded: false });
    }
  }, [currentSessionId, setTaskReview, taskReviewStorageKey]);

  useEffect(() => {
    if (!currentSessionId) return;
    const key = taskReviewStorageKey(currentSessionId);
    const files = Array.isArray(taskReview?.files) ? taskReview.files : [];
    const shouldClear = !taskReview || (taskReview.status === 'idle' && files.length === 0);
    if (shouldClear) {
      try { localStorage.removeItem(key); } catch {}
      return;
    }
    try {
      const raw = JSON.stringify(taskReview);
      if (raw.length > 1_500_000) return;
      localStorage.setItem(key, raw);
    } catch {
    }
  }, [currentSessionId, taskReview, taskReviewStorageKey]);

  const emitSessionsUpdated = useCallback((detail = {}) => {
    const payload = { timestamp: Date.now(), ...detail };
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn('Emit sessions-updated failed', err);
    }
  }, []);

  const getEnabledTools = useCallback((mode) => {
    if (!workspaceDriver) return [];
    if (mode === 'agent') {
      return Object.entries(toolSettings?.agent || {})
        .filter(([, enabled]) => enabled)
        .map(([name]) => name);
    }
    if (mode === 'canva') {
      return Object.entries(toolSettings?.canva || {})
        .filter(([, enabled]) => enabled)
        .map(([name]) => name);
    }
    return [];
  }, [toolSettings, workspaceDriver]);

  const captureWorkspaceSnapshot = useCallback(async () => {
    if (!workspaceDriver) return null;
    try {
      const data = await workspaceDriver.getStructure({ includeContent: true });
      const files = (data.files || [])
        .filter((f) => !shouldHidePath(f.path))
        .map((f) => ({ path: f.path, content: f.content ?? '' }));
      return { raw: data, files };
    } catch (err) {
      console.error('Capture workspace snapshot failed', err);
      return null;
    }
  }, [workspaceDriver]);

  const buildTaskDiffs = useCallback((beforeFiles = [], afterFiles = []) => {
    const beforeMap = new Map((beforeFiles || []).map((f) => [f.path, f.content ?? '']));
    const afterMap = new Map((afterFiles || []).map((f) => [f.path, f.content ?? '']));
    const allPaths = new Set([...beforeMap.keys(), ...afterMap.keys()]);
    const diffs = [];
    allPaths.forEach((path) => {
      const prev = beforeMap.has(path) ? beforeMap.get(path) : null;
      const next = afterMap.has(path) ? afterMap.get(path) : null;
      if (prev === next) return;
      const changeType = prev === null ? 'added' : (next === null ? 'deleted' : 'modified');
      const stat = safeDiffStat(prev || '', next || '');
      let blocks = [];
      if (changeType === 'modified') {
        blocks = buildLineDiffBlocks(prev || '', next || '').map((b, idx) => ({ ...b, id: `${path}#${idx}` }));
      } else if (changeType === 'added') {
        const afterText = String(next || '');
        const afterEndIndex = afterText ? afterText.split('\n').length : 0;
        blocks = [{
          id: `${path}#0`,
          beforeStartIndex: 0,
          beforeEndIndex: 0,
          afterStartIndex: 0,
          afterEndIndex,
          beforeText: '',
          afterText,
          changeType: 'added',
          action: 'pending',
          contextBefore: '',
          contextAfter: '',
        }];
      } else if (changeType === 'deleted') {
        const beforeText = String(prev || '');
        const beforeEndIndex = beforeText ? beforeText.split('\n').length : 0;
        blocks = [{
          id: `${path}#0`,
          beforeStartIndex: 0,
          beforeEndIndex,
          afterStartIndex: 0,
          afterEndIndex: 0,
          beforeText,
          afterText: '',
          changeType: 'deleted',
          action: 'pending',
          contextBefore: '',
          contextAfter: '',
        }];
      }
      diffs.push({
        path,
        before: prev,
        after: next,
        changeType,
        stat,
        action: 'pending',
        blocks,
      });
    });
    return diffs.sort((a, b) => a.path.localeCompare(b.path));
  }, []);

  const finalizeTaskReview = useCallback(async (taskId) => {
    if (!taskSnapshotRef.current || taskSnapshotRef.current.id !== taskId) return;
    try {
      const after = await captureWorkspaceSnapshot();
      const afterFiles = after?.files || [];
      const diffs = buildTaskDiffs(taskSnapshotRef.current.files || [], afterFiles);
      setTaskReview((prev) => ({
        taskId,
        files: diffs,
        expanded: prev?.expanded || diffs.length > 0,
        status: diffs.length ? 'ready' : 'clean',
        cursorByPath: prev?.cursorByPath || {},
      }));
      if (after?.raw) {
        await syncWorkspaceFromDisk?.({ includeContent: true, highlight: true, force: true, snapshot: after.raw });
      } else {
        await syncWorkspaceFromDisk?.({ includeContent: true, highlight: true, force: true });
      }
    } catch (err) {
      console.error('Finalize task review failed', err);
      setTaskReview((prev) => (prev && prev.taskId === taskId ? { ...prev, status: 'error' } : prev));
    } finally {
      taskSnapshotRef.current = null;
    }
  }, [buildTaskDiffs, captureWorkspaceSnapshot, syncWorkspaceFromDisk]);

  const updateTaskReviewIncrementally = useCallback(async (taskId) => {
    if (!taskSnapshotRef.current || taskSnapshotRef.current.id !== taskId) return;
    try {
      const after = await captureWorkspaceSnapshot();
      if (!after) return;
      const afterFiles = after.files || [];
      const diffs = buildTaskDiffs(taskSnapshotRef.current.files || [], afterFiles);

      setTaskReview((prev) => {
        if (!prev || prev.taskId !== taskId) return prev;
        const nextStatus = prev.status === 'running' ? 'running' : prev.status;
        return {
          ...prev,
          files: diffs,
          status: nextStatus,
          expanded: prev.expanded || diffs.length > 0,
        };
      });

      if (typeof setWorkspaceState === 'function') {
        setWorkspaceState((prev) => {
          let changed = false;
          const nextFiles = prev.files.map((f) => {
            const snap = afterFiles.find((s) => s.path === f.path);
            if (snap && snap.content !== f.content) {
              changed = true;
              return { ...f, content: snap.content, updated: true };
            }
            return f;
          });
          if (!changed) return prev;
          return { ...prev, files: nextFiles };
        });
      }
    } catch (err) {
      console.error('Incremental task review update failed', err);
    }
  }, [buildTaskDiffs, captureWorkspaceSnapshot, setWorkspaceState]);

  const toggleTaskReview = useCallback(() => {
    setTaskReview((prev) => (prev ? { ...prev, expanded: !prev.expanded } : prev));
  }, []);

  const computeTaskFileAction = useCallback((file) => {
    if (!file) return 'pending';
    const blocks = Array.isArray(file.blocks) ? file.blocks : [];
    if (!blocks.length) return file.action || 'pending';
    const pending = blocks.filter((b) => b.action === 'pending').length;
    if (pending > 0) return 'pending';
    const kept = blocks.filter((b) => b.action === 'kept').length;
    const reverted = blocks.filter((b) => b.action === 'reverted').length;
    if (kept === blocks.length) return 'kept';
    if (reverted === blocks.length) return 'reverted';
    return 'mixed';
  }, []);

  const computeTaskStatus = useCallback((files, fallback = 'ready') => {
    const list = Array.isArray(files) ? files : [];
    if (list.length === 0) return 'clean';
    const anyPending = list.some((f) => computeTaskFileAction(f) === 'pending');
    return anyPending ? fallback : 'resolved';
  }, [computeTaskFileAction]);

  const keepTaskFile = useCallback((path) => {
    if (!taskReview?.files?.length) return;
    setTaskReview((prev) => {
      if (!prev) return prev;
      const files = prev.files.map((f) => {
        if (f.path !== path) return f;
        const blocks = Array.isArray(f.blocks) ? f.blocks.map((b) => ({ ...b, action: 'kept' })) : f.blocks;
        return { ...f, action: 'kept', blocks };
      });
      const status = computeTaskStatus(files, prev.status);
      return { ...prev, files, status, cursorByPath: prev.cursorByPath || {} };
    });
    if (typeof setWorkspaceState === 'function') {
      setWorkspaceState((prev) => ({
        ...prev,
        files: prev.files.map((f) => f.path === path ? { ...f, updated: false } : f),
      }));
    }
  }, [computeTaskStatus, setWorkspaceState, taskReview]);

  const keepAllTaskFiles = useCallback(() => {
    const paths = taskReview?.files?.map((f) => f.path) || [];
    if (!paths.length) {
      setTaskReview((prev) => (prev ? { ...prev, status: 'clean', expanded: false } : prev));
      return;
    }
    if (typeof setWorkspaceState === 'function') {
      setWorkspaceState((prev) => ({
        ...prev,
        files: prev.files.map((f) => paths.includes(f.path) ? { ...f, updated: false } : f),
      }));
    }
    setTaskReview((prev) => (prev ? {
      ...prev,
      files: prev.files.map((f) => ({
        ...f,
        action: 'kept',
        blocks: Array.isArray(f.blocks) ? f.blocks.map((b) => ({ ...b, action: 'kept' })) : f.blocks,
      })),
      status: 'resolved',
      expanded: false,
    } : prev));
  }, [setWorkspaceState, taskReview]);

  const setTaskReviewCursor = useCallback((path, index) => {
    setTaskReview((prev) => {
      if (!prev) return prev;
      const cursorByPath = { ...(prev.cursorByPath || {}) };
      cursorByPath[path] = Number.isFinite(Number(index)) ? Math.max(0, Math.floor(Number(index))) : 0;
      return { ...prev, cursorByPath };
    });
  }, []);

  const keepTaskBlock = useCallback((path, blockId) => {
    setTaskReview((prev) => {
      if (!prev) return prev;
      const files = prev.files.map((f) => {
        if (f.path !== path) return f;
        const blocks = Array.isArray(f.blocks) ? f.blocks.map((b) => b.id === blockId ? { ...b, action: 'kept' } : b) : f.blocks;
        const nextFile = { ...f, blocks };
        return { ...nextFile, action: computeTaskFileAction(nextFile) };
      });
      const status = computeTaskStatus(files, prev.status);
      return { ...prev, files, status, cursorByPath: prev.cursorByPath || {} };
    });
    if (typeof setWorkspaceState === 'function') {
      setWorkspaceState((prev) => ({
        ...prev,
        files: prev.files.map((f) => f.path === path ? { ...f, updated: false, dirty: false } : f),
      }));
    }
  }, [computeTaskFileAction, computeTaskStatus, setWorkspaceState]);

  const revertTaskBlock = useCallback((path, blockId) => {
    setTaskReview((prev) => {
      if (!prev) return prev;
      const files = prev.files.map((f) => {
        if (f.path !== path) return f;
        const blocks = Array.isArray(f.blocks) ? f.blocks.map((b) => b.id === blockId ? { ...b, action: 'reverted' } : b) : f.blocks;
        const nextFile = { ...f, blocks };
        return { ...nextFile, action: computeTaskFileAction(nextFile) };
      });
      const status = computeTaskStatus(files, prev.status);
      return { ...prev, files, status, cursorByPath: prev.cursorByPath || {} };
    });
  }, [computeTaskFileAction, computeTaskStatus]);

  const resetTaskFile = useCallback((path) => {
    setTaskReview((prev) => {
      if (!prev) return prev;
      const files = prev.files.map((f) => {
        if (f.path !== path) return f;
        const blocks = Array.isArray(f.blocks) ? f.blocks.map((b) => ({ ...b, action: 'pending' })) : f.blocks;
        return { ...f, action: 'pending', blocks };
      });
      const status = computeTaskStatus(files, 'ready');
      return { ...prev, files, status };
    });
  }, [computeTaskStatus]);

  const resetTaskBlock = useCallback((path, blockId) => {
    setTaskReview((prev) => {
      if (!prev) return prev;
      const files = prev.files.map((f) => {
        if (f.path !== path) return f;
        const blocks = Array.isArray(f.blocks) ? f.blocks.map((b) => {
          if (b.id !== blockId) return b;
          return { ...b, action: 'pending' };
        }) : f.blocks;
        const hasPending = blocks.some((b) => b.action === 'pending');
        const action = hasPending ? (blocks.every((b) => b.action === 'pending') ? 'pending' : 'mixed') : f.action;
        return { ...f, action, blocks };
      });
      const status = computeTaskStatus(files, 'ready');
      return { ...prev, files, status };
    });
  }, [computeTaskStatus]);

  const revertTaskFile = useCallback(async (path) => {
    const target = taskReview?.files?.find((f) => f.path === path);
    if (!target || !workspaceDriver) return;
    setTaskReview((prev) => (prev ? { ...prev, status: 'applying' } : prev));
    try {
      if (target.changeType === 'added') {
        const hasDeleteHook = !!(workspaceDriver?.fileOpsHooks
          && typeof workspaceDriver.fileOpsHooks === 'object'
          && typeof workspaceDriver.fileOpsHooks.willDeleteFiles === 'function'
          && typeof workspaceDriver.fileOpsHooks.didDeleteFiles === 'function');
        if (!hasDeleteHook) {
          try { await lspService?.willDeleteFiles?.([path]); } catch {}
        }
        await workspaceDriver.deletePath(path);
        if (!hasDeleteHook) {
          try { await lspService?.didDeleteFiles?.([path]); } catch {}
        }
      } else {
        await workspaceDriver.writeFile(path, target.before || '', { createDirectories: true });
      }
      await syncWorkspaceFromDisk?.({ includeContent: true, highlight: false, force: true });
      setTaskReview((prev) => {
        if (!prev) return prev;
        const files = prev.files.map((f) => {
          if (f.path !== path) return f;
          const blocks = Array.isArray(f.blocks) ? f.blocks.map((b) => ({ ...b, action: 'reverted' })) : f.blocks;
          return { ...f, action: 'reverted', blocks };
        });
        const status = computeTaskStatus(files, 'ready');
        return { ...prev, files, status, cursorByPath: prev.cursorByPath || {} };
      });
    } catch (err) {
      console.error('Revert file failed', err);
      alert(`撤销失败：${err.message || err}`);
      setTaskReview((prev) => (prev ? { ...prev, status: prev.status === 'applying' ? 'ready' : prev.status } : prev));
    }
  }, [computeTaskStatus, lspService, syncWorkspaceFromDisk, taskReview, workspaceDriver]);

  const revertAllTaskFiles = useCallback(async () => {
    if (!taskReview?.files?.length || !workspaceDriver) return;
    setTaskReview((prev) => (prev ? { ...prev, status: 'applying' } : prev));
    try {
      const deletePaths = taskReview.files.filter((f) => f?.changeType === 'added').map((f) => f.path).filter(Boolean);
      const hasDeleteHook = !!(workspaceDriver?.fileOpsHooks
        && typeof workspaceDriver.fileOpsHooks === 'object'
        && typeof workspaceDriver.fileOpsHooks.willDeleteFiles === 'function'
        && typeof workspaceDriver.fileOpsHooks.didDeleteFiles === 'function');
      if (deletePaths.length && !hasDeleteHook) {
        try { await lspService?.willDeleteFiles?.(deletePaths); } catch {}
      }
      for (const file of taskReview.files) {
        if (file.changeType === 'added') {
          await workspaceDriver.deletePath(file.path);
        } else {
          await workspaceDriver.writeFile(file.path, file.before || '', { createDirectories: true });
        }
      }
      if (deletePaths.length && !hasDeleteHook) {
        try { await lspService?.didDeleteFiles?.(deletePaths); } catch {}
      }
      await syncWorkspaceFromDisk?.({ includeContent: true, highlight: false, force: true });
      setTaskReview((prev) => (prev ? {
        ...prev,
        files: prev.files.map((f) => ({
          ...f,
          action: 'reverted',
          blocks: Array.isArray(f.blocks) ? f.blocks.map((b) => ({ ...b, action: 'reverted' })) : f.blocks,
        })),
        status: 'resolved',
        expanded: false,
      } : prev));
    } catch (err) {
      console.error('Revert all failed', err);
      alert(`撤销失败：${err.message || err}`);
      setTaskReview((prev) => (prev ? { ...prev, status: prev.status === 'applying' ? 'ready' : prev.status } : prev));
    }
  }, [lspService, syncWorkspaceFromDisk, taskReview, workspaceDriver]);

  const deriveDiffTarget = useCallback((result, args) => {
    const resultObject = result && typeof result === 'object' ? result : null;
    const argsObject = args && typeof args === 'object' ? args : null;
    const diffObject = resultObject && typeof resultObject.diff === 'object' ? resultObject.diff : null;
    const diffId = typeof resultObject?.diff_id === 'number'
      ? resultObject.diff_id
      : (diffObject && typeof diffObject.id === 'number' ? diffObject.id : undefined);
    const pathCandidate =
      (diffObject && typeof diffObject.path === 'string' && diffObject.path) ||
      (resultObject && typeof resultObject.path === 'string' && resultObject.path) ||
      (argsObject && typeof argsObject.path === 'string' && argsObject.path) ||
      (argsObject && typeof argsObject.new_path === 'string' && argsObject.new_path) ||
      (argsObject && typeof argsObject.old_path === 'string' && argsObject.old_path) ||
      undefined;
    if (!diffId && !pathCandidate) return null;
    return { diff_id: diffId, path: pathCandidate };
  }, []);

  const collectRunKeys = (run) => {
    const keys = [];
    const diffTarget = run?.diffTarget;
    if (diffTarget?.diff_id !== undefined && diffTarget?.diff_id !== null) keys.push(`diff:${diffTarget.diff_id}`);
    if (diffTarget?.path) keys.push(`path:${diffTarget.path}`);
    if (run?.name) keys.push(`name:${run.name}`);
    return keys;
  };

  const mergeRunLists = useCallback((existing = [], incoming = []) => {
    const doneKeySet = new Set();
    (existing || [])
      .filter((run) => run && run.status && run.status !== 'running')
      .forEach((run) => collectRunKeys(run).forEach((k) => k && doneKeySet.add(k)));

    const next = [...(existing || [])];
    (incoming || []).forEach((candidate) => {
      if (!candidate) return;
      const candidateKeys = collectRunKeys(candidate).filter(Boolean);
      if (candidateKeys.some((k) => doneKeySet.has(k)) && candidate.status === 'running') return;
      const matchIndex = next.findIndex((r) => r && (r.id && candidate.id ? r.id === candidate.id : false));
      if (matchIndex >= 0) {
        next[matchIndex] = { ...next[matchIndex], ...candidate };
        return;
      }
      next.push(candidate);
    });
    return next;
  }, []);

  const buildToolRunsFromMessages = useCallback((list = []) => {
    const ownerByToolId = {};
    const derived = {};

    const resolveStatus = (payload) => {
      if (!payload) return 'done';
      if (payload.status === 'running' || payload.running) return 'running';
      if (payload.status === 'error' || payload.error) return 'error';
      return 'done';
    };

    list.forEach((msg, idx) => {
      const cid = msg._cid || msg.id || `msg-${idx}`;
      if (msg.role === 'assistant') {
        const calls = (msg.tool_calls || []).map((tc, callIdx) => {
          let parsedArgs = tc.function?.arguments;
          if (typeof parsedArgs === 'string') {
            try { parsedArgs = JSON.parse(parsedArgs); } catch { }
          }
          ownerByToolId[tc.id] = cid;
          return {
            id: tc.id || `call-${cid}-${callIdx}`,
            name: tc.function?.name || 'tool',
            status: 'running',
            detail: typeof parsedArgs === 'string' ? parsedArgs.slice(0, 120) : JSON.stringify(parsedArgs || {}).slice(0, 120),
            args: parsedArgs,
            diffTarget: deriveDiffTarget(null, parsedArgs),
          };
        });
        if (calls.length) {
          derived[cid] = mergeRunLists(derived[cid], calls);
        }
      }
    });

    list.forEach((msg, idx) => {
      if (msg.role !== 'tool') return;
      const cid = (msg.tool_call_id && ownerByToolId[msg.tool_call_id]) || null;
      const targetId = cid || Object.keys(derived)[Object.keys(derived).length - 1];
      if (!targetId) return;
      let parsedResult = msg.content;
      if (typeof msg.content === 'string') {
        try { parsedResult = JSON.parse(msg.content); } catch { parsedResult = msg.content; }
      }
      const previewSource = typeof parsedResult === 'string' ? parsedResult : JSON.stringify(parsedResult || {});
      const status = resolveStatus(parsedResult);
      const existingRuns = derived[targetId] || [];
      const argsSource = (existingRuns.find((r) => r.id === (msg.tool_call_id || `tool-${idx}`)) || {}).args;
      const diffTarget = deriveDiffTarget(parsedResult, argsSource);
      const nextRun = {
        id: msg.tool_call_id || `tool-${idx}`,
        name: msg.name || 'tool',
        status,
        detail: previewSource ? previewSource.slice(0, 160) : '',
        result: parsedResult,
        diffTarget,
      };
      derived[targetId] = mergeRunLists(derived[targetId] || [], [nextRun]);
      const selfCid = msg._cid || msg.id || `toolmsg-${idx}`;
      derived[selfCid] = mergeRunLists(derived[selfCid] || [], [nextRun]);
    });

    return derived;
  }, [deriveDiffTarget, mergeRunLists]);

  const normalizeMessages = useCallback((data = []) => data.map((msg, idx) => {
    let payload = msg.content;
    let modeTag = msg.mode;
    if (payload && typeof payload === 'object' && payload.message) {
      modeTag = payload.mode || modeTag;
      const meta = payload.meta;
      payload = payload.message;
      if (meta?.attachments) {
        if (payload && typeof payload === 'object') {
          payload = { ...payload, attachments: [...(payload.attachments || []), ...meta.attachments] };
        } else {
          payload = { content: payload, attachments: meta.attachments };
        }
      }
    }

    const toolCalls = payload?.tool_calls || msg.tool_calls || [];
    const toolCallId = payload?.tool_call_id || msg.tool_call_id;
    const name = payload?.name || msg.name;

    let contentValue = payload;
    if (payload && typeof payload === 'object' && payload.content !== undefined) {
      contentValue = payload.content;
    }
    if (contentValue === undefined || contentValue === null) contentValue = '';
    if (payload && typeof payload === 'object' && payload.attachments) {
      if (typeof contentValue === 'string' || Array.isArray(contentValue)) {
        contentValue = { content: contentValue, attachments: payload.attachments };
      } else if (typeof contentValue === 'object') {
        contentValue = { ...contentValue, attachments: [...(contentValue.attachments || []), ...payload.attachments] };
      }
    }

    const cid = msg.id ? `msg-${msg.id}` : (toolCallId ? `tool-${toolCallId}` : `local-${idx}-${Math.random().toString(16).slice(2)}`);
    return { ...msg, mode: modeTag, content: contentValue, tool_calls: toolCalls, tool_call_id: toolCallId, name, _cid: cid };
  }), []);

  const refreshMessages = useCallback(async (sessionId) => {
    if (!sessionId) return;
    try {
      const res = await projectFetch?.(`/api/sessions/${sessionId}/messages`);
      if (!res?.ok) return;
      const data = await res.json();
      const normalized = normalizeMessages(data);
      const derivedRuns = buildToolRunsFromMessages(normalized);

      if (loadingSessions.has(sessionId)) {
        setToolRuns((prev) => {
          const next = {};
          Object.entries(derivedRuns).forEach(([cid, runs]) => {
            next[cid] = mergeRunLists(prev[cid] || [], runs);
          });
          return next;
        });
        return;
      }

      const localToolPlaceholders = messages
        .filter((m) => m.role === 'tool' && m.synthetic)
        .filter((m) => {
          const runs = toolRuns[m._cid];
          if (!runs || runs.length === 0) return true;
          return runs.some((r) => !r.status || r.status === 'running');
        });
      const mergedMessages = [...normalized, ...localToolPlaceholders];
      setMessages(mergedMessages);
      setToolRuns((prev) => {
        const next = {};
        Object.entries(derivedRuns).forEach(([cid, runs]) => {
          next[cid] = mergeRunLists(prev[cid] || [], runs);
        });
        return next;
      });
    } catch (err) {
      console.error(err);
    }
  }, [buildToolRunsFromMessages, loadingSessions, mergeRunLists, messages, normalizeMessages, projectFetch, toolRuns]);

  const refreshToolRuns = useCallback(async (sessionId) => {
    if (!sessionId) return;
    try {
      const res = await projectFetch?.(`/api/sessions/${sessionId}/messages`);
      if (!res?.ok) return;
      const data = await res.json();
      const normalized = normalizeMessages(data);
      const derivedRuns = buildToolRunsFromMessages(normalized);
      const completedKeys = [];
      Object.values(derivedRuns).forEach((runs) => {
        runs.forEach((run) => {
          if (run && run.status && run.status !== 'running') {
            collectRunKeys(run).forEach((k) => k && completedKeys.push(k));
          }
        });
      });

      setToolRuns((prev) => {
        const next = { ...prev };
        Object.entries(derivedRuns).forEach(([cid, runs]) => {
          next[cid] = mergeRunLists(prev[cid] || [], runs);
        });

        if (completedKeys.length > 0) {
          const remaining = completedKeys.reduce((acc, key) => {
            acc.set(key, (acc.get(key) || 0) + 1);
            return acc;
          }, new Map());

          Object.entries(next).forEach(([cid, runs]) => {
            let changed = false;
            const filtered = runs.filter((run) => {
              if (!run || !run.synthetic || run.status !== 'running') return true;
              const keys = collectRunKeys(run);
              const matchedKey = keys.find((k) => remaining.get(k) > 0);
              if (matchedKey) {
                remaining.set(matchedKey, (remaining.get(matchedKey) || 0) - 1);
                changed = true;
                return false;
              }
              return true;
            });
            if (changed) next[cid] = filtered;
          });
        }

        const nameBuckets = {};
        Object.values(derivedRuns).forEach((runs) => {
          runs.forEach((run) => {
            const key = run?.name;
            if (!key) return;
            if (!nameBuckets[key]) nameBuckets[key] = [];
            nameBuckets[key].push(run);
          });
        });
        messages.forEach((msg) => {
          if (msg.role !== 'tool' || !msg.name) return;
          const bucket = nameBuckets[msg.name];
          if (!bucket || bucket.length === 0) return;
          next[msg._cid || msg.id] = mergeRunLists(prev[msg._cid || msg.id] || [], bucket);
        });

        return next;
      });
    } catch (err) {
      console.error('Failed to refresh tool runs', err);
    }
  }, [buildToolRunsFromMessages, mergeRunLists, messages, normalizeMessages, projectFetch]);

  const upsertToolRun = useCallback((messageId, run) => {
    if (!messageId) return;
    setToolRuns((prev) => ({
      ...prev,
      [messageId]: mergeRunLists(prev[messageId] || [], [run]),
    }));
  }, [mergeRunLists]);

  const selectSession = useCallback(async (id, sessionHint = null) => {
    if (!id) return;
    setCurrentSessionId(id);
    const found = sessionHint || sessions.find((s) => s.id === id);
    if (found?.mode) {
      setCurrentMode(found.mode);
    }
    if (sidebarCollapsed) setSidebarCollapsed?.(false);
    setActiveSidebarPanel?.('sessions');
    await refreshMessages(id);
  }, [refreshMessages, sessions, setActiveSidebarPanel, setSidebarCollapsed, sidebarCollapsed]);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await projectFetch?.('/api/sessions');
      if (res?.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (err) {
      console.error('Failed to fetch sessions', err);
    }
  }, [projectFetch]);

  const createSession = useCallback(async (initialTitle) => {
    console.time('🚀 createSession');
    try {
      console.log('[CREATE] 发送请求...');
      const initialTitleStr = typeof initialTitle === 'string' ? initialTitle : '';
      const title = initialTitleStr.trim() ? initialTitleStr.trim().slice(0, 60) : 'New Chat';
      const res = await projectFetch?.('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, mode: currentMode }),
      });
      if (res?.ok) {
        const newSession = await res.json();
        console.log('[CREATE] 收到响应，更新 UI...', newSession.id);
        setSessions((prev) => [newSession, ...prev]);
        setCurrentSessionId(newSession.id);
        setTaskReview({ taskId: null, files: [], status: 'idle', expanded: false });
        setMessages([]);
        setToolRuns({});
        setSidebarCollapsed?.(false);
        setActiveSidebarPanel?.('sessions');
        console.timeEnd('🚀 createSession');
        emitSessionsUpdated({ action: 'create', sessionId: newSession.id });
        return newSession;
      }
    } catch (err) {
      console.error('Failed to create session', err);
    }
    return null;
  }, [currentMode, emitSessionsUpdated, projectFetch, setActiveSidebarPanel, setSidebarCollapsed]);

  const deleteSession = useCallback(async (id) => {
    if (!confirm('Are you sure you want to delete this chat?')) return;
    dispatch({ type: 'deleteSessionLocal', id });
    try { localStorage.removeItem(taskReviewStorageKey(id)); } catch {}

    try {
      await projectFetch?.(`/api/sessions/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.error(err);
    }

    emitSessionsUpdated({ action: 'delete', sessionId: id });
  }, [emitSessionsUpdated, projectFetch]);

  const renameSession = useCallback(async (id, title) => {
    const trimmed = (title || '').trim();
    if (!trimmed) return;
    try {
      const res = await projectFetch?.(`/api/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (res?.ok) {
        const updated = await res.json();
        setSessions((prev) => prev.map((s) => s.id === id ? { ...s, ...updated } : s));
        if (currentSessionId === id && updated.mode) {
          setCurrentMode(updated.mode);
        }
        emitSessionsUpdated({ action: 'rename', sessionId: id });
      }
    } catch (err) {
      console.error('Failed to rename session', err);
    }
  }, [currentSessionId, emitSessionsUpdated, projectFetch]);

  const handleModeChange = useCallback(async (mode) => {
    setCurrentMode(mode);
    setProjectConfig?.((cfg) => ({ ...cfg, lastMode: mode }));
    if (['canva', 'agent'].includes(mode)) {
      setTimeout(() => {
        syncWorkspaceFromDisk?.({ includeContent: true, highlight: false });
      }, 300);
    }
    if (!currentSessionId) return;
    setSessions((prev) => prev.map((s) => s.id === currentSessionId ? { ...s, mode } : s));
    try {
      await projectFetch?.(`/api/sessions/${currentSessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      emitSessionsUpdated({ action: 'mode', sessionId: currentSessionId });
    } catch (err) {
      console.error('Failed to update mode', err);
    }
  }, [currentSessionId, emitSessionsUpdated, projectFetch, setProjectConfig, syncWorkspaceFromDisk]);

  const fetchLogs = useCallback(async () => {
    if (!currentSessionId) return;
    try {
      const res = await projectFetch?.(`/api/sessions/${currentSessionId}/logs`);
      if (res?.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error(err);
    }
  }, [currentSessionId, projectFetch]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    const hasPending = loadingSessions.size > 0;
    if (hasPending && !toolRunSyncTimerRef.current) {
      const targetSession = currentSessionId || Array.from(loadingSessions)[0];
      if (targetSession) refreshToolRuns(targetSession);
      toolRunSyncTimerRef.current = setInterval(() => {
        const target = currentSessionId || Array.from(loadingSessions)[0];
        if (target) refreshToolRuns(target);
      }, 900);
    } else if (!hasPending && toolRunSyncTimerRef.current) {
      clearInterval(toolRunSyncTimerRef.current);
      toolRunSyncTimerRef.current = null;
    }
    return () => {
      if (toolRunSyncTimerRef.current) {
        clearInterval(toolRunSyncTimerRef.current);
        toolRunSyncTimerRef.current = null;
      }
    };
  }, [loadingSessions, currentSessionId, refreshToolRuns]);

  useEffect(() => {
    if (showLogs && currentSessionId) {
      fetchLogs();
      const interval = setInterval(fetchLogs, 2000);
      return () => clearInterval(interval);
    }
    return undefined;
  }, [fetchLogs, showLogs, currentSessionId]);

  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key !== SESSION_STORAGE_KEY || !e.newValue) return;
      fetchSessions();
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, [fetchSessions]);

  const handleSend = useCallback(async ({ text, attachments } = {}) => {
    const messageText = text !== undefined ? text : input;
    const cleanedText = messageText || '';
    const safeAttachments = attachments || [];
    const requiresWorkspace = ['canva', 'agent'].includes(currentMode);
    if (requiresWorkspace && !workspaceDriver) {
      alert('请先选择项目文件夹（Canva/Agent 模式需要访问工作区文件）。');
      return;
    }
    const enabledTools = getEnabledTools(currentMode);
    if ((!cleanedText.trim()) && safeAttachments.length === 0) return;

    const trackTaskChanges = ['canva', 'agent'].includes(currentMode);
    const deriveTitle = () => {
      const t = (cleanedText || '').trim();
      if (t) return t.slice(0, 60);
      if (safeAttachments.length > 0) {
        const name = safeAttachments[0]?.name || '';
        if (name) return name.slice(0, 60);
      }
      return 'New Chat';
    };

    let sessionIdToUse = currentSessionId;
    if (!sessionIdToUse) {
      const created = await createSession(deriveTitle());
      if (!created?.id) return;
      sessionIdToUse = created.id;
    }
    const sessionForTitle = sessions.find((s) => s.id === sessionIdToUse);
    if (sessionForTitle && (!sessionForTitle.title || sessionForTitle.title.toLowerCase() === 'new chat')) {
      const candidateTitle = deriveTitle();
      if (candidateTitle && candidateTitle !== sessionForTitle.title) {
        renameSession(sessionIdToUse, candidateTitle);
      }
    }

    const taskId = Date.now();
    let snapshotReady = false;
    if (trackTaskChanges && workspaceDriver) {
      const beforeSnapshot = await captureWorkspaceSnapshot();
      if (beforeSnapshot) {
        taskSnapshotRef.current = { id: taskId, files: beforeSnapshot.files || [] };
        setTaskReview({ taskId, files: [], status: 'running', expanded: false });
        snapshotReady = true;
      } else {
        taskSnapshotRef.current = null;
        setTaskReview({ taskId, files: [], status: 'idle', expanded: false });
      }
    } else {
      taskSnapshotRef.current = null;
      setTaskReview({ taskId: null, files: [], status: 'idle', expanded: false });
    }

    const userMessage = { _cid: `user-${Date.now()}`, role: 'user', content: { text: cleanedText, attachments: safeAttachments, mode: currentMode } };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoadingSessions((prev) => {
      const next = new Set(prev);
      next.add(sessionIdToUse);
      return next;
    });

    const controller = new AbortController();
    abortControllerRef.current = controller;
    streamBufferRef.current = '';
    let incrementalTimer = null;

    try {
      const llmConfig = getBackendConfig?.();
      const response = await aiEngineClient?.chatStream?.({
        requestId: `ui-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        sessionId: sessionIdToUse,
        workspaceRoot: backendWorkspaceRoot,
        message: cleanedText,
        attachments: safeAttachments,
        mode: currentMode,
        toolOverrides: enabledTools,
        llmConfig,
      }, { signal: controller.signal });

      if (!response?.ok) {
        throw new Error(`Request failed with status ${response?.status}`);
      }

      if (!response.body) {
        throw new Error('Response body is empty');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let currentAssistantCid = null;
      let shouldStartNewAssistant = false;
      let hasReceivedContent = false;

      if (trackTaskChanges && taskId) {
        incrementalTimer = setInterval(() => {
          updateTaskReviewIncrementally(taskId);
        }, 1500);
      }

      const ensureAssistantMessage = () => {
        if (currentAssistantCid && !shouldStartNewAssistant) return currentAssistantCid;
        const cid = `assistant-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        currentAssistantCid = cid;
        shouldStartNewAssistant = false;
        setMessages((prev) => [...prev, { _cid: cid, role: 'assistant', content: '', tool_calls: [] }]);
        return cid;
      };

      const appendToAssistant = (text = '') => {
        if (!text) return;
        hasReceivedContent = true;
        const cid = ensureAssistantMessage();
        setMessages((prev) => {
          const next = [...prev];
          const idx = next.findIndex((m) => m._cid === cid);
          if (idx === -1) {
            next.push({ _cid: cid, role: 'assistant', content: text, tool_calls: [] });
          } else {
            const existing = next[idx];
            next[idx] = { ...existing, content: `${existing.content || ''}${text}` };
          }
          return next;
        });
      };

      const handleToolMarker = (rawName = '') => {
        const ownerCid = currentAssistantCid || ensureAssistantMessage();
        const toolName = rawName?.trim() || '工具';
        const startedAt = Date.now();
        upsertToolRun(ownerCid, {
          id: `live-${ownerCid}-${toolName}`,
          name: toolName,
          status: 'running',
          detail: `正在执行 ${toolName}…`,
          synthetic: true,
          startedAt,
        });
        const placeholderCid = `tool-${ownerCid}-${startedAt}-${Math.random().toString(16).slice(2)}`;
        setMessages((prev) => [...prev, { _cid: placeholderCid, role: 'tool', name: toolName, content: `执行 ${toolName} 中…`, synthetic: true }]);
        upsertToolRun(placeholderCid, {
          id: `live-${placeholderCid}`,
          name: toolName,
          status: 'running',
          detail: `正在执行 ${toolName}…`,
          synthetic: true,
          startedAt,
        });
        shouldStartNewAssistant = true;
      };

      ensureAssistantMessage();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });

        let buffer = `${streamBufferRef.current}${chunk}`;
        let lastIndex = 0;
        const execRegex = /\[Executing\s+([^\]]+?)\.\.\.\]/g;
        let match;

        while ((match = execRegex.exec(buffer))) {
          const textChunk = buffer.slice(lastIndex, match.index);
          appendToAssistant(textChunk);
          handleToolMarker(match[1]);
          lastIndex = execRegex.lastIndex;
        }

        const remainder = buffer.slice(lastIndex);
        const partialIdx = remainder.lastIndexOf('[Executing ');
        if (partialIdx !== -1) {
          appendToAssistant(remainder.slice(0, partialIdx));
          streamBufferRef.current = remainder.slice(partialIdx);
        } else {
          appendToAssistant(remainder);
          streamBufferRef.current = '';
        }
      }

      if (streamBufferRef.current) {
        appendToAssistant(streamBufferRef.current);
        streamBufferRef.current = '';
      }

      if (!hasReceivedContent) {
        appendToAssistant('（AI 未返回任何内容，请检查网络或配置）');
      }

      fetchSessions();
      fetchLogs();
      await refreshMessages(sessionIdToUse);
      emitSessionsUpdated({ action: 'messages', sessionId: sessionIdToUse });
    } catch (err) {
      if (err?.name === 'AbortError') {
        console.log('Generation aborted');
        setMessages((prev) => [...prev, { role: 'system', content: '[Stopped by user]' }]);
      } else {
        console.error(err);
        setMessages((prev) => [...prev, { role: 'error', content: 'Error getting response' }]);
      }
    } finally {
      if (typeof incrementalTimer !== 'undefined' && incrementalTimer) {
        clearInterval(incrementalTimer);
      }
      abortControllerRef.current = null;
      streamBufferRef.current = '';
      if (snapshotReady && taskId) {
        await finalizeTaskReview(taskId);
      } else {
        taskSnapshotRef.current = null;
      }
      setLoadingSessions((prev) => {
        const next = new Set(prev);
        next.delete(sessionIdToUse);
        return next;
      });
    }
  }, [
    aiEngineClient,
    backendWorkspaceRoot,
    captureWorkspaceSnapshot,
    createSession,
    currentMode,
    currentSessionId,
    fetchLogs,
    fetchSessions,
    finalizeTaskReview,
    getBackendConfig,
    getEnabledTools,
    input,
    refreshMessages,
    renameSession,
    sessions,
    updateTaskReviewIncrementally,
    upsertToolRun,
    workspaceDriver,
  ]);

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  return {
    sessions,
    setSessions,
    currentSessionId,
    setCurrentSessionId,
    messages,
    setMessages,
    toolRuns,
    setToolRuns,
    input,
    setInput,
    taskReview,
    setTaskReview,
    loadingSessions,
    setLoadingSessions,
    currentMode,
    setCurrentMode,
    showLogs,
    setShowLogs,
    logs,
    setLogs,
    abortControllerRef,
    taskSnapshotRef,
    actions: {
      fetchSessions,
      selectSession,
      createSession,
      deleteSession,
      renameSession,
      refreshMessages,
      handleSend,
      handleStop,
      handleModeChange,
      fetchLogs,
      toggleTaskReview,
      keepTaskFile,
      keepAllTaskFiles,
      keepTaskBlock,
      revertTaskBlock,
      revertTaskFile,
      revertAllTaskFiles,
      resetTaskFile,
      resetTaskBlock,
      setTaskReviewCursor,
    },
  };
}
