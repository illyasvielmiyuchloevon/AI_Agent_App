import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { createAICoreClient } from './client';

const AICoreContext = createContext(null);

export function AICoreProvider({ projectFetch, children }) {
  const client = useMemo(() => createAICoreClient(projectFetch), [projectFetch]);
  const [settings, setSettings] = useState(null);
  const [providers, setProviders] = useState([]);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prov, setts, modelPayload] = await Promise.all([
        client.listProviders(),
        client.getSettings(),
        client.listModels()
      ]);
      setProviders(prov || []);
      setSettings(setts);
      setModels(modelPayload?.models || []);
    } catch (err) {
      setError(err.message || '加载 AI Core 失败');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { refresh(); }, [refresh]);

  const value = useMemo(() => ({
    client,
    settings,
    providers,
    models,
    loading,
    error,
    refresh,
    async upsertProvider(payload) {
      const result = await client.upsertProvider(payload);
      await refresh();
      return result;
    },
    async testProvider(id) {
      return client.testProvider(id);
    },
    async updateDefaults(defaults, workspaceId) {
      const res = await client.updateDefaults(defaults, workspaceId);
      setSettings(res);
      return res;
    },
    async runEditorAction(action, payload) {
      return client.runEditorAction(action, payload);
    }
  }), [client, settings, providers, models, loading, error, refresh]);

  return <AICoreContext.Provider value={value}>{children}</AICoreContext.Provider>;
}

export function useAICore() {
  const ctx = useContext(AICoreContext);
  if (!ctx) throw new Error('useAICore must be used within AICoreProvider');
  return ctx;
}
