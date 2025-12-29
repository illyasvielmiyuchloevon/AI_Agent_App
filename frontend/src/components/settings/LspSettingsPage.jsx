import React, { useEffect, useMemo, useState } from 'react';
import SectionCard from './SectionCard';
import SettingRow from './SettingRow';
import Switch from './Switch';
import { pluginsService } from '../../workbench/services/pluginsService';

const DEFAULT_PROVIDERS = ['official', 'github', 'openvsx'];

const safeStringify = (obj) => {
  try { return JSON.stringify(obj ?? {}, null, 2); } catch { return '{}'; }
};

const safeParse = (text) => {
  try {
    const v = JSON.parse(String(text || ''));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
};

export default function LspSettingsPage({
  lspConfig,
  onChangeLspConfig,
  language = 'zh',
}) {
  const [activeTab, setActiveTab] = useState('discover'); // discover | installed | updates | errors | config
  const [providerIds, setProviderIds] = useState(DEFAULT_PROVIDERS);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchItems, setSearchItems] = useState([]);
  const [installingIds, setInstallingIds] = useState(() => new Set());

  const [installedItems, setInstalledItems] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [lastProgress, setLastProgress] = useState(null);
  const [lastError, setLastError] = useState(null);

  const [configText, setConfigText] = useState(() => safeStringify(lspConfig));
  const [configError, setConfigError] = useState('');

  const t = (zh, en) => (language === 'zh' ? zh : en);

  useEffect(() => {
    setConfigText(safeStringify(lspConfig));
  }, [lspConfig]);

  useEffect(() => {
    if (!pluginsService.isAvailable()) return () => {};
    const unsub = pluginsService.subscribe((snap) => {
      setInstalledItems(Array.isArray(snap?.installed) ? snap.installed : []);
      setLastProgress(snap?.lastProgress || null);
      setLastError(snap?.lastError || null);
    });
    void pluginsService.listInstalled().catch(() => {});
    void pluginsService.listUpdates().then((res) => setUpdates(res?.items || [])).catch(() => {});
    return () => unsub?.();
  }, []);

  const languages = useMemo(() => {
    const set = new Set();
    for (const it of installedItems) {
      for (const l of Array.isArray(it?.languages) ? it.languages : []) set.add(String(l));
    }
    for (const l of ['typescript', 'javascript', 'python', 'rust', 'json']) set.add(l);
    return Array.from(set).filter(Boolean).sort();
  }, [installedItems]);

  const clientCfg = useMemo(() => {
    const root = (lspConfig && typeof lspConfig === 'object') ? lspConfig : {};
    const client = (root._client && typeof root._client === 'object') ? root._client : {};
    const mapping = (client.languagePlugins && typeof client.languagePlugins === 'object') ? client.languagePlugins : {};
    return { root, client, mapping };
  }, [lspConfig]);

  const setLanguagePlugin = (languageId, pluginId) => {
    const root = clientCfg.root || {};
    const client = clientCfg.client || {};
    const mapping = { ...(client.languagePlugins || {}) };
    const lang = String(languageId || '').trim();
    const pid = String(pluginId || '').trim();
    if (!lang) return;
    if (!pid) delete mapping[lang];
    else mapping[lang] = pid;
    onChangeLspConfig?.({ ...root, _client: { ...client, languagePlugins: mapping } });
  };

  const doSearch = async () => {
    if (!pluginsService.isAvailable()) return;
    setSearching(true);
    setSearchItems([]);
    try {
      const res = await pluginsService.search(query, providerIds);
      setSearchItems(Array.isArray(res?.items) ? res.items : []);
    } catch (err) {
      setLastError({ message: err?.message || String(err) });
    } finally {
      setSearching(false);
    }
  };

  const installPlugin = async (item) => {
    const pid = String(item?.id || '');
    const providerId = String(item?.source?.providerId || item?.providerId || '');
    if (!pid || !providerId) return;
    setInstallingIds((prev) => {
      const next = new Set(prev);
      next.add(pid);
      return next;
    });
    try {
      await pluginsService.install({ providerId, id: pid, version: item?.version || '' });
      if (String(item?.trust || '') === 'official') {
        await pluginsService.enable(pid).catch(() => {});
      }
      await pluginsService.listInstalled().catch(() => {});
    } catch (err) {
      setLastError({ message: err?.message || String(err) });
    } finally {
      setInstallingIds((prev) => {
        const next = new Set(prev);
        next.delete(pid);
        return next;
      });
    }
  };

  const enablePlugin = async (it) => {
    const id = String(it?.id || '');
    const trust = String(it?.trust || '');
    if (!id) return;
    if (trust !== 'official') {
      const ok = globalThis.confirm?.(t(
        `启用 ${trust} 插件需要信任确认：${id}\n\n将允许 IDE 在本机启动该插件声明的命令。继续？`,
        `Enabling a ${trust} plugin requires trust confirmation: ${id}\n\nThis allows the IDE to spawn commands declared by the plugin. Continue?`,
      ));
      if (!ok) return;
      await pluginsService.enable(id, trust).catch((err) => setLastError({ message: err?.message || String(err) }));
    } else {
      await pluginsService.enable(id).catch((err) => setLastError({ message: err?.message || String(err) }));
    }
    await pluginsService.listInstalled().catch(() => {});
  };

  const disablePlugin = async (it) => {
    const id = String(it?.id || '');
    if (!id) return;
    await pluginsService.disable(id).catch((err) => setLastError({ message: err?.message || String(err) }));
    await pluginsService.listInstalled().catch(() => {});
  };

  const uninstallPlugin = async (it) => {
    const id = String(it?.id || '');
    if (!id) return;
    const ok = globalThis.confirm?.(t(`卸载插件：${id}？`, `Uninstall plugin: ${id}?`));
    if (!ok) return;
    await pluginsService.uninstall(id).catch((err) => setLastError({ message: err?.message || String(err) }));
    await pluginsService.listInstalled().catch(() => {});
  };

  const renderTabs = () => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
      {[
        { id: 'discover', label: t('发现', 'Discover') },
        { id: 'installed', label: t('已安装', 'Installed') },
        { id: 'updates', label: t('更新', 'Updates') },
        { id: 'errors', label: t('错误', 'Errors') },
        { id: 'config', label: t('配置', 'Config') },
      ].map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={activeTab === tab.id ? 'primary-btn' : 'ghost-btn'}
          style={{ height: 32, padding: '0 10px', fontSize: '0.86rem' }}
          onClick={() => setActiveTab(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  const renderDiscover = () => (
    <>
      <div className="settings-group-title">{t('Marketplace', 'Marketplace')}</div>
      <SectionCard>
        <SettingRow title={t('搜索', 'Search')} description={t('从多个来源搜索语言插件。', 'Search language plugins across providers.')}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
            <input
              type="text"
              className="settings-control"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('例如：tsls / pyright / rust-analyzer', 'e.g. tsls / pyright / rust-analyzer')}
              style={{ flex: 1 }}
            />
            <button type="button" className="primary-btn" style={{ height: 34 }} onClick={doSearch} disabled={searching}>
              {searching ? t('搜索中…', 'Searching…') : t('搜索', 'Search')}
            </button>
          </div>
        </SettingRow>

        <SettingRow title={t('来源', 'Providers')} description={t('选择启用的 Marketplace Provider。', 'Select enabled marketplace providers.')}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {DEFAULT_PROVIDERS.map((p) => (
              <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={providerIds.includes(p)}
                  onChange={(e) => {
                    const next = new Set(providerIds);
                    if (e.target.checked) next.add(p);
                    else next.delete(p);
                    setProviderIds(Array.from(next));
                  }}
                />
                <span style={{ fontSize: '0.92rem' }}>{p}</span>
              </label>
            ))}
          </div>
        </SettingRow>
      </SectionCard>

      <div className="settings-group-title">{t('结果', 'Results')}</div>
      <SectionCard>
        <div style={{ padding: '12px 16px' }}>
        {lastError?.message ? (
          <div style={{ marginBottom: 10, color: '#f48771', whiteSpace: 'pre-wrap' }}>
            {String(lastError.message)}
          </div>
        ) : null}
        {lastProgress ? (
          <div style={{ marginBottom: 10, opacity: 0.9, fontSize: '0.86rem', whiteSpace: 'pre-wrap' }}>
            {t('进度：', 'Progress: ')}{String(lastProgress?.stage || '')}
            {lastProgress?.pluginId ? ` • ${lastProgress.pluginId}` : ''}
            {Number.isFinite(lastProgress?.loadedBytes) ? ` • ${Math.round(lastProgress.loadedBytes / 1024)} KB` : ''}
            {Number.isFinite(lastProgress?.totalBytes) && lastProgress.totalBytes > 0 ? ` / ${Math.round(lastProgress.totalBytes / 1024)} KB` : ''}
          </div>
        ) : null}
        {!pluginsService.isAvailable() ? (
          <div style={{ opacity: 0.8 }}>{t('当前环境不可用（需要 Electron preload 暴露 plugins API）。', 'Not available in this environment (Electron preload plugins API required).')}</div>
        ) : searchItems.length === 0 ? (
          <div style={{ opacity: 0.8 }}>{t('暂无结果。', 'No results.')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {searchItems.slice(0, 30).map((it) => (
              <div
                key={`${it?.source?.providerId || 'p'}:${it?.id || ''}:${it?.version || ''}`}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{String(it?.name || it?.id || '')}</div>
                  <div style={{ opacity: 0.8, fontSize: '0.86rem', overflowWrap: 'anywhere' }}>
                    {String(it?.id || '')} {it?.version ? `• ${it.version}` : ''} {it?.source?.providerId ? `• ${it.source.providerId}` : ''}
                  </div>
                  {it?.description ? <div style={{ opacity: 0.85, fontSize: '0.9rem', overflowWrap: 'anywhere' }}>{String(it.description)}</div> : null}
                </div>
                <button
                  type="button"
                  className="primary-btn"
                  style={{ height: 34, flex: '0 0 auto' }}
                  onClick={() => installPlugin(it)}
                  disabled={installingIds.has(String(it?.id || ''))}
                >
                  {installingIds.has(String(it?.id || '')) ? t('安装中…', 'Installing…') : t('安装', 'Install')}
                </button>
              </div>
            ))}
          </div>
        )}
        </div>
      </SectionCard>
    </>
  );

  const renderInstalled = () => (
    <>
      <div className="settings-group-title">{t('已安装插件', 'Installed Plugins')}</div>
      <SectionCard>
        {!pluginsService.isAvailable() ? (
          <div style={{ opacity: 0.8 }}>{t('当前环境不可用。', 'Not available in this environment.')}</div>
        ) : installedItems.length === 0 ? (
          <div style={{ opacity: 0.8 }}>{t('暂无已安装插件。', 'No installed plugins.')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {installedItems.map((it) => (
              <div key={String(it?.id || '')} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{String(it?.name || it?.id || '')}</div>
                  <div style={{ opacity: 0.8, fontSize: '0.86rem' }}>
                    {String(it?.id || '')}
                    {it?.installedVersion ? ` • ${it.installedVersion}` : ''}
                    {it?.trust ? ` • ${it.trust}` : ''}
                    {it?.metadataOnly ? ` • ${t('仅元数据', 'metadata-only')}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Switch
                    checked={!!it?.enabled}
                    onChange={() => (it?.enabled ? disablePlugin(it) : enablePlugin(it))}
                    label={it?.enabled ? t('启用', 'Enabled') : t('禁用', 'Disabled')}
                  />
                  <button type="button" className="ghost-btn" style={{ height: 34 }} onClick={() => uninstallPlugin(it)}>
                    {t('卸载', 'Uninstall')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
      {lastProgress ? (
        <>
          <div className="settings-group-title">{t('安装进度', 'Progress')}</div>
          <SectionCard>
            <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.86rem', whiteSpace: 'pre-wrap' }}>
              {safeStringify(lastProgress)}
            </div>
          </SectionCard>
        </>
      ) : null}
    </>
  );

  const renderUpdates = () => (
    <>
      <div className="settings-group-title">{t('可更新', 'Updates')}</div>
      <SectionCard>
        {updates.length === 0 ? (
          <div style={{ opacity: 0.8 }}>{t('暂无可更新项。', 'No updates.')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {updates.map((u) => (
              <div key={`${u.id}:${u.latest}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{u.id}</div>
                  <div style={{ opacity: 0.8, fontSize: '0.86rem' }}>{u.current} → {u.latest} • {u.providerId}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </>
  );

  const renderErrors = () => (
    <>
      <div className="settings-group-title">{t('错误', 'Errors')}</div>
      <SectionCard>
        {lastError ? (
          <div style={{ color: '#f48771', whiteSpace: 'pre-wrap' }}>{String(lastError?.message || safeStringify(lastError))}</div>
        ) : (
          <div style={{ opacity: 0.8 }}>{t('暂无错误。', 'No errors.')}</div>
        )}
      </SectionCard>
    </>
  );

  const renderConfig = () => (
    <>
      <div className="settings-group-title">{t('路由（语言 → 插件）', 'Routing (language → plugin)')}</div>
      <SectionCard>
        {languages.map((lang) => (
          <SettingRow
            key={lang}
            title={lang}
            description={t('选择该语言默认使用的插件（不选则自动）。', 'Choose default plugin for this language (empty = auto).')}
          >
            <select
              className="settings-control compact"
              value={String(clientCfg.mapping?.[lang] || '')}
              onChange={(e) => setLanguagePlugin(lang, e.target.value)}
            >
              <option value="">{t('自动', 'Auto')}</option>
              {installedItems
                .filter((p) => !p?.metadataOnly)
                .map((p) => (
                  <option key={p.id} value={p.id}>{p.name || p.id}</option>
                ))}
            </select>
          </SettingRow>
        ))}
      </SectionCard>

      <div className="settings-group-title">{t('LSP 配置 JSON', 'LSP Config JSON')}</div>
      <SectionCard>
        <SettingRow
          title={t('配置', 'Config')}
          description={t('该对象会通过 workspace/didChangeConfiguration 和 workspace/configuration 提供给语言服务器（包含保留字段 _client）。', 'This object is sent to language servers via workspace/didChangeConfiguration and workspace/configuration (includes reserved _client).')}
        >
          <textarea
            className="settings-control"
            style={{ minHeight: 180, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
            value={configText}
            onChange={(e) => {
              const nextText = e.target.value;
              setConfigText(nextText);
              const parsed = safeParse(nextText);
              if (!parsed) {
                setConfigError(t('JSON 解析失败', 'JSON parse failed'));
                return;
              }
              setConfigError('');
              onChangeLspConfig?.(parsed);
            }}
          />
        </SettingRow>
        {configError ? <div style={{ marginTop: 8, color: '#f48771' }}>{configError}</div> : null}
      </SectionCard>
    </>
  );

  return (
    <>
      <h1 className="settings-page-title">{t('LSP / 语言插件', 'LSP / Language Plugins')}</h1>
      <p className="settings-page-intro">{t('管理语言服务器插件，并配置工作区的 LSP 设置。', 'Manage language server plugins and configure workspace LSP settings.')}</p>
      {renderTabs()}
      {activeTab === 'discover'
        ? renderDiscover()
        : activeTab === 'installed'
          ? renderInstalled()
          : activeTab === 'updates'
            ? renderUpdates()
            : activeTab === 'errors'
              ? renderErrors()
              : renderConfig()}
    </>
  );
}
