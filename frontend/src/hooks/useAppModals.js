import { useCallback, useEffect, useState } from 'react';

export function useAppModals({
  uiDiffMode = 'modal',
  projectFetch,
  currentSessionIdRef,
  openDiffTabInWorkspaceRef,
  inputModalState,
  setInputModalState,
} = {}) {
  const [internalInputModal, setInternalInputModal] = useState({
    isOpen: false,
    title: '',
    label: '',
    defaultValue: '',
    placeholder: '',
    confirmText: '确定',
    icon: 'codicon-edit',
    onConfirm: () => {},
    onClose: () => {},
  });
  const inputModal = inputModalState ?? internalInputModal;
  const setInputModal = setInputModalState ?? setInternalInputModal;
  const [diffModal, setDiffModal] = useState(null);
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [helpModal, setHelpModal] = useState({ isOpen: false, type: '', appInfo: null });
  const [configFullscreen, setConfigFullscreen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [editorAiInvoker, setEditorAiInvoker] = useState(null);

  const openDiffModal = useCallback((payload) => {
    if (!payload) return;
    setDiffModal(payload);
  }, []);

  const closeDiffModal = useCallback(() => setDiffModal(null), []);

  const handleOpenDiffInWorkspace = useCallback((diff) => {
    const openInEditor = openDiffTabInWorkspaceRef?.current;
    if (typeof openInEditor !== 'function') {
      alert('当前无法在编辑器中打开 Diff（工作区未就绪）');
      return;
    }
    try {
      openInEditor(diff);
      setDiffModal(null);
    } catch (e) {
      console.warn('openDiffTabInWorkspace failed, fallback to modal', e);
      setDiffModal(diff);
    }
  }, [openDiffTabInWorkspaceRef]);

  const fetchDiffSnapshot = useCallback(async ({ diffId, path } = {}) => {
    const currentSessionId = currentSessionIdRef?.current;
    if (!currentSessionId) return null;
    if (typeof projectFetch !== 'function') return null;
    try {
      let url = '';
      if (diffId) {
        url = `/api/diffs/${diffId}`;
      } else if (path) {
        url = `/api/diffs?session_id=${encodeURIComponent(currentSessionId)}&path=${encodeURIComponent(path)}&limit=1`;
      } else {
        url = `/api/diffs?session_id=${encodeURIComponent(currentSessionId)}&limit=1`;
      }
      const res = await projectFetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      if (Array.isArray(data)) {
        return data[0] || null;
      }
      return data;
    } catch (e) {
      console.warn('fetchDiffSnapshot failed', e);
      return null;
    }
  }, [currentSessionIdRef, projectFetch]);

  const handleOpenDiff = useCallback(async (payload = {}) => {
    const diffId = payload?.diff_id || payload?.id;
    const path = payload?.path;
    const direct = payload && payload.before !== undefined && payload.after !== undefined ? payload : null;
    const latest = await fetchDiffSnapshot({ diffId, path });
    const diff = latest && latest.before !== undefined && latest.after !== undefined ? latest : direct;
    if (diff) {
      if (uiDiffMode === 'editor') {
        const openInEditor = openDiffTabInWorkspaceRef?.current;
        if (typeof openInEditor === 'function') {
          try {
            openInEditor(diff);
            setDiffModal(null);
            return;
          } catch (e) {
            console.warn('openDiffTabInWorkspace failed, fallback to modal', e);
          }
        }
        openDiffModal(diff);
      } else {
        openDiffModal(diff);
      }
      return;
    }
    alert('未找到可用的 diff 快照（请确认已触发文件写入操作）');
  }, [fetchDiffSnapshot, openDiffModal, openDiffTabInWorkspaceRef, uiDiffMode]);

  const openHelpModal = useCallback((type) => {
    const nextType = type === 'about' ? 'about' : 'docs';
    setHelpModal({ isOpen: true, type: nextType, appInfo: null });
  }, []);

  const closeHelpModal = useCallback(() => {
    setHelpModal((prev) => ({ ...prev, isOpen: false }));
  }, []);

  useEffect(() => {
    if (!helpModal.isOpen) return;
    if (helpModal.type !== 'about') return;
    let cancelled = false;
    (async () => {
      try {
        const api = typeof window !== 'undefined' ? window.electronAPI?.app : null;
        if (!api?.getInfo) return;
        const res = await api.getInfo();
        if (cancelled) return;
        setHelpModal((prev) => {
          if (!prev.isOpen || prev.type !== 'about') return prev;
          return { ...prev, appInfo: res || null };
        });
      } catch {
      }
    })();
    return () => { cancelled = true; };
  }, [helpModal.isOpen, helpModal.type]);

  const handleConnectRemote = useCallback(async (data) => {
    console.log('Connecting to remote:', data);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    alert(`Connected to ${data.username}@${data.host}:${data.port}`);
    setShowRemoteModal(false);
  }, []);

  return {
    inputModal,
    setInputModal,
    diffModal,
    setDiffModal,
    openDiffModal,
    closeDiffModal,
    handleOpenDiff,
    handleOpenDiffInWorkspace,
    showRemoteModal,
    setShowRemoteModal,
    showCloneModal,
    setShowCloneModal,
    helpModal,
    openHelpModal,
    closeHelpModal,
    configFullscreen,
    setConfigFullscreen,
    globalSearchQuery,
    setGlobalSearchQuery,
    editorAiInvoker,
    setEditorAiInvoker,
    handleConnectRemote,
  };
}
