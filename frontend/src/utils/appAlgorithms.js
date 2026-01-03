export const pathDirname = (absPath = '') => {
  const s = String(absPath || '');
  const idx1 = s.lastIndexOf('/');
  const idx2 = s.lastIndexOf('\\');
  const idx = Math.max(idx1, idx2);
  if (idx < 0) return '';
  return s.slice(0, idx);
};

export const pathJoinAbs = (baseAbs = '', rel = '') => {
  const base = String(baseAbs || '').replace(/[\\\/]+$/, '');
  const suffix = String(rel || '').replace(/^[\\\/]+/, '');
  if (!base) return suffix;
  if (!suffix) return base;
  const sep = base.includes('\\') ? '\\' : '/';
  const normalized = suffix.replace(/[\\\/]+/g, sep);
  return `${base}${sep}${normalized}`;
};

export const pathRelativeToRoot = (rootAbs = '', fileAbs = '') => {
  const root = String(rootAbs || '').replace(/[\\\/]+$/, '');
  const file = String(fileAbs || '');
  if (!root || !file) return '';
  const lowerRoot = root.toLowerCase();
  const lowerFile = file.toLowerCase();
  if (!lowerFile.startsWith(lowerRoot)) return '';
  let rel = file.slice(root.length);
  rel = rel.replace(/^[\\\/]+/, '');
  rel = rel.replace(/\\/g, '/');
  if (!rel || rel.includes('..')) return '';
  return rel;
};

export const isFileUnderRoot = (rootAbs = '', fileAbs = '') => {
  const root = String(rootAbs || '').replace(/[\\\/]+$/, '');
  const file = String(fileAbs || '');
  if (!root || !file) return false;
  return file.toLowerCase().startsWith(root.toLowerCase());
};

export const isMissingPathError = (err) => {
  if (!err || !err.message) return false;
  return err.message.toLowerCase().includes('does not exist');
};

export const isAbsolutePath = (path = '') => {
  const trimmed = (path || '').trim();
  if (!trimmed) return false;
  return /^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\') || trimmed.startsWith('/');
};

export const normalizeRelPath = (path = '') => (path || '').replace(/^[./\\]+/, '');

export const shouldHidePath = (path = '') => {
  const clean = normalizeRelPath(path);
  return clean === '.aichat'
    || clean.startsWith('.aichat/')
    || clean.startsWith('.aichat\\')
    || clean === 'aichat'
    || clean.startsWith('aichat/')
    || clean.startsWith('aichat\\');
};

