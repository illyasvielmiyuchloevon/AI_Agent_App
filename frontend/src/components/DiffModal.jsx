import React, { Suspense, useMemo, useRef, useEffect, useCallback, useState } from 'react';

const MonacoDiffEditor = React.lazy(() =>
  import('@monaco-editor/react').then((mod) => ({ default: mod.DiffEditor }))
);

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

const inferLanguage = (path = '') => {
  const ext = path.split('.').pop();
  return LANG_MAP[ext] || 'plaintext';
};

class EditorErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Monaco Editor Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return <div style={{ padding: '10px', color: 'var(--danger)' }}>Editor component crashed. Please retry.</div>;
    }
    return this.props.children;
  }
}

const findFirstDiffLine = (before = '', after = '') => {
  const beforeLines = (before || '').split('\n');
  const afterLines = (after || '').split('\n');
  const len = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < len; i += 1) {
    if (beforeLines[i] !== afterLines[i]) {
      return { originalLine: i + 1, modifiedLine: i + 1 };
    }
  }
  return null;
};

function DiffModal({ diff, onClose, theme, onOpenFile, onOpenDiffInWorkspace }) {
  const hasDiff = !!diff && typeof diff === 'object';
  const path = hasDiff ? diff.path : '';
  const before = hasDiff ? diff.before || '' : '';
  const after = hasDiff ? diff.after || '' : '';
  const beforeTruncated = hasDiff ? !!diff.before_truncated : false;
  const afterTruncated = hasDiff ? !!diff.after_truncated : false;
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [compactView, setCompactView] = useState(true); // true: 仅改动块；false: 全量文件
  const editorKey = useMemo(
    () => `${(diff && (diff.id || diff.diff_id || diff.path)) || 'diff-view'}-${compactView ? 'compact' : 'full'}`,
    [diff, compactView]
  );
  const editorRef = useRef(null);
  const modifiedEditorRef = useRef(null);
  const originalEditorRef = useRef(null);
  const modelRef = useRef({ original: null, modified: null });

  const isModelAlive = useCallback((model) => {
    if (!model) return false;
    try {
      if (typeof model.isDisposed === 'function' && model.isDisposed()) return false;
      // Accessing line count will throw if disposed
      model.getLineCount();
      return true;
    } catch {
      return false;
    }
  }, []);

  const language = useMemo(() => inferLanguage(path || ''), [path]);
  const monacoTheme = useMemo(() => {
    if (theme === 'high-contrast') return 'hc-black';
    return theme === 'dark' ? 'vs-dark' : 'vs';
  }, [theme]);

  const handleMount = useCallback((editor) => {
    editorRef.current = editor;
    const model = editor.getModel();
    modelRef.current = {
      original: model?.original || null,
      modified: model?.modified || null
    };
    try {
      modifiedEditorRef.current = editor.getModifiedEditor();
      originalEditorRef.current = editor.getOriginalEditor();
    } catch (e) {
      modifiedEditorRef.current = null;
      originalEditorRef.current = null;
    }
  }, []);

  useEffect(() => {
    const diffEditor = editorRef.current;
    const editor = modifiedEditorRef.current || (diffEditor && diffEditor.getModifiedEditor && diffEditor.getModifiedEditor());
    if (!editor) return;
    const { modified } = modelRef.current;
    if (!isModelAlive(modified)) return;

    const lineChanges = (diffEditor && diffEditor.getLineChanges && diffEditor.getLineChanges()) || [];
    const firstChange = lineChanges.length > 0 ? lineChanges[0] : null;
    const fallbackPos = findFirstDiffLine(before, after);

    const targetLine = (() => {
      if (firstChange && typeof firstChange.modifiedStartLineNumber === 'number') {
        return firstChange.modifiedStartLineNumber;
      }
      if (fallbackPos) return fallbackPos.modifiedLine || fallbackPos.originalLine || 1;
      return 1;
    })();

    const boundedLine = Math.min(Math.max(targetLine, 1), modified.getLineCount());
    // Slight delay to ensure models are attached
    setTimeout(() => {
      try {
        editor.revealLineInCenter(boundedLine);
        editor.setPosition({ lineNumber: boundedLine, column: Math.max(1, modified.getLineMaxColumn(boundedLine) || 1) });
      } catch (e) {
        // ignore
      }
    }, 0);
  }, [before, after, isModelAlive]);

  if (!hasDiff) return null;

  return (
    <div className="diff-modal-backdrop" onClick={onClose}>
      <div
        className="diff-modal"
        onClick={(e) => e.stopPropagation()}
        style={isFullScreen ? { 
            width: 'calc(100vw - 32px)', 
            height: 'calc(100vh - 32px)', 
            maxWidth: 'none',
            borderRadius: '16px' 
        } : undefined}
      >
        <div className="diff-modal-header">
          <div className="diff-modal-title">
            <span className="codicon codicon-diff" aria-hidden style={{ fontSize: '18px', color: 'var(--accent)' }} />
            <span>代码对比</span>
            {path ? <span className="diff-modal-path">{path}</span> : null}
          </div>
          <div className="diff-modal-actions">
            {(beforeTruncated || afterTruncated) && (
              <span className="diff-modal-note">
                {[
                  beforeTruncated ? '原始内容已截断' : '',
                  afterTruncated ? '修改后内容已截断' : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
            {(path || (diff.files && diff.files.length > 0)) && onOpenDiffInWorkspace && (
              <button
                className="ghost-btn"
                title="在编辑器打开 Diff 视图"
                onClick={() => {
                  onOpenDiffInWorkspace(diff);
                }}
              >
                <span className="codicon codicon-diff" aria-hidden />
                <span style={{ marginLeft: '0.35rem' }}>在编辑器查看</span>
              </button>
            )}
            <button
              className="ghost-btn"
              title={compactView ? '切换为全量文件对比' : '仅显示改动块'}
              onClick={() => setCompactView((v) => !v)}
            >
              <span className="codicon codicon-diff" aria-hidden />
              <span style={{ marginLeft: '0.35rem' }}>{compactView ? '全量对比' : '仅改动'}</span>
            </button>
            <button
              className="ghost-btn"
              title={isFullScreen ? '退出全屏' : '全屏查看'}
              onClick={() => setIsFullScreen((v) => !v)}
            >
              <span className={`codicon ${isFullScreen ? 'codicon-screen-normal' : 'codicon-screen-full'}`} aria-hidden />
            </button>
            <button className="ghost-btn" onClick={onClose} title="关闭">
              <span className="codicon codicon-close" aria-hidden />
            </button>
          </div>
        </div>
        <div className="diff-modal-body">
            {diff.files && Array.isArray(diff.files) ? (
                // Multi-file View
                <div className="multi-diff-container" style={{ height: '100%', overflowY: 'auto' }}>
                    {diff.files.map((file, idx) => (
                        <FileDiffSection 
                            key={file.path} 
                            file={file} 
                            theme={monacoTheme}
                            compactView={compactView}
                            index={idx}
                            onOpenFile={onOpenFile}
                            onOpenDiffInWorkspace={onOpenDiffInWorkspace}
                            onCloseModal={onClose}
                        />
                    ))}
                </div>
            ) : (
              // Single-file View
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                <Suspense fallback={<div className="monaco-fallback">Loading Diff Viewer…</div>}>
                  <MonacoDiffEditor
                    key={editorKey}
                    height="100%"
                    language={language}
                    original={before}
                    modified={after}
                    theme={monacoTheme}
                    onMount={handleMount}
                    keepCurrentOriginalModel={true}
                    keepCurrentModifiedModel={true}
                    originalModelPath={`diff-original-${(diff && (diff.id || diff.diff_id || diff.path)) || 'default'}`}
                    modifiedModelPath={`diff-modified-${(diff && (diff.id || diff.diff_id || diff.path)) || 'default'}`}
                    options={{
                      renderSideBySide: true,
                      readOnly: true,
                      automaticLayout: true,
                      wordWrap: 'off',
                      diffWordWrap: 'off',
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      padding: { top: 16, bottom: 16 },
                      hideUnchangedRegions: compactView ? {
                        enabled: true,
                        revealLinePadding: 3,
                        contextLineCount: 3
                      } : { enabled: false }
                    }}
                  />
                </Suspense>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

const FileDiffSection = ({ file, theme, compactView, index, onOpenFile, onOpenDiffInWorkspace, onCloseModal }) => {
    const [expanded, setExpanded] = useState(true);
    const language = useMemo(() => inferLanguage(file.path || ''), [file.path]);
    
    // Lazy load logic: only render editor when expanded
    return (
        <div className="diff-section">
            <div 
                className="diff-section-header" 
                onClick={() => setExpanded(!expanded)}
                style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center' }}
            >
                <span 
                    className={`codicon codicon-${expanded ? 'chevron-down' : 'chevron-right'}`} 
                    style={{ marginRight: '8px', fontSize: '14px', color: 'var(--muted)' }} 
                />
                <span style={{ 
                    color: file.status === 'M' ? '#e2c08d' : (file.status === 'A' ? '#73c991' : (file.status === 'D' ? '#f14c4c' : '#999')), 
                    fontWeight: 'bold', 
                    marginRight: '8px',
                    fontSize: '13px',
                    width: '16px',
                    textAlign: 'center'
                }}>
                    {file.status}
                </span>
                <span style={{ fontWeight: '500', fontSize: '13px', color: 'var(--text)', flex: 1 }}>{file.path}</span>
                {onOpenDiffInWorkspace ? (
                    <button 
                        className="ghost-btn" 
                        title="在编辑器打开 Diff 视图"
                        onClick={(e) => {
                            e.stopPropagation();
                            onOpenDiffInWorkspace(file);
                            if (onCloseModal) onCloseModal();
                        }}
                        style={{ padding: '2px 6px', height: '24px', fontSize: '12px' }}
                    >
                        <span className="codicon codicon-diff" />
                    </button>
                ) : (onOpenFile && (
                    <button 
                        className="ghost-btn" 
                        title="在编辑器打开"
                        onClick={(e) => {
                            e.stopPropagation();
                            onOpenFile(file.path);
                            if (onCloseModal) onCloseModal();
                        }}
                        style={{ padding: '2px 6px', height: '24px', fontSize: '12px' }}
                    >
                        <span className="codicon codicon-go-to-file" />
                    </button>
                ))}
            </div>
            {expanded && (
                <div style={{ height: '300px' }}>
                    <EditorErrorBoundary>
                        <Suspense fallback={<div className="monaco-fallback">Loading...</div>}>
                            <MonacoDiffEditor
                                height="300px"
                                language={language}
                                original={file.before || ''}
                                modified={file.after || ''}
                                theme={theme}
                                originalModelPath={`original://${file.path}`}
                                modifiedModelPath={`modified://${file.path}`}
                                keepCurrentOriginalModel={true}
                                keepCurrentModifiedModel={true}
                                options={{
                                    renderSideBySide: true,
                                    readOnly: true,
                                    automaticLayout: true,
                                    scrollBeyondLastLine: false,
                                    minimap: { enabled: false },
                                    padding: { top: 8, bottom: 8 },
                                    hideUnchangedRegions: compactView ? {
                                      enabled: true,
                                      revealLinePadding: 3,
                                      contextLineCount: 3
                                    } : { enabled: false }
                                }}
                            />
                        </Suspense>
                    </EditorErrorBoundary>
                </div>
            )}
        </div>
    );
};

export default DiffModal;
