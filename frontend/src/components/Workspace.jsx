import React, { useMemo, useState, useEffect, Suspense, useCallback, useRef } from 'react';

const MonacoEditor = React.lazy(() =>
  Promise.all([
    import('monaco-editor/esm/vs/platform/undoRedo/common/undoRedoService.js').then(({ UndoRedoService }) => {
      if (globalThis.__AI_CHAT_MONACO_UNDO_REDO_PATCHED) return;
      globalThis.__AI_CHAT_MONACO_UNDO_REDO_PATCHED = true;

      const normalizeUndoRedoLimit = (value) => {
        const raw = Number(value);
        if (!Number.isFinite(raw)) return 16;
        const n = Math.round(raw);
        return Math.max(8, Math.min(64, n));
      };

      const originalPushElement = UndoRedoService?.prototype?._pushElement;
      if (typeof originalPushElement !== 'function') return;

      UndoRedoService.prototype._pushElement = function patchedPushElement(element) {
        originalPushElement.call(this, element);

        const stacks = this?._editStacks;
        const strResources = element?.strResources;
        if (!stacks || typeof stacks.get !== 'function' || !Array.isArray(strResources)) return;

        for (const strResource of strResources) {
          const editStack = stacks.get(strResource);
          if (!editStack) continue;
          if (editStack._aiChatMaxPast == null) {
            editStack._aiChatMaxPast = normalizeUndoRedoLimit(globalThis.__AI_CHAT_MONACO_UNDO_REDO_LIMIT);
          }
          const maxPast = editStack._aiChatMaxPast;
          const past = editStack._past;
          if (!Array.isArray(past) || past.length <= maxPast) continue;

          const overflow = past.length - maxPast;
          const removed = past.splice(0, overflow);
          for (const removedElement of removed) {
            if (removedElement?.type === 1 && typeof removedElement.removeResource === 'function') {
              removedElement.removeResource(editStack.resourceLabel, editStack.strResource, 0);
            }
          }
          editStack.versionId += 1;
        }
      };
    }),
    import('@monaco-editor/react')
  ]).then(([, mod]) => mod)
);
const MonacoDiffEditor = React.lazy(() =>
  import('@monaco-editor/react').then((mod) => ({ default: mod.DiffEditor }))
);

const ManagedDiffEditor = (props) => {
  const modelRef = useRef({ original: null, modified: null });
  const onMount = useCallback((editor, monaco) => {
    const model = editor?.getModel?.();
    modelRef.current = {
      original: model?.original || null,
      modified: model?.modified || null,
    };
    if (typeof props.onMount === 'function') {
      props.onMount(editor, monaco);
    }
  }, [props]);

  useEffect(() => () => {
    const { original, modified } = modelRef.current;
    setTimeout(() => {
      try {
        if (original && typeof original.isDisposed === 'function' && !original.isDisposed()) {
          original.dispose();
        }
        if (modified && typeof modified.isDisposed === 'function' && !modified.isDisposed()) {
          modified.dispose();
        }
      } catch {
        // ignore
      }
    }, 0);
  }, []);

  const { onMount: _ignore, ...rest } = props;
  return (
    <MonacoDiffEditor
      {...rest}
      onMount={onMount}
      keepCurrentOriginalModel={true}
      keepCurrentModifiedModel={true}
    />
  );
};

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

const extractIdHints = (script = '') => {
  const hints = new Set();
  if (!script) return [];
  const patterns = [
    /getElementById\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    /querySelector\s*\(\s*['"`]#([^'"`]+)['"`]\s*\)/g,
    /querySelectorAll\s*\(\s*['"`]#([^'"`]+)['"`]\s*\)/g,
  ];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(script)) !== null) {
      const id = String(match[1] || '').trim();
      if (id) hints.add(id);
    }
  });
  return Array.from(hints);
};

const injectIdPlaceholders = (html = '', ids = []) => {
  if (!ids.length) return html;
  const placeholders = ids.map((id) => `<div id="${id}"></div>`).join('');
  if (html.includes('</body>')) {
    return html.replace('</body>', `${placeholders}</body>`);
  }
  return `${html}${placeholders}`;
};

const previewStorageShim = `
  <script>
    (function () {
      try {
        const testKey = '__preview_test__';
        window.localStorage.setItem(testKey, '1');
        window.localStorage.removeItem(testKey);
      } catch (err) {
        const store = new Map();
        const safeStorage = {
          getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
          setItem: (key, value) => { store.set(String(key), String(value)); },
          removeItem: (key) => { store.delete(String(key)); },
          clear: () => { store.clear(); },
          key: (index) => Array.from(store.keys())[index] || null,
          get length() { return store.size; }
        };
        try {
          Object.defineProperty(window, 'localStorage', {
            value: safeStorage,
            configurable: true
          });
        } catch (e) {
          try {
            window.localStorage = safeStorage;
          } catch {}
          window.__localStorage = safeStorage;
        }
      }
    })();
  </script>
`;

