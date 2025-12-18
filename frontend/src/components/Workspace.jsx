import React, { useMemo, useState, useEffect, Suspense, useCallback, useRef } from 'react';

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
  aiEngineClient,
  getBackendConfig,
  currentSessionId,
  backendWorkspaceId,
  onRegisterEditorAiInvoker,
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

  const canUseEditorAi = !!aiEngineClient && !!activeFile
    && !(settingsTabPath && activeFile === settingsTabPath)
    && !(welcomeTabPath && activeFile === welcomeTabPath)
    && !(diffTabPrefix && activeFile && activeFile.startsWith(diffTabPrefix));

  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const disposablesRef = useRef([]);
  const lastSelectionRef = useRef({ isEmpty: true, range: null });
  const [inlineAi, setInlineAi] = useState({ visible: false, top: 0, left: 0 });
  const [aiPanel, setAiPanel] = useState({
    open: false,
    busy: false,
    action: '',
    applyTarget: '',
    selectionRange: null,
    title: '',
    content: '',
    error: '',
    canApplySelection: false,
    canApplyFile: false,
  });
  const [aiPrompt, setAiPrompt] = useState({ open: false, action: '', title: '', placeholder: '', value: '' });
  const applyActions = useMemo(() => new Set(['optimize', 'generateComments', 'rewrite', 'modify']), []);

  const clipText = useCallback((text, maxChars) => {
    const s = typeof text === 'string' ? text : '';
    if (s.length <= maxChars) return s;
    return `${s.slice(0, maxChars)}\n…[truncated]`;
  }, []);

  const extractFirstCodeBlock = useCallback((text) => {
    const s = typeof text === 'string' ? text : '';
    const m = s.match(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```/);
    if (m && m[1] != null) return m[1];
    return s.trim();
  }, []);

  const getEditorSnapshot = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return null;
    const model = editor.getModel?.();
    if (!model) return null;

    const selection = editor.getSelection?.() || null;
    const hasSelection = !!selection && typeof selection.isEmpty === 'function' ? !selection.isEmpty() : false;
    const selectedText = hasSelection ? (model.getValueInRange?.(selection) || '') : '';

    const visibleRanges = editor.getVisibleRanges?.() || [];
    const visibleText = visibleRanges.length
      ? visibleRanges.map((r) => model.getValueInRange?.(r) || '').join('\n')
      : (model.getValue?.() || '');

    const cursor = editor.getPosition?.() || null;

    const selectionPayload = hasSelection
      ? {
          startLine: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLine: selection.endLineNumber,
          endColumn: selection.endColumn,
        }
      : undefined;

    lastSelectionRef.current = { isEmpty: !hasSelection, range: selection || null };

    return {
      filePath: activeFile || '',
      languageId: inferLanguage(activeFile || ''),
      cursorLine: cursor?.lineNumber,
      cursorColumn: cursor?.column,
      selection: selectionPayload,
      visibleText: clipText(visibleText, 14000),
      selectedText: clipText(selectedText, 8000),
    };
  }, [activeFile, clipText]);

  const buildInstruction = useCallback((action, { hasSelection, userInstruction }) => {
    if (action === 'explain') {
      return hasSelection
        ? '用自然语言解释选中代码的功能、逻辑和关键点。'
        : '用自然语言解释当前文件的功能、逻辑和关键点。';
    }
    if (action === 'generateTests') {
      return hasSelection
        ? '为选中代码生成高质量单元测试。优先匹配项目中已有的测试框架与约定。输出测试代码。'
        : '为当前文件生成高质量单元测试。优先匹配项目中已有的测试框架与约定。输出测试代码。';
    }
    if (action === 'optimize') {
      return hasSelection
        ? '在不改变行为的前提下优化选中代码的性能与可读性。输出可直接替换选中代码的新实现。'
        : '在不改变行为的前提下优化当前文件的性能与可读性。输出修改后的完整文件内容。';
    }
    if (action === 'generateComments') {
      return hasSelection
        ? '为选中代码补充必要注释（遵循语言风格）。输出可直接替换选中代码的新实现。'
        : '为当前文件补充必要注释（遵循语言风格）。输出修改后的完整文件内容。';
    }
    if (action === 'review') {
      return hasSelection
        ? '审阅选中代码，指出问题与风险，并给出可执行的改进建议。'
        : '审阅当前文件，指出问题与风险，并给出可执行的改进建议。';
    }
    if (action === 'rewrite') {
      return hasSelection
        ? '重写选中代码，保持行为一致并提升可读性。输出可直接替换选中代码的新实现。'
        : '重写当前文件，保持行为一致并提升可读性。输出修改后的完整文件内容。';
    }
    if (action === 'generateDocs') {
      return hasSelection
        ? '为选中代码所在模块生成 Markdown 风格文档（用途、关键接口、示例）。'
        : '为当前文件/模块生成 Markdown 风格文档（用途、关键接口、示例）。';
    }
    if (action === 'modify') {
      const base = hasSelection
        ? '按以下指令修改选中代码。输出可直接替换选中代码的新实现。'
        : '按以下指令修改当前文件。输出修改后的完整文件内容。';
      const extra = String(userInstruction || '').trim();
      return extra ? `${base}\n\n指令：${extra}` : base;
    }
    return String(userInstruction || '').trim() || '请根据上下文完成编辑器动作。';
  }, []);

  const runEditorAiAction = useCallback(async ({ action, userInstruction } = {}) => {
    if (!canUseEditorAi) return;
    const snapshot = getEditorSnapshot();
    if (!snapshot) return;

    const hasSelection = !!snapshot.selectedText && snapshot.selectedText.trim().length > 0;
    const instruction = buildInstruction(action, { hasSelection, userInstruction });
    const applyTarget = hasSelection ? 'selection' : 'file';
    const selection = lastSelectionRef.current?.range;
    const selectionRange = hasSelection && selection
      ? {
          startLineNumber: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLineNumber: selection.endLineNumber,
          endColumn: selection.endColumn,
        }
      : null;
    const canApplySelectionByAction = applyTarget === 'selection' && applyActions.has(action);
    const canApplyFileByAction = applyTarget === 'file' && applyActions.has(action);

    const titleMap = {
      explain: 'AI：解释代码',
      generateTests: 'AI：生成单元测试',
      optimize: 'AI：优化代码',
      generateComments: 'AI：生成注释',
      review: 'AI：审阅代码',
      rewrite: 'AI：重写代码',
      modify: 'AI：按指令修改',
      generateDocs: 'AI：生成文档',
    };

    setAiPanel({
      open: true,
      busy: true,
      action,
      applyTarget,
      selectionRange,
      title: titleMap[action] || 'AI',
      content: '',
      error: '',
      canApplySelection: false,
      canApplyFile: false,
    });

    try {
      const llmConfig = typeof getBackendConfig === 'function' ? getBackendConfig() : undefined;
      const res = await aiEngineClient.editorAction({
        sessionId: currentSessionId,
        workspaceId: backendWorkspaceId,
        workspaceRoot: backendRoot,
        action,
        instruction,
        editor: snapshot,
        llmConfig,
      });

      const content = typeof res?.content === 'string' ? res.content : '';
      const canApplySelection = canApplySelectionByAction && content.trim().length > 0;
      const canApplyFile = canApplyFileByAction && content.trim().length > 0;
      setAiPanel((prev) => ({
        ...prev,
        busy: false,
        content,
        error: '',
        canApplySelection,
        canApplyFile,
      }));
    } catch (e) {
      setAiPanel((prev) => ({
        ...prev,
        busy: false,
        content: '',
        error: e?.message || String(e),
        canApplySelection: false,
        canApplyFile: false,
      }));
    }
  }, [aiEngineClient, backendRoot, backendWorkspaceId, buildInstruction, canUseEditorAi, currentSessionId, getBackendConfig, getEditorSnapshot]);

  const openPromptForAction = useCallback((action) => {
    if (action !== 'modify') return;
    setAiPrompt({
      open: true,
      action,
      title: 'AI：按指令修改',
      placeholder: '例如：将 for 循环改为 map/reduce；增加异常处理；提取为函数…',
      value: '',
    });
  }, []);

  const triggerAiAction = useCallback((action) => {
    if (!canUseEditorAi) return;
    if (action === 'modify') {
      openPromptForAction(action);
      return;
    }
    runEditorAiAction({ action }).catch(() => {});
  }, [canUseEditorAi, openPromptForAction, runEditorAiAction]);

  const applyAiResultToSelection = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const range = aiPanel.selectionRange || lastSelectionRef.current?.range;
    if (!range) return;
    const model = editor.getModel?.();
    if (!model) return;
    const text = extractFirstCodeBlock(aiPanel.content || '');
    if (!text) return;
    editor.executeEdits('ai-editor-action', [{ range, text, forceMoveMarkers: true }]);
    editor.focus?.();
  }, [aiPanel.content, aiPanel.selectionRange, extractFirstCodeBlock]);

  const applyAiResultToFile = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel?.();
    if (!model) return;
    const lineCount = model.getLineCount?.() || 1;
    const lastCol = model.getLineMaxColumn?.(lineCount) || 1;
    const fullRange = new monaco.Range(1, 1, lineCount, lastCol);
    const text = extractFirstCodeBlock(aiPanel.content || '');
    if (!text) return;
    editor.executeEdits('ai-editor-action', [{ range: fullRange, text, forceMoveMarkers: true }]);
    editor.focus?.();
  }, [aiPanel.content, extractFirstCodeBlock]);

  const registerEditorActions = useCallback((editor, monaco) => {
    const defs = [
      { id: 'ai.explain', label: 'AI：解释代码', action: 'explain', key: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyE },
      { id: 'ai.tests', label: 'AI：生成单元测试', action: 'generateTests', key: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyT },
      { id: 'ai.optimize', label: 'AI：优化代码', action: 'optimize', key: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyO },
      { id: 'ai.comments', label: 'AI：生成注释', action: 'generateComments', key: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyC },
      { id: 'ai.review', label: 'AI：审阅代码', action: 'review', key: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyR },
      { id: 'ai.rewrite', label: 'AI：重写代码', action: 'rewrite', key: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyW },
      { id: 'ai.modify', label: 'AI：按指令修改…', action: 'modify', key: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyM },
      { id: 'ai.docs', label: 'AI：生成文档', action: 'generateDocs', key: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyD },
    ];

    defs.forEach((d, idx) => {
      const disposable = editor.addAction({
        id: d.id,
        label: d.label,
        keybindings: d.key ? [d.key] : undefined,
        contextMenuGroupId: '9_ai',
        contextMenuOrder: 1.0 + idx / 100,
        run: () => {
          triggerAiAction(d.action);
        },
      });
      disposablesRef.current.push(disposable);
    });
  }, [triggerAiAction]);

  const handleEditorMount = useCallback((editor, monaco) => {
    disposablesRef.current.forEach((d) => d?.dispose?.());
    disposablesRef.current = [];
    editorRef.current = editor;
    monacoRef.current = monaco;

    if (canUseEditorAi) {
      registerEditorActions(editor, monaco);

      const selectionDisposable = editor.onDidChangeCursorSelection(() => {
        const sel = editor.getSelection?.();
        const model = editor.getModel?.();
        if (!sel || !model) {
          setInlineAi({ visible: false, top: 0, left: 0 });
          return;
        }
        const isEmpty = typeof sel.isEmpty === 'function' ? sel.isEmpty() : true;
        lastSelectionRef.current = { isEmpty, range: sel };
        if (isEmpty) {
          setInlineAi({ visible: false, top: 0, left: 0 });
          return;
        }
        const pos = sel.getEndPosition?.();
        if (!pos) {
          setInlineAi({ visible: false, top: 0, left: 0 });
          return;
        }
        const coords = editor.getScrolledVisiblePosition?.(pos);
        if (!coords) {
          setInlineAi({ visible: false, top: 0, left: 0 });
          return;
        }
        const padding = 10;
        const top = Math.max(padding, Math.round(coords.top + coords.height + 6));
        const left = Math.max(padding, Math.round(coords.left));
        setInlineAi({ visible: true, top, left });
      });
      disposablesRef.current.push(selectionDisposable);
    }
  }, [canUseEditorAi, registerEditorActions]);

  useEffect(() => {
    if (typeof onRegisterEditorAiInvoker !== 'function') return;
    if (!canUseEditorAi) {
      onRegisterEditorAiInvoker(null);
      return;
    }
    const invoker = {
      run: (action) => triggerAiAction(action),
      runWithInstruction: (action, instruction) => runEditorAiAction({ action, userInstruction: instruction }),
    };
    onRegisterEditorAiInvoker(invoker);
    return () => onRegisterEditorAiInvoker(null);
  }, [canUseEditorAi, onRegisterEditorAiInvoker, runEditorAiAction, triggerAiAction]);

  useEffect(() => {
    return () => {
      disposablesRef.current.forEach((d) => d?.dispose?.());
      disposablesRef.current = [];
    };
  }, []);

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
          <div className="monaco-shell" style={{ position: 'relative' }}>
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
                              <div style={{ height: '100%', width: '100%' }}>
                                <MonacoEditor
                                  key={`editor-${activeFile}`}
                                  height="100%"
                                  language={inferLanguage(activeFile)}
                                  theme={monacoTheme}
                                  value={activeContent}
                                  options={monacoOptions}
                                  onMount={handleEditorMount}
                                  onChange={(value) => onFileChange(activeFile, value ?? '')}
                                />
                              </div>
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

            {canUseEditorAi && inlineAi.visible ? (
              <button
                type="button"
                className="ghost-btn"
                style={{
                  position: 'absolute',
                  top: inlineAi.top,
                  left: inlineAi.left,
                  zIndex: 20,
                  height: 26,
                  padding: '0 8px',
                  borderRadius: 999,
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
                onClick={() => setAiPanel((prev) => ({ ...prev, open: true, title: 'AI', content: prev.content || '', error: prev.error || '' }))}
                title="AI Actions"
              >
                <span aria-hidden>✨</span>
                <span>AI</span>
              </button>
            ) : null}

            {canUseEditorAi && aiPanel.open ? (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 99990, background: 'rgba(0,0,0,0.28)' }}
                  onClick={() => setAiPanel((prev) => ({ ...prev, open: false }))}
                />
                <div
                  style={{
                    position: 'fixed',
                    zIndex: 99991,
                    right: 16,
                    top: 56,
                    width: 'min(720px, calc(100vw - 32px))',
                    maxHeight: 'min(70vh, 720px)',
                    background: 'var(--panel)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    boxShadow: 'var(--shadow-strong)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 700, fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {aiPanel.title || 'AI'}
                    </div>
                    <button type="button" className="ghost-btn" style={{ height: 28 }} onClick={() => triggerAiAction('explain')}>解释</button>
                    <button type="button" className="ghost-btn" style={{ height: 28 }} onClick={() => triggerAiAction('optimize')}>优化</button>
                    <button type="button" className="ghost-btn" style={{ height: 28 }} onClick={() => triggerAiAction('review')}>审阅</button>
                    <button type="button" className="ghost-btn" style={{ height: 28 }} onClick={() => openPromptForAction('modify')}>修改</button>
                    <button type="button" className="ghost-btn" style={{ height: 28 }} onClick={() => setAiPanel((prev) => ({ ...prev, open: false }))}>
                      <span className="codicon codicon-close" aria-hidden />
                    </button>
                  </div>

                  <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
                    <button type="button" className="ghost-btn" style={{ height: 30 }} onClick={() => triggerAiAction('generateTests')}>单测</button>
                    <button type="button" className="ghost-btn" style={{ height: 30 }} onClick={() => triggerAiAction('generateComments')}>注释</button>
                    <button type="button" className="ghost-btn" style={{ height: 30 }} onClick={() => triggerAiAction('rewrite')}>重写</button>
                    <button type="button" className="ghost-btn" style={{ height: 30 }} onClick={() => triggerAiAction('generateDocs')}>文档</button>
                    {aiPanel.canApplySelection ? (
                      <button type="button" className="primary-btn" style={{ height: 30 }} onClick={applyAiResultToSelection}>应用到选中</button>
                    ) : null}
                    {aiPanel.canApplyFile ? (
                      <button type="button" className="primary-btn" style={{ height: 30 }} onClick={applyAiResultToFile}>替换文件</button>
                    ) : null}
                    <button
                      type="button"
                      className="ghost-btn"
                      style={{ height: 30 }}
                      onClick={() => {
                        const text = aiPanel.content || '';
                        if (!text) return;
                        navigator.clipboard?.writeText?.(text).catch(() => {});
                      }}
                    >
                      复制
                    </button>
                  </div>

                  <div style={{ padding: 12, overflow: 'auto', flex: 1 }}>
                    {aiPanel.busy ? (
                      <div style={{ color: 'var(--muted)', fontSize: 13 }}>生成中…</div>
                    ) : aiPanel.error ? (
                      <div style={{ color: 'var(--danger)', fontSize: 13 }}>{aiPanel.error}</div>
                    ) : (
                      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, lineHeight: 1.55, color: 'var(--text)' }}>
                        {aiPanel.content || ''}
                      </pre>
                    )}
                  </div>
                </div>
              </>
            ) : null}

            {canUseEditorAi && aiPrompt.open ? (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 99992, background: 'rgba(0,0,0,0.28)' }}
                  onClick={() => setAiPrompt((prev) => ({ ...prev, open: false }))}
                />
                <div
                  style={{
                    position: 'fixed',
                    zIndex: 99993,
                    left: '50%',
                    top: '20%',
                    transform: 'translateX(-50%)',
                    width: 'min(640px, calc(100vw - 32px))',
                    background: 'var(--panel)',
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    boxShadow: 'var(--shadow-strong)',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>{aiPrompt.title}</div>
                  <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <textarea
                      className="ghost-input"
                      value={aiPrompt.value}
                      onChange={(e) => setAiPrompt((prev) => ({ ...prev, value: e.target.value }))}
                      placeholder={aiPrompt.placeholder}
                      style={{ width: '100%', minHeight: 96, resize: 'vertical', padding: 10, lineHeight: 1.5 }}
                      autoFocus
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <button type="button" className="ghost-btn" style={{ height: 32 }} onClick={() => setAiPrompt((prev) => ({ ...prev, open: false }))}>取消</button>
                      <button
                        type="button"
                        className="primary-btn"
                        style={{ height: 32 }}
                        disabled={!aiPrompt.value.trim()}
                        onClick={() => {
                          const instruction = aiPrompt.value;
                          setAiPrompt((prev) => ({ ...prev, open: false }));
                          runEditorAiAction({ action: aiPrompt.action, userInstruction: instruction }).catch(() => {});
                        }}
                      >
                        运行
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
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
