import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
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

const formatDate = (ts) => {
  const n = Number(ts || 0);
  if (!Number.isFinite(n) || n <= 0) return '';
  try {
    return new Date(n).toLocaleDateString();
  } catch {
    return '';
  }
};

function ExtensionDetailsEditor({ tabPath, language = 'zh', onClose }) {
  const t = (zh, en) => (language === 'zh' ? zh : en);
  const seqRef = useRef(0);
  const refreshTimerRef = useRef(null);
  const canOpenExternalLink = useCallback(() => {
    const api = globalThis?.window?.electronAPI || null;
    return !!(api?.window?.openPopup || api?.shell?.openExternal);
  }, []);
  const openExternal = useCallback(async (url) => {
    const target = String(url || '').trim();
    if (!target) return;
    const windowApi = globalThis?.window?.electronAPI?.window;
    try {
      if (windowApi?.openPopup) {
        await windowApi.openPopup({ url: target });
        return;
      }
    } catch {}
    const shellApi = globalThis?.window?.electronAPI?.shell;
    try {
      if (shellApi?.openExternal) {
        await shellApi.openExternal(target);
        return;
      }
    } catch {}
    try {
      window.open(target, '_blank', 'noopener,noreferrer');
    } catch {}
  }, []);

  const pluginId = useMemo(() => {
    const p = String(tabPath || '');
    const prefix = p.startsWith(EXTENSIONS_TAB_PREFIX) ? EXTENSIONS_TAB_PREFIX : '__system__/extensions/';
    return normalizeText(safeDecodeURIComponent(p.slice(prefix.length)));
  }, [tabPath]);

  const [activeTab, setActiveTab] = useState('readme');
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState(null);
  const [marketItem, setMarketItem] = useState(null);
  const [remoteDetail, setRemoteDetail] = useState(null);
  const [remoteCached, setRemoteCached] = useState(false);
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState('');

  const refresh = useCallback(async () => {
    const id = normalizeText(pluginId);
    if (!id) return;
    const seq = (seqRef.current += 1);
    setLoading(true);
    setError('');
    setRemoteDetail(null);
    setRemoteCached(false);
    try {
      const fetchRemoteDetail = async ({ providerId, version } = {}) => {
        const pid = normalizeText(providerId);
        const ver = normalizeText(version);
        if (!pid) return { ok: false, error: language === 'zh' ? '缺少 providerId，无法获取插件详情。' : 'Missing providerId, cannot fetch details.' };

        const attempt = async (opts) =>
          pluginsService
            .getDetail(id, pid, opts)
            .catch((e) => ({ ok: false, error: e?.message || String(e) }));

        const first = await attempt({ ...(ver ? { version: ver } : {}), forceRefresh: false });
        if (first?.ok && first?.detail) return first;
        if (ver) {
          const second = await attempt({ forceRefresh: false });
          if (second?.ok && second?.detail) return second;
        }
        return first;
      };

      const res = await pluginsService.getDetails(id).catch((e) => ({ ok: false, error: e?.message || String(e) }));
      if (seq !== seqRef.current) return;
      if (res?.ok) {
        setDetails(res);
        setMarketItem(null);
        const providerId = normalizeText(
          res?.marketplace?.source?.providerId
          || res?.plugin?.installed?.source?.providerId
          || res?.plugin?.source?.providerId
          || res?.manifest?.source?.providerId
          || ''
        );
        const version = normalizeText(res?.marketplace?.version || res?.plugin?.installedVersion || '');
        if (providerId) {
          const detailRes = await fetchRemoteDetail({ providerId, version });
          if (seq !== seqRef.current) return;
          if (detailRes?.ok && detailRes?.detail) {
            setRemoteDetail(detailRes.detail);
            setRemoteCached(!!detailRes.cached);
          }
        }
        return;
      }
      setDetails(null);
      const q = id;
      const found = await pluginsService.search(q, DEFAULT_PROVIDERS, { offset: 0, limit: 30 }).catch(() => ({ ok: false, items: [] }));
      if (seq !== seqRef.current) return;
      const items = Array.isArray(found?.items) ? found.items : [];
      const exact = items.find((it) => String(it?.id || '') === id) || (items.length === 1 ? items[0] : null);
      setMarketItem(exact);
      if (!exact) {
        setError(res?.error ? String(res.error) : '');
        return;
      }

      const providerId = normalizeText(exact?.source?.providerId || exact?.providerId || '');
      const version = normalizeText(exact?.version || '');
      const detailRes = await fetchRemoteDetail({ providerId, version });
      if (seq !== seqRef.current) return;
      if (detailRes?.ok && detailRes?.detail) {
        setRemoteDetail(detailRes.detail);
        setRemoteCached(!!detailRes.cached);
        setError('');
      } else {
        setRemoteDetail(null);
        setRemoteCached(false);
        setError(String(detailRes?.error || (language === 'zh' ? '获取插件详情失败。' : 'Failed to fetch details.')));
      }
    } finally {
      if (seq === seqRef.current) setLoading(false);
    }
  }, [language, pluginId]);

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

    const remote = remoteDetail || null;

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
      publisherUrl: normalizeText(remote?.publisher?.url || ''),
      trust,
      installedAt,
      icon,
      links,
      readme: normalizeText(details?.readme || remote?.readme || ''),
      changelog: normalizeText(details?.changelog || remote?.changelog || ''),
      tags: Array.isArray(remote?.capabilities) ? remote.capabilities : [],
      categories: Array.isArray(remote?.categories) ? remote.categories : [],
      dependencies: Array.isArray(remote?.dependencies) ? remote.dependencies : [],
      license: normalizeText(remote?.license || ''),
      repository: normalizeText(remote?.repository || ''),
      downloads: Number.isFinite(remote?.statistics?.downloads) ? remote.statistics.downloads : null,
      rating: Number.isFinite(remote?.statistics?.rating) ? remote.statistics.rating : null,
      reviewCount: Number.isFinite(remote?.statistics?.reviewCount) ? remote.statistics.reviewCount : null,
      lastUpdated: Number.isFinite(remote?.lastUpdated) ? remote.lastUpdated : 0,
      sourceProviderId: normalizeText(remote?.source?.providerId || marketplace?.source?.providerId || marketItem?.source?.providerId || ''),
      remoteCached: !!remoteCached,
    };
  }, [details, language, marketItem, pluginId, remoteCached, remoteDetail]);

  const autoTabRef = useRef({ id: '', done: false });
  useEffect(() => {
    if (autoTabRef.current.id !== pluginId) autoTabRef.current = { id: pluginId, done: false };
    if (autoTabRef.current.done) return;
    if (loading) return;

    const hasReadme = !!normalizeText(view.readme);
    const hasChangelog = !!normalizeText(view.changelog);
    const next = hasReadme ? 'readme' : hasChangelog ? 'changelog' : 'features';
    setActiveTab(next);
    autoTabRef.current = { id: pluginId, done: true };
  }, [loading, pluginId, view.changelog, view.readme]);

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

    const schema = {
      ...defaultSchema,
      tagNames: Array.from(new Set([
        ...((defaultSchema && Array.isArray(defaultSchema.tagNames)) ? defaultSchema.tagNames : []),
        'img', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'kbd', 'details', 'summary', 'div', 'span', 'sup', 'sub',
      ])),
      attributes: {
        ...(defaultSchema?.attributes || {}),
        a: Array.from(new Set([...(defaultSchema?.attributes?.a || []), 'target', 'rel'])),
        img: Array.from(new Set([...(defaultSchema?.attributes?.img || []), 'src', 'alt', 'title', 'width', 'height', 'align'])),
        div: Array.from(new Set([...(defaultSchema?.attributes?.div || []), 'align'])),
        p: Array.from(new Set([...(defaultSchema?.attributes?.p || []), 'align'])),
        td: Array.from(new Set([...(defaultSchema?.attributes?.td || []), 'align'])),
        th: Array.from(new Set([...(defaultSchema?.attributes?.th || []), 'align'])),
        span: Array.from(new Set([...(defaultSchema?.attributes?.span || []), 'align'])),
      },
    };

    return (
      <ReactMarkdown
        className="markdown-content"
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
        components={{
          a: ({ node: _node, href, ...props }) => (
            <a
              {...props}
              href={href}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                if (!href) return;
                const safeHref = String(href || '').trim();
                if (!/^https?:\/\//i.test(safeHref)) return;
                if (!canOpenExternalLink()) return;
                e.preventDefault();
                e.stopPropagation();
                void openExternal(safeHref);
              }}
            />
          ),
        }}
      >
        {raw}
      </ReactMarkdown>
    );
  };

  const renderFeatures = () => {
    const contributes = view.packageJson?.contributes && typeof view.packageJson.contributes === 'object'
      ? view.packageJson.contributes
      : null;
    const activationEvents = Array.isArray(view.packageJson?.activationEvents) ? view.packageJson.activationEvents : [];

    if (!contributes && activationEvents.length === 0) {
      return (
        <div className="extension-details-empty">
          {t('暂无贡献点信息（未提供 package.json）。', 'No contributions info (missing package.json).')}
        </div>
      );
    }

    const labelForKey = (key) => {
      const map = {
        commands: t('命令', 'Commands'),
        languages: t('语言', 'Languages'),
        grammars: t('语法高亮', 'Grammars'),
        debuggers: t('调试器', 'Debuggers'),
        configuration: t('配置', 'Configuration'),
        configurationDefaults: t('默认配置', 'Configuration Defaults'),
        keybindings: t('键位', 'Keybindings'),
        menus: t('菜单', 'Menus'),
        snippets: t('代码片段', 'Snippets'),
        themes: t('主题', 'Themes'),
        iconThemes: t('图标主题', 'Icon Themes'),
        colors: t('颜色', 'Colors'),
        views: t('视图', 'Views'),
        viewsContainers: t('视图容器', 'View Containers'),
        viewsWelcome: t('视图欢迎页', 'View Welcome'),
        jsonValidation: t('JSON 校验', 'JSON Validation'),
        semanticTokenScopes: t('语义令牌', 'Semantic Token Scopes'),
        terminal: t('终端', 'Terminal'),
        taskDefinitions: t('任务定义', 'Task Definitions'),
        problemMatchers: t('问题匹配器', 'Problem Matchers'),
        notebooks: t('Notebook', 'Notebooks'),
        notebookRenderer: t('Notebook 渲染器', 'Notebook Renderers'),
        walkthroughs: t('引导', 'Walkthroughs'),
      };
      return map[key] || key;
    };

    const countValue = (value) => {
      if (Array.isArray(value)) return value.length;
      if (value && typeof value === 'object') {
        if (value.properties && typeof value.properties === 'object') return Object.keys(value.properties).length;
        return Object.keys(value).length;
      }
      if (value == null) return 0;
      return 1;
    };

    const keys = contributes ? Object.keys(contributes).sort((a, b) => a.localeCompare(b)) : [];
    const rows = keys
      .map((k) => ({ key: k, label: labelForKey(k), count: countValue(contributes[k]) }))
      .filter((r) => r.count > 0);

    if (rows.length === 0 && activationEvents.length === 0) {
      return (
        <div className="extension-details-empty">
          {t('暂无贡献点信息。', 'No contributions info.')}
        </div>
      );
    }

    return (
      <div className="extension-details-features">
        {rows.length ? (
          <div className="extension-details-features-section">
            <div className="extension-details-features-title">{t('贡献点', 'Contributions')}</div>
            <div className="extension-details-contrib-list" role="table" aria-label={t('贡献点列表', 'Contributions list')}>
              {rows.map((r) => (
                <div key={r.key} className="extension-details-contrib-row" role="row">
                  <div className="extension-details-contrib-key" role="cell">{r.label}</div>
                  <div className="extension-details-contrib-count" role="cell">{String(r.count)}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {activationEvents.length ? (
          <div className="extension-details-features-section">
            <div className="extension-details-features-title">{t('激活事件', 'Activation Events')}</div>
            <div className="extension-details-mono-list">
              {activationEvents.slice(0, 80).map((ev) => (
                <div key={String(ev)} className="extension-details-mono-item">{String(ev)}</div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
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
          <div className="extension-details-content-inner">
            {loading ? <div className="extension-details-empty">{t('加载中…', 'Loading…')}</div> : null}
            {!loading && activeTab === 'readme' ? renderMarkdown(view.readme) : null}
            {!loading && activeTab === 'changelog' ? renderMarkdown(view.changelog) : null}
            {!loading && activeTab === 'features' ? renderFeatures() : null}
            {!loading && view.remoteCached ? <div className="extension-details-subtle">{t('详情来自缓存。', 'Details loaded from cache.')}</div> : null}
          </div>
        </div>

        <div className="extension-details-sidebar">
          <div className="extension-details-sidebar-section">
            <div className="extension-details-sidebar-title">{t('信息', 'Info')}</div>
            {view.sourceProviderId ? (
              <div className="extension-details-sidebar-row">
                <div className="k">{t('市场', 'Marketplace')}</div>
                <div className="v">{view.sourceProviderId}</div>
              </div>
            ) : null}
            {view.version ? (
              <div className="extension-details-sidebar-row">
                <div className="k">{t('版本', 'Version')}</div>
                <div className="v">{view.version}</div>
              </div>
            ) : null}
            {view.publisher ? (
              <div className="extension-details-sidebar-row">
                <div className="k">{t('发布者', 'Publisher')}</div>
                <div className="v">
                  {view.publisherUrl ? (
                    <a
                      className="extension-details-link"
                      href={view.publisherUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => {
                        const safeHref = String(view.publisherUrl || '').trim();
                        if (!/^https?:\/\//i.test(safeHref)) return;
                        if (!canOpenExternalLink()) return;
                        e.preventDefault();
                        e.stopPropagation();
                        void openExternal(safeHref);
                      }}
                    >
                      {view.publisher}
                    </a>
                  ) : (
                    view.publisher
                  )}
                </div>
              </div>
            ) : null}
            {view.lastUpdated ? (
              <div className="extension-details-sidebar-row">
                <div className="k">{t('更新时间', 'Last Updated')}</div>
                <div className="v">{formatDate(view.lastUpdated)}</div>
              </div>
            ) : null}
            {view.downloads != null ? (
              <div className="extension-details-sidebar-row">
                <div className="k">{t('下载量', 'Downloads')}</div>
                <div className="v">{String(view.downloads)}</div>
              </div>
            ) : null}
            {view.rating != null ? (
              <div className="extension-details-sidebar-row">
                <div className="k">{t('评分', 'Rating')}</div>
                <div className="v">
                  {Number(view.rating).toFixed(1)}{view.reviewCount != null ? ` (${String(view.reviewCount)})` : ''}
                </div>
              </div>
            ) : null}
            {view.license ? (
              <div className="extension-details-sidebar-row">
                <div className="k">{t('许可', 'License')}</div>
                <div className="v">{view.license}</div>
              </div>
            ) : null}
            {view.repository ? (
              <div className="extension-details-sidebar-row">
                <div className="k">{t('仓库', 'Repository')}</div>
                <div className="v">
                  <a
                    className="extension-details-link"
                    href={view.repository}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      const safeHref = String(view.repository || '').trim();
                      if (!/^https?:\/\//i.test(safeHref)) return;
                      if (!canOpenExternalLink()) return;
                      e.preventDefault();
                      e.stopPropagation();
                      void openExternal(safeHref);
                    }}
                  >
                    {t('打开', 'Open')}
                  </a>
                </div>
              </div>
            ) : null}
          </div>

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
                  <a
                    key={l.href}
                    className="extension-details-link"
                    href={l.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      const safeHref = String(l.href || '').trim();
                      if (!/^https?:\/\//i.test(safeHref)) return;
                      if (!canOpenExternalLink()) return;
                      e.preventDefault();
                      e.stopPropagation();
                      void openExternal(safeHref);
                    }}
                  >
                    {l.label}
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          {view.categories.length ? (
            <div className="extension-details-sidebar-section">
              <div className="extension-details-sidebar-title">{t('类别', 'Categories')}</div>
              <div className="extension-details-tags">
                {view.categories.slice(0, 64).map((c) => (
                  <span key={String(c)} className="extension-details-tag">{String(c)}</span>
                ))}
              </div>
            </div>
          ) : null}

          {view.tags.length ? (
            <div className="extension-details-sidebar-section">
              <div className="extension-details-sidebar-title">{t('标签', 'Tags')}</div>
              <div className="extension-details-tags">
                {view.tags.slice(0, 128).map((c) => (
                  <span key={String(c)} className="extension-details-tag">{String(c)}</span>
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
