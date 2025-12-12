import React, { Suspense, useMemo, useRef, useEffect, useCallback } from 'react';

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

function DiffModal({ diff, onClose, theme }) {
  const hasDiff = !!diff && typeof diff === 'object';
  const path = hasDiff ? diff.path : '';
  const before = hasDiff ? diff.before || '' : '';
  const after = hasDiff ? diff.after || '' : '';
  const beforeTruncated = hasDiff ? !!diff.before_truncated : false;
  const afterTruncated = hasDiff ? !!diff.after_truncated : false;
  const editorRef = useRef(null);
  const modelRef = useRef({ original: null, modified: null });

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
  }, []);

  useEffect(() => {
    return () => {
      try { editorRef.current?.dispose(); } catch (e) {}
      const { original, modified } = modelRef.current;
      // Defer disposal to avoid race with DiffEditor cleanup
      setTimeout(() => {
        try { original?.dispose(); } catch (e) {}
        try { modified?.dispose(); } catch (e) {}
      }, 0);
    };
  }, []);

  if (!hasDiff) return null;

  return (
    <div className="diff-modal-backdrop" onClick={onClose}>
      <div className="diff-modal" onClick={(e) => e.stopPropagation()}>
        <div className="diff-modal-header">
          <div className="diff-modal-title">
            <span className="codicon codicon-diff" aria-hidden />
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
            <button className="ghost-btn" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
        <div className="diff-modal-body">
          <Suspense fallback={<div className="monaco-fallback">Loading Diff Viewer…</div>}>
            <MonacoDiffEditor
              key={(diff && (diff.id || diff.diff_id || diff.path)) || 'diff-view'}
              height="70vh"
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
                diffWordWrap: 'on',
                minimap: { enabled: false },
              }}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

export default DiffModal;
