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

function DiffModal({ diff, onClose, theme }) {
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
        style={isFullScreen ? { width: '96vw', height: '92vh', maxWidth: 'none' } : undefined}
      >
        <div className="diff-modal-header">
          <div className="diff-modal-title">
            <span className="codicon codicon-diff" aria-hidden />
            <span>代码对比</span>
            {path ? <span className="diff-modal-path">{path}</span> : null}
          </div>
          <div className="diff-modal-actions">
            <button
              className="ghost-btn"
              title={compactView ? '切换为全量文件对比' : '仅显示改动块'}
              onClick={() => setCompactView((v) => !v)}
              style={{ marginRight: '0.5rem' }}
            >
              <span className="codicon codicon-diff" aria-hidden />
              <span style={{ marginLeft: '0.25rem' }}>{compactView ? '全量对比' : '仅改动'}</span>
            </button>
            <button
              className="ghost-btn"
              title={isFullScreen ? '退出全屏' : '全屏查看'}
              onClick={() => setIsFullScreen((v) => !v)}
              style={{ marginRight: '0.5rem' }}
            >
              <span className={`codicon ${isFullScreen ? 'codicon-screen-normal' : 'codicon-screen-full'}`} aria-hidden />
              <span style={{ marginLeft: '0.25rem' }}>{isFullScreen ? '退出全屏' : '全屏'}</span>
            </button>
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
              key={editorKey}
              height={isFullScreen ? 'calc(92vh - 80px)' : '70vh'}
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
                // Try both flags to support different monaco versions
                hideUnchangedRegions: compactView ? {
                  enabled: true,
                  revealLinePadding: 3,
                  contextLineCount: 3
                } : { enabled: false },
                renderUnchangedRegions: compactView ? {
                  enabled: true,
                  revealLinePadding: 3,
                  contextLineCount: 3
                } : { enabled: false }
              }}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

export default DiffModal;
