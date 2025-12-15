import React, { useMemo, useState, useEffect, Suspense } from 'react';

const MonacoEditor = React.lazy(() => import('@monaco-editor/react'));
const MonacoDiffEditor = React.lazy(() =>
  import('@monaco-editor/react').then((mod) => ({ default: mod.DiffEditor }))
);

const EXT_ICONS = {
  js: 'codicon-file-code',
  jsx: 'codicon-file-code',
  ts: 'codicon-file-code',
  tsx: 'codicon-file-code',
  html: 'codicon-code',
  css: 'codicon-symbol-color',
  json: 'codicon-json',
  md: 'codicon-markdown',
  txt: 'codicon-file-text',
  py: 'codicon-symbol-keyword',
};

const LANG_MAP = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  css: 'css',
  html: 'html',
  json: 'json',
  md: 'markdown',
  py: 'python',
};

const getIconClass = (path) => {
  const ext = path.split('.').pop();
  return EXT_ICONS[ext] || 'codicon-file';
};

const inferLanguage = (path) => LANG_MAP[path.split('.').pop()] || 'plaintext';

const themedFallback = (message) => `
  <style>
    body { margin: 0; }
    .__preview-fallback { font-family: Inter, Arial, sans-serif; padding: 1.5rem; color: #111827; background: #f3f4f6; min-height: 100vh; }
    @media (prefers-color-scheme: dark) {
      .__preview-fallback { color: #e5e7eb; background: #1e1e1e; }
    }
  </style>
  <div class="__preview-fallback">${message}</div>
`;

const stripExternalScripts = (html = '') =>
  html.replace(/<script[^>]*src=["'][^"']+["'][^>]*>\s*<\/script>/gi, '');

const wrapHtml = (content, css, scripts, headExtras = '') => {
  const base =
    content && content.includes('<html')
      ? stripExternalScripts(content)
      : `<!doctype html><html><head></head><body>${
          content || themedFallback('Nothing to preview')
        }</body></html>`;

  const headInjected = base.includes('</head>')
    ? base.replace(
        '</head>',
        `${headExtras || ''}<style>${css || ''}</style></head>`
      )
    : `${headExtras || ''}<style>${css || ''}</style>${base}`;

  if (headInjected.includes('</body>')) {
    return headInjected.replace('</body>', `${scripts || ''}</body>`);
  }
  return `${headInjected}${scripts || ''}`;
};

