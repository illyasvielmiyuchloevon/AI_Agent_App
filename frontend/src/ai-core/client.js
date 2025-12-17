export function createAICoreClient(projectFetch) {
  const fetcher = projectFetch || ((url, options) => fetch(url, options));

  const request = async (url, options = {}) => {
    const res = await fetcher(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      throw new Error(detail.detail || res.statusText);
    }
    return res.json();
  };

  return {
    async listProviders() {
      return request('/api/ai/providers');
    },
    async upsertProvider(payload) {
      return request('/api/ai/providers', { method: 'POST', body: JSON.stringify(payload) });
    },
    async testProvider(id) {
      return request(`/api/ai/providers/${encodeURIComponent(id)}/test`, { method: 'POST' });
    },
    async getSettings() {
      return request('/api/ai/settings');
    },
    async updateDefaults(defaults, workspaceId) {
      return request('/api/ai/settings', { method: 'POST', body: JSON.stringify({ defaults, workspaceId }) });
    },
    async listModels() {
      return request('/api/ai/models');
    },
    async runEditorAction(action, payload = {}) {
      return request('/api/ai/editor-action', { method: 'POST', body: JSON.stringify({ action, capability: 'editorAction', ...payload }) });
    },
  };
}
