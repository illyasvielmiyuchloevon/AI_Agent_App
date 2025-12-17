import React, { useMemo, useState } from 'react';
import { useAICore } from '../ai-core/AICoreProvider.jsx';

const CAPABILITIES = [
  { key: 'chat', label: 'Chat' },
  { key: 'inline', label: 'Inline' },
  { key: 'editorAction', label: 'Editor Actions' },
  { key: 'tools', label: 'Tools / Functions' },
  { key: 'embeddings', label: 'Embeddings' },
];

const PROVIDER_TYPES = [
  { key: 'openai', label: 'OpenAI / compatible' },
  { key: 'anthropic', label: 'Anthropic' },
  { key: 'openrouter', label: 'OpenRouter' },
  { key: 'xai', label: 'xAI' },
  { key: 'ollama', label: 'Ollama' },
  { key: 'lmstudio', label: 'LM Studio' },
];

export default function SettingsEditor() {
  const { providers, models, settings, upsertProvider, updateDefaults, testProvider, loading, error } = useAICore();
  const [editingProvider, setEditingProvider] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const providerById = useMemo(() => Object.fromEntries((providers || []).map((p) => [p.id, p])), [providers]);

  const handleSaveProvider = async () => {
    if (!editingProvider) return;
    setSaving(true);
    setMessage('');
    try {
      const payload = { ...editingProvider };
      await upsertProvider(payload);
      setMessage('Provider saved');
      setEditingProvider(null);
    } catch (err) {
      setMessage(err.message || 'Failed to save provider');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (id) => {
    const res = await testProvider(id);
    setMessage(res.message || (res.ok ? 'Connected' : 'Failed'));
  };

  const handleDefaultChange = async (capability, providerId, model) => {
    const defaults = { [capability]: { providerId, model } };
    await updateDefaults(defaults);
    setMessage('Defaults updated');
  };

  return (
    <div className="settings-editor">
      <div className="settings-grid">
        <section className="settings-card">
          <header>
            <h3>Providers</h3>
            <p className="muted">Configure multiple provider endpoints and API keys.</p>
          </header>
          <div className="provider-list">
            {(providers || []).map((p) => (
              <div key={p.id} className="provider-row">
                <div>
                  <div className="provider-title">{p.displayName || p.id}</div>
                  <div className="muted">{p.provider}</div>
                </div>
                <div className="provider-actions">
                  <button className="ghost-btn" onClick={() => setEditingProvider(p)}>Edit</button>
                  <button className="ghost-btn" onClick={() => handleTest(p.id)}>Test</button>
                </div>
              </div>
            ))}
            <button className="primary-btn" onClick={() => setEditingProvider({ provider: 'openai', id: '', displayName: '' })}>Add Provider</button>
          </div>
          {editingProvider ? (
            <div className="provider-form">
              <div className="settings-field">
                <label>Display name</label>
                <input
                  className="config-input"
                  value={editingProvider.displayName || ''}
                  onChange={(e) => setEditingProvider({ ...editingProvider, displayName: e.target.value })}
                />
              </div>
              <div className="settings-field">
                <label>Provider type</label>
                <select
                  className="config-input"
                  value={editingProvider.provider}
                  onChange={(e) => setEditingProvider({ ...editingProvider, provider: e.target.value })}
                >
                  {PROVIDER_TYPES.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div className="settings-field">
                <label>Base URL</label>
                <input
                  className="config-input"
                  placeholder="https://api.openai.com/v1"
                  value={editingProvider.baseURL || ''}
                  onChange={(e) => setEditingProvider({ ...editingProvider, baseURL: e.target.value })}
                />
              </div>
              <div className="settings-field">
                <label>API Key</label>
                <input
                  className="config-input"
                  placeholder="sk-..."
                  value={editingProvider.apiKey || ''}
                  onChange={(e) => setEditingProvider({ ...editingProvider, apiKey: e.target.value })}
                />
              </div>
              <div className="settings-field">
                <label>Models (comma separated)</label>
                <input
                  className="config-input"
                  placeholder="gpt-4o, gpt-4o-mini"
                  value={(editingProvider.models || []).join(', ')}
                  onChange={(e) => setEditingProvider({ ...editingProvider, models: e.target.value.split(',').map((m) => m.trim()).filter(Boolean) })}
                />
              </div>
              <div className="settings-field">
                <label>Default model</label>
                <input
                  className="config-input"
                  value={editingProvider.defaultModel || ''}
                  onChange={(e) => setEditingProvider({ ...editingProvider, defaultModel: e.target.value })}
                />
              </div>
              <div className="provider-actions" style={{ justifyContent: 'flex-end' }}>
                <button className="ghost-btn" onClick={() => setEditingProvider(null)}>Cancel</button>
                <button className="primary-btn" disabled={saving} onClick={handleSaveProvider}>Save</button>
              </div>
            </div>
          ) : null}
        </section>

        <section className="settings-card">
          <header>
            <h3>Capability routing</h3>
            <p className="muted">Pick a default model per capability. Workspace overrides will arrive in a later iteration.</p>
          </header>
          <table className="settings-table">
            <thead>
              <tr>
                <th>Capability</th>
                <th>Provider</th>
                <th>Model</th>
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((cap) => {
                const current = settings?.defaults?.[cap.key] || {};
                const provider = providerById[current.providerId] || providers?.[0];
                const providerModels = models.filter((m) => m.providerId === provider?.id);
                return (
                  <tr key={cap.key}>
                    <td>{cap.label}</td>
                    <td>
                      <select
                        className="config-input"
                        value={current.providerId || provider?.id || ''}
                        onChange={(e) => handleDefaultChange(cap.key, e.target.value, current.model)}
                      >
                        {(providers || []).map((p) => (
                          <option key={p.id} value={p.id}>{p.displayName || p.id}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="config-input"
                        value={current.model || providerModels[0]?.id || ''}
                        onChange={(e) => handleDefaultChange(cap.key, current.providerId || provider?.id, e.target.value)}
                      >
                        {providerModels.map((m) => (
                          <option key={`${m.providerId}-${m.id}`} value={m.id}>{m.displayName}</option>
                        ))}
                        {!providerModels.length ? (<option value="">No models</option>) : null}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
      <div className="settings-footer">
        {loading ? <span className="muted">Loading AI Core…</span> : null}
        {error ? <span className="error-text">{error}</span> : null}
        {message ? <span className="muted">{message}</span> : null}
      </div>
    </div>
  );
}
