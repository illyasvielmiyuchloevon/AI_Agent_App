import { useCallback } from 'react';

export function useWorkspaceFileOps({
  workspaceDriver = null,
  lspService = null,
  setInputModal,
  openFile,
  syncWorkspaceFromDisk,
  setWorkspaceState,
  ensureEditorGroups,
  syncLegacyTabsFromGroups,
  setWorkspaceBindingStatus,
} = {}) {
  const ideBus = globalThis?.window?.electronAPI?.ideBus || null;
  const notifyBus = (method, payload) => {
    try {
      ideBus?.notify?.(String(method || ''), payload && typeof payload === 'object' ? payload : {});
    } catch {
      // ignore
    }
  };

  const handleAddFile = useCallback(() => {
    if (!workspaceDriver) {
      alert('请先选择项目文件夹');
      return;
    }
    setInputModal?.({
      isOpen: true,
      title: '新建文件',
      label: '输入文件名 (例如: src/App.js)',
      defaultValue: '',
      placeholder: 'src/App.js',
      confirmText: '创建',
      icon: 'codicon-new-file',
      onConfirm: async (name) => {
        if (!name) return;
        try {
          if (!workspaceDriver?.setFileOperationsHooks) {
            try { await lspService?.willCreateFiles?.([name]); } catch {}
          }
          await workspaceDriver.writeFile(name, '', { createDirectories: true });
          if (!workspaceDriver?.setFileOperationsHooks) {
            try { await lspService?.didCreateFiles?.([name]); } catch {}
          }
          notifyBus('workspace/didCreateFiles', { paths: [name], source: 'ui' });
          await syncWorkspaceFromDisk?.({ includeContent: true, highlight: true });
          openFile?.(name);
        } catch {
        }
        setInputModal?.((prev) => ({ ...prev, isOpen: false }));
      },
      onClose: () => setInputModal?.((prev) => ({ ...prev, isOpen: false })),
    });
  }, [lspService, openFile, setInputModal, syncWorkspaceFromDisk, workspaceDriver]);

  const handleAddFolder = useCallback(() => {
    if (!workspaceDriver) {
      alert('请先选择项目文件夹');
      return;
    }
    setInputModal?.({
      isOpen: true,
      title: '新建文件夹',
      label: '输入文件夹名 (例如: src/components)',
      defaultValue: '',
      placeholder: 'src/components',
      confirmText: '创建',
      icon: 'codicon-new-folder',
      onConfirm: async (name) => {
        if (!name) return;
        try {
          if (!workspaceDriver?.setFileOperationsHooks) {
            try { await lspService?.willCreateFiles?.([name]); } catch {}
          }
          await workspaceDriver.createFolder(name);
          if (!workspaceDriver?.setFileOperationsHooks) {
            try { await lspService?.didCreateFiles?.([name]); } catch {}
          }
          notifyBus('workspace/didCreateFiles', { paths: [name], source: 'ui' });
          await syncWorkspaceFromDisk?.({ includeContent: false, highlight: false });
        } catch {
        }
        setInputModal?.((prev) => ({ ...prev, isOpen: false }));
      },
      onClose: () => setInputModal?.((prev) => ({ ...prev, isOpen: false })),
    });
  }, [lspService, setInputModal, syncWorkspaceFromDisk, workspaceDriver]);

  const handleDeletePath = useCallback(async (path) => {
    if (!workspaceDriver) {
      alert('请先选择项目文件夹');
      return;
    }
    if (!path) return;
    if (!window.confirm(`确认删除 ${path} ?`)) return;
    try {
      if (!workspaceDriver?.setFileOperationsHooks) {
        try { await lspService?.willDeleteFiles?.([path]); } catch {}
      }
      await workspaceDriver.deletePath(path);
      if (!workspaceDriver?.setFileOperationsHooks) {
        try { await lspService?.didDeleteFiles?.([path]); } catch {}
      }
      notifyBus('workspace/didDeleteFiles', { paths: [path], source: 'ui' });
      await syncWorkspaceFromDisk?.({ includeContent: true, highlight: false });
      setWorkspaceState?.((prevRaw) => {
        const prev = syncLegacyTabsFromGroups(prevRaw);
        const { groups, activeGroupId } = ensureEditorGroups(prev);
        let nextGroups = groups.map((g) => {
          const openTabs = (g.openTabs || []).filter((t) => t !== path);
          const activeFile = g.activeFile === path ? (openTabs[openTabs.length - 1] || '') : g.activeFile;
          const previewTab = g.previewTab === path ? '' : g.previewTab;
          return { ...g, openTabs, activeFile, previewTab };
        });
        if (nextGroups.length > 1) nextGroups = nextGroups.filter((g) => g.openTabs.length > 0);
        const nextActiveGroupId = nextGroups.some((g) => g.id === activeGroupId) ? activeGroupId : (nextGroups[0]?.id || 'group-1');

        const tabMeta = prev.tabMeta && typeof prev.tabMeta === 'object' ? prev.tabMeta : {};
        const nextTabMeta = { ...tabMeta };
        Object.keys(nextTabMeta).forEach((k) => {
          if (k.endsWith(`::${path}`)) delete nextTabMeta[k];
        });

        return syncLegacyTabsFromGroups({
          ...prev,
          files: (prev.files || []).filter((f) => f.path !== path),
          editorGroups: nextGroups,
          activeGroupId: nextActiveGroupId,
          tabMeta: nextTabMeta,
        });
      });
    } catch {
    }
  }, [ensureEditorGroups, lspService, setWorkspaceState, syncLegacyTabsFromGroups, syncWorkspaceFromDisk, workspaceDriver]);

  const handleRenamePath = useCallback(async (oldPath, nextPathInput = null) => {
    if (!workspaceDriver) {
      alert('请先选择项目文件夹');
      return;
    }
    if (nextPathInput) {
      try {
        if (!workspaceDriver?.setFileOperationsHooks) {
          try { await lspService?.willRenameFiles?.([{ from: oldPath, to: nextPathInput }]); } catch {}
        }
        await workspaceDriver.renamePath(oldPath, nextPathInput);
        if (!workspaceDriver?.setFileOperationsHooks) {
          try { await lspService?.didRenameFiles?.([{ from: oldPath, to: nextPathInput }]); } catch {}
        }
        notifyBus('workspace/didRenameFiles', { files: [{ from: oldPath, to: nextPathInput }], source: 'ui' });
        await syncWorkspaceFromDisk?.({ includeContent: true, highlight: true });
      } catch {
      }
      return;
    }

    setInputModal?.({
      isOpen: true,
      title: '重命名',
      label: '输入新的相对路径',
      defaultValue: oldPath,
      placeholder: oldPath,
      confirmText: '重命名',
      icon: 'codicon-edit',
      onConfirm: async (nextPath) => {
        if (!nextPath || nextPath === oldPath) {
          setInputModal?.((prev) => ({ ...prev, isOpen: false }));
          return;
        }
        try {
          if (!workspaceDriver?.setFileOperationsHooks) {
            try { await lspService?.willRenameFiles?.([{ from: oldPath, to: nextPath }]); } catch {}
          }
          await workspaceDriver.renamePath(oldPath, nextPath);
          if (!workspaceDriver?.setFileOperationsHooks) {
            try { await lspService?.didRenameFiles?.([{ from: oldPath, to: nextPath }]); } catch {}
          }
          notifyBus('workspace/didRenameFiles', { files: [{ from: oldPath, to: nextPath }], source: 'ui' });
          await syncWorkspaceFromDisk?.({ includeContent: true, highlight: true });
        } catch {
        }
        setInputModal?.((prev) => ({ ...prev, isOpen: false }));
      },
      onClose: () => setInputModal?.((prev) => ({ ...prev, isOpen: false })),
    });
  }, [lspService, setInputModal, syncWorkspaceFromDisk, workspaceDriver]);

  const applyWorkspaceEditCreateFile = useCallback(async (path, meta = {}) => {
    const relPath = String(path || '').trim();
    if (!workspaceDriver || !relPath) return false;
    const options = meta?.options && typeof meta.options === 'object' ? meta.options : {};
    const ignoreIfExists = options?.ignoreIfExists === true || options?.ignore_if_exists === true;
    const overwrite = options?.overwrite === true;
    if (ignoreIfExists || !overwrite) {
      try {
        const existing = await workspaceDriver.readFile(relPath, { allowMissing: true });
        if (existing?.exists !== false) return true;
      } catch {
      }
    }
    const initial = typeof meta?.initialContent === 'string'
      ? meta.initialContent
      : (typeof meta?.content === 'string' ? meta.content : '');
    await workspaceDriver.writeFile(relPath, initial, { createDirectories: true, notifyCreate: false });
    notifyBus('workspace/didCreateFiles', { paths: [relPath], source: 'lsp' });
    setWorkspaceState?.((prevRaw) => {
      const prev = syncLegacyTabsFromGroups(prevRaw);
      const prevFiles = Array.isArray(prev.files) ? prev.files : [];
      const hasEntry = prevFiles.some((f) => f && f.path === relPath);
      const nextFiles = hasEntry
        ? prevFiles
        : [...prevFiles, { path: relPath, content: initial, truncated: false, updated: false, dirty: false }];
      return syncLegacyTabsFromGroups({ ...prev, files: nextFiles });
    });
    setWorkspaceBindingStatus?.('ready');
    return true;
  }, [setWorkspaceBindingStatus, setWorkspaceState, syncLegacyTabsFromGroups, workspaceDriver]);

  const applyWorkspaceEditReadFile = useCallback(async (path) => {
    const relPath = String(path || '').trim();
    if (!workspaceDriver || !relPath) return { exists: false, content: '' };
    const res = await workspaceDriver.readFile(relPath, { allowMissing: true });
    const exists = res?.exists !== false;
    return { exists, content: String(res?.content ?? '') };
  }, [workspaceDriver]);

  const applyWorkspaceEditWriteFile = useCallback(async (path, content) => {
    const relPath = String(path || '').trim();
    if (!workspaceDriver || !relPath) return false;
    const nextContent = String(content ?? '');
    await workspaceDriver.writeFile(relPath, nextContent, { createDirectories: true, notifyCreate: false });
    setWorkspaceState?.((prevRaw) => {
      const prev = syncLegacyTabsFromGroups(prevRaw);
      const prevFiles = Array.isArray(prev.files) ? prev.files : [];
      const hasEntry = prevFiles.some((f) => f && f.path === relPath);
      const nextFiles = hasEntry
        ? prevFiles.map((f) => (f && f.path === relPath ? { ...f, content: nextContent, dirty: false } : f))
        : [...prevFiles, { path: relPath, content: nextContent, truncated: false, updated: false, dirty: false }];
      return syncLegacyTabsFromGroups({ ...prev, files: nextFiles });
    });
    setWorkspaceBindingStatus?.('ready');
    return true;
  }, [setWorkspaceBindingStatus, setWorkspaceState, syncLegacyTabsFromGroups, workspaceDriver]);

  const applyWorkspaceEditRenamePath = useCallback(async (oldPath, nextPath) => {
    const from = String(oldPath || '').trim();
    const to = String(nextPath || '').trim();
    if (!workspaceDriver || !from || !to || from === to) return false;
    let content = '';
    try {
      const data = await workspaceDriver.readFile(from, { allowMissing: true });
      if (data?.exists !== false) content = String(data?.content ?? '');
    } catch {
    }

    await workspaceDriver.writeFile(to, content, { createDirectories: true, notifyCreate: false });
    try {
      await workspaceDriver.deletePath(from, { notify: false });
    } catch {
      await workspaceDriver.deletePath(from);
    }
    notifyBus('workspace/didRenameFiles', { files: [{ from, to }], source: 'lsp' });

    setWorkspaceState?.((prevRaw) => {
      const prev = syncLegacyTabsFromGroups(prevRaw);
      const prevFiles = Array.isArray(prev.files) ? prev.files : [];
      const existing = prevFiles.find((f) => f && f.path === from) || null;
      const nextFiles = existing
        ? prevFiles.map((f) => (f && f.path === from ? { ...f, path: to } : f))
        : [...prevFiles, { path: to, content, truncated: false, updated: false, dirty: false }];

      const { groups, activeGroupId } = ensureEditorGroups(prev);
      const nextGroups = groups.map((g) => {
        const openTabs = (g.openTabs || []).map((t) => (t === from ? to : t));
        const activeFile = g.activeFile === from ? to : g.activeFile;
        const previewTab = g.previewTab === from ? to : g.previewTab;
        return { ...g, openTabs, activeFile, previewTab };
      });
      const nextActiveGroupId = nextGroups.some((g) => g.id === activeGroupId) ? activeGroupId : (nextGroups[0]?.id || 'group-1');

      const tabMeta = prev.tabMeta && typeof prev.tabMeta === 'object' ? prev.tabMeta : {};
      const nextTabMeta = { ...tabMeta };
      Object.keys(nextTabMeta).forEach((k) => {
        if (!k.endsWith(`::${from}`)) return;
        const v = nextTabMeta[k];
        delete nextTabMeta[k];
        const nk = k.replace(`::${from}`, `::${to}`);
        nextTabMeta[nk] = v;
      });

      const nextHistory = Array.isArray(prev.tabHistory)
        ? prev.tabHistory.map((p) => (p === from ? to : p))
        : prev.tabHistory;

      return syncLegacyTabsFromGroups({
        ...prev,
        files: nextFiles,
        editorGroups: nextGroups,
        activeGroupId: nextActiveGroupId,
        tabMeta: nextTabMeta,
        tabHistory: nextHistory,
      });
    });

    return true;
  }, [ensureEditorGroups, setWorkspaceState, syncLegacyTabsFromGroups, workspaceDriver]);

  const applyWorkspaceEditDeletePath = useCallback(async (path) => {
    const relPath = String(path || '').trim();
    if (!workspaceDriver || !relPath) return false;
    try {
      await workspaceDriver.deletePath(relPath, { notify: false });
    } catch {
      await workspaceDriver.deletePath(relPath);
    }
    notifyBus('workspace/didDeleteFiles', { paths: [relPath], source: 'lsp' });
    setWorkspaceState?.((prevRaw) => {
      const prev = syncLegacyTabsFromGroups(prevRaw);
      const { groups, activeGroupId } = ensureEditorGroups(prev);
      let nextGroups = groups.map((g) => {
        const openTabs = (g.openTabs || []).filter((t) => t !== relPath);
        const activeFile = g.activeFile === relPath ? (openTabs[openTabs.length - 1] || '') : g.activeFile;
        const previewTab = g.previewTab === relPath ? '' : g.previewTab;
        return { ...g, openTabs, activeFile, previewTab };
      });
      if (nextGroups.length > 1) nextGroups = nextGroups.filter((g) => g.openTabs.length > 0);
      const nextActiveGroupId = nextGroups.some((g) => g.id === activeGroupId) ? activeGroupId : (nextGroups[0]?.id || 'group-1');

      const tabMeta = prev.tabMeta && typeof prev.tabMeta === 'object' ? prev.tabMeta : {};
      const nextTabMeta = { ...tabMeta };
      Object.keys(nextTabMeta).forEach((k) => {
        if (k.endsWith(`::${relPath}`)) delete nextTabMeta[k];
      });

      const nextHistory = Array.isArray(prev.tabHistory)
        ? prev.tabHistory.filter((p) => p !== relPath)
        : prev.tabHistory;

      return syncLegacyTabsFromGroups({
        ...prev,
        files: (prev.files || []).filter((f) => f.path !== relPath),
        editorGroups: nextGroups,
        activeGroupId: nextActiveGroupId,
        tabMeta: nextTabMeta,
        tabHistory: nextHistory,
      });
    });
    return true;
  }, [ensureEditorGroups, setWorkspaceState, syncLegacyTabsFromGroups, workspaceDriver]);

  return {
    handleAddFile,
    handleAddFolder,
    handleDeletePath,
    handleRenamePath,
    applyWorkspaceEditCreateFile,
    applyWorkspaceEditReadFile,
    applyWorkspaceEditWriteFile,
    applyWorkspaceEditRenamePath,
    applyWorkspaceEditDeletePath,
  };
}
