import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { pluginsService } from '../services/pluginsService';
import { outputService } from '../services/outputService';
import { EXTENSIONS_TAB_PREFIX } from '../../utils/appDefaults';

const DEFAULT_PROVIDERS = ['official', 'github', 'openvsx'];

const safeDecodeURIComponent = (value) => {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
};

const normalizeText = (value) => String(value || '').trim();

const formatDateTime = (ts) => {
  const n = Number(ts || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  try {
    return new Date(n).toLocaleString();
  } catch {
    return '';
  }
};

function ExtensionDetailsEditor({ tabPath, language = 'zh', onClose }) {
  const t = (zh, en) => (language === 'zh' ? zh : en);
  const seqRef = useRef(0);
  const refreshTimerRef = useRef(null);

  const pluginId = useMemo(() => {
    const p = String(tabPath || '');
    const prefix = p.startsWith(EXTENSIONS_TAB_PREFIX) ? EXTENSIONS_TAB_PREFIX : '__system__/extensions/';
    return normalizeText(safeDecodeURIComponent(p.slice(prefix.length)));
  }, [tabPath]);

  const [activeTab, setActiveTab] = useState('readme');
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState(null);
  const [marketItem, setMarketItem] = useState(null);
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState('');

  const refresh = useCallback(async () => {
    const id = normalizeText(pluginId);
    if (!id) return;
    const seq = (seqRef.current += 1);
    setLoading(true);
    setError('');
    try {
      const res = await pluginsService.getDetails(id).catch((e) => ({ ok: false, error: e?.message || String(e) }));
      if (seq !== seqRef.current) return;
      if (res?.ok) {
        setDetails(res);
        setMarketItem(null);
        return;
      }
      setDetails(null);
      const q = id;
      const found = await pluginsService.search(q, DEFAULT_PROVIDERS, { offset: 0, limit: 30 }).catch(() => ({ ok: false, items: [] }));
      if (seq !== seqRef.current) return;
      const items = Array.isArray(found?.items) ? found.items : [];
      const exact = items.find((it) => String(it?.id || '') === id) || (items.length === 1 ? items[0] : null);
      setMarketItem(exact);
      setError(!exact && res?.error ? String(res.error) : '');
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [pluginId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => () => {
    try { clearTimeout(refreshTimerRef.current); } catch {}
  }, []);

  useEffect(() => {
    if (!pluginsService.isAvailable()) return () => {};
    const unsub = pluginsService.subscribe(() => {
      try { clearTimeout(refreshTimerRef.current); } catch {}
      refreshTimerRef.current = setTimeout(() => void refresh(), 120);
    });
    return () => unsub?.();
  }, [refresh]);

  useEffect(() => {
    setActiveTab('readme');
  }, [pluginId]);

  const view = useMemo(() => {
    const plugin = details?.plugin || null;
    const packageJson = details?.packageJson || null;
    const manifest = details?.manifest || null;
    const marketplace = details?.marketplace || null;
    const installed = !!details?.installed;
    const enabled = !!plugin?.enabled;

    const name = normalizeText(packageJson?.displayName || packageJson?.name || plugin?.name || marketItem?.name || pluginId);
    const description = normalizeText(packageJson?.description || plugin?.description || marketItem?.description);
    const version = normalizeText(plugin?.installedVersion || packageJson?.version || marketplace?.version || marketItem?.version);
    const publisher = normalizeText(
      packageJson?.publisher
      || marketplace?.source?.namespace
      || marketItem?.source?.namespace
      || marketItem?.publisher
      || marketItem?.source?.publisher
      || ''
    );
    const trust = normalizeText(plugin?.trust || marketplace?.trust || marketItem?.trust || '');
    const installedAt = plugin?.installedAt ? formatDateTime(plugin.installedAt) : '';
    const icon = normalizeText(details?.icon || '');

    const links = [];
    const homepage = normalizeText(packageJson?.homepage || marketItem?.homepage || '');
    const repo = packageJson?.repository?.url ? normalizeText(packageJson.repository.url) : normalizeText(packageJson?.repository || marketItem?.repository || '');
    const bugs = packageJson?.bugs?.url ? normalizeText(packageJson.bugs.url) : normalizeText(packageJson?.bugs || marketItem?.bugs || '');
    if (homepage) links.push({ label: t('主页', 'Homepage'), href: homepage });
    if (repo) links.push({ label: t('仓库', 'Repository'), href: repo });
    if (bugs) links.push({ label: t('问题', 'Issues'), href: bugs });

    return {
      plugin,
      packageJson,
      manifest,
      marketplace,
      installed,
      enabled,
      name,
      description,
      version,
      publisher,
      trust,
      installedAt,
      icon,
      links,
      readme: normalizeText(details?.readme || ''),
      changelog: normalizeText(details?.changelog || ''),
    };
  }, [details, language, marketItem, pluginId]);

  const ensureMarketplaceItem = useCallback(async () => {
    if (view?.marketplace?.id) return view.marketplace;
    if (marketItem?.id) return marketItem;
    const id = normalizeText(pluginId);
    if (!id) return null;
    const found = await pluginsService.search(id, DEFAULT_PROVIDERS, { offset: 0, limit: 30 }).catch(() => ({ ok: false, items: [] }));
    const items = Array.isArray(found?.items) ? found.items : [];
    return items.find((it) => String(it?.id || '') === id) || (items.length === 1 ? items[0] : null);
  }, [marketItem, pluginId, view?.marketplace]);

  const doInstall = useCallback(async () => {
    const id = normalizeText(pluginId);
    if (!id) return;
    setBusyAction('install');
    try {
      const item = await ensureMarketplaceItem();
      const providerId = normalizeText(view?.marketplace?.source?.providerId || item?.source?.providerId || view?.plugin?.source?.providerId || view?.manifest?.source?.providerId || '');
      const version = normalizeText(view?.marketplace?.version || item?.version || '');
      if (!providerId) throw new Error('missing providerId');
      await pluginsService.install({ providerId, id, version });
      if (normalizeText(item?.trust) === 'official') {
        await pluginsService.enable(id).catch(() => {});
      }
      outputService.append('LSP', `[PLUGIN] installed: ${id}`);
    } catch (err) {
      setError(err?.message || String(err));
      outputService.append('LSP', `[PLUGIN] install failed: ${id} ${err?.message || String(err)}`);
    } finally {
      setBusyAction('');
      void refresh();
    }
  }, [
    ensureMarketplaceItem,
    pluginId,
    refresh,
    view?.manifest?.source?.providerId,
    view?.marketplace?.source?.providerId,
    view?.marketplace?.version,
    view?.plugin?.source?.providerId,
  ]);

  const doEnableDisable = useCallback(async () => {
    const id = normalizeText(pluginId);
    if (!id) return;
    setBusyAction(view.enabled ? 'disable' : 'enable');
    try {
      if (view.enabled) {
        await pluginsService.disable(id);
        outputService.append('LSP', `[PLUGIN] disabled: ${id}`);
      } else if (normalizeText(view.trust) && normalizeText(view.trust) !== 'official') {
        const ok = globalThis.confirm?.(t(`信任并启用插件：${id}？`, `Trust and enable plugin: ${id}?`));
        if (!ok) return;
        await pluginsService.enable(id, view.trust);
        outputService.append('LSP', `[PLUGIN] enabled (trusted): ${id}`);
      } else {
        await pluginsService.enable(id);
        outputService.append('LSP', `[PLUGIN] enabled: ${id}`);
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusyAction('');
      void refresh();
    }
  }, [pluginId, refresh, t, view.enabled, view.trust]);

  const doUninstall = useCallback(async () => {
    const id = normalizeText(pluginId);
    if (!id) return;
    const ok = globalThis.confirm?.(t(`卸载插件：${id}？`, `Uninstall extension: ${id}?`));
    if (!ok) return;
    setBusyAction('uninstall');
    try {
      await pluginsService.uninstall(id);
      outputService.append('LSP', `[PLUGIN] uninstalled: ${id}`);
      onClose?.();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusyAction('');
      void refresh();
    }
  }, [onClose, pluginId, refresh, t]);

  const actionButtons = useMemo(() => {
    const disabled = !!busyAction || !pluginsService.isAvailable();
    if (!view.installed) {
      return (
        <button type="button" className="primary-btn" disabled={disabled} onClick={() => void doInstall()}>
          {busyAction === 'install' ? t('安装中…', 'Installing…') : t('安装', 'Install')}
        </button>
      );
    }
    return (
      <>
        <button type="button" className="primary-btn" disabled={disabled} onClick={() => void doEnableDisable()}>
          {busyAction ? t('处理中…', 'Working…') : (view.enabled ? t('禁用', 'Disable') : t('启用', 'Enable'))}
        </button>
        <button type="button" className="ghost-btn danger" disabled={disabled} onClick={() => void doUninstall()}>
          {busyAction === 'uninstall' ? t('卸载中…', 'Uninstalling…') : t('卸载', 'Uninstall')}
        </button>
      </>
    );
  }, [busyAction, doEnableDisable, doInstall, doUninstall, language, view.enabled, view.installed]);

  const renderMarkdown = (value) => {
    const raw = normalizeText(value || '');
    if (!raw) return <div className="extension-details-empty">{t('暂无内容。', 'No content.')}</div>;
    return (
      <ReactMarkdown className="markdown-content">
        {raw}
      </ReactMarkdown>
    );
  };

  return (
    <div className="extension-details-editor" role="document" aria-label={`Extension Details: ${pluginId}`}>
      <div className="extension-details-header">
        <div className="extension-details-icon">
          {view.icon ? (
            <img src={view.icon} alt="" />
          ) : (
            <span className="codicon codicon-extensions" aria-hidden />
          )}
        </div>
        <div className="extension-details-header-main">
          <div className="extension-details-title">{view.name || pluginId}</div>
          <div className="extension-details-meta">
            <span className="extension-details-id">{pluginId}</span>
            {view.publisher ? <span className="extension-details-sep">•</span> : null}
            {view.publisher ? <span>{view.publisher}</span> : null}
            {view.version ? <><span className="extension-details-sep">•</span><span>{view.version}</span></> : null}
            {view.trust ? <><span className="extension-details-sep">•</span><span>{view.trust}</span></> : null}
            {view.installed && view.installedAt ? <><span className="extension-details-sep">•</span><span>{t('安装于', 'Installed')} {view.installedAt}</span></> : null}
          </div>
          {view.description ? <div className="extension-details-description">{view.description}</div> : null}
          <div className="extension-details-actions">
            {actionButtons}
          </div>
          {error ? <div className="extension-details-error">{error}</div> : null}
        </div>
        <div className="extension-details-header-right">
          <button type="button" className="ghost-btn tiny" onClick={() => onClose?.()} title={t('关闭', 'Close')}>
            <span className="codicon codicon-close" aria-hidden />
          </button>
        </div>
      </div>

      <div className="extension-details-tabs" role="tablist" aria-label={t('扩展详情', 'Extension details')}>
        <button type="button" role="tab" aria-selected={activeTab === 'readme'} className={`extension-details-tab ${activeTab === 'readme' ? 'active' : ''}`} onClick={() => setActiveTab('readme')}>
          {t('详细', 'Readme')}
        </button>
        <button type="button" role="tab" aria-selected={activeTab === 'features'} className={`extension-details-tab ${activeTab === 'features' ? 'active' : ''}`} onClick={() => setActiveTab('features')}>
          {t('功能', 'Features')}
        </button>
        <button type="button" role="tab" aria-selected={activeTab === 'changelog'} className={`extension-details-tab ${activeTab === 'changelog' ? 'active' : ''}`} onClick={() => setActiveTab('changelog')}>
          {t('更改日志', 'Changelog')}
        </button>
      </div>

      <div className="extension-details-body">
        <div className="extension-details-content">
          {loading ? <div className="extension-details-empty">{t('加载中…', 'Loading…')}</div> : null}
          {!loading && activeTab === 'readme' ? renderMarkdown(view.readme) : null}
          {!loading && activeTab === 'changelog' ? renderMarkdown(view.changelog) : null}
          {!loading && activeTab === 'features' ? (
            <div className="extension-details-features">
              {view.packageJson?.contributes ? (
                <pre className="extension-details-pre">{JSON.stringify(view.packageJson.contributes, null, 2)}</pre>
              ) : (
                <div className="extension-details-empty">
                  {t('暂无可展示的 contributes 信息（非 VS Code 扩展或未提供 package.json）。', 'No contributes info available.')}
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="extension-details-sidebar">
          <div className="extension-details-sidebar-section">
            <div className="extension-details-sidebar-title">{t('安装', 'Installation')}</div>
            <div className="extension-details-sidebar-row">
              <div className="k">{t('状态', 'Status')}</div>
              <div className="v">{view.installed ? (view.enabled ? t('已启用', 'Enabled') : t('已安装', 'Installed')) : t('未安装', 'Not installed')}</div>
            </div>
            {view.installed && details?.installDir ? (
              <div className="extension-details-sidebar-row">
                <div className="k">{t('目录', 'Folder')}</div>
                <div className="v mono" title={String(details.installDir)}>{String(details.installDir)}</div>
              </div>
            ) : null}
          </div>

          {view.links.length ? (
            <div className="extension-details-sidebar-section">
              <div className="extension-details-sidebar-title">{t('资源', 'Resources')}</div>
              <div className="extension-details-links">
                {view.links.map((l) => (
                  <a key={l.href} className="extension-details-link" href={l.href} target="_blank" rel="noreferrer">
                    {l.label}
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          {(view.plugin?.languages && Array.isArray(view.plugin.languages) && view.plugin.languages.length) ? (
            <div className="extension-details-sidebar-section">
              <div className="extension-details-sidebar-title">{t('语言', 'Languages')}</div>
              <div className="extension-details-tags">
                {view.plugin.languages.slice(0, 24).map((lang) => (
                  <span key={lang} className="extension-details-tag">{String(lang)}</span>
                ))}
              </div>
            </div>
          ) : null}

          {(view.plugin?.lastError) ? (
            <div className="extension-details-sidebar-section">
              <div className="extension-details-sidebar-title">{t('错误', 'Error')}</div>
              <pre className="extension-details-pre">{String(view.plugin.lastError)}</pre>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default React.memo(ExtensionDetailsEditor);