const buildPreviewDoc = ({ files, liveContent, entryCandidates, preferredEntry }) => {
  const fileMap = Object.fromEntries(files.map((f) => [f.path, f]));
  if (liveContent && liveContent.trim().length > 0) {
    return wrapHtml(liveContent, '', '');
  }

  const css = files
    .filter((f) => f.path.toLowerCase().endsWith('.css'))
    .map((f) => f.content || '')
    .join('\n');

  const resolveEntry = () => {
    if (preferredEntry && fileMap[preferredEntry]) return preferredEntry;
    const htmlEntry =
      (entryCandidates || []).find((f) => f.toLowerCase().endsWith('.html')) ||
      files.find((f) => f.path.toLowerCase().endsWith('.html'))?.path;
    if (htmlEntry) return htmlEntry;
    const jsxEntry =
      (entryCandidates || []).find((f) => f.toLowerCase().endsWith('.jsx') || f.toLowerCase().endsWith('.tsx')) ||
      files.find((f) => f.path.toLowerCase().endsWith('.jsx') || f.path.toLowerCase().endsWith('.tsx'))?.path;
    if (jsxEntry) return jsxEntry;
    const jsEntry = files.find((f) => f.path.toLowerCase().endsWith('.js'))?.path;
    if (jsEntry) return jsEntry;
    const pyEntry = (entryCandidates || []).find((f) => f.toLowerCase().endsWith('.py'));
    if (pyEntry) return pyEntry;
    return null;
  };

  const entry = resolveEntry();
  const entryFile = entry ? fileMap[entry] : null;
  const entryExt = entry ? entry.toLowerCase().split('.').pop() : '';

  // If HTML entry
  if (entryFile && entryExt === 'html') {
    const sanitizedHtml = stripExternalScripts(entryFile.content || '');
    const htmlHasInlineScript = sanitizedHtml ? /<script[\s\S]*?>[\s\S]*?<\/script>/i.test(sanitizedHtml) : false;
    const scripts = htmlHasInlineScript ? '' : '';
    return wrapHtml(
      sanitizedHtml || themedFallback('请选择文件以预览'),
      css,
      scripts,
      ''
    );
  }

  // If JSX/TSX entry
  if (entryFile && (entryExt === 'jsx' || entryExt === 'tsx')) {
    const jsx = entryFile.content || '';
    const headExtras = `
      <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
      <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
      <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    `;
    const scripts = `
      <script type="text/babel">
        ${jsx}
      </script>
    `;
    return wrapHtml(`<div id="root"></div>`, css, scripts, headExtras);
  }

  // If JS entry
  if (entryFile && entryExt === 'js') {
    const js = entryFile.content || '';
    const scripts = `<script>${js}</script>`;
    return wrapHtml(`<div id="root"></div>`, css, scripts, '');
  }

  // If Python entry fallback
  if (entry && entryExt === 'py') {
    const html = `<main style="font-family:Inter,Arial,sans-serif;padding:2rem;line-height:1.6;">
      <h2 style="margin-top:0;">Python entry detected: ${entry}</h2>
      <p>Run the backend or start the script locally to preview the app. Frontend preview shows files only.</p>
    </main>`;
    return wrapHtml(html, css, '', '');
  }

  // Fallback: auto aggregate
  const htmlCandidate =
    (entryCandidates || []).find((f) => f.toLowerCase().endsWith('.html')) ||
    files.find((f) => f.path.toLowerCase().endsWith('.html'))?.path;

  const jsxCandidate =
    (entryCandidates || []).find((f) => f.toLowerCase().endsWith('.jsx') || f.toLowerCase().endsWith('.tsx')) ||
    files.find((f) => f.path.toLowerCase().endsWith('.jsx') || f.path.toLowerCase().endsWith('.tsx'))?.path;

  const js = files
    .filter((f) => f.path.toLowerCase().endsWith('.js'))
    .map((f) => f.content || '')
    .join('\n');
  const jsx = files
    .filter((f) => f.path.toLowerCase().endsWith('.jsx') || f.path.toLowerCase().endsWith('.tsx'))
    .map((f) => f.content || '')
    .join('\n');

  let htmlSource = htmlCandidate ? fileMap[htmlCandidate]?.content : null;

  if (!htmlSource && jsxCandidate) {
    htmlSource = `<div id="root"></div>`;
  }

  const sanitizedHtml = htmlSource ? stripExternalScripts(htmlSource) : htmlSource;
  const htmlHasInlineScript = sanitizedHtml ? /<script[\s\S]*?>[\s\S]*?<\/script>/i.test(sanitizedHtml) : false;

  const needsBabel = jsx.trim().length > 0 && !htmlHasInlineScript;
  const headExtras = needsBabel
    ? `
      <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
      <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
      <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    `
    : '';

  const shouldInjectAppScripts = !htmlHasInlineScript;
  const scripts = shouldInjectAppScripts
    ? `
    ${js ? `<script>${js}</script>` : ''}
    ${jsx ? `<script type="text/babel">${jsx}</script>` : ''}
  `
    : '';

  return wrapHtml(
    sanitizedHtml || themedFallback('请选择文件以预览'),
    css,
    scripts,
    headExtras
  );
};