const FILE_EXT_ICONS = {
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

export const getFileIconClass = (path = '') => {
  const ext = String(path || '').split('.').pop()?.toLowerCase();
  return (ext && FILE_EXT_ICONS[ext]) || 'codicon-file';
};

export const getTabIconClass = (path = '', {
  settingsTabPath = '',
  terminalSettingsTabPath = '',
  terminalEditorTabPath = '',
  welcomeTabPath = '',
  extensionsTabPrefix = '',
  diffTabPrefix = '',
} = {}) => {
  const p = String(path || '');
  if (settingsTabPath && p === settingsTabPath) return 'codicon-settings-gear';
  if (terminalSettingsTabPath && p === terminalSettingsTabPath) return 'codicon-terminal';
  if (terminalEditorTabPath && p === terminalEditorTabPath) return 'codicon-terminal';
  if (welcomeTabPath && p === welcomeTabPath) return 'codicon-home';
  if (extensionsTabPrefix && p.startsWith(extensionsTabPrefix)) return 'codicon-extensions';
  if (diffTabPrefix && p.startsWith(diffTabPrefix)) return 'codicon-diff';
  return getFileIconClass(p);
};

export const getDiffFileStatusColor = (status) => {
  const s = String(status || '').trim().toUpperCase();
  if (s === 'M') return '#e2c08d';
  if (s === 'A') return '#73c991';
  if (s === 'D') return '#f14c4c';
  return '#999';
};

export const getSearchResultIconClass = (fileName = '') => {
  const value = String(fileName || '');
  if (!value) return 'codicon-file';
  const lower = value.toLowerCase();
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'codicon-file-code';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'codicon-file-code';
  if (lower.endsWith('.css') || lower.endsWith('.scss')) return 'codicon-paintcan';
  if (lower.endsWith('.html')) return 'codicon-file-code';
  if (lower.endsWith('.json')) return 'codicon-json';
  if (lower.endsWith('.md')) return 'codicon-markdown';
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.svg')) return 'codicon-file-media';
  return 'codicon-file';
};

const FILE_EXT_LANGUAGES = {
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

export const inferMonacoLanguage = (path = '') => {
  const ext = String(path || '').split('.').pop()?.toLowerCase();
  return (ext && FILE_EXT_LANGUAGES[ext]) || 'plaintext';
};

export const toLines = (text) => {
  const s = typeof text === 'string' ? text : String(text || '');
  if (!s) return [];
  return s.split('\n');
};

export const clipText = (text, maxChars) => {
  const s = typeof text === 'string' ? text : '';
  if (s.length <= maxChars) return s;
  return `${s.slice(0, maxChars)}\n…[truncated]`;
};

export const extractFirstCodeBlock = (text) => {
  const s = typeof text === 'string' ? text : '';
  const m = s.match(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)\s*```/);
  if (m && m[1] != null) return m[1];
  return s.trim();
};

export const getKeybindingValue = (keybindings, id, fallback = '') => {
  const kb = keybindings && typeof keybindings === 'object' ? keybindings : {};
  const v = kb?.[id];
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  return fallback;
};

export const parseMonacoKeybinding = (shortcut, monaco) => {
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
};

export const resolveBlockPosition = (lines, { needleLines, contextBefore, contextAfter, preferredIndex = 0 } = {}) => {
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
};

export const copyToClipboard = async (text) => {
  const value = String(text || '');
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
};

export const isSpecialTabPath = (tabPath, {
  settingsTabPath,
  terminalSettingsTabPath,
  terminalEditorTabPath,
  welcomeTabPath,
  extensionsTabPrefix,
  diffTabPrefix,
} = {}) => {
  const p = String(tabPath || '');
  if (!p) return true;
  if (settingsTabPath && p === settingsTabPath) return true;
  if (terminalSettingsTabPath && p === terminalSettingsTabPath) return true;
  if (terminalEditorTabPath && p === terminalEditorTabPath) return true;
  if (welcomeTabPath && p === welcomeTabPath) return true;
  if (extensionsTabPrefix && p.startsWith(extensionsTabPrefix)) return true;
  if (diffTabPrefix && p.startsWith(diffTabPrefix)) return true;
  return false;
};

export const resolveDiffModelBaseForPath = (tabPath, {
  diffTabPrefix,
  diffTabs,
} = {}) => {
  const p = String(tabPath || '');
  if (!diffTabPrefix || !p || !p.startsWith(diffTabPrefix)) return p || 'diff';
  const diff = diffTabs && diffTabs[p];
  return (diff && (diff.id || diff.diff_id || diff.path)) || p || 'diff';
};

export const getTabTitle = (tabPath, {
  settingsTabPath,
  terminalSettingsTabPath,
  terminalEditorTabPath,
  welcomeTabPath,
  extensionsTabPrefix,
  diffTabPrefix,
  diffTabs,
} = {}) => {
  const p = String(tabPath || '');
  const isSettingsTab = settingsTabPath && p === settingsTabPath;
  const isTerminalSettingsTab = terminalSettingsTabPath && p === terminalSettingsTabPath;
  const isTerminalEditorTab = terminalEditorTabPath && p === terminalEditorTabPath;
  const isWelcomeTab = welcomeTabPath && p === welcomeTabPath;
  const isExtensionsTab = extensionsTabPrefix && p.startsWith(extensionsTabPrefix);
  const isDiffTab = diffTabPrefix && p.startsWith(diffTabPrefix);
  const diff = isDiffTab && diffTabs ? diffTabs[p] : null;
  const diffLabel = diff
    ? (diff.path ? `Diff: ${diff.path}` : (diff.files ? 'Diff (multi-file)' : 'Diff'))
    : 'Diff';
  return isSettingsTab
    ? 'Settings'
    : (isTerminalSettingsTab
      ? '终端设置'
      : (isTerminalEditorTab
        ? '终端'
        : (isWelcomeTab
          ? 'Welcome'
          : (isExtensionsTab
            ? `Extension: ${decodeURIComponent(p.slice(String(extensionsTabPrefix || '').length) || '')}`
            : (isDiffTab ? diffLabel : p.split('/').pop())))));
};

export const themedFallback = (message) => `
  <style>
    body { margin: 0; }
    .__preview-fallback { font-family: Inter, Arial, sans-serif; padding: 1.5rem; color: #111827; background: #f3f4f6; min-height: 100vh; }
    @media (prefers-color-scheme: dark) {
      .__preview-fallback { color: #e5e7eb; background: #1e1e1e; }
    }
  </style>
  <div class="__preview-fallback">${message}</div>
`;

export const stripExternalScripts = (html = '') =>
  String(html || '').replace(/<script[^>]*src=["'][^"']+["'][^>]*>\s*<\/script>/gi, '');

export const extractIdHints = (script = '') => {
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

export const injectIdPlaceholders = (html = '', ids = []) => {
  const list = Array.isArray(ids) ? ids : [];
  if (!list.length) return String(html || '');
  const placeholders = list.map((id) => `<div id="${id}"></div>`).join('');
  const raw = String(html || '');
  if (raw.includes('</body>')) {
    return raw.replace('</body>', `${placeholders}</body>`);
  }
  return `${raw}${placeholders}`;
};

export const previewStorageShim = `
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

export const wrapHtml = (content, css, scripts, headExtras = '') => {
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

export const buildPreviewDoc = ({ files, liveContent, entryCandidates, preferredEntry }) => {
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

  if (entryFile && entryExt === 'html') {
    const sanitizedHtml = stripExternalScripts(entryFile.content || '');
    const inlineScriptChunks = [];
    if (sanitizedHtml) {
      sanitizedHtml.replace(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi, (_match, code) => {
        inlineScriptChunks.push(String(code || ''));
        return _match;
      });
    }
    const idHints = extractIdHints(inlineScriptChunks.join('\n'));
    const htmlWithHints = injectIdPlaceholders(
      sanitizedHtml || themedFallback('请选择文件以预览'),
      idHints
    );
    const scripts = '';
    return wrapHtml(
      htmlWithHints || themedFallback('请选择文件以预览'),
      css,
      scripts,
      ''
    );
  }

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
        (function () {
          const run = () => {
            try {
              ${jsx}
            } catch (err) {
              try { console.error(err); } catch {}
            }
          };
          try {
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
            else run();
          } catch {
            run();
          }
        })();
      </script>
    `;
    const jsxMount = injectIdPlaceholders(sanitizedHtml || `<div id="root"></div>`, idHints);
    return wrapHtml(jsxMount, css, scripts, headExtras);
  }

  if (entryFile && entryExt === 'js') {
    const js = entryFile.content || '';
    const scripts = `
      <script>
        (function () {
          const run = () => {
            try {
              ${js}
            } catch (err) {
              try { console.error(err); } catch {}
            }
          };
          try {
            if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
            else run();
          } catch {
            run();
          }
        })();
      </script>
    `;
    const htmlBase = !preferredEntry && htmlCandidate ? (fileMap[htmlCandidate]?.content || '') : '';
    const sanitizedHtml = htmlBase ? stripExternalScripts(htmlBase) : '';
    const idHints = !preferredEntry ? extractIdHints(js) : [];
    const jsMount = injectIdPlaceholders(sanitizedHtml || `<div id="root"></div>`, idHints);
    return wrapHtml(jsMount, css, scripts, '');
  }

  if (entry && entryExt === 'py') {
    const html = `<main style="font-family:Inter,Arial,sans-serif;padding:2rem;line-height:1.6;">
      <h2 style="margin-top:0;">Python entry detected: ${entry}</h2>
      <p>Run the backend or start the script locally to preview the app. Frontend preview shows files only.</p>
    </main>`;
    return wrapHtml(html, css, '', '');
  }

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
    ${js ? `<script>(function(){const run=()=>{try{${js}}catch(err){try{console.error(err)}catch{}}};try{if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();}catch{run();}})();</script>` : ''}
    ${jsx ? `<script type="text/babel">(function(){const run=()=>{try{${jsx}}catch(err){try{console.error(err)}catch{}}};try{if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();}catch{run();}})();</script>` : ''}
  `
    : '';

  return wrapHtml(
    sanitizedWithHints || themedFallback('请选择文件以预览'),
    css,
    scripts,
    headExtras
  );
};

export const safeDiffStat = (before = '', after = '') => {
  const a = String(before || '').split('\n');
  const b = String(after || '').split('\n');
  const m = a.length;
  const n = b.length;
  if (m === 0 && n === 0) return { added: 0, removed: 0 };
  if (m === 0) return { added: n, removed: 0 };
  if (n === 0) return { added: 0, removed: m };
  if (m * n > 2000000) {
    return { added: Math.max(n - m, 0), removed: Math.max(m - n, 0) };
  }
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  let i = m;
  let j = n;
  let added = 0;
  let removed = 0;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      removed += 1;
      i -= 1;
    } else {
      added += 1;
      j -= 1;
    }
  }
  removed += i;
  added += j;
  return { added, removed };
};

export const buildLineDiffBlocks = (before = '', after = '') => {
  const a = String(before || '').split('\n');
  const b = String(after || '').split('\n');
  const m = a.length;
  const n = b.length;
  if (m === 0 && n === 0) return [];
  if (m * n > 2000000) {
    return [{
      id: 'block-0',
      beforeStartIndex: 0,
      beforeEndIndex: m,
      afterStartIndex: 0,
      afterEndIndex: n,
      beforeText: String(before || ''),
      afterText: String(after || ''),
      changeType: 'modified',
      action: 'pending',
      contextBefore: '',
      contextAfter: '',
    }];
  }

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const ops = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ t: 'eq', v: a[i - 1] });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ t: 'ins', v: b[j - 1] });
      j -= 1;
    } else {
      ops.push({ t: 'del', v: a[i - 1] });
      i -= 1;
    }
  }
  ops.reverse();

  const blocks = [];
  let bi = 0;
  let ai = 0;
  let active = null;

  const startBlock = () => {
    active = {
      beforeStartIndex: bi,
      afterStartIndex: ai,
      beforeLines: [],
      afterLines: [],
    };
  };

  const finishBlock = () => {
    if (!active) return;
    const beforeEndIndex = bi;
    const afterEndIndex = ai;
    const beforeText = active.beforeLines.join('\n');
    const afterText = active.afterLines.join('\n');
    const changeType = active.beforeLines.length === 0 ? 'added' : (active.afterLines.length === 0 ? 'deleted' : 'modified');

    const ctxBefore = b.slice(Math.max(0, active.afterStartIndex - 2), active.afterStartIndex).join('\n');
    const ctxAfter = b.slice(afterEndIndex, Math.min(n, afterEndIndex + 2)).join('\n');
    const id = `block-${blocks.length}`;
    blocks.push({
      id,
      beforeStartIndex: active.beforeStartIndex,
      beforeEndIndex,
      afterStartIndex: active.afterStartIndex,
      afterEndIndex,
      beforeText,
      afterText,
      changeType,
      action: 'pending',
      contextBefore: ctxBefore,
      contextAfter: ctxAfter,
    });
    active = null;
  };

  for (const op of ops) {
    if (op.t === 'eq') {
      finishBlock();
      bi += 1;
      ai += 1;
      continue;
    }
    if (!active) startBlock();
    if (op.t === 'del') {
      active.beforeLines.push(op.v);
      bi += 1;
    } else if (op.t === 'ins') {
      active.afterLines.push(op.v);
      ai += 1;
    }
  }
  finishBlock();

  return blocks;
};
