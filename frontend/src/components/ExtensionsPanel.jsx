import React, { useEffect, useMemo, useRef, useState } from 'react';
import { pluginsService } from '../workbench/services/pluginsService';
import { outputService } from '../workbench/services/outputService';

const DEFAULT_PROVIDERS = ['official', 'github', 'openvsx'];

const normalizeText = (s) => String(s || '').trim().toLowerCase();

const formatSub = (it) => {
  const parts = [];
  if (it?.installedVersion) parts.push(String(it.installedVersion));
  if (it?.trust) parts.push(String(it.trust));
  if (it?.metadataOnly) parts.push('metadata-only');
  return parts.join(' • ');
};

export default function ExtensionsPanel({ language = 'zh', onOpenDetails = null }) {
  const t = (zh, en) => (language === 'zh' ? zh : en);

  const [query, setQuery] = useState('');
  const [providerIds, setProviderIds] = useState(DEFAULT_PROVIDERS);
  const [searching, setSearching] = useState(false);
  const [searchItems, setSearchItems] = useState([]);
  const [installedItems, setInstalledItems] = useState([]);
  const [updates, setUpdates] = useState([]);
  const [lastProgress, setLastProgress] = useState(null);
  const [lastError, setLastError] = useState(null);
  const [installingIds, setInstallingIds] = useState(() => new Set());

  const searchReqRef = useRef(0);
  const searchTimerRef = useRef(null);

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

  useEffect(() => () => {
    try { clearTimeout(searchTimerRef.current); } catch {}
  }, []);

  const parsed = useMemo(() => {
    const raw = String(query || '').trim();
    const lower = raw.toLowerCase();
    const isAt = lower.startsWith('@');
    const tokens = lower.split(/\s+/).filter(Boolean);
    const hasInstalled = tokens.includes('@installed');
    const hasEnabled = tokens.includes('@enabled');
    const hasDisabled = tokens.includes('@disabled');
    const text = tokens.filter((t) => !t.startsWith('@')).join(' ').trim();
    const mode = hasInstalled || hasEnabled || hasDisabled ? 'installed' : (raw ? 'marketplace' : 'installed');
    return { raw, lower, isAt, mode, hasInstalled, hasEnabled, hasDisabled, text };
  }, [query]);

  const filteredInstalled = useMemo(() => {
    let list = Array.isArray(installedItems) ? installedItems : [];
    if (parsed.text) {
      const needle = normalizeText(parsed.text);
      list = list.filter((it) => normalizeText(`${it?.id || ''} ${it?.name || ''} ${it?.description || ''} ${(it?.languages || []).join(' ')}`).includes(needle));
    }
    if (parsed.hasEnabled) list = list.filter((it) => !!it?.enabled);
    if (parsed.hasDisabled) list = list.filter((it) => !it?.enabled);
    return list;
  }, [installedItems, parsed]);

  const doSearch = async (q) => {
    if (!pluginsService.isAvailable()) return;
    const wanted = String(q || '').trim();
    if (!wanted) {
      setSearchItems([]);
      return;
    }
    setSearching(true);
    const reqId = (searchReqRef.current += 1);
    try {
      const res = await pluginsService.search(wanted, providerIds, { offset: 0, limit: 50 });
      if (reqId !== searchReqRef.current) return;
      const items = Array.isArray(res?.items) ? res.items : [];
      setSearchItems(items);
    } catch (err) {
      if (reqId !== searchReqRef.current) return;
      setSearchItems([]);
      setLastError({ message: err?.message || String(err) });
    } finally {
      if (reqId !== searchReqRef.current) return;
      setSearching(false);
    }
  };

  useEffect(() => {
    if (parsed.mode !== 'marketplace') return;
    try { clearTimeout(searchTimerRef.current); } catch {}
    searchTimerRef.current = setTimeout(() => {
      void doSearch(parsed.text || parsed.raw);
    }, 200);
  }, [parsed.mode, parsed.raw, parsed.text, providerIds]);

  const enablePlugin = async (it) => {
    const id = String(it?.id || '').trim();
    if (!id) return;
    try {
      if (String(it?.trust || '') !== 'official') {
        const ok = globalThis.confirm?.(t(`信任并启用插件：${id}？`, `Trust and enable plugin: ${id}?`));
        if (!ok) return;
        await pluginsService.enable(id, it.trust);
      } else {
        await pluginsService.enable(id);
      }
      outputService.append('LSP', `[PLUGIN] enabled: ${id}`);
    } catch (err) {
      setLastError({ message: err?.message || String(err) });
    }
  };

  const disablePlugin = async (it) => {
    const id = String(it?.id || '').trim();
    if (!id) return;
    try {
      await pluginsService.disable(id);
      outputService.append('LSP', `[PLUGIN] disabled: ${id}`);
    } catch (err) {
      setLastError({ message: err?.message || String(err) });
    }
  };

  const uninstallPlugin = async (it) => {
    const id = String(it?.id || '').trim();
    if (!id) return;
    const ok = globalThis.confirm?.(t(`卸载插件：${id}？`, `Uninstall plugin: ${id}?`));
    if (!ok) return;
    try {
      await pluginsService.uninstall(id);
      outputService.append('LSP', `[PLUGIN] uninstalled: ${id}`);
    } catch (err) {
      setLastError({ message: err?.message || String(err) });
    }
  };

  const installFromMarketplace = async (item) => {
    const pid = String(item?.id || '').trim();
    if (!pid) return;
    const providerId = String(item?.source?.providerId || '').trim();
    setInstallingIds((prev) => new Set([...(prev || []), pid]));
    try {
      await pluginsService.install({ providerId, id: pid, version: item?.version || '' });
      if (String(item?.trust || '') === 'official') {
        await pluginsService.enable(pid).catch(() => {});
      }
      outputService.append('LSP', `[PLUGIN] installed: ${pid}`);
    } catch (err) {
      setLastError({ message: err?.message || String(err) });
    } finally {
      setInstallingIds((prev) => {
        const next = new Set(prev || []);
        next.delete(pid);
        return next;
      });
      void pluginsService.listInstalled().catch(() => {});
      void pluginsService.listUpdates().then((res) => setUpdates(res?.items || [])).catch(() => {});
    }
  };

  const headerTitle = t('扩展', 'Extensions');

  return (
    <div className="extensions-panel">
      <div className="extensions-header">
        <div className="explorer-title">
          <div className="explorer-label">{headerTitle.toUpperCase()}</div>
        </div>
        <div className="extensions-actions">
          <button
            type="button"
            className="explorer-action-btn"
            title={t('已安装', 'Installed')}
            onClick={() => setQuery('@installed ')}
          >
            <span className="codicon codicon-check" aria-hidden />
          </button>
          <button
            type="button"
            className="explorer-action-btn"
            title={t('更新', 'Updates')}
            onClick={() => pluginsService.listUpdates().then((res) => setUpdates(res?.items || [])).catch(() => {})}
          >
            <span className="codicon codicon-refresh" aria-hidden />
          </button>
        </div>
      </div>

      <div className="extensions-search">
        <span className="codicon codicon-search extensions-search-icon" aria-hidden />
        <input
          className="extensions-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('在扩展市场中搜索', 'Search Extensions in Marketplace')}
          spellCheck={false}
        />
      </div>

      {!pluginsService.isAvailable() ? (
        <div className="extensions-empty">
          {t('当前环境不可用（需要 Electron 主进程插件服务）。', 'Not available in this environment.')}
        </div>
      ) : (
        <div className="extensions-body">
          {parsed.mode === 'installed' ? (
            <>
              <div className="extensions-section-title">{t('已安装', 'Installed')}</div>
              {filteredInstalled.length === 0 ? (
                <div className="extensions-empty">
                  {t('暂无已安装插件。', 'No installed extensions.')}
                </div>
              ) : (
                <div className="extensions-list">
                  {filteredInstalled.map((it) => (
                    <div
                      key={String(it?.id || '')}
                      className="extension-item"
                      role="button"
                      tabIndex={0}
                      onClick={() => onOpenDetails?.(String(it?.id || '').trim())}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpenDetails?.(String(it?.id || '').trim());
                        }
                      }}
                    >
                      <div className="extension-icon">
                        <span className="codicon codicon-symbol-keyword" aria-hidden />
                      </div>
                      <div className="extension-main">
                        <div className="extension-name-row">
                          <div className="extension-name">{String(it?.name || it?.id || '')}</div>
                          <div className="extension-badges">
                            {!!it?.enabled ? (
                              <span className="extension-badge enabled">{t('已启用', 'Enabled')}</span>
                            ) : (
                              <span className="extension-badge disabled">{t('已禁用', 'Disabled')}</span>
                            )}
                          </div>
                        </div>
                        <div className="extension-desc">{String(it?.description || '')}</div>
                        <div className="extension-sub">{String(it?.id || '')}{formatSub(it) ? ` • ${formatSub(it)}` : ''}</div>
                      </div>
                      <div className="extension-actions">
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            it?.enabled ? disablePlugin(it) : enablePlugin(it);
                          }}
                          style={{ height: 30 }}
                        >
                          {it?.enabled ? t('禁用', 'Disable') : t('启用', 'Enable')}
                        </button>
                        <button
                          type="button"
                          className="ghost-btn danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            uninstallPlugin(it);
                          }}
                          style={{ height: 30 }}
                        >
                          {t('卸载', 'Uninstall')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {updates.length ? (
                <>
                  <div className="extensions-section-title">{t('可更新', 'Updates')}</div>
                  <div className="extensions-list">
                    {updates.map((u) => (
                      <div key={`${u.id}:${u.latest}`} className="extension-item compact">
                        <div className="extension-icon">
                          <span className="codicon codicon-cloud-download" aria-hidden />
                        </div>
                        <div className="extension-main">
                          <div className="extension-name-row">
                            <div className="extension-name">{String(u.id || '')}</div>
                          </div>
                          <div className="extension-sub">{String(u.current || '')} → {String(u.latest || '')} • {String(u.providerId || '')}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <>
              <div className="extensions-section-title">{t('扩展市场', 'Marketplace')}</div>
              {searching ? (
                <div className="extensions-empty">{t('搜索中…', 'Searching…')}</div>
              ) : searchItems.length === 0 ? (
                <div className="extensions-empty">{t('未找到结果。', 'No results.')}</div>
              ) : (
                <div className="extensions-list">
                  {searchItems.map((it) => {
                    const id = String(it?.id || '');
                    const installed = installedItems.some((x) => String(x?.id || '') === id);
                    return (
                      <div
                        key={`${it?.source?.providerId || ''}:${id}:${it?.version || ''}`}
                        className="extension-item"
                        role="button"
                        tabIndex={0}
                        onClick={() => onOpenDetails?.(String(it?.id || '').trim())}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onOpenDetails?.(String(it?.id || '').trim());
                          }
                        }}
                      >
                        <div className="extension-icon">
                          <span className="codicon codicon-package" aria-hidden />
                        </div>
                        <div className="extension-main">
                          <div className="extension-name-row">
                            <div className="extension-name">{String(it?.name || it?.id || '')}</div>
                            <div className="extension-badges">
                              {it?.trust ? <span className="extension-badge">{String(it.trust)}</span> : null}
                              {installed ? <span className="extension-badge enabled">{t('已安装', 'Installed')}</span> : null}
                            </div>
                          </div>
                          <div className="extension-desc">{String(it?.description || '')}</div>
                          <div className="extension-sub">{String(it?.id || '')}{it?.version ? ` • ${it.version}` : ''}{it?.source?.providerId ? ` • ${it.source.providerId}` : ''}</div>
                        </div>
                        <div className="extension-actions">
                          <button
                            type="button"
                            className="ghost-btn"
                            disabled={installed || installingIds.has(id)}
                            onClick={(e) => {
                              e.stopPropagation();
                              installFromMarketplace(it);
                            }}
                            style={{ height: 30 }}
                          >
                            {installed ? t('已安装', 'Installed') : (installingIds.has(id) ? t('安装中…', 'Installing…') : t('安装', 'Install'))}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="extensions-provider-row">
                <span className="extensions-provider-label">{t('来源', 'Sources')}:</span>
                {DEFAULT_PROVIDERS.map((p) => (
                  <label key={p} className="extensions-provider-pill">
                    <input
                      type="checkbox"
                      checked={providerIds.includes(p)}
                      onChange={(e) => {
                        const checked = !!e.target.checked;
                        setProviderIds((prev) => {
                          const list = Array.isArray(prev) ? prev : [];
                          const next = new Set(list);
                          if (checked) next.add(p); else next.delete(p);
                          return Array.from(next);
                        });
                      }}
                    />
                    <span>{p}</span>
                  </label>
                ))}
              </div>
            </>
          )}

          {lastProgress ? (
            <div className="extensions-footer">
              <div className="extensions-footer-title">{t('进度', 'Progress')}</div>
              <pre className="extensions-footer-pre">{JSON.stringify(lastProgress, null, 2)}</pre>
            </div>
          ) : null}
          {lastError ? (
            <div className="extensions-footer error">
              <div className="extensions-footer-title">{t('错误', 'Error')}</div>
              <pre className="extensions-footer-pre">{String(lastError?.message || '')}</pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
