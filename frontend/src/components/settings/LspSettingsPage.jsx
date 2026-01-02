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
  const [searchPageSize] = useState(20);
  const [searchLimit, setSearchLimit] = useState(20);
  const [installingIds, setInstallingIds] = useState(() => new Set());

  const [installedItems, setInstalledItems] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [lastProgress, setLastProgress] = useState(null);
  const [lastError, setLastError] = useState(null);

  const [localVsixPath, setLocalVsixPath] = useState('');
  const [localPluginId, setLocalPluginId] = useState('');
  const [localPluginVersion, setLocalPluginVersion] = useState('local');

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

  const doSearch = async ({ limit = searchPageSize } = {}) => {
    if (!pluginsService.isAvailable()) return;
    setSearching(true);
    setSearchItems([]);
    try {
      const nextLimit = Number.isFinite(limit) ? Math.max(1, Number(limit)) : searchPageSize;
      const res = await pluginsService.search(query, providerIds, { offset: 0, limit: nextLimit });
      const items = Array.isArray(res?.items) ? res.items : [];
      setSearchItems(items);
      setSearchLimit(nextLimit);
    } catch (err) {
      setLastError({ message: err?.message || String(err) });
    } finally {
      setSearching(false);
    }
  };

  const pickLocalVsix = async () => {
    const api = globalThis?.window?.electronAPI?.workspace;
    if (!api?.pickFile) return;
    try {
      const res = await api.pickFile();
      const fsPath = String(res?.fsPath || '').trim();
      if (res?.canceled || !fsPath) return;
      setLocalVsixPath(fsPath);
    } catch (err) {
      setLastError({ message: err?.message || String(err) });
    }
  };

  const inferPluginIdFromPath = (fsPath) => {
    const p = String(fsPath || '');
    const name = p.split(/[\\/]/).filter(Boolean).slice(-1)[0] || '';
    const base = name.replace(/\.vsix$/i, '');
    const cleaned = base.replace(/[^a-zA-Z0-9._@/\\-]/g, '_');
    return cleaned || 'local.plugin';
  };

  const installLocalVsix = async () => {
    if (!pluginsService.isAvailable()) return;
    const filePath = String(localVsixPath || '').trim();
    if (!filePath) return;
    const pid = String(localPluginId || '').trim() || inferPluginIdFromPath(filePath);
    const version = String(localPluginVersion || '').trim() || 'local';
    setInstallingIds((prev) => {
      const next = new Set(prev);
      next.add(pid);
      return next;
    });
    try {
      await pluginsService.install({ providerId: 'local', id: pid, version, filePath });
      await pluginsService.listInstalled().catch(() => {});
      const res = await pluginsService.listUpdates().catch(() => ({ items: [] }));
      setUpdates(Array.isArray(res?.items) ? res.items : []);
      setActiveTab('installed');
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
      const res = await pluginsService.listUpdates().catch(() => ({ items: [] }));
      setUpdates(Array.isArray(res?.items) ? res.items : []);
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
      <div className="settings-group-title">{t('本地安装', 'Local Install')}</div>
      <SectionCard>
        <SettingRow
          title={t('本地 VSIX', 'Local VSIX')}
          description={t('从本机选择 .vsix 安装（需包含 language-plugin.json 才能作为语言插件工作）。', 'Pick a .vsix from disk to install (needs language-plugin.json to work as a language plugin).')}
        >
          {!pluginsService.isAvailable() ? (
            <div style={{ opacity: 0.8 }}>{t('当前环境不可用。', 'Not available in this environment.')}</div>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', flexWrap: 'wrap' }}>
              <input
                type="text"
                className="settings-control"
                value={localVsixPath}
                placeholder={t('选择一个 .vsix 文件…', 'Choose a .vsix file…')}
                readOnly
                style={{ flex: 1, minWidth: 220 }}
              />
              <button
                type="button"
                className="ghost-btn"
                style={{ height: 34 }}
                onClick={pickLocalVsix}
                disabled={!globalThis?.window?.electronAPI?.workspace?.pickFile}
              >
                {t('选择文件', 'Pick file')}
              </button>
            </div>
          )}
        </SettingRow>
        <SettingRow title={t('插件 ID', 'Plugin ID')} description={t('用于本地注册与管理（留空则从文件名推断）。', 'Used for local registry management (empty = inferred from filename).')}>
          <input
            type="text"
            className="settings-control"
            value={localPluginId}
            onChange={(e) => setLocalPluginId(e.target.value)}
            placeholder={t('例如：local.my-plugin', 'e.g. local.my-plugin')}
          />
        </SettingRow>
        <SettingRow title={t('版本', 'Version')} description={t('用于本地安装目录区分。', 'Used to separate install directories.')}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
            <input
              type="text"
              className="settings-control"
              value={localPluginVersion}
              onChange={(e) => setLocalPluginVersion(e.target.value)}
              placeholder={t('例如：local / 1.0.0', 'e.g. local / 1.0.0')}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="primary-btn"
              style={{ height: 34 }}
              onClick={installLocalVsix}
              disabled={!localVsixPath || installingIds.has(String((localPluginId || inferPluginIdFromPath(localVsixPath)) || ''))}
            >
              {installingIds.has(String((localPluginId || inferPluginIdFromPath(localVsixPath)) || '')) ? t('安装中…', 'Installing…') : t('安装', 'Install')}
            </button>
          </div>
        </SettingRow>
      </SectionCard>

      <div className="settings-group-title">{t('Marketplace', 'Marketplace')}</div>
      <SectionCard>
        <SettingRow title={t('搜索', 'Search')} description={t('从多个来源搜索语言插件。', 'Search language plugins across providers.')}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
            <input
              type="text"
              className="settings-control"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void doSearch({ limit: searchPageSize });
              }}
              placeholder={t('例如：tsls / pyright / rust-analyzer', 'e.g. tsls / pyright / rust-analyzer')}
              style={{ flex: 1 }}
            />
            <button type="button" className="primary-btn" style={{ height: 34 }} onClick={() => doSearch({ limit: searchPageSize })} disabled={searching}>
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
            {searchItems.map((it) => (
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
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 6 }}>
              <button
                type="button"
                className="ghost-btn"
                style={{ height: 34 }}
                onClick={() => doSearch({ limit: searchLimit + searchPageSize })}
                disabled={searching || searchItems.length === 0}
              >
                {t('加载更多', 'Load more')}
              </button>
            </div>
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
