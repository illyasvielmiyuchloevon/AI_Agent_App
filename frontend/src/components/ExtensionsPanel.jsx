import React, { useEffect, useMemo, useRef, useState } from 'react';
import { pluginsService } from '../workbench/services/pluginsService';
import { vscodeExtensionsService } from '../workbench/services/vscodeExtensionsService';
import { outputService } from '../workbench/services/outputService';
import Modal from './Modal';

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
  const [extHostStatus, setExtHostStatus] = useState(null);
  const [extHostExtensions, setExtHostExtensions] = useState(null);
  const [extHostBusy, setExtHostBusy] = useState(false);
  const [showExtHost, setShowExtHost] = useState(false);
  const [vsCodeInstalled, setVsCodeInstalled] = useState([]);
  const [vsCodeProgress, setVsCodeProgress] = useState(null);
  const [vsCodeError, setVsCodeError] = useState(null);
  const [vsCodeBusy, setVsCodeBusy] = useState(false);
  const [vsCodeDetailOpen, setVsCodeDetailOpen] = useState(false);
  const [vsCodeDetailId, setVsCodeDetailId] = useState('');
  const [vsCodeDetail, setVsCodeDetail] = useState(null);
  const [vsCodeDetailError, setVsCodeDetailError] = useState('');
  const [vsCodeDetailBusy, setVsCodeDetailBusy] = useState(false);
  const [vsCodeDetailTab, setVsCodeDetailTab] = useState('overview');

  const searchReqRef = useRef(0);
  const searchTimerRef = useRef(null);
  const extHostReqRef = useRef(0);
  const vsCodeDetailReqRef = useRef(0);

  const extensionsApi = useMemo(() => {
    const api = globalThis?.window?.electronAPI?.extensions || null;
    return api && typeof api.getStatus === 'function' ? api : null;
  }, []);

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

  useEffect(() => {
    if (!vscodeExtensionsService.isAvailable()) return () => {};
    const unsub = vscodeExtensionsService.subscribe((snap) => {
      setVsCodeInstalled(Array.isArray(snap?.installed) ? snap.installed : []);
      setVsCodeProgress(snap?.lastProgress || null);
      setVsCodeError(snap?.lastError || null);
    });
    void vscodeExtensionsService.listInstalled().catch(() => {});
    return () => unsub?.();
  }, []);

  const refreshExtHostStatus = async () => {
    if (!extensionsApi) return;
    const reqId = (extHostReqRef.current += 1);
    try {
      const res = await extensionsApi.getStatus();
      if (reqId !== extHostReqRef.current) return;
      setExtHostStatus(res && typeof res === 'object' ? res : null);
    } catch (err) {
      if (reqId !== extHostReqRef.current) return;
      setExtHostStatus({ ok: false, error: err?.message || String(err) });
    }
  };

  const restartExtHost = async () => {
    if (!extensionsApi?.restart) return;
    setExtHostBusy(true);
    try {
      await extensionsApi.restart('ui');
      await refreshExtHostStatus();
      setExtHostExtensions(null);
    } catch (err) {
      setLastError({ message: err?.message || String(err) });
    } finally {
      setExtHostBusy(false);
    }
  };

  const loadExtHostExtensions = async () => {
    if (!extensionsApi?.listExtensions) return;
    setExtHostBusy(true);
    try {
      const res = await extensionsApi.listExtensions();
      setExtHostExtensions(res && typeof res === 'object' ? res : null);
      await refreshExtHostStatus();
    } catch (err) {
      setExtHostExtensions({ ok: false, error: err?.message || String(err) });
    } finally {
      setExtHostBusy(false);
    }
  };

  useEffect(() => {
    void refreshExtHostStatus();
  }, [extensionsApi]);

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
      const [lspRes, vsRes] = await Promise.allSettled([
        pluginsService.search(wanted, providerIds, { offset: 0, limit: 50 }),
        vscodeExtensionsService.isAvailable() ? vscodeExtensionsService.search(wanted, ['openvsx'], { offset: 0, limit: 50 }) : Promise.resolve({ ok: true, items: [] }),
      ]);
      if (reqId !== searchReqRef.current) return;
      const lspItems = lspRes.status === 'fulfilled' && Array.isArray(lspRes.value?.items) ? lspRes.value.items : [];
      const vscodeItems = vsRes.status === 'fulfilled' && Array.isArray(vsRes.value?.items) ? vsRes.value.items : [];

      if (lspRes.status === 'rejected') setLastError({ message: lspRes.reason?.message || String(lspRes.reason) });
      if (vsRes.status === 'rejected') setVsCodeError({ message: vsRes.reason?.message || String(vsRes.reason) });

      const merged = [
        ...lspItems.map((it) => ({ ...(it && typeof it === 'object' ? it : {}), type: 'lsp' })),
        ...vscodeItems,
      ];
      setSearchItems(merged);
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
    const key = `lsp:${pid}`;
    setInstallingIds((prev) => new Set([...(prev || []), key]));
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
        next.delete(key);
        return next;
      });
      void pluginsService.listInstalled().catch(() => {});
      void pluginsService.listUpdates().then((res) => setUpdates(res?.items || [])).catch(() => {});
    }
  };

  const installVsCodeFromMarketplace = async (item) => {
    if (!vscodeExtensionsService.isAvailable()) return;
    const id = String(item?.id || '').trim();
    const key = `vscode:${id}`;
    const namespace = String(item?.source?.namespace || '').trim();
    const name = String(item?.source?.name || '').trim();
    const version = String(item?.source?.version || item?.version || '').trim();
    if (!namespace || !name) return;
    setInstallingIds((prev) => new Set([...(prev || []), key]));
    try {
      const res = await vscodeExtensionsService.installFromOpenVsx({ namespace, name, version });
      if (!res?.ok) throw new Error(res?.error || 'install failed');
      outputService.append('Extensions', `[VSCODE EXT] installed: ${namespace}.${name}${version ? `@${version}` : ''}`);
      await vscodeExtensionsService.listInstalled().catch(() => {});
    } catch (err) {
      setVsCodeError({ message: err?.message || String(err) });
    } finally {
      setInstallingIds((prev) => {
        const next = new Set(prev || []);
        next.delete(key);
        return next;
      });
    }
  };

  const headerTitle = t('扩展', 'Extensions');

  const pickVsixAndInstall = async () => {
    if (!vscodeExtensionsService.isAvailable()) return;
    const picker = globalThis?.window?.electronAPI?.workspace?.pickFile;
    if (typeof picker !== 'function') return;
    setVsCodeBusy(true);
    try {
      const res = await picker();
      const filePath = String(res?.fsPath || '').trim();
      if (!filePath || res?.canceled) return;
      const installRes = await vscodeExtensionsService.installFromVsixFile(filePath);
      if (installRes?.ok) {
        outputService.append('Extensions', `[VSCODE EXT] installed from vsix: ${filePath}`);
      } else {
        setVsCodeError({ message: installRes?.error || 'install failed' });
      }
      await vscodeExtensionsService.listInstalled().catch(() => {});
    } catch (err) {
      setVsCodeError({ message: err?.message || String(err) });
    } finally {
      setVsCodeBusy(false);
    }
  };

  const enableVsCodeExtension = async (it) => {
    const id = String(it?.id || '').trim();
    if (!id) return;
    setVsCodeBusy(true);
    try {
      const res = await vscodeExtensionsService.enable(id);
      if (!res?.ok) throw new Error(res?.error || 'enable failed');
      outputService.append('Extensions', `[VSCODE EXT] enabled: ${id}`);
      if (res?.needsRestart) outputService.append('Extensions', `[VSCODE EXT] restart required to take effect`);
      await vscodeExtensionsService.listInstalled().catch(() => {});
    } catch (err) {
      setVsCodeError({ message: err?.message || String(err) });
    } finally {
      setVsCodeBusy(false);
    }
  };

  const disableVsCodeExtension = async (it) => {
    const id = String(it?.id || '').trim();
    if (!id) return;
    setVsCodeBusy(true);
    try {
      const res = await vscodeExtensionsService.disable(id);
      if (!res?.ok) throw new Error(res?.error || 'disable failed');
      outputService.append('Extensions', `[VSCODE EXT] disabled: ${id}`);
      if (res?.needsRestart) outputService.append('Extensions', `[VSCODE EXT] restart required to take effect`);
      await vscodeExtensionsService.listInstalled().catch(() => {});
    } catch (err) {
      setVsCodeError({ message: err?.message || String(err) });
    } finally {
      setVsCodeBusy(false);
    }
  };

  const uninstallVsCodeExtension = async (it) => {
    const id = String(it?.id || '').trim();
    if (!id) return;
    const ok = globalThis.confirm?.(t(`卸载扩展：${id}？`, `Uninstall extension: ${id}?`));
    if (!ok) return;
    setVsCodeBusy(true);
    try {
      const res = await vscodeExtensionsService.uninstall(id);
      if (!res?.ok) throw new Error(res?.error || 'uninstall failed');
      outputService.append('Extensions', `[VSCODE EXT] uninstalled: ${id}`);
      if (res?.needsRestart) outputService.append('Extensions', `[VSCODE EXT] restart required to take effect`);
      await vscodeExtensionsService.listInstalled().catch(() => {});
    } catch (err) {
      setVsCodeError({ message: err?.message || String(err) });
    } finally {
      setVsCodeBusy(false);
    }
  };

  const openVsCodeDetails = async (id) => {
    const targetId = String(id || '').trim();
    if (!targetId || !vscodeExtensionsService.isAvailable()) return;
    setVsCodeDetailOpen(true);
    setVsCodeDetailId(targetId);
    setVsCodeDetail(null);
    setVsCodeDetailError('');
    setVsCodeDetailTab('overview');

    const reqId = (vsCodeDetailReqRef.current += 1);
    setVsCodeDetailBusy(true);
    try {
      const res = await vscodeExtensionsService.getDetail(targetId);
      if (reqId !== vsCodeDetailReqRef.current) return;
      if (!res?.ok) {
        setVsCodeDetail(null);
        setVsCodeDetailError(String(res?.error || 'get detail failed'));
        return;
      }
      setVsCodeDetail(res?.item || null);
    } catch (err) {
      if (reqId !== vsCodeDetailReqRef.current) return;
      setVsCodeDetail(null);
      setVsCodeDetailError(err?.message || String(err));
    } finally {
      if (reqId !== vsCodeDetailReqRef.current) return;
      setVsCodeDetailBusy(false);
    }
  };

  const closeVsCodeDetails = () => {
    vsCodeDetailReqRef.current += 1;
    setVsCodeDetailOpen(false);
    setVsCodeDetailId('');
    setVsCodeDetail(null);
    setVsCodeDetailError('');
    setVsCodeDetailBusy(false);
    setVsCodeDetailTab('overview');
  };

  const renderVsCodeDetailBody = () => {
    if (!vsCodeDetailId) return <div style={{ opacity: 0.8 }}>{t('缺少扩展 ID。', 'Missing extension id.')}</div>;
    if (vsCodeDetailBusy && !vsCodeDetail && !vsCodeDetailError) return <div className="spinner" />;
    if (vsCodeDetailError) return <div style={{ color: '#f48771', whiteSpace: 'pre-wrap' }}>{String(vsCodeDetailError)}</div>;
    if (!vsCodeDetail) return <div style={{ opacity: 0.8 }}>{t('暂无详情数据。', 'No detail available.')}</div>;

    const rec = vsCodeDetail && typeof vsCodeDetail === 'object' ? vsCodeDetail : {};
    const manifest = rec?.manifest && typeof rec.manifest === 'object' ? rec.manifest : {};
    const contributes = manifest?.contributes && typeof manifest.contributes === 'object' ? manifest.contributes : {};

    const activationEvents = Array.isArray(manifest.activationEvents) ? manifest.activationEvents : [];
    const contribCommands = Array.isArray(contributes.commands) ? contributes.commands : [];
    const keybindings = Array.isArray(contributes.keybindings) ? contributes.keybindings : [];
    const menus = contributes.menus && typeof contributes.menus === 'object' ? contributes.menus : {};
    const languages = Array.isArray(contributes.languages) ? contributes.languages : [];
    const grammars = Array.isArray(contributes.grammars) ? contributes.grammars : [];
    const snippets = Array.isArray(contributes.snippets) ? contributes.snippets : [];
    const themes = Array.isArray(contributes.themes) ? contributes.themes : [];
    const iconThemes = Array.isArray(contributes.iconThemes) ? contributes.iconThemes : [];
    const configuration = contributes.configuration;
    const dependencies = Array.isArray(manifest.extensionDependencies) ? manifest.extensionDependencies : [];
    const pack = Array.isArray(manifest.extensionPack) ? manifest.extensionPack : [];

    if (vsCodeDetailTab === 'contributes') {
      const menuKeys = Object.keys(menus || {}).sort((a, b) => a.localeCompare(b));
      const menuItemCount = menuKeys.reduce((acc, k) => acc + (Array.isArray(menus?.[k]) ? menus[k].length : 0), 0);
      const menusText = (() => {
        if (!menuKeys.length) return '';
        const lines = [];
        for (const k of menuKeys.slice(0, 120)) {
          const items = Array.isArray(menus?.[k]) ? menus[k] : [];
          lines.push(`${k} (${items.length})`);
          for (const it of items.slice(0, 40)) {
            const cmd = String(it?.command || '').trim();
            if (!cmd) continue;
            const group = it?.group != null ? String(it.group) : '';
            const when = it?.when != null ? String(it.when) : '';
            const suffix = `${group ? ` [${group}]` : ''}${when ? ` when ${when}` : ''}`;
            lines.push(`  - ${cmd}${suffix}`);
          }
        }
        if (menuKeys.length > 120) lines.push(`… (${menuKeys.length - 120} more locations)`);
        return lines.join('\n');
      })();

      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('激活事件', 'Activation Events')}</div>
            {activationEvents.length ? (
              <pre className="extensions-footer-pre" style={{ margin: 0, maxHeight: 180, overflow: 'auto' }}>{activationEvents.join('\n')}</pre>
            ) : (
              <div style={{ opacity: 0.8 }}>{t('无。', 'None.')}</div>
            )}
          </div>

          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('命令', 'Commands')}</div>
            {contribCommands.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {contribCommands.slice(0, 200).map((c) => (
                  <div key={String(c?.command || Math.random())} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                    <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace', opacity: 0.95, overflowWrap: 'anywhere', flex: '0 0 320px' }}>
                      {String(c?.command || '')}
                    </div>
                    <div style={{ opacity: 0.85, overflowWrap: 'anywhere' }}>{String(c?.title || '')}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ opacity: 0.8 }}>{t('无。', 'None.')}</div>
            )}
          </div>

          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('快捷键', 'Keybindings')}</div>
            {keybindings.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {keybindings.slice(0, 240).map((kb, idx) => {
                  const command = String(kb?.command || '');
                  const key = String(kb?.key || '');
                  const win = String(kb?.win || '');
                  const mac = String(kb?.mac || '');
                  const linux = String(kb?.linux || '');
                  const when = String(kb?.when || '');
                  const spec = key || win || mac || linux ? [key && `key=${key}`, win && `win=${win}`, mac && `mac=${mac}`, linux && `linux=${linux}`].filter(Boolean).join(' ') : '';
                  return (
                    <div key={`${command || 'kb'}_${idx}`} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                      <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace', opacity: 0.95, overflowWrap: 'anywhere', flex: '0 0 320px' }}>
                        {command || t('(缺少 command)', '(missing command)')}
                      </div>
                      <div style={{ opacity: 0.85, overflowWrap: 'anywhere' }}>
                        {spec || t('未声明 key/win/mac/linux', 'No key/win/mac/linux specified')}
                        {when ? <span style={{ opacity: 0.9 }}>{` • when ${when}`}</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ opacity: 0.8 }}>{t('无。', 'None.')}</div>
            )}
          </div>

          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('菜单', 'Menus')}</div>
            {menuItemCount ? (
              <pre className="extensions-footer-pre" style={{ margin: 0, maxHeight: 260, overflow: 'auto' }}>{menusText}</pre>
            ) : (
              <div style={{ opacity: 0.8 }}>{t('无。', 'None.')}</div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('主题', 'Themes')}</div>
              {themes.length ? (
                <pre className="extensions-footer-pre" style={{ margin: 0, maxHeight: 160, overflow: 'auto' }}>{themes.map((x) => String(x?.label || x?.id || x?.path || '')).filter(Boolean).join('\n')}</pre>
              ) : (
                <div style={{ opacity: 0.8 }}>{t('无。', 'None.')}</div>
              )}
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('图标主题', 'Icon Themes')}</div>
              {iconThemes.length ? (
                <pre className="extensions-footer-pre" style={{ margin: 0, maxHeight: 160, overflow: 'auto' }}>{iconThemes.map((x) => String(x?.label || x?.id || x?.path || '')).filter(Boolean).join('\n')}</pre>
              ) : (
                <div style={{ opacity: 0.8 }}>{t('无。', 'None.')}</div>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('语言', 'Languages')}</div>
              {languages.length ? (
                <pre className="extensions-footer-pre" style={{ margin: 0, maxHeight: 180, overflow: 'auto' }}>
                  {languages.slice(0, 200).map((x) => {
                    const id = String(x?.id || x?.language || '').trim();
                    const aliases = Array.isArray(x?.aliases) ? x.aliases.map((a) => String(a)).filter(Boolean) : [];
                    const exts = Array.isArray(x?.extensions) ? x.extensions.map((e) => String(e)).filter(Boolean) : [];
                    const tail = `${aliases.length ? ` aliases=${aliases.join(',')}` : ''}${exts.length ? ` extensions=${exts.join(',')}` : ''}`.trim();
                    return `${id || '(unknown)'}${tail ? ` ${tail}` : ''}`;
                  }).join('\n')}
                </pre>
              ) : (
                <div style={{ opacity: 0.8 }}>{t('无。', 'None.')}</div>
              )}
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('语法 / Snippets', 'Grammars / Snippets')}</div>
              {(grammars.length || snippets.length) ? (
                <pre className="extensions-footer-pre" style={{ margin: 0, maxHeight: 180, overflow: 'auto' }}>
                  {[
                    grammars.length ? `grammars (${grammars.length})` : '',
                    ...grammars.slice(0, 80).map((g) => {
                      const lang = String(g?.language || '').trim();
                      const scope = String(g?.scopeName || '').trim();
                      const pathVal = String(g?.path || '').trim();
                      return `  - ${lang || '(unknown)'} ${scope ? `scope=${scope}` : ''} ${pathVal ? `path=${pathVal}` : ''}`.trim();
                    }),
                    snippets.length ? `snippets (${snippets.length})` : '',
                    ...snippets.slice(0, 80).map((s) => {
                      const lang = String(s?.language || '').trim();
                      const pathVal = String(s?.path || '').trim();
                      return `  - ${lang || '(unknown)'} ${pathVal ? `path=${pathVal}` : ''}`.trim();
                    }),
                  ].filter(Boolean).join('\n')}
                </pre>
              ) : (
                <div style={{ opacity: 0.8 }}>{t('无。', 'None.')}</div>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('配置', 'Configuration')}</div>
              {configuration ? (
                <pre className="extensions-footer-pre" style={{ margin: 0, maxHeight: 240, overflow: 'auto' }}>{JSON.stringify(configuration, null, 2)}</pre>
              ) : (
                <div style={{ opacity: 0.8 }}>{t('无。', 'None.')}</div>
              )}
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('依赖', 'Dependencies')}</div>
              {(dependencies.length || pack.length) ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {dependencies.length ? (
                    <div>
                      <div style={{ opacity: 0.85, marginBottom: 4 }}>{t('extensionDependencies', 'extensionDependencies')}</div>
                      <pre className="extensions-footer-pre" style={{ margin: 0, maxHeight: 140, overflow: 'auto' }}>{dependencies.map((x) => String(x)).join('\n')}</pre>
                    </div>
                  ) : null}
                  {pack.length ? (
                    <div>
                      <div style={{ opacity: 0.85, marginBottom: 4 }}>{t('extensionPack', 'extensionPack')}</div>
                      <pre className="extensions-footer-pre" style={{ margin: 0, maxHeight: 140, overflow: 'auto' }}>{pack.map((x) => String(x)).join('\n')}</pre>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div style={{ opacity: 0.8 }}>{t('无。', 'None.')}</div>
              )}
            </div>
          </div>
        </div>
      );
    }

    if (vsCodeDetailTab === 'manifest') {
      return (
        <pre className="extensions-footer-pre" style={{ margin: 0, maxHeight: '60vh', overflow: 'auto' }}>
          {JSON.stringify({ ...rec, manifest }, null, 2)}
        </pre>
      );
    }

    const title = String(manifest?.displayName || rec?.id || '');
    const menuKeys = Object.keys(menus || {});
    const menuItemCount = menuKeys.reduce((acc, k) => acc + (Array.isArray(menus?.[k]) ? menus[k].length : 0), 0);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{title}</div>
        <div style={{ opacity: 0.85, fontSize: '0.9rem', overflowWrap: 'anywhere' }}>
          {String(rec?.id || '')}
          {rec?.version ? ` • ${String(rec.version)}` : ''}
          {manifest?.engines?.vscode ? ` • engines.vscode=${String(manifest.engines.vscode)}` : ''}
        </div>
        {manifest?.description ? <div style={{ opacity: 0.9, overflowWrap: 'anywhere' }}>{String(manifest.description)}</div> : null}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: '0.9rem' }}>
          <div style={{ opacity: 0.85 }}>{t('发布者：', 'Publisher: ')}{String(rec?.publisher || manifest?.publisher || '')}</div>
          <div style={{ opacity: 0.85 }}>{t('状态：', 'State: ')}{rec?.enabled ? t('已启用', 'Enabled') : t('已禁用', 'Disabled')}</div>
          {rec?.installDir ? <div style={{ opacity: 0.85, overflowWrap: 'anywhere' }}>{t('目录：', 'Dir: ')}{String(rec.installDir)}</div> : null}
          {manifest?.main ? <div style={{ opacity: 0.85, overflowWrap: 'anywhere' }}>{t('入口：', 'Main: ')}{String(manifest.main)}</div> : null}
          {rec?.installedAt ? <div style={{ opacity: 0.85 }}>{t('安装时间：', 'Installed: ')}{new Date(rec.installedAt).toLocaleString()}</div> : null}
          {rec?.updatedAt ? <div style={{ opacity: 0.85 }}>{t('更新时间：', 'Updated: ')}{new Date(rec.updatedAt).toLocaleString()}</div> : null}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div className="extension-badge">{t('命令', 'Commands')}: {contribCommands.length}</div>
          <div className="extension-badge">{t('快捷键', 'Keybindings')}: {keybindings.length}</div>
          <div className="extension-badge">{t('菜单', 'Menus')}: {menuItemCount}</div>
          <div className="extension-badge">{t('激活事件', 'Activation Events')}: {activationEvents.length}</div>
          <div className="extension-badge">{t('主题', 'Themes')}: {themes.length}</div>
          <div className="extension-badge">{t('图标主题', 'Icon Themes')}: {iconThemes.length}</div>
          <div className="extension-badge">{t('配置', 'Configuration')}: {configuration ? 1 : 0}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="extensions-panel">
      <Modal
        isOpen={!!vsCodeDetailOpen}
        onClose={closeVsCodeDetails}
        title={t('VS Code 扩展详情', 'VS Code Extension Details')}
        width="920px"
        height="80vh"
        footer={(
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, width: '100%' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" className={vsCodeDetailTab === 'overview' ? 'primary-btn' : 'ghost-btn'} style={{ height: 34 }} onClick={() => setVsCodeDetailTab('overview')}>
                {t('概览', 'Overview')}
              </button>
              <button type="button" className={vsCodeDetailTab === 'contributes' ? 'primary-btn' : 'ghost-btn'} style={{ height: 34 }} onClick={() => setVsCodeDetailTab('contributes')}>
                {t('贡献点', 'Contributes')}
              </button>
              <button type="button" className={vsCodeDetailTab === 'manifest' ? 'primary-btn' : 'ghost-btn'} style={{ height: 34 }} onClick={() => setVsCodeDetailTab('manifest')}>
                {t('原始数据', 'Raw')}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {vsCodeDetail?.id ? (
                <>
                  <button
                    type="button"
                    className="ghost-btn"
                    style={{ height: 34 }}
                    disabled={vsCodeBusy}
                    onClick={async () => {
                      const cur = vsCodeDetail;
                      if (!cur) return;
                      if (cur.enabled) await disableVsCodeExtension(cur);
                      else await enableVsCodeExtension(cur);
                      await vscodeExtensionsService.listInstalled().catch(() => {});
                      await openVsCodeDetails(String(cur.id || '')).catch(() => {});
                    }}
                  >
                    {vsCodeDetail?.enabled ? t('禁用', 'Disable') : t('启用', 'Enable')}
                  </button>
                  <button
                    type="button"
                    className="ghost-btn danger"
                    style={{ height: 34 }}
                    disabled={vsCodeBusy}
                    onClick={async () => {
                      const cur = vsCodeDetail;
                      if (!cur) return;
                      await uninstallVsCodeExtension(cur);
                      await vscodeExtensionsService.listInstalled().catch(() => {});
                      closeVsCodeDetails();
                    }}
                  >
                    {t('卸载', 'Uninstall')}
                  </button>
                </>
              ) : null}
              <button type="button" className="ghost-btn" style={{ height: 34 }} onClick={closeVsCodeDetails}>
                {t('关闭', 'Close')}
              </button>
            </div>
          </div>
        )}
      >
        {renderVsCodeDetailBody()}
      </Modal>

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
          placeholder={t('搜索扩展（LSP / VS Code）', 'Search extensions (LSP / VS Code)')}
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

              <div className="extensions-section-title" style={{ marginTop: 16 }}>
                {t('VS Code 扩展（VSIX）', 'VS Code Extensions (VSIX)')}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                <div className="extension-sub" style={{ opacity: 0.85 }}>
                  {t('离线安装：选择 .vsix 文件。启用/禁用后需重启宿主生效。', 'Offline install: choose a .vsix file. Restart host after enable/disable.')}
                </div>
                <button type="button" className="ghost-btn" disabled={vsCodeBusy} onClick={() => void pickVsixAndInstall()} style={{ height: 30 }}>
                  {vsCodeBusy ? t('处理中…', 'Working…') : t('安装 VSIX', 'Install VSIX')}
                </button>
              </div>

              {vsCodeInstalled.length === 0 ? (
                <div className="extensions-empty">
                  {t('暂无已安装 VS Code 扩展。', 'No installed VS Code extensions.')}
                </div>
              ) : (
                <div className="extensions-list">
                  {vsCodeInstalled.map((it) => (
                    <div
                      key={String(it?.id || '')}
                      className="extension-item"
                      role="button"
                      tabIndex={0}
                      onClick={() => openVsCodeDetails(String(it?.id || '').trim())}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openVsCodeDetails(String(it?.id || '').trim());
                        }
                      }}
                    >
                      <div className="extension-icon">
                        <span className="codicon codicon-extensions" aria-hidden />
                      </div>
                      <div className="extension-main">
                        <div className="extension-name-row">
                          <div className="extension-name">{String(it?.manifest?.displayName || it?.id || '')}</div>
                          <div className="extension-badges">
                            {!!it?.enabled ? (
                              <span className="extension-badge enabled">{t('已启用', 'Enabled')}</span>
                            ) : (
                              <span className="extension-badge disabled">{t('已禁用', 'Disabled')}</span>
                            )}
                          </div>
                        </div>
                        <div className="extension-desc">{String(it?.manifest?.description || '')}</div>
                        <div className="extension-sub">{String(it?.id || '')}{it?.version ? ` • ${it.version}` : ''}</div>
                      </div>
                      <div className="extension-actions">
                        <button
                          type="button"
                          className="ghost-btn"
                          disabled={vsCodeBusy}
                          onClick={(e) => {
                            e.stopPropagation();
                            it?.enabled ? disableVsCodeExtension(it) : enableVsCodeExtension(it);
                          }}
                          style={{ height: 30 }}
                        >
                          {it?.enabled ? t('禁用', 'Disable') : t('启用', 'Enable')}
                        </button>
                        <button
                          type="button"
                          className="ghost-btn danger"
                          disabled={vsCodeBusy}
                          onClick={(e) => {
                            e.stopPropagation();
                            uninstallVsCodeExtension(it);
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
            </>
          ) : (
            <>
              <div className="extensions-section-title">{t('插件市场', 'Marketplace')}</div>
              {searching ? (
                <div className="extensions-empty">{t('搜索中…', 'Searching…')}</div>
              ) : searchItems.length === 0 ? (
                <div className="extensions-empty">{t('未找到结果。', 'No results.')}</div>
              ) : (
                <div className="extensions-list">
                  {searchItems.map((it) => {
                    const type = it?.type === 'vscode' ? 'vscode' : 'lsp';
                    const id = String(it?.id || '');
                    const installed = type === 'vscode'
                      ? vsCodeInstalled.some((x) => String(x?.id || '') === id)
                      : installedItems.some((x) => String(x?.id || '') === id);
                    const installingKey = `${type}:${id}`;
                    return (
                      <div
                        key={`${type}:${it?.source?.providerId || ''}:${id}:${it?.version || ''}`}
                        className="extension-item"
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (type === 'vscode') return;
                          onOpenDetails?.(String(it?.id || '').trim());
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            if (type === 'vscode') return;
                            onOpenDetails?.(String(it?.id || '').trim());
                          }
                        }}
                      >
                        <div className="extension-icon">
                          <span className={`codicon ${type === 'vscode' ? 'codicon-extensions' : 'codicon-package'}`} aria-hidden />
                        </div>
                        <div className="extension-main">
                          <div className="extension-name-row">
                            <div className="extension-name">{String(it?.name || it?.id || '')}</div>
                            <div className="extension-badges">
                              <span className="extension-badge">{type === 'vscode' ? 'VS Code' : 'LSP'}</span>
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
                            disabled={installed || installingIds.has(installingKey)}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (type === 'vscode') installVsCodeFromMarketplace(it);
                              else installFromMarketplace(it);
                            }}
                            style={{ height: 30 }}
                          >
                            {installed ? t('已安装', 'Installed') : (installingIds.has(installingKey) ? t('安装中…', 'Installing…') : t('安装', 'Install'))}
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

          {extensionsApi ? (
            <div className="extensions-footer">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div className="extensions-footer-title" style={{ marginBottom: 0 }}>
                  {t('扩展宿主（开发者）', 'Extension Host (Dev)')}
                </div>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => setShowExtHost((v) => !v)}
                  style={{ height: 30 }}
                >
                  {showExtHost ? t('收起', 'Collapse') : t('展开', 'Expand')}
                </button>
              </div>
              {showExtHost ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
                    <div style={{ opacity: 0.85, fontSize: '0.86rem', whiteSpace: 'pre-wrap' }}>
                      {extHostStatus?.ok
                        ? `${t('运行中', 'Running')}: ${extHostStatus?.running ? t('是', 'Yes') : t('否', 'No')}  •  ${t('已信任', 'Trusted')}: ${extHostStatus?.trusted ? t('是', 'Yes') : t('否', 'No')}`
                        : String(extHostStatus?.error || t('不可用', 'Unavailable'))}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button type="button" className="ghost-btn" disabled={extHostBusy} onClick={() => void refreshExtHostStatus()} style={{ height: 30 }}>
                        {t('刷新', 'Refresh')}
                      </button>
                      <button type="button" className="ghost-btn" disabled={extHostBusy} onClick={() => void loadExtHostExtensions()} style={{ height: 30 }}>
                        {t('列出', 'List')}
                      </button>
                      <button type="button" className="ghost-btn danger" disabled={extHostBusy} onClick={() => void restartExtHost()} style={{ height: 30 }}>
                        {t('重启', 'Restart')}
                      </button>
                    </div>
                  </div>
                  {extHostExtensions ? (
                    <pre className="extensions-footer-pre" style={{ marginTop: 8 }}>
                      {JSON.stringify(extHostExtensions, null, 2)}
                    </pre>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          {lastProgress ? (
            <div className="extensions-footer">
              <div className="extensions-footer-title">{t('进度', 'Progress')}</div>
              <pre className="extensions-footer-pre">{JSON.stringify(lastProgress, null, 2)}</pre>
            </div>
          ) : null}
          {vsCodeProgress ? (
            <div className="extensions-footer">
              <div className="extensions-footer-title">{t('VSIX 进度', 'VSIX Progress')}</div>
              <pre className="extensions-footer-pre">{JSON.stringify(vsCodeProgress, null, 2)}</pre>
            </div>
          ) : null}
          {lastError ? (
            <div className="extensions-footer error">
              <div className="extensions-footer-title">{t('错误', 'Error')}</div>
              <pre className="extensions-footer-pre">{String(lastError?.message || '')}</pre>
            </div>
          ) : null}
          {vsCodeError ? (
            <div className="extensions-footer error">
              <div className="extensions-footer-title">{t('VSIX 错误', 'VSIX Error')}</div>
              <pre className="extensions-footer-pre">{String(vsCodeError?.message || '')}</pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
