import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import Modal from '../Modal';
import { pluginsService } from '../../workbench/services/pluginsService';

const coercePluginRef = (pluginRef) => {
  const id = String(pluginRef?.id || '').trim();
  const providerId = pluginRef?.providerId != null ? String(pluginRef.providerId || '').trim() : '';
  const name = pluginRef?.name != null ? String(pluginRef.name || '').trim() : '';
  const version = pluginRef?.version != null ? String(pluginRef.version || '').trim() : '';
  return { id, providerId, name, version };
};

export default function PluginDetailPanel({
  isOpen,
  pluginRef,
  onClose,
  language = 'zh',
}) {
  const t = (zh, en) => (language === 'zh' ? zh : en);
  const ref = useMemo(() => coercePluginRef(pluginRef), [pluginRef]);
  const canOpenExternalLink = () => {
    const api = globalThis?.window?.electronAPI || null;
    return !!(api?.window?.openPopup || api?.shell?.openExternal);
  };
  const openExternal = async (url) => {
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
  };

  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cached, setCached] = useState(false);
  const [activeTab, setActiveTab] = useState('readme');

  useEffect(() => {
    if (!isOpen) return;
    setDetail(null);
    setError('');
    setBusy(false);
    setCached(false);
    setActiveTab('readme');
  }, [isOpen, ref.id, ref.providerId]);

  const load = async ({ forceRefresh = false } = {}) => {
    if (!ref.id) return;
    setBusy(true);
    setError('');
    try {
      const res = await pluginsService.getDetail(ref.id, ref.providerId || undefined, { forceRefresh: !!forceRefresh });
      if (res?.ok && res?.detail) {
        setDetail(res.detail);
        setCached(!!res?.cached);
        const nextTab = (() => {
          if (res.detail.readme) return 'readme';
          if (res.detail.changelog) return 'changelog';
          return 'capabilities';
        })();
        setActiveTab((prev) => {
          const safe = (prev === 'readme' || prev === 'changelog' || prev === 'capabilities') ? prev : nextTab;
          if (safe === 'readme' && !res.detail.readme) return res.detail.changelog ? 'changelog' : 'capabilities';
          if (safe === 'changelog' && !res.detail.changelog) return res.detail.readme ? 'readme' : 'capabilities';
          if (safe === 'capabilities' && (res.detail.readme || res.detail.changelog)) return res.detail.readme ? 'readme' : 'changelog';
          return safe;
        });
      } else {
        setDetail(null);
        setCached(false);
        setError(String(res?.error || t('获取插件详情失败', 'Failed to load plugin details')));
      }
    } catch (e) {
      setDetail(null);
      setCached(false);
      setError(String(e?.message || e || t('获取插件详情失败', 'Failed to load plugin details')));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    if (!ref.id) return;
    void load({ forceRefresh: false });
  }, [isOpen, ref.id, ref.providerId]);

  const title = (() => {
    const left = ref.name || ref.id || t('插件详情', 'Plugin Details');
    const right = ref.providerId ? ` • ${ref.providerId}` : '';
    return `${left}${right}`;
  })();

  const hasReadme = !!detail?.readme;
  const hasChangelog = !!detail?.changelog;
  const caps = Array.isArray(detail?.capabilities) ? detail.capabilities : [];
  const deps = Array.isArray(detail?.dependencies) ? detail.dependencies : [];

  const markdownSchema = useMemo(() => ({
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
  }), []);

  const markdownComponents = useMemo(() => ({
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
  }), []);

  const renderMeta = () => {
    if (!detail) return null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{String(detail?.name || detail?.id || '')}</div>
        <div style={{ opacity: 0.8, fontSize: '0.86rem', overflowWrap: 'anywhere' }}>
          {String(detail?.id || '')}
          {detail?.version ? ` • ${detail.version}` : ''}
          {detail?.source?.providerId ? ` • ${detail.source.providerId}` : ''}
          {cached ? ` • ${t('缓存', 'cached')}` : ''}
        </div>
        {detail?.description ? <div style={{ opacity: 0.9, overflowWrap: 'anywhere' }}>{String(detail.description)}</div> : null}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', opacity: 0.85, fontSize: '0.86rem' }}>
          {detail?.publisher?.name ? <span>{t('发布者：', 'Publisher: ')}{String(detail.publisher.name)}</span> : null}
          {detail?.license ? <span>{t('许可证：', 'License: ')}{String(detail.license)}</span> : null}
          {detail?.repository ? (
            <a
              href={String(detail.repository)}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'inherit' }}
              onClick={(e) => {
                const safeHref = String(detail.repository || '').trim();
                if (!/^https?:\/\//i.test(safeHref)) return;
                if (!canOpenExternalLink()) return;
                e.preventDefault();
                e.stopPropagation();
                void openExternal(safeHref);
              }}
            >
              {t('仓库', 'Repository')}
            </a>
          ) : null}
        </div>
      </div>
    );
  };

  const renderTabs = () => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
      <button
        type="button"
        className={activeTab === 'readme' ? 'primary-btn' : 'ghost-btn'}
        style={{ height: 32 }}
        onClick={() => setActiveTab('readme')}
        disabled={!hasReadme}
      >
        README
      </button>
      <button
        type="button"
        className={activeTab === 'changelog' ? 'primary-btn' : 'ghost-btn'}
        style={{ height: 32 }}
        onClick={() => setActiveTab('changelog')}
        disabled={!hasChangelog}
      >
        Changelog
      </button>
      <button
        type="button"
        className={activeTab === 'capabilities' ? 'primary-btn' : 'ghost-btn'}
        style={{ height: 32 }}
        onClick={() => setActiveTab('capabilities')}
      >
        {t('功能', 'Features')}
      </button>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <button type="button" className="ghost-btn" style={{ height: 32 }} onClick={() => load({ forceRefresh: true })} disabled={busy}>
          {busy ? t('加载中…', 'Loading…') : t('刷新', 'Refresh')}
        </button>
      </div>
    </div>
  );

  const renderBody = () => {
    if (!ref.id) return <div style={{ opacity: 0.8 }}>{t('缺少插件 ID。', 'Missing plugin id.')}</div>;
    if (busy && !detail && !error) return <div className="spinner" />;
    if (error) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ color: '#f48771', whiteSpace: 'pre-wrap' }}>{String(error)}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="primary-btn" style={{ height: 34 }} onClick={() => load({ forceRefresh: false })} disabled={busy}>
              {t('重试', 'Retry')}
            </button>
            <button type="button" className="ghost-btn" style={{ height: 34 }} onClick={() => load({ forceRefresh: true })} disabled={busy}>
              {t('强制刷新', 'Force refresh')}
            </button>
          </div>
        </div>
      );
    }
    if (!detail) return <div style={{ opacity: 0.8 }}>{t('暂无详情数据。', 'No detail available.')}</div>;

    if (activeTab === 'changelog') {
      return hasChangelog ? (
        <div className="markdown-content">
          <ReactMarkdown rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSchema]]} components={markdownComponents}>
            {String(detail.changelog || '')}
          </ReactMarkdown>
        </div>
      ) : (
        <div style={{ opacity: 0.8 }}>{t('暂无 Changelog。', 'No changelog.')}</div>
      );
    }

    if (activeTab === 'capabilities') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('功能列表', 'Features')}</div>
            {caps.length === 0 ? (
              <div style={{ opacity: 0.8 }}>{t('暂无功能信息。', 'No feature information.')}</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {caps.map((c) => (
                  <li key={String(c)} style={{ overflowWrap: 'anywhere' }}>{String(c)}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('依赖', 'Dependencies')}</div>
            {deps.length === 0 ? (
              <div style={{ opacity: 0.8 }}>{t('无依赖。', 'No dependencies.')}</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {deps.map((d) => (
                  <li key={`${d?.id || ''}:${d?.version || ''}`} style={{ overflowWrap: 'anywhere' }}>
                    {String(d?.id || '')}{d?.version ? `@${d.version}` : ''}{d?.optional ? ` (${t('可选', 'optional')})` : ''}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      );
    }

    return hasReadme ? (
      <div className="markdown-content">
        <ReactMarkdown rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSchema]]} components={markdownComponents}>
          {String(detail.readme || '')}
        </ReactMarkdown>
      </div>
    ) : (
      <div style={{ opacity: 0.8 }}>{t('暂无 README。', 'No README.')}</div>
    );
  };

  return (
    <Modal
      isOpen={!!isOpen}
      onClose={onClose}
      title={title}
      width="900px"
      height="80vh"
      footer={(
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="ghost-btn" style={{ height: 34 }} onClick={onClose}>
            {t('关闭', 'Close')}
          </button>
        </div>
      )}
    >
      {renderMeta()}
      {renderTabs()}
      {renderBody()}
    </Modal>
  );
}