const wrapHtml = (content, css, scripts, headExtras = '') => {
  const base =
    content && content.includes('<html')
      ? stripExternalScripts(content)
      : `<!doctype html><html><head></head><body>${
          content || themedFallback('Nothing to preview')
        }</body></html>`;

  const extraHead = `${previewStorageShim}${headExtras || ''}<style>${css || ''}</style>`;
  const headInjected = base.includes('<head>')
    ? base.replace('<head>', `<head>${extraHead}`)
    : (base.includes('</head>')
        ? base.replace('</head>', `${extraHead}</head>`)
        : `${extraHead}${base}`);

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
  const htmlCandidate =
    (entryCandidates || []).find((f) => f.toLowerCase().endsWith('.html')) ||
    files.find((f) => f.path.toLowerCase().endsWith('.html'))?.path;

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
    const htmlBase = !preferredEntry && htmlCandidate ? (fileMap[htmlCandidate]?.content || '') : '';
    const sanitizedHtml = htmlBase ? stripExternalScripts(htmlBase) : '';
    const idHints = !preferredEntry ? extractIdHints(jsx) : [];
    const headExtras = `
      <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
      <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
      <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    `;
    const scripts = `
      <script type="text/babel">
        document.addEventListener('DOMContentLoaded', () => {
          ${jsx}
        });
      </script>
    `;
    const jsxMount = injectIdPlaceholders(sanitizedHtml || `<div id="root"></div>`, idHints);
    return wrapHtml(jsxMount, css, scripts, headExtras);
  }

  // If JS entry
  if (entryFile && entryExt === 'js') {
    const js = entryFile.content || '';
    const scripts = `
      <script>
        document.addEventListener('DOMContentLoaded', () => {
          ${js}
        });
      </script>
    `;
    const htmlBase = !preferredEntry && htmlCandidate ? (fileMap[htmlCandidate]?.content || '') : '';
    const sanitizedHtml = htmlBase ? stripExternalScripts(htmlBase) : '';
    const idHints = !preferredEntry ? extractIdHints(js) : [];
    const jsMount = injectIdPlaceholders(sanitizedHtml || `<div id="root"></div>`, idHints);
    return wrapHtml(jsMount, css, scripts, '');
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
  const idHints = !preferredEntry ? extractIdHints(`${js}\n${jsx}`) : [];
  const sanitizedWithHints = sanitizedHtml
    ? injectIdPlaceholders(sanitizedHtml, idHints)
    : sanitizedHtml;
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
    ${js ? `<script>document.addEventListener('DOMContentLoaded', () => { ${js} });</script>` : ''}
    ${jsx ? `<script type="text/babel">document.addEventListener('DOMContentLoaded', () => { ${jsx} });</script>` : ''}
  `
    : '';

  return wrapHtml(
    sanitizedWithHints || themedFallback('请选择文件以预览'),
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
  keybindings,
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
  taskReview,
  onTaskKeepFile,
  onTaskRevertFile,
  onTaskKeepBlock,
  onTaskRevertBlock,
  onTaskResetBlock,
  onTaskResetFile,
  onTaskSetCursor,
  diffTabPrefix,
  diffTabs,
  diffViewMode = 'compact',
  aiEngineClient,
  getBackendConfig,
  currentSessionId,
  backendWorkspaceId,
  onRegisterEditorAiInvoker,
  undoRedoLimit = 16,
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
      fontSize: 13,
      lineHeight: 21,
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
  const compactDiff = diffViewMode === 'compact';

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
  const diffModelBase = useMemo(() => {
    if (!diffTabPrefix || !activeFile || !activeFile.startsWith(diffTabPrefix)) return activeFile || 'diff';
    const diff = diffTabs && diffTabs[activeFile];
    return (diff && (diff.id || diff.diff_id || diff.path)) || activeFile || 'diff';
  }, [activeFile, diffTabPrefix, diffTabs]);
  
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
  const taskReviewDecorationsRef = useRef(null);
  const taskReviewWidgetsRef = useRef(new Map());
  const taskReviewKeyDisposableRef = useRef(null);
  const shouldRevealTaskBlockRef = useRef(true);
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
  const [editorVersion, setEditorVersion] = useState(0);
  const applyActions = useMemo(() => new Set(['optimize', 'generateComments', 'rewrite', 'modify']), []);

  const taskReviewFile = useMemo(() => {
    const list = taskReview?.files;
    if (!activeFile || !Array.isArray(list)) return null;
    return list.find((f) => f && f.path === activeFile) || null;
  }, [activeFile, taskReview]);

  const taskBlocks = useMemo(() => (
    taskReviewFile && Array.isArray(taskReviewFile.blocks) ? taskReviewFile.blocks : []
  ), [taskReviewFile]);

  const taskCursorIndex = useMemo(() => {
    const raw = taskReview?.cursorByPath && activeFile ? taskReview.cursorByPath[activeFile] : 0;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.floor(n));
  }, [activeFile, taskReview]);

  const taskActiveIndex = useMemo(() => {
    if (!taskBlocks.length) return 0;
    return Math.min(taskCursorIndex, taskBlocks.length - 1);
  }, [taskBlocks.length, taskCursorIndex]);

  const pendingBlocks = useMemo(() => (
    taskBlocks.filter(b => b.action === 'pending')
  ), [taskBlocks]);

  const currentPendingIndex = useMemo(() => {
    if (!pendingBlocks.length) return -1;
    const activeBlockId = taskBlocks[taskActiveIndex]?.id;
    return pendingBlocks.findIndex(b => b.id === activeBlockId);
  }, [pendingBlocks, taskBlocks, taskActiveIndex]);

  const hasTaskReview = !!activeFile
    && !(settingsTabPath && activeFile === settingsTabPath)
    && !(welcomeTabPath && activeFile === welcomeTabPath)
    && !(diffTabPrefix && activeFile && activeFile.startsWith(diffTabPrefix))
    && !!taskReviewFile
    && taskBlocks.length > 0;

  const shouldShowTaskReviewUI = hasTaskReview && taskBlocks.some(b => b.action === 'pending');

  const toLines = useCallback((text) => {
    const s = typeof text === 'string' ? text : String(text || '');
    if (!s) return [];
    return s.split('\n');
  }, []);

  const resolveBlockInLines = useCallback((lines, block, preferredIndex = 0) => {
    const hay = Array.isArray(lines) ? lines : [];
    const afterLines = toLines(block?.afterText || '');
    const beforeLines = toLines(block?.beforeText || '');
    const ctxBefore = toLines(block?.contextBefore || '');
    const ctxAfter = toLines(block?.contextAfter || '');
    const cb = ctxBefore.length > 2 ? ctxBefore.slice(ctxBefore.length - 2) : ctxBefore;
    const ca = ctxAfter.length > 2 ? ctxAfter.slice(0, 2) : ctxAfter;

    const rawPreferred = Number(block?.afterStartIndex);
    const prefer = Number.isFinite(rawPreferred) ? Math.max(0, Math.floor(rawPreferred)) : Math.max(0, Math.floor(Number(preferredIndex) || 0));

    const matches = [];
    for (let i = 0; i <= hay.length; i += 1) {
      let ok = true;
      if (cb.length) {
        if (i - cb.length < 0) ok = false;
        for (let k = 0; ok && k < cb.length; k += 1) {
          if (hay[i - cb.length + k] !== cb[k]) ok = false;
        }
      }
      if (!ok) continue;
      if (afterLines.length) {
        if (i + afterLines.length > hay.length) continue;
        for (let k = 0; ok && k < afterLines.length; k += 1) {
          if (hay[i + k] !== afterLines[k]) ok = false;
        }
      }
      if (!ok) continue;
      if (ca.length) {
        const start = i + afterLines.length;
        if (start + ca.length > hay.length) continue;
        for (let k = 0; ok && k < ca.length; k += 1) {
          if (hay[start + k] !== ca[k]) ok = false;
        }
      }
      if (ok) matches.push(i);
    }

    const startIndex = matches.length
      ? matches.reduce((best, cur) => (Math.abs(cur - prefer) < Math.abs(best - prefer) ? cur : best), matches[0])
      : Math.min(Math.max(0, prefer), hay.length);

    const anchorLineNumber = (() => {
      if (hay.length === 0) return 1;
      if (startIndex >= hay.length) return hay.length;
      return startIndex + 1;
    })();

    return {
      startIndex,
      afterLineCount: afterLines.length,
      beforeLines,
      afterLines,
      anchorLineNumber,
    };
  }, [toLines]);

  const normalizedUndoRedoLimit = useMemo(() => {
    const raw = Number(undoRedoLimit);
    const normalized = Number.isFinite(raw) ? Math.max(8, Math.min(64, Math.round(raw))) : 16;
    return normalized;
  }, [undoRedoLimit]);

  useEffect(() => {
    globalThis.__AI_CHAT_MONACO_UNDO_REDO_LIMIT = normalizedUndoRedoLimit;
  }, [normalizedUndoRedoLimit]);

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

  const getKeybinding = useCallback((id, fallback = '') => {
    const kb = keybindings && typeof keybindings === 'object' ? keybindings : {};
    const v = kb[id];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    return fallback;
  }, [keybindings]);

  const parseMonacoKeybinding = useCallback((shortcut, monaco) => {
    if (!shortcut || typeof shortcut !== 'string' || !monaco) return null;
    const raw = shortcut.trim();
    if (!raw) return null;
    const parts = raw.split('+').map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return null;

    let mod = 0;
    let keyToken = '';
    parts.forEach((p) => {
      const t = p.toLowerCase();
      if (t === 'ctrl' || t === 'control') mod |= monaco.KeyMod.CtrlCmd;
      else if (t === 'cmd' || t === 'command' || t === 'meta') mod |= monaco.KeyMod.CtrlCmd;
      else if (t === 'alt' || t === 'option') mod |= monaco.KeyMod.Alt;
      else if (t === 'shift') mod |= monaco.KeyMod.Shift;
      else keyToken = p;
    });
    if (!keyToken) return null;

    const k = keyToken.trim();
    const upper = k.length === 1 ? k.toUpperCase() : k;
    let code = null;
    if (upper.length === 1 && upper >= 'A' && upper <= 'Z') {
      code = monaco.KeyCode[`Key${upper}`];
    } else if (upper.length === 1 && upper >= '0' && upper <= '9') {
      code = monaco.KeyCode[`Digit${upper}`];
    } else if (upper === 'ENTER') {
      code = monaco.KeyCode.Enter;
    } else if (upper === 'BACKSPACE') {
      code = monaco.KeyCode.Backspace;
    } else if (upper === 'ESC' || upper === 'ESCAPE') {
      code = monaco.KeyCode.Escape;
    } else if (upper === 'TAB') {
      code = monaco.KeyCode.Tab;
    } else if (upper === 'UP') {
      code = monaco.KeyCode.UpArrow;
    } else if (upper === 'DOWN') {
      code = monaco.KeyCode.DownArrow;
    } else if (upper === ',') {
      code = monaco.KeyCode.Comma;
    } else if (upper === '.') {
      code = monaco.KeyCode.Period;
    } else if (/^F\d{1,2}$/i.test(upper)) {
      const n = Number(upper.slice(1));
      const name = `F${n}`;
      code = monaco.KeyCode[name];
    }
    if (!code) return null;
    return mod | code;
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

  const taskActiveBlock = useMemo(() => {
    if (!taskBlocks.length) return null;
    return taskBlocks[taskActiveIndex] || null;
  }, [taskActiveIndex, taskBlocks]);

  const resolveBlockPosition = useCallback((lines, { needleLines, contextBefore, contextAfter, preferredIndex = 0 } = {}) => {
    const hay = Array.isArray(lines) ? lines : [];
    const needle = Array.isArray(needleLines) ? needleLines : [];
    const cb = Array.isArray(contextBefore) ? (contextBefore.length > 2 ? contextBefore.slice(contextBefore.length - 2) : contextBefore) : [];
    const ca = Array.isArray(contextAfter) ? (contextAfter.length > 2 ? contextAfter.slice(0, 2) : contextAfter) : [];
    const prefer = Number.isFinite(Number(preferredIndex)) ? Math.max(0, Math.floor(Number(preferredIndex))) : 0;

    const matches = [];
    for (let i = 0; i <= hay.length; i += 1) {
      let ok = true;
      if (cb.length) {
        if (i - cb.length < 0) ok = false;
        for (let k = 0; ok && k < cb.length; k += 1) {
          if (hay[i - cb.length + k] !== cb[k]) ok = false;
        }
      }
      if (!ok) continue;
      if (needle.length) {
        if (i + needle.length > hay.length) continue;
        for (let k = 0; ok && k < needle.length; k += 1) {
          if (hay[i + k] !== needle[k]) ok = false;
        }
      }
      if (!ok) continue;
      if (ca.length) {
        const start = i + needle.length;
        if (start + ca.length > hay.length) continue;
        for (let k = 0; ok && k < ca.length; k += 1) {
          if (hay[start + k] !== ca[k]) ok = false;
        }
      }
      if (ok) matches.push(i);
    }

    const startIndex = matches.length
      ? matches.reduce((best, cur) => (Math.abs(cur - prefer) < Math.abs(best - prefer) ? cur : best), matches[0])
      : Math.min(Math.max(0, prefer), hay.length);

    const anchorLineNumber = (() => {
      if (hay.length === 0) return 1;
      if (startIndex >= hay.length) return hay.length;
      return startIndex + 1;
    })();

    return { startIndex, anchorLineNumber };
  }, []);

  const applyTaskBlockToModel = useCallback((block, nextAction) => {
    if (!hasTaskReview) return false;
    if (!block || !activeFile) return false;
    if (nextAction !== 'kept' && nextAction !== 'reverted') return false;
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return false;
    const model = editor.getModel?.();
    if (!model) return false;

    const currentLines = (model.getValue?.() || '').split('\n');

    const beforeLines = toLines(block.beforeText || '');
    const afterLines = toLines(block.afterText || '');
    const ctxBefore = toLines(block.contextBefore || '');
    const ctxAfter = toLines(block.contextAfter || '');
    const preferredIndex = Number.isFinite(Number(block.afterStartIndex)) ? Number(block.afterStartIndex) : 0;

    const currentState = block.action === 'reverted' ? 'before' : 'after';
    if (nextAction === 'reverted' && currentState === 'before') return true;
    
    // For 'kept' action, if it's already in 'after' state (pending), 
    // we still want to push an edit so it's undoable.
    // Monaco might ignore identical text edits, so we use pushEditOperations.
    
    let fromLines, toReplaceText;
    if (nextAction === 'reverted') {
      fromLines = afterLines;
      toReplaceText = beforeLines.join('\n');
    } else {
      // nextAction === 'kept'
      fromLines = currentState === 'before' ? beforeLines : afterLines;
      toReplaceText = afterLines.join('\n');
    }

    const pos = resolveBlockPosition(currentLines, {
      needleLines: fromLines,
      contextBefore: ctxBefore,
      contextAfter: ctxAfter,
      preferredIndex,
    });

    const startLineNumber = Math.max(1, pos.anchorLineNumber);
    const range = (() => {
      if (!fromLines.length) {
        return new monaco.Range(startLineNumber, 1, startLineNumber, 1);
      }
      const endLineNumber = Math.max(startLineNumber, startLineNumber + fromLines.length - 1);
      const endCol = model.getLineMaxColumn?.(endLineNumber) || 1;
      return new monaco.Range(startLineNumber, 1, endLineNumber, endCol);
    })();

    // Use pushEditOperations to ensure it's in the undo stack
    model.pushStackElement();
    editor.executeEdits('task-review', [{ range, text: toReplaceText, forceMoveMarkers: true }]);
    model.pushStackElement();
    
    editor.focus?.();
    return true;
  }, [activeFile, hasTaskReview, resolveBlockPosition, toLines]);

  const keepActiveTaskBlock = useCallback(() => {
    if (!taskActiveBlock || typeof onTaskKeepBlock !== 'function') return;
    const changed = applyTaskBlockToModel(taskActiveBlock, 'kept');
    if (changed) onTaskKeepBlock(activeFile, taskActiveBlock.id);
  }, [activeFile, applyTaskBlockToModel, onTaskKeepBlock, taskActiveBlock]);

  const revertActiveTaskBlock = useCallback(() => {
    if (!taskActiveBlock || typeof onTaskRevertBlock !== 'function') return;
    const changed = applyTaskBlockToModel(taskActiveBlock, 'reverted');
    if (changed) onTaskRevertBlock(activeFile, taskActiveBlock.id);
  }, [activeFile, applyTaskBlockToModel, onTaskRevertBlock, taskActiveBlock]);

  const setTaskCursor = useCallback((nextIndex) => {
    if (!activeFile || typeof onTaskSetCursor !== 'function') return;
    shouldRevealTaskBlockRef.current = true;
    onTaskSetCursor(activeFile, nextIndex);
  }, [activeFile, onTaskSetCursor]);

  const revealTaskBlock = useCallback((block) => {
    const editor = editorRef.current;
    const model = editor?.getModel?.();
    if (!editor || !model || !block) return;
    const lines = (model.getValue?.() || '').split('\n');
    const needleLines = block.action === 'reverted' ? toLines(block.beforeText || '') : toLines(block.afterText || '');
    const pos = resolveBlockPosition(lines, {
      needleLines,
      contextBefore: toLines(block.contextBefore || ''),
      contextAfter: toLines(block.contextAfter || ''),
      preferredIndex: block.afterStartIndex,
    });
    const boundedLine = Math.max(1, Math.min(model.getLineCount?.() || 1, pos.anchorLineNumber));
    editor.revealLineInCenter?.(boundedLine);
    editor.setPosition?.({ lineNumber: boundedLine, column: 1 });
  }, [resolveBlockPosition, toLines]);

  useEffect(() => {
    shouldRevealTaskBlockRef.current = true;
  }, [activeFile]);

  // Auto-correct cursor to nearest pending block if current one is processed
  useEffect(() => {
    if (!hasTaskReview || pendingBlocks.length === 0) return;
    const currentBlock = taskBlocks[taskActiveIndex];
    if (currentBlock && currentBlock.action !== 'pending') {
      // Find the next pending block
      let nextIdx = taskBlocks.findIndex((b, i) => i >= taskActiveIndex && b.action === 'pending');
      // If no next, find the previous pending block
      if (nextIdx === -1) {
        const revIdx = [...taskBlocks].reverse().findIndex((b, i) => (taskBlocks.length - 1 - i) < taskActiveIndex && b.action === 'pending');
        if (revIdx !== -1) nextIdx = taskBlocks.length - 1 - revIdx;
      }
      
      if (nextIdx !== -1 && nextIdx !== taskActiveIndex) {
        // Disable reveal for auto-correction to avoid jumps on undo/keep
        shouldRevealTaskBlockRef.current = false;
        onTaskSetCursor?.(activeFile, nextIdx);
      }
    }
  }, [hasTaskReview, taskBlocks, taskActiveIndex, pendingBlocks.length, activeFile, onTaskSetCursor]);

  useEffect(() => {
    if (viewMode !== 'code' && viewMode !== 'diff') {
      setEditorVersion(0);
    }
  }, [viewMode]);

  useEffect(() => {
    if (!hasTaskReview || !editorVersion) return undefined;
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return undefined;

    const disposables = [];
    const keepShortcut = getKeybinding('taskReview.keepBlock', 'Alt+Y');
    const revertShortcut = getKeybinding('taskReview.revertBlock', 'Alt+N');
    const keepKb = parseMonacoKeybinding(keepShortcut, monaco);
    const revertKb = parseMonacoKeybinding(revertShortcut, monaco);

    disposables.push(editor.addAction({
      id: 'taskReview.keepBlock',
      label: 'Task Review: Keep Block',
      keybindings: keepKb ? [keepKb] : undefined,
      run: () => keepActiveTaskBlock(),
    }));
    disposables.push(editor.addAction({
      id: 'taskReview.revertBlock',
      label: 'Task Review: Revert Block',
      keybindings: revertKb ? [revertKb] : undefined,
      run: () => revertActiveTaskBlock(),
    }));

    taskReviewKeyDisposableRef.current?.dispose?.();
    taskReviewKeyDisposableRef.current = { dispose: () => disposables.forEach((d) => d?.dispose?.()) };

    return () => {
      disposables.forEach((d) => d?.dispose?.());
      if (taskReviewKeyDisposableRef.current) taskReviewKeyDisposableRef.current = null;
    };
  }, [hasTaskReview, getKeybinding, keepActiveTaskBlock, parseMonacoKeybinding, revertActiveTaskBlock, editorVersion]);

  useEffect(() => {
    if (!hasTaskReview || !editorVersion) return undefined;
    if (!taskActiveBlock) return undefined;
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return undefined;

    if (shouldRevealTaskBlockRef.current) {
        revealTaskBlock(taskActiveBlock);
        shouldRevealTaskBlockRef.current = false;
    }
    return undefined;
  }, [hasTaskReview, revealTaskBlock, taskActiveBlock, taskActiveIndex, editorVersion]);

  useEffect(() => {
    if (!editorVersion) return undefined;
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return undefined;

    const widgets = taskReviewWidgetsRef.current;
    for (const widget of widgets.values()) {
      try {
        editor.removeContentWidget?.(widget);
      } catch {
        // ignore
      }
    }
    widgets.clear();

    try {
      taskReviewDecorationsRef.current?.clear?.();
    } catch {
      // ignore
    }
    taskReviewDecorationsRef.current = null;

    if (!hasTaskReview) {
        editor.layout?.();
        return undefined;
    }
    const model = editor.getModel?.();
    if (!model) return undefined;
    const lines = (model.getValue?.() || '').split('\n');

    const decorations = [];
    // Only show pending blocks in the editor
    pendingBlocks.forEach((block) => {
      const idx = taskBlocks.findIndex(b => b.id === block.id);
      const needleLines = block.action === 'reverted' ? toLines(block.beforeText || '') : toLines(block.afterText || '');
      const fromLen = needleLines.length || 1;
      const pos = resolveBlockPosition(lines, {
        needleLines,
        contextBefore: toLines(block.contextBefore || ''),
        contextAfter: toLines(block.contextAfter || ''),
        preferredIndex: block.afterStartIndex,
      });
      const startLineNumber = Math.max(1, Math.min(model.getLineCount?.() || 1, pos.anchorLineNumber));
      const endLineNumber = Math.max(startLineNumber, Math.min(model.getLineCount?.() || 1, startLineNumber + fromLen - 1));
      decorations.push({
        range: new monaco.Range(startLineNumber, 1, endLineNumber, 1),
        options: {
          isWholeLine: true,
          className: `task-review-hunk task-review-${block.changeType || 'modified'} task-review-${block.action || 'pending'}`,
          linesDecorationsClassName: `task-review-glyph task-review-${block.changeType || 'modified'} task-review-${block.action || 'pending'}`,
        }
      });

      const widgetId = `task-review-widget:${activeFile}:${block.id}`;
      const dom = document.createElement('div');
      dom.className = `task-review-hunk-overlay ${idx === taskActiveIndex ? 'active' : ''}`;
      // Set width to ensure right-alignment works relative to editor width
      const layoutInfo = editor.getLayoutInfo?.();
      if (layoutInfo) {
          dom.style.width = `${layoutInfo.contentWidth}px`;
      }

      const actions = document.createElement('div');
      actions.className = 'task-review-hunk-actions';

      const btnRevert = document.createElement('button');
      btnRevert.type = 'button';
      btnRevert.className = 'task-review-hunk-btn revert';
      btnRevert.title = '撤销 (Alt+N)';
      btnRevert.innerHTML = '<span class="kb">Alt+N</span><span class="label"> 撤销</span>';
      btnRevert.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        onTaskSetCursor?.(activeFile, idx);
        applyTaskBlockToModel(block, 'reverted');
        onTaskRevertBlock?.(activeFile, block.id);
      };

      const btnKeep = document.createElement('button');
      btnKeep.type = 'button';
      btnKeep.className = 'task-review-hunk-btn keep';
      btnKeep.title = '保留 (Alt+Y)';
      btnKeep.innerHTML = '<span class="kb">Alt+Y</span><span class="label"> 保留</span>';
      btnKeep.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        onTaskSetCursor?.(activeFile, idx);
        applyTaskBlockToModel(block, 'kept');
        onTaskKeepBlock?.(activeFile, block.id);
      };

      actions.appendChild(btnRevert);
      actions.appendChild(btnKeep);
      dom.appendChild(actions);

      const widget = {
        getId: () => widgetId,
        getDomNode: () => dom,
        getPosition: () => ({
          position: { lineNumber: startLineNumber, column: 1 },
          preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
        }),
      };
      widgets.set(widgetId, widget);
      try {
        editor.addContentWidget?.(widget);
      } catch {
        // ignore
      }
    });

    // Add content change listener to detect undo/redo that reverts text to pending state
    const contentSub = model.onDidChangeContent((e) => {
        if (!e.isFlush && (e.isUndoing || e.isRedoing)) {
            const currentLines = (model.getValue() || '').split('\n');
            taskBlocks.forEach((block, idx) => {
                if (block.action === 'kept') {
                    // If it was kept but now it matches beforeText, it was likely undone
                    const pos = resolveBlockPosition(currentLines, {
                        needleLines: toLines(block.beforeText || ''),
                        contextBefore: toLines(block.contextBefore || ''),
                        contextAfter: toLines(block.contextAfter || ''),
                        preferredIndex: block.afterStartIndex,
                    });
                    if (pos.anchorLineNumber > 0) {
                        onTaskResetBlock?.(activeFile, block.id);
                        onTaskSetCursor?.(activeFile, idx);
                    }
                } else if (block.action === 'reverted') {
                    // If it was reverted but now it matches afterText, it was likely undone
                    const pos = resolveBlockPosition(currentLines, {
                        needleLines: toLines(block.afterText || ''),
                        contextBefore: toLines(block.contextBefore || ''),
                        contextAfter: toLines(block.contextAfter || ''),
                        preferredIndex: block.afterStartIndex,
                    });
                    if (pos.anchorLineNumber > 0) {
                        onTaskResetBlock?.(activeFile, block.id);
                        onTaskSetCursor?.(activeFile, idx);
                    }
                }
            });
        }
    });

    // Track mouse move to update active task block based on hover
    const mouseMoveSub = editor.onMouseMove((e) => {
        if (!e.target || !e.target.position) return;
        const lineNumber = e.target.position.lineNumber;
        
        // Find if this line is within any pending block
        const hoveredBlockIdx = taskBlocks.findIndex(block => {
            if (block.action !== 'pending') return false;
            const needleLines = block.action === 'reverted' ? toLines(block.beforeText || '') : toLines(block.afterText || '');
            const fromLen = needleLines.length || 1;
            const pos = resolveBlockPosition(lines, {
                needleLines,
                contextBefore: toLines(block.contextBefore || ''),
                contextAfter: toLines(block.contextAfter || ''),
                preferredIndex: block.afterStartIndex,
            });
            const startLineNumber = Math.max(1, Math.min(model.getLineCount?.() || 1, pos.anchorLineNumber));
            const endLineNumber = Math.max(startLineNumber, Math.min(model.getLineCount?.() || 1, startLineNumber + fromLen - 1));
            return lineNumber >= startLineNumber && lineNumber <= endLineNumber;
        });

        if (hoveredBlockIdx !== -1 && hoveredBlockIdx !== taskActiveIndex) {
            shouldRevealTaskBlockRef.current = false;
            onTaskSetCursor?.(activeFile, hoveredBlockIdx);
        }
    });

    taskReviewDecorationsRef.current = editor.createDecorationsCollection(decorations);
    editor.layout?.();

    return () => {
      contentSub.dispose();
      mouseMoveSub.dispose();
      try {
        taskReviewDecorationsRef.current?.clear?.();
      } catch {
        // ignore
      }
      taskReviewDecorationsRef.current = null;
      for (const widget of widgets.values()) {
        try {
          editor.removeContentWidget?.(widget);
        } catch {
          // ignore
        }
      }
      widgets.clear();
    };
  }, [activeFile, applyTaskBlockToModel, hasTaskReview, onTaskKeepBlock, onTaskRevertBlock, onTaskResetBlock, onTaskSetCursor, resolveBlockPosition, taskActiveIndex, taskBlocks, pendingBlocks, toLines, editorVersion]);

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

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    // Handle AI action registration and cursor selection tracking
    // Clean up previous AI disposables
    const aiDisposables = [];

    if (canUseEditorAi) {
      // Register context menu actions
      const defs = [
        { id: 'ai.explain', label: 'AI：解释代码', action: 'explain', fallbackKey: 'Ctrl+Alt+E' },
        { id: 'ai.tests', label: 'AI：生成单元测试', action: 'generateTests', fallbackKey: 'Ctrl+Alt+T' },
        { id: 'ai.optimize', label: 'AI：优化代码', action: 'optimize', fallbackKey: 'Ctrl+Alt+O' },
        { id: 'ai.comments', label: 'AI：生成注释', action: 'generateComments', fallbackKey: 'Ctrl+Alt+C' },
        { id: 'ai.review', label: 'AI：审阅代码', action: 'review', fallbackKey: 'Ctrl+Alt+R' },
        { id: 'ai.rewrite', label: 'AI：重写代码', action: 'rewrite', fallbackKey: 'Ctrl+Alt+W' },
        { id: 'ai.modify', label: 'AI：按指令修改…', action: 'modify', fallbackKey: 'Ctrl+Alt+M' },
        { id: 'ai.docs', label: 'AI：生成文档', action: 'generateDocs', fallbackKey: 'Ctrl+Alt+D' },
      ];

      defs.forEach((d, idx) => {
        const shortcut = getKeybinding(`editor.${d.id}`, d.fallbackKey);
        const parsed = parseMonacoKeybinding(shortcut, monaco);
        const disposable = editor.addAction({
          id: d.id,
          label: d.label,
          keybindings: parsed ? [parsed] : undefined,
          contextMenuGroupId: '9_ai',
          contextMenuOrder: 1.0 + idx / 100,
          run: () => {
            triggerAiAction(d.action);
          },
        });
        aiDisposables.push(disposable);
      });

      // Track selection for inline AI button
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
      aiDisposables.push(selectionDisposable);
    } else {
      setInlineAi({ visible: false, top: 0, left: 0 });
    }

    return () => {
      aiDisposables.forEach((d) => d?.dispose?.());
    };
  }, [canUseEditorAi, getKeybinding, parseMonacoKeybinding, triggerAiAction, editorVersion]);

  const handleEditorMount = useCallback((editor, monaco) => {
    disposablesRef.current.forEach((d) => d?.dispose?.());
    disposablesRef.current = [];
    editorRef.current = editor;
    monacoRef.current = monaco;
    globalThis.__AI_CHAT_MONACO_UNDO_REDO_LIMIT = normalizedUndoRedoLimit;
    setEditorVersion(v => v + 1);

    // Force a secondary refresh after 500ms to ensure decorations/widgets are rendered
    // after the editor has fully settled from page switching
    setTimeout(() => {
      setEditorVersion(v => v + 1);
    }, 500);
  }, [normalizedUndoRedoLimit]);

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
            {shouldShowTaskReviewUI ? (
              <div className="task-review-floating" role="region" aria-label="Task Review">
                <div className="task-review-floating-main">
                  <div className="task-review-floating-text">变更已完成，请确认是否采纳</div>
                  <div className="task-review-floating-actions">
                    {typeof onTaskRevertFile === 'function' ? (
                      <button type="button" className="task-review-btn" onClick={() => onTaskRevertFile(activeFile)}>
                        全部撤销
                      </button>
                    ) : null}
                    {typeof onTaskKeepFile === 'function' ? (
                      <button type="button" className="task-review-btn" onClick={() => onTaskKeepFile(activeFile)}>
                        全部采纳
                      </button>
                    ) : null}
                    {typeof onTaskResetFile === 'function' ? (
                      <button type="button" className="task-review-btn" onClick={() => onTaskResetFile(activeFile)} title="还原所有变更到 Diff 状态">
                        还原 Diff
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="task-review-floating-nav">
                  <div className="task-review-floating-count">
                    {currentPendingIndex !== -1 ? `${currentPendingIndex + 1}/${pendingBlocks.length}` : `-/${pendingBlocks.length}`}
                  </div>
                  <button
                    type="button"
                    className="task-review-btn"
                    disabled={currentPendingIndex <= 0}
                    onClick={() => {
                      const target = pendingBlocks[currentPendingIndex - 1];
                      if (target) {
                        const realIdx = taskBlocks.findIndex(b => b.id === target.id);
                        if (realIdx !== -1) setTaskCursor(realIdx);
                      }
                    }}
                    title="上一处待处理变更"
                  >
                    <span className="codicon codicon-chevron-up" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="task-review-btn"
                    disabled={currentPendingIndex === -1 || currentPendingIndex >= pendingBlocks.length - 1}
                    onClick={() => {
                      const target = pendingBlocks[currentPendingIndex + 1];
                      if (target) {
                        const realIdx = taskBlocks.findIndex(b => b.id === target.id);
                        if (realIdx !== -1) setTaskCursor(realIdx);
                      }
                    }}
                    title="下一处待处理变更"
                  >
                    <span className="codicon codicon-chevron-down" aria-hidden />
                  </button>
                </div>
              </div>
            ) : null}
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
                                          <ManagedDiffEditor
                                              height="100%"
                                              language={inferLanguage(file.path || '')}
                                              original={file.before || ''}
                                              modified={file.after || ''}
                                              theme={monacoTheme}
                                              originalModelPath={`diff-tab-original://${diffModelBase}/${file.path}`}
                                              modifiedModelPath={`diff-tab-modified://${diffModelBase}/${file.path}`}
                                              options={{
                                                  ...monacoOptions,
                                                  readOnly: true,
                                                  renderSideBySide: true,
                                                  wordWrap: 'off',
                                                  minimap: { enabled: false },
                                                  scrollBeyondLastLine: false,
                                                  padding: { top: 8, bottom: 8 },
                                                  hideUnchangedRegions: compactDiff ? {
                                                    enabled: true,
                                                    revealLinePadding: 3,
                                                    contextLineCount: 3
                                                  } : { enabled: false }
                                              }}
                                          />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <ManagedDiffEditor
                                  height="100%"
                                  language={inferLanguage(diffTabs[activeFile].path || '')}
                                  original={diffTabs[activeFile].before || ''}
                                  modified={diffTabs[activeFile].after || ''}
                                  theme={monacoTheme}
                                  originalModelPath={`diff-tab-original://${diffModelBase}`}
                                  modifiedModelPath={`diff-tab-modified://${diffModelBase}`}
                                  options={{
                                    ...monacoOptions,
                                    readOnly: true,
                                    renderSideBySide: true,
                                    wordWrap: 'off',
                                    hideUnchangedRegions: compactDiff ? {
                                      enabled: true,
                                      revealLinePadding: 3,
                                      contextLineCount: 3
                                    } : { enabled: false }
                                  }}
                                />
                              )}
                            </Suspense>
                          )
                          : (
                            <Suspense fallback={<div className="monaco-fallback">Loading Monaco Editor…</div>}>
                              <div style={{ height: '100%', width: '100%' }}>
                                <MonacoEditor
                                  height="100%"
                                  path={activeFile}
                                  language={inferLanguage(activeFile)}
                                  theme={monacoTheme}
                                  value={activeContent}
                                  options={monacoOptions}
                                  saveViewState
                                  keepCurrentModel
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
