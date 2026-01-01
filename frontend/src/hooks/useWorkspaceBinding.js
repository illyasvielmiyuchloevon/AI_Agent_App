import { useCallback, useEffect, useRef } from 'react';
import { isAbsolutePath } from '../utils/appAlgorithms';

export function useWorkspaceBinding({
  lspService = null,
  getProjectConfigLsp,
  workspaceBindingStatus = 'idle',
  backendWorkspaceId = '',
  backendWorkspaceRoot = '',
  setWorkspaceBindingStatus,
  setWorkspaceBindingError,
  setBackendWorkspaceRoot,
  setBackendWorkspaceId,
  config = null,
  toolSettings = null,
  getBackendConfig = null,
  setProjectConfig = null,
} = {}) {
  const backendWorkspaceRootRef = useRef('');

  useEffect(() => {
    backendWorkspaceRootRef.current = String(backendWorkspaceRoot || '');
  }, [backendWorkspaceRoot]);

  useEffect(() => {
    if (!workspaceBindingStatus || workspaceBindingStatus !== 'ready') return;
    const lspCfg = typeof getProjectConfigLsp === 'function' ? getProjectConfigLsp() : null;
    const wid = String(backendWorkspaceId || '').trim();
    if (!wid) return;
    if (!backendWorkspaceRoot) return;
    try {
      lspService?.updateWorkspace?.({
        nextWorkspaceId: wid,
        nextRootFsPath: backendWorkspaceRoot,
        nextWorkspaceFolders: [backendWorkspaceRoot],
      });
    } catch {
    }
    try {
      void lspService?.didChangeConfiguration?.(lspCfg || {}).catch?.(() => {});
    } catch {
    }
  }, [backendWorkspaceId, backendWorkspaceRoot, getProjectConfigLsp, lspService, workspaceBindingStatus]);

  const resolveApiUrl = useCallback((url) => {
    if (typeof window === 'undefined') return url;
    if (typeof url !== 'string') return url;
    if (!url.startsWith('/api/')) return url;
    const proto = window.location?.protocol;
    const origin = window.location?.origin;
    if (proto === 'file:' || origin === 'null') {
      return `http://127.0.0.1:8000${url.replace(/^\/api/, '')}`;
    }
    return url;
  }, []);

  const openBackendWorkspace = useCallback(async (workspaceOrRoot, { silent = false } = {}) => {
    const descriptor = workspaceOrRoot && typeof workspaceOrRoot === 'object' ? workspaceOrRoot : null;
    const rootPath = descriptor && Array.isArray(descriptor.folders) && descriptor.folders[0] && typeof descriptor.folders[0].path === 'string'
      ? descriptor.folders[0].path
      : workspaceOrRoot;
    const trimmed = (rootPath || '').trim();
    if (!trimmed) {
      setBackendWorkspaceRoot?.('');
      setBackendWorkspaceId?.('');
      try {
        if (typeof window !== 'undefined') {
          window.__NODE_AGENT_WORKSPACE_ID__ = '';
          window.__NODE_AGENT_WORKSPACE_ROOT__ = '';
        }
      } catch {}
      if (typeof setProjectConfig === 'function') {
        setProjectConfig((cfg) => ({ ...cfg, backendRoot: '' }));
      }
      return;
    }
    if (!isAbsolutePath(trimmed)) {
      const message = '请填写 Workspace 的绝对路径，例如 H:\\\\04';
      setWorkspaceBindingStatus?.('error');
      setWorkspaceBindingError?.(message);
      setBackendWorkspaceRoot?.('');
      setBackendWorkspaceId?.('');
      try {
        if (typeof window !== 'undefined') {
          window.__NODE_AGENT_WORKSPACE_ID__ = '';
          window.__NODE_AGENT_WORKSPACE_ROOT__ = '';
        }
      } catch {}
      if (typeof setProjectConfig === 'function') {
        setProjectConfig((cfg) => ({ ...cfg, backendRoot: '' }));
      }
      if (!silent) {
        console.warn(message);
      }
      return;
    }
    try {
      setWorkspaceBindingStatus?.('checking');
      const abort = new AbortController();
      let timeoutId = null;
      try {
        timeoutId = setTimeout(() => abort.abort(), 15000);
        const provider = config?.provider || '';
        const model = (provider && config && config[provider] && config[provider].model) ? config[provider].model : '';
        const llmConfig = typeof getBackendConfig === 'function' ? getBackendConfig() : {};
        const res = await fetch(resolveApiUrl('/api/workspace/bind-root'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Workspace-Root': trimmed },
          body: JSON.stringify({
            root: trimmed,
            settings: {
              provider,
              model: model || '',
              llmConfig,
              toolSettings,
            },
          }),
          signal: abort.signal,
        });
        let data = {};
        try {
          data = await res.json();
        } catch {
          data = {};
        }
        if (!res.ok) {
          throw new Error(data.detail || res.statusText || '打开 Workspace 失败');
        }
        const applied = data.root || trimmed;
        const workspaceId = typeof data.workspace_id === 'string' ? data.workspace_id.trim() : '';
        setBackendWorkspaceId?.(workspaceId);
        setBackendWorkspaceRoot?.(applied);
        try {
          if (typeof window !== 'undefined') {
            window.__NODE_AGENT_WORKSPACE_ID__ = workspaceId;
            window.__NODE_AGENT_WORKSPACE_ROOT__ = applied;
          }
        } catch {}
        if (typeof setProjectConfig === 'function') {
          setProjectConfig((cfg) => ({
            ...cfg,
            backendRoot: applied,
            projectPath: cfg.projectPath || applied,
            workspaceId: workspaceId || cfg.workspaceId || '',
          }));
        }
        setWorkspaceBindingError?.('');
        setWorkspaceBindingStatus?.('ready');
        return { descriptor: descriptor || (data.workspace || null) || null, workspaceId, root: applied };
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    } catch (err) {
      console.error('Bind backend workspace failed', err);
      setBackendWorkspaceId?.('');
      try {
        if (typeof window !== 'undefined') {
          window.__NODE_AGENT_WORKSPACE_ID__ = '';
        }
      } catch {}
      setWorkspaceBindingStatus?.('error');
      const isAbort = err?.name === 'AbortError';
      setWorkspaceBindingError?.(isAbort ? '打开 Workspace 超时：请确认后端服务已启动' : (err?.message || '打开 Workspace 失败'));
      if (!silent) {
        console.warn(`打开 Workspace 失败：${err.message || err}`);
      }
    }
  }, [
    config,
    getBackendConfig,
    resolveApiUrl,
    setBackendWorkspaceId,
    setBackendWorkspaceRoot,
    setProjectConfig,
    setWorkspaceBindingError,
    setWorkspaceBindingStatus,
    toolSettings,
  ]);

  return { backendWorkspaceRootRef, openBackendWorkspace };
}