function Workspace({
  files,
  openTabs,
  activeFile,
  viewMode,
  livePreviewContent,
  entryCandidates,
  loading,
  hasWorkspace,
  workspaceRootLabel,
  workspaceRoots,
  bindingStatus,
  bindingError,
  hotReloadToken,
  theme,
  backendRoot,
  welcomeTabPath,
  renderWelcomeTab,
  onOpenWelcomeTab,
  previewEntry = '',
  onSelectFolder,
  onBindBackendRoot,
  onOpenFile,
  onCloseFile,
  onFileChange,
  onActiveFileChange,
  onTabReorder,
  onAddFile,
  onAddFolder,
  onRefreshPreview,
  onToggleTheme,
  onToggleView,
  onSyncStructure,
  onPreviewEntryChange,
  settingsTabPath,
  renderSettingsTab,
  diffTabPrefix,
  diffTabs,
}) {
  const monacoTheme = useMemo(() => {
    if (theme === 'high-contrast') return 'hc-black';
    return theme === 'dark' ? 'vs-dark' : 'vs';
  }, [theme]);

  const monacoOptions = useMemo(
    () => ({
      minimap: { enabled: true, renderCharacters: false },
      glyphMargin: true,
      folding: true,
      renderLineHighlight: 'all',
      lineNumbers: 'on',
      wordWrap: 'off',
      automaticLayout: true,
      scrollBeyondLastLine: true,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace",
      fontLigatures: true,
      fontSize: 14,
      lineHeight: 20,
      letterSpacing: 0,
      tabSize: 4,
      contextmenu: true,
      smoothScrolling: true,
      renderWhitespace: 'none',
      bracketPairColorization: { enabled: true },
      guides: { indentation: true, highlightActiveIndentation: true },
      quickSuggestions: true,
      cursorBlinking: 'blink',
    }),
    []
  );

  const previewOptions = useMemo(
    () =>
      files
        .filter((f) => {
          const ext = f.path.toLowerCase();
          return ext.endsWith('.html') || ext.endsWith('.jsx') || ext.endsWith('.tsx') || ext.endsWith('.js') || ext.endsWith('.py');
        })
        .map((f) => f.path),
    [files]
  );

  const previewDoc = useMemo(
    () => buildPreviewDoc({ files, liveContent: livePreviewContent, entryCandidates, preferredEntry: previewEntry }),
    [files, livePreviewContent, entryCandidates, previewEntry]
  );

  const activeContent = files.find((f) => f.path === activeFile)?.content || '';
  
  const updatedPaths = useMemo(
    () => new Set(files.filter((f) => f.updated).map((f) => f.path)),
    [files]
  );

  const breadcrumbParts = useMemo(() => {
    if (!activeFile) return [];
    return activeFile.split('/').filter(Boolean);
  }, [activeFile]);

  const projectLabel = useMemo(() => {
    if (workspaceRoots && Array.isArray(workspaceRoots) && workspaceRoots.length > 1) {
      const names = workspaceRoots.map((r) => (r && (r.name || r.path)) || '').filter(Boolean);
      if (names.length > 0) return names.join(' • ');
    }
    return workspaceRootLabel;
  }, [workspaceRootLabel, workspaceRoots]);

  const editorPane = (
    <div className="workspace-editor">
          <div className="tab-row">
            {openTabs.map((path, idx) => {
              const isSettingsTab = settingsTabPath && path === settingsTabPath;
              const isWelcomeTab = welcomeTabPath && path === welcomeTabPath;
              const isDiffTab = diffTabPrefix && path.startsWith(diffTabPrefix);
              const diff = isDiffTab && diffTabs ? diffTabs[path] : null;
              const diffLabel = diff
                ? (diff.path ? `Diff: ${diff.path}` : (diff.files ? 'Diff (multi-file)' : 'Diff'))
                : 'Diff';
              return (
              // VS Code tab styling: icon + title, dirty dot, close button on hover
              <div
                key={path}
                className={`tab ${activeFile === path ? 'active' : ''} ${updatedPaths.has(path) ? 'tab-updated' : ''}`}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', idx.toString())}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = Number(e.dataTransfer.getData('text/plain'));
                  onTabReorder(from, idx);
                }}
              >
                <button
                  className="tab-main"
                  onClick={() => onActiveFileChange(path)}
                  title={path}
                  type="button"
                >
                  <span className="tab-text">
                    {isSettingsTab
                      ? 'Settings'
                      : (isWelcomeTab ? 'Welcome' : (isDiffTab ? diffLabel : path.split('/').pop()))}
                  </span>
                  {updatedPaths.has(path) && <span className="tab-dirty codicon codicon-circle-filled" aria-label="未保存更改" />}
                </button>
                <button onClick={() => onCloseFile(path)} className="tab-close" title="Close tab">
                  <i className="codicon codicon-close" aria-hidden />
                </button>
              </div>
            );})}
          </div>
          <div className="editor-breadcrumbs" role="navigation" aria-label="Breadcrumbs">
            {activeFile && projectLabel && activeFile !== settingsTabPath && activeFile !== welcomeTabPath && !(diffTabPrefix && activeFile && activeFile.startsWith(diffTabPrefix)) && (
              <span className="breadcrumb-root">
                {projectLabel}
              </span>
            )}
            {activeFile && activeFile !== settingsTabPath && activeFile !== welcomeTabPath && !(diffTabPrefix && activeFile && activeFile.startsWith(diffTabPrefix)) && breadcrumbParts.map((part, idx) => (
              <span key={`${part}-${idx}`} className="breadcrumb-part">
                <i className="codicon codicon-chevron-right" aria-hidden />
                <span>{part}</span>
              </span>
            ))}
          </div>
          <div className="monaco-shell">
            {activeFile ? (
                settingsTabPath && activeFile === settingsTabPath && renderSettingsTab
                  ? renderSettingsTab()
                  : (welcomeTabPath && activeFile === welcomeTabPath && renderWelcomeTab
                      ? renderWelcomeTab()
                      : (diffTabPrefix && activeFile && activeFile.startsWith(diffTabPrefix) && diffTabs && diffTabs[activeFile]
                          ? (
                            <Suspense fallback={<div className="monaco-fallback">Loading Diff Editor…</div>}>
                              {diffTabs[activeFile].files ? (
                                <div style={{ height: '100%', overflowY: 'auto' }}>
                                  {diffTabs[activeFile].files.map((file) => (
                                    <div key={file.path} style={{ height: '300px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
                                      <div style={{ 
                                          padding: '8px 16px', 
                                          background: 'var(--panel-sub)', 
                                          borderBottom: '1px solid var(--border)',
                                          fontSize: '13px',
                                          fontWeight: '600',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '8px'
                                      }}>
                                          <span style={{ 
                                              color: file.status === 'M' ? '#e2c08d' : (file.status === 'A' ? '#73c991' : (file.status === 'D' ? '#f14c4c' : '#999')), 
                                              fontWeight: 'bold',
                                              width: '16px',
                                              textAlign: 'center'
                                          }}>
                                              {file.status}
                                          </span>
                                          {file.path}
                                      </div>
                                      <div style={{ flex: 1, minHeight: 0 }}>
                                          <MonacoDiffEditor
                                              height="100%"
                                              language={inferLanguage(file.path || '')}
                                              original={file.before || ''}
                                              modified={file.after || ''}
                                              theme={monacoTheme}
                                              options={{
                                                  ...monacoOptions,
                                                  readOnly: true,
                                                  renderSideBySide: true,
                                                  wordWrap: 'off',
                                                  minimap: { enabled: false },
                                                  scrollBeyondLastLine: false,
                                                  padding: { top: 8, bottom: 8 }
                                              }}
                                          />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <MonacoDiffEditor
                                  height="100%"
                                  language={inferLanguage(diffTabs[activeFile].path || '')}
                                  original={diffTabs[activeFile].before || ''}
                                  modified={diffTabs[activeFile].after || ''}
                                  theme={monacoTheme}
                                  options={{
                                    ...monacoOptions,
                                    readOnly: true,
                                    renderSideBySide: true,
                                    wordWrap: 'off'
                                  }}
                                />
                              )}
                            </Suspense>
                          )
                          : (
                            <Suspense fallback={<div className="monaco-fallback">Loading Monaco Editor…</div>}>
                              <MonacoEditor
                                key={`editor-${activeFile}`}
                                height="100%"
                                language={inferLanguage(activeFile)}
                                theme={monacoTheme}
                                value={activeContent}
                                options={monacoOptions}
                                onChange={(value) => onFileChange(activeFile, value ?? '')}
                              />
                            </Suspense>
                          )
                        )
                    )
            ) : (
              <div className="monaco-empty" aria-label="No file open" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {!hasWorkspace && onOpenWelcomeTab ? (
                  <div style={{ textAlign: 'center', padding: 24 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No editor open</div>
                    <div style={{ color: 'var(--muted)', marginBottom: 12 }}>打开 Welcome 或选择项目文件夹开始</div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                      <button className="primary-btn" onClick={onOpenWelcomeTab}>Open Welcome</button>
                      <button className="ghost-btn" onClick={onSelectFolder}>📁 Open Folder</button>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
    </div>
  );

  return (
    <div className="workspace-shell">
      <div className={`workspace-body ${viewMode === 'preview' ? 'preview-only' : 'code-only'}`}>
        {viewMode === 'code' || viewMode === 'diff' ? (
          editorPane
        ) : (
          <div className="workspace-preview fullscreen-preview">
            <div className="preview-header">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span>Live Preview</span>
                  <select
                    value={previewEntry}
                    onChange={(e) => onPreviewEntryChange?.(e.target.value)}
                    className="ghost-input"
                    style={{ minWidth: '200px', padding: '0.2rem 0.4rem' }}
                    title="选择要预览的入口文件"
                  >
                    <option value="">自动选择入口</option>
                    {previewOptions.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  {entryCandidates?.length ? (
                    <span className="preview-entry">默认入口: {entryCandidates[0]}</span>
                  ) : null}
                </div>
              </div>
              <div className="preview-actions">
                <button onClick={onToggleView} className="ghost-btn">
                  返回编辑
                </button>
                <button onClick={onRefreshPreview} className="ghost-btn">
                  ⟳
                </button>
              </div>
            </div>
            <iframe
              key={`preview-${hotReloadToken}`}
              title="live-preview"
              srcDoc={previewDoc}
              sandbox="allow-scripts"
              className="preview-frame"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(Workspace);
