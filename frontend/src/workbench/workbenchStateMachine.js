import { useCallback, useMemo, useReducer } from 'react';

export const WorkbenchStates = Object.freeze({
  BOOTING: 'BOOTING',
  NO_WORKSPACE: 'NO_WORKSPACE',
  OPENING_WORKSPACE: 'OPENING_WORKSPACE',
  WORKSPACE_READY: 'WORKSPACE_READY',
  WORKSPACE_ERROR: 'WORKSPACE_ERROR',
});

function reducer(state, event) {
  switch (event.type) {
    case 'BOOT':
      return { ...state, state: WorkbenchStates.NO_WORKSPACE, error: null };
    case 'OPEN_REQUESTED':
      return { ...state, state: WorkbenchStates.OPENING_WORKSPACE, error: null };
    case 'OPEN_SUCCEEDED':
      return { ...state, state: WorkbenchStates.WORKSPACE_READY, error: null };
    case 'OPEN_FAILED':
      return { ...state, state: WorkbenchStates.WORKSPACE_ERROR, error: event.error || 'Open failed' };
    case 'CLOSE_REQUESTED':
      return { ...state, state: WorkbenchStates.NO_WORKSPACE, error: null };
    case 'SYNC_FROM_LEGACY': {
      const next = event.payload || {};
      return { ...state, ...next };
    }
    default:
      return state;
  }
}

export function useWorkbenchStateMachine() {
  const initial = useMemo(() => ({ state: WorkbenchStates.BOOTING, error: null }), []);
  const [model, dispatch] = useReducer(reducer, initial);

  const boot = useCallback(() => dispatch({ type: 'BOOT' }), []);
  const openRequested = useCallback(() => dispatch({ type: 'OPEN_REQUESTED' }), []);
  const openSucceeded = useCallback(() => dispatch({ type: 'OPEN_SUCCEEDED' }), []);
  const openFailed = useCallback((error) => dispatch({ type: 'OPEN_FAILED', error }), []);
  const closeRequested = useCallback(() => dispatch({ type: 'CLOSE_REQUESTED' }), []);

  const syncFromLegacy = useCallback(({ workspaceDriver, workspaceBindingStatus, workspaceBindingError }) => {
    if (!workspaceDriver) {
      dispatch({ type: 'SYNC_FROM_LEGACY', payload: { state: WorkbenchStates.NO_WORKSPACE, error: null } });
      return;
    }
    if (workspaceBindingStatus === 'checking') {
      dispatch({ type: 'SYNC_FROM_LEGACY', payload: { state: WorkbenchStates.OPENING_WORKSPACE, error: null } });
      return;
    }
    if (workspaceBindingStatus === 'ready') {
      dispatch({ type: 'SYNC_FROM_LEGACY', payload: { state: WorkbenchStates.WORKSPACE_READY, error: null } });
      return;
    }
    if (workspaceBindingStatus === 'error') {
      dispatch({ type: 'SYNC_FROM_LEGACY', payload: { state: WorkbenchStates.WORKSPACE_ERROR, error: workspaceBindingError || 'Workspace error' } });
      return;
    }
    dispatch({ type: 'SYNC_FROM_LEGACY', payload: { state: WorkbenchStates.NO_WORKSPACE, error: null } });
  }, []);

  return {
    model,
    boot,
    openRequested,
    openSucceeded,
    openFailed,
    closeRequested,
    syncFromLegacy,
  };
}

