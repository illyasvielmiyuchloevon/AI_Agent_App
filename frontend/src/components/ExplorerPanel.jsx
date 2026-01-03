
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GitDriver } from '../utils/gitDriver';
import { getFileIconClass } from '../utils/appAlgorithms';

const buildFolderTree = (entries = []) => {
  const root = { path: '', name: '', type: 'dir', children: [] };
  const map = new Map([['', root]]);
  entries.forEach((entry) => {
    const parts = entry.path.split('/').filter(Boolean);
    let prefix = '';
    parts.forEach((part, idx) => {
      const currentPath = prefix ? `${prefix}/${part}` : part;
      if (!map.has(currentPath)) {
        const node = {
          path: currentPath,
          name: part,
          type: idx === parts.length - 1 ? entry.type : 'dir',
          children: [],
        };
        map.set(currentPath, node);
        const parent = map.get(prefix);
        if (parent) parent.children.push(node);
      } else if (idx === parts.length - 1) {
        const node = map.get(currentPath);
        node.type = entry.type;
      }
      prefix = currentPath;
    });
  });
  return root.children;
};

const buildTree = (entries = [], workspaceRoots = []) => {
  const groupsMap = new Map();
  entries.forEach((entry) => {
    const index = typeof entry.workspace_folder_index === 'number' ? entry.workspace_folder_index : 0;
    const rootPath = entry.workspace_root || '';
    const folderName = entry.workspace_folder || '';
    const key = String(index);
    let group = groupsMap.get(key);
    if (!group) {
      const meta = Array.isArray(workspaceRoots) ? workspaceRoots.find((r, i) => i === index || (rootPath && r.path === rootPath)) : null;
      const name = folderName || (meta && (meta.name || meta.path)) || '';
      group = { index, name, entries: [] };
      groupsMap.set(key, group);
    }
    group.entries.push(entry);
  });
  const groups = Array.from(groupsMap.values()).sort((a, b) => a.index - b.index);
  if (groups.length <= 1) {
    return buildFolderTree(entries);
  }
  return groups.map((group) => {
    const children = buildFolderTree(group.entries);
    const label = group.name || `Root ${group.index + 1}`;
    return {
      path: label,
      name: label,
      type: 'dir',
      children,
    };
  });
};

const flattenTree = (nodes, collapsed) => {
  const rows = [];
  const walk = (list, depth = 0) => {
    list
      .slice()
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.path.localeCompare(b.path);
      })
      .forEach((node) => {
        rows.push({ ...node, depth });
        if (node.type === 'dir' && !collapsed.has(node.path)) {
          walk(node.children || [], depth + 1);
        }
      });
  };
  walk(nodes);
  return rows;
};

const TreeRow = React.memo(({ index, style, data }) => {
  const { rows, activeFile, revealPath, updatedPaths, onToggle, onOpen, onContext, collapsed, gitStatusMap } = data;
  const node = rows[index];
  const isDir = node.type === 'dir';
  const isActive = activeFile === node.path;
  const isRevealed = revealPath === node.path;
  const isUpdated = updatedPaths.has(node.path);
  
  const gitState = gitStatusMap?.get(node.path);
  const getGitColor = (s) => {
      if (!s) return null;
      if (s === 'M') return '#e2c08d';
      if (s === 'A' || s === '?') return '#73c991';
      if (s === 'D') return '#f14c4c';
      return '#aaa'; 
  };
  const gitColor = getGitColor(gitState);

  return (
    <div
      style={{
        ...style,
        paddingLeft: 12 + node.depth * 12,
      }}
      className={`tree-item-virtual explorer-row ${isActive ? 'active' : ''} ${isRevealed ? 'revealed' : ''} ${isUpdated ? 'updated' : ''}`}
      onClick={() => (isDir ? onToggle(node.path) : onOpen(node.path))}
      onDoubleClick={() => {
        if (isDir) return;
        onOpen(node.path, { mode: 'persistent' });
      }}
      onContextMenu={(e) => onContext(e, node)}
    >
      <span className="tree-disclosure">
        {isDir ? (
          <i
            className={`codicon ${collapsed.has(node.path) ? 'codicon-chevron-right' : 'codicon-chevron-down'}`}
            aria-hidden
            style={{ color: 'var(--muted)' }}
          />
        ) : (
          <i className={`codicon ${getFileIconClass(node.path)}`} aria-hidden style={{ color: gitColor || 'inherit' }} />
        )}
      </span>
      <span title={node.path} className="tree-label" style={{ color: gitColor || 'inherit' }}>
        {node.name}
      </span>
      {gitState && <span style={{marginLeft:'auto', fontSize:'10px', fontWeight:'bold', color: gitColor, marginRight:'8px'}}>{gitState === '?' ? 'U' : gitState}</span>}
      {isUpdated && !gitState && <span className="tree-dirty-dot" title="未保存更改" />}
    </div>
  );
}, (prevProps, nextProps) => {
  const { rows: prevRows, activeFile: prevActive, revealPath: prevReveal, updatedPaths: prevUpdated, collapsed: prevCollapsed, gitStatusMap: prevGit } = prevProps.data;
  const { rows: nextRows, activeFile: nextActive, revealPath: nextReveal, updatedPaths: nextUpdated, collapsed: nextCollapsed, gitStatusMap: nextGit } = nextProps.data;
  const prevNode = prevRows[prevProps.index];
  const nextNode = nextRows[nextProps.index];
  
  return (
    prevProps.index === nextProps.index &&
    prevProps.style === nextProps.style &&
    prevNode?.path === nextNode?.path &&
    prevActive === nextActive &&
    prevReveal === nextReveal &&
    (prevNode?.path ? prevUpdated.has(prevNode.path) === nextUpdated.has(nextNode.path) : true) &&
    (prevNode?.type === 'dir' ? prevCollapsed.has(prevNode.path) === nextCollapsed.has(nextNode.path) : true) &&
    (prevNode?.path ? prevGit?.get(prevNode.path) === nextGit?.get(nextNode.path) : true)
  );
});

const VirtualizedList = ({ height, itemSize, items, rowData, scrollToIndex = -1, children }) => {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);

  const onScroll = useCallback((e) => {
    setScrollTop(e.currentTarget.scrollTop || 0);
  }, []);

  useEffect(() => {
    const idx = Number(scrollToIndex);
    if (!Number.isFinite(idx) || idx < 0) return;
    const el = containerRef.current;
    if (!el) return;
    const containerHeight = Math.max(0, el.clientHeight || height || 0);
    const targetTop = Math.max(0, idx * itemSize - Math.floor(containerHeight / 2) + Math.floor(itemSize / 2));
    el.scrollTop = targetTop;
    setScrollTop(targetTop);
  }, [scrollToIndex, height, itemSize]);

  const totalHeight = items.length * itemSize;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemSize));
  const visibleCount = Math.ceil(height / itemSize) + 3;
  const endIndex = Math.min(items.length, startIndex + visibleCount);

  const slice = items.slice(startIndex, endIndex);

  return (
    <div
      ref={containerRef}
      style={{ height, overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}
      onScroll={onScroll}
    >
      <div style={{ height: totalHeight, position: 'relative', width: '100%' }}>
        {slice.map((_, idx) => {
          const realIndex = startIndex + idx;
          const style = { position: 'absolute', top: realIndex * itemSize, height: itemSize, width: '100%' };
          return children({ index: realIndex, style, data: rowData, key: realIndex });
        })}
      </div>
    </div>
  );
};

function ExplorerPanel({
  files = [],
  fileTree = [],
  projectLabel = '',
  loading = false,
  activeFile = '',
  backendRoot = '',
  editorGroups = [],
  activeGroupId = '',
  tabMeta = {},
  previewEditorEnabled = true,
  revealPath = '',
  revealNonce = 0,
  onOpenFile,
  onAddFile,
  onAddFolder,
  onDeletePath,
  onRenamePath,
  onSyncStructure,
  hasWorkspace = false,
  gitStatus = null,
  workspaceRoots = [],
  // onSearch prop is no longer used here as search is moved to SearchPanel
}) {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const treeRef = useRef(null);
  const [treeHeight, setTreeHeight] = useState(380);
  const [revealedPath, setRevealedPath] = useState('');
  const revealTimerRef = useRef(null);
  const [outlineCollapsed, setOutlineCollapsed] = useState(false);
  const [outlineMode, setOutlineMode] = useState('code'); // code | runtime
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineItems, setTimelineItems] = useState([]);
  const [timelineError, setTimelineError] = useState('');
  const timelineReqRef = useRef(0);

  const updatedPaths = useMemo(
    () => new Set(files.filter((f) => f.dirty).map((f) => f.path)),
    [files]
  );
  
  const gitStatusMap = useMemo(() => {
      if (!gitStatus || !gitStatus.files) return new Map();
      const map = new Map();
      gitStatus.files.forEach(f => {
          const status = f.working_dir !== ' ' ? f.working_dir : f.index;
          map.set(f.path, status);
      });
      return map;
  }, [gitStatus]);

  const nodes = useMemo(() => buildTree(fileTree, workspaceRoots), [fileTree, workspaceRoots]);
  const virtualRows = useMemo(() => flattenTree(nodes, collapsed), [nodes, collapsed]);

  const findAncestors = useCallback((nodeList, target) => {
    const t = String(target || '').trim();
    if (!t) return null;

    const walk = (list, parents) => {
      for (const node of list || []) {
        if (!node?.path) continue;
        if (node.path === t) return parents;
        if (node.type === 'dir' && Array.isArray(node.children) && node.children.length > 0) {
          const found = walk(node.children, [...parents, node.path]);
          if (found) return found;
        }
      }
      return null;
    };

    return walk(nodeList, []) || [];
  }, []);

  const headerLabel = useMemo(() => {
    if (Array.isArray(workspaceRoots) && workspaceRoots.length > 1) {
      const names = workspaceRoots.map((r) => (r && (r.name || r.path)) || '').filter(Boolean);
      if (names.length > 0) return names.join(' • ');
    }
    return projectLabel;
  }, [projectLabel, workspaceRoots]);

  const activeFileEntry = useMemo(() => {
    const p = String(activeFile || '');
    if (!p) return null;
    return (files || []).find((f) => f?.path === p) || null;
  }, [activeFile, files]);

  const activeFileContent = String(activeFileEntry?.content || '');
  const activeFileExt = useMemo(() => {
    const p = String(activeFile || '');
    const ext = p.toLowerCase().split('.').pop();
    return ext || '';
  }, [activeFile]);

  const revealInActiveEditor = useCallback((line, column = 1) => {
    const lineNumber = Number(line);
    const col = Number(column);
    if (!Number.isFinite(lineNumber) || lineNumber <= 0) return;
    try {
      window.dispatchEvent(new CustomEvent('workbench:revealInActiveEditor', { detail: { line: lineNumber, column: Number.isFinite(col) && col > 0 ? col : 1 } }));
    } catch {
      // ignore
    }
  }, []);

  const formatRelativeTime = (dateInput) => {
    const t = new Date(dateInput || 0).getTime();
    if (!Number.isFinite(t) || t <= 0) return '';
    const diff = Date.now() - t;
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / (60 * 1000)))} 分钟`;
    if (diff < 24 * 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / (60 * 60 * 1000)))} 小时`;
    if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.max(1, Math.floor(diff / (24 * 60 * 60 * 1000)))} 天`;
    return `${Math.max(1, Math.floor(diff / (7 * 24 * 60 * 60 * 1000)))} 周`;
  };

  const buildCodeOutline = useCallback((path, content) => {
    const p = String(path || '');
    if (!p) return [];
    const text = String(content || '');
    if (!text) return [];
    const ext = p.toLowerCase().split('.').pop() || '';
    const supported = ['js', 'jsx', 'ts', 'tsx', 'css', 'md', 'json'].includes(ext);
    if (!supported) return [];

    const lines = text.split('\n');
    const items = [];
    let depth = 0;
    const push = (item) => {
      if (items.length >= 240) return;
      items.push(item);
    };

    const rx = {
      funcDecl: /^\s*(?:export\s+)?(?:default\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/,
      classDecl: /^\s*(?:export\s+)?class\s+([A-Za-z0-9_$]+)/,
      ifaceDecl: /^\s*(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/,
      enumDecl: /^\s*(?:export\s+)?enum\s+([A-Za-z0-9_$]+)/,
      typeDecl: /^\s*(?:export\s+)?type\s+([A-Za-z0-9_$]+)/,
      arrowDecl: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)?\s*=>/,
      funcExpr: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?function\b/,
      cssSelector: /^\s*([.#][A-Za-z0-9_-]+)\s*(?:\{|,)/,
      cssKeyframes: /^\s*@keyframes\s+([A-Za-z0-9_-]+)/,
      jsonKey: /^\s*\"([^\"]+)\"\s*:\s*/,
    };

    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i];
      const lineNo = i + 1;
      const line = String(raw || '');
      const beforeDepth = depth;

      if (ext === 'css') {
        const m1 = line.match(rx.cssSelector);
        const m2 = line.match(rx.cssKeyframes);
        if (m2) push({ kind: 'event', icon: 'codicon-symbol-event', name: m2[1], line: lineNo, depth: beforeDepth });
        else if (m1) push({ kind: 'class', icon: 'codicon-symbol-class', name: m1[1], line: lineNo, depth: beforeDepth });
      } else if (ext === 'json') {
        const m = line.match(rx.jsonKey);
        if (m) push({ kind: 'property', icon: 'codicon-symbol-property', name: m[1], line: lineNo, depth: Math.max(0, beforeDepth) });
      } else if (['js', 'jsx', 'ts', 'tsx'].includes(ext)) {
        const mFunc = line.match(rx.funcDecl);
        const mClass = line.match(rx.classDecl);
        const mIface = line.match(rx.ifaceDecl);
        const mEnum = line.match(rx.enumDecl);
        const mType = line.match(rx.typeDecl);
        const mArrow = line.match(rx.arrowDecl);
        const mExpr = line.match(rx.funcExpr);
        if (mFunc) push({ kind: 'function', icon: 'codicon-symbol-method', name: mFunc[1], line: lineNo, depth: beforeDepth });
        else if (mClass) push({ kind: 'class', icon: 'codicon-symbol-class', name: mClass[1], line: lineNo, depth: beforeDepth });
        else if (mIface) push({ kind: 'interface', icon: 'codicon-symbol-interface', name: mIface[1], line: lineNo, depth: beforeDepth });
        else if (mEnum) push({ kind: 'enum', icon: 'codicon-symbol-enum', name: mEnum[1], line: lineNo, depth: beforeDepth });
        else if (mType) push({ kind: 'type', icon: 'codicon-symbol-namespace', name: mType[1], line: lineNo, depth: beforeDepth });
        else if (mExpr) push({ kind: 'function', icon: 'codicon-symbol-method', name: mExpr[1], line: lineNo, depth: beforeDepth });
        else if (mArrow) push({ kind: 'function', icon: 'codicon-symbol-method', name: mArrow[1], line: lineNo, depth: beforeDepth });
      } else if (ext === 'md') {
        const h = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
        if (h) push({ kind: 'string', icon: 'codicon-symbol-string', name: h[2].trim(), line: lineNo, depth: Math.max(0, h[1].length - 1) });
      }

      // Update depth (very lightweight brace-based nesting).
      if (!['json', 'md'].includes(ext)) {
        const opens = (line.match(/{/g) || []).length;
        const closes = (line.match(/}/g) || []).length;
        depth = Math.max(0, depth + opens - closes);
      }
    }

    return items;
  }, []);

  const buildRuntimeOutline = useCallback(() => {
    const groups = Array.isArray(editorGroups) ? editorGroups : [];
    const gid = String(activeGroupId || '').trim();
    const active = groups.find((g) => String(g?.id || '') === gid) || groups[0] || null;
    const activePath = String(active?.activeFile || activeFile || '');
    const key = gid && activePath ? `${gid}::${activePath}` : '';
    const meta = key && tabMeta && typeof tabMeta === 'object' ? tabMeta[key] : null;
    const dirty = !!(files || []).find((f) => f?.path === activePath && f?.dirty);
    const previewEnabled = previewEditorEnabled !== false;
    const rows = [];
    const push = (depth, icon, label, value = '') => rows.push({ depth, icon, label, value });
    push(0, 'codicon-editor-layout', `Group: ${gid || 'group-1'}`);
    push(1, 'codicon-lock', `Locked`, active?.locked ? 'true' : 'false');
    push(1, 'codicon-eye', `Preview Enabled`, previewEnabled ? 'true' : 'false');
    push(1, 'codicon-file', `Active File`, activePath || '—');
    push(2, 'codicon-edit', `Dirty`, dirty ? 'true' : 'false');
    push(2, 'codicon-pin', `Pinned`, meta?.pinned ? 'true' : 'false');
    push(2, 'codicon-lock', `Kept Open`, meta?.keptOpen ? 'true' : 'false');
    push(2, 'codicon-eye', `Preview`, meta?.preview ? 'true' : 'false');
    push(1, 'codicon-list-unordered', `Open Tabs`, String((active?.openTabs || []).length || 0));
    return rows;
  }, [activeFile, activeGroupId, editorGroups, files, previewEditorEnabled, tabMeta]);

  const codeOutlineItems = useMemo(() => buildCodeOutline(activeFile, activeFileContent), [activeFile, activeFileContent, buildCodeOutline]);
  const runtimeOutlineItems = useMemo(() => buildRuntimeOutline(), [buildRuntimeOutline]);

  const loadTimeline = useCallback(async () => {
    const root = String(backendRoot || '').trim();
    const file = String(activeFile || '').trim();
    if (!root || !file || !hasWorkspace) {
      setTimelineItems([]);
      setTimelineError('');
      return;
    }
    if (!GitDriver.isAvailable()) {
      setTimelineItems([]);
      setTimelineError('');
      return;
    }
    const reqId = (timelineReqRef.current || 0) + 1;
    timelineReqRef.current = reqId;
    setTimelineLoading(true);
    setTimelineError('');
    try {
      const log = await GitDriver.logFile(root, file);
      if (timelineReqRef.current !== reqId) return;
      const list = (log && log.all) ? log.all : (Array.isArray(log) ? log : []);
      setTimelineItems(Array.isArray(list) ? list : []);
    } catch (err) {
      if (timelineReqRef.current !== reqId) return;
      setTimelineItems([]);
      setTimelineError(err?.message || String(err));
    } finally {
      if (timelineReqRef.current === reqId) setTimelineLoading(false);
    }
  }, [activeFile, backendRoot, hasWorkspace]);

  useEffect(() => {
    if (timelineCollapsed) return;
    loadTimeline();
  }, [loadTimeline, timelineCollapsed]);

  useEffect(() => {
    if (!treeRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const nextHeight = Math.max(220, Math.floor(entry.contentRect.height));
      setTreeHeight(nextHeight);
    });
    observer.observe(treeRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  useEffect(() => {
    if (!activeFile) return;
    const parts = String(activeFile || '').split('/').filter(Boolean);
    if (parts.length < 2) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      let prefix = '';
      for (let i = 0; i < parts.length - 1; i += 1) {
        prefix = prefix ? `${prefix}/${parts[i]}` : parts[i];
        next.delete(prefix);
      }
      return next;
    });
  }, [activeFile]);

  useEffect(() => {
    const target = String(revealPath || '').trim();
    if (!target) return;
    // Use nonce so revealing the same path twice still works.
    if (!revealNonce) return;

    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }

    setRevealedPath(target);
    const ancestors = findAncestors(nodes, target) || [];
    if (!ancestors.length) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      ancestors.forEach((p) => next.delete(p));
      return next;
    });
  }, [revealNonce, revealPath, findAncestors, nodes]);

  useEffect(() => {
    if (!revealedPath) return;
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    const current = revealedPath;
    revealTimerRef.current = setTimeout(() => {
      setRevealedPath((prev) => (prev === current ? '' : prev));
      revealTimerRef.current = null;
    }, 1500);
    return () => {
      if (revealTimerRef.current) {
        clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      }
    };
  }, [revealedPath]);

  const toggleCollapse = useCallback((path) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleContextMenu = useCallback((event, node = null) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      node: node && node.path ? node : null,
    });
  }, []);

  const closeContext = () => setContextMenu(null);
  const contextTargetPath = contextMenu?.node?.path || '';
  const hasContextTarget = !!contextTargetPath;
  const renderContextItem = (label, action, { danger = false, disabled = false } = {}) => (
    <div
      className={`context-item ${danger ? 'danger' : ''} ${disabled ? 'disabled' : ''}`}
      style={{ padding: '8px 12px', ...(danger ? { color: 'var(--danger)' } : {}) }}
      onClick={() => {
        if (disabled) return;
        action?.();
        closeContext();
      }}
    >
      {label}
    </div>
  );

  return (
    <div className="explorer-panel">
      <div className="explorer-header">
        <div className="explorer-title" title={headerLabel || '未绑定项目'}>
          <div className="explorer-label">EXPLORER</div>
          <div className="explorer-sub">
            <i className="codicon codicon-folder-opened" aria-hidden />
            <span className="explorer-sub-text">{headerLabel || '未绑定项目'}</span>
          </div>
        </div>
        <div className="explorer-actions">
          <button
            type="button"
            onClick={onAddFile}
            className="explorer-action-btn"
            title="新建文件"
            aria-label="新建文件"
          >
            <i className="codicon codicon-new-file" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onAddFolder}
            className="explorer-action-btn"
            title="新建文件夹"
            aria-label="新建文件夹"
          >
            <i className="codicon codicon-new-folder" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onSyncStructure}
            className="explorer-action-btn"
            title="刷新"
            aria-label="刷新"
          >
            <i className={`codicon ${loading ? 'codicon-loading codicon-modifier-spin' : 'codicon-refresh'}`} aria-hidden />
          </button>
        </div>
      </div>

      <div className="explorer-body">
        <div
          className="workspace-tree explorer-tree"
          ref={treeRef}
          onContextMenu={(e) => handleContextMenu(e, null)}
        >
          {virtualRows.length > 0 ? (
            <VirtualizedList
              height={treeHeight}
              itemSize={28}
              items={virtualRows}
              scrollToIndex={revealedPath ? virtualRows.findIndex((r) => r?.path === revealedPath) : -1}
              rowData={{
                rows: virtualRows,
                activeFile,
                revealPath: revealedPath,
                updatedPaths,
                onToggle: toggleCollapse,
                onOpen: onOpenFile,
                onContext: handleContextMenu,
                collapsed,
                gitStatusMap
              }}
            >
              {({ index, style, data, key }) => (
                <TreeRow key={`${virtualRows[index]?.path || index}`} index={index} style={style} data={data} />
              )}
            </VirtualizedList>
          ) : (
            <div className="tree-empty" onContextMenu={(e) => handleContextMenu(e, null)}>该项目暂无文件，开始创建吧。</div>
          )}
        </div>

        <div className={`sidebar-section ${outlineCollapsed ? 'collapsed' : ''}`}>
          <div
            className="sidebar-section-header"
            role="button"
            tabIndex={0}
            onClick={() => setOutlineCollapsed((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOutlineCollapsed((v) => !v);
              }
            }}
          >
            <div className="sidebar-section-title">
              <i className={`codicon ${outlineCollapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'}`} aria-hidden />
              <span>大纲</span>
              {activeFile ? <span className="sidebar-section-sub">{activeFile.split('/').pop()}</span> : null}
            </div>
            <div className="sidebar-section-actions" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={`sidebar-chip ${outlineMode === 'code' ? 'active' : ''}`}
                onClick={() => setOutlineMode('code')}
                title="代码大纲"
              >
                <i className="codicon codicon-symbol-field" aria-hidden />
                <span>代码</span>
              </button>
              <button
                type="button"
                className={`sidebar-chip ${outlineMode === 'runtime' ? 'active' : ''}`}
                onClick={() => setOutlineMode('runtime')}
                title="运行时对象大纲"
              >
                <i className="codicon codicon-debug" aria-hidden />
                <span>运行时</span>
              </button>
            </div>
          </div>
          {!outlineCollapsed ? (
            <div className="sidebar-section-body outline-body">
              {outlineMode === 'code' ? (
                codeOutlineItems.length > 0 ? (
                  <div className="outline-list" role="tree" aria-label="Code outline">
                    {codeOutlineItems.map((it, idx) => (
                      <div
                        key={`${it.name}-${it.line}-${idx}`}
                        className="outline-item"
                        role="treeitem"
                        style={{ paddingLeft: 10 + Math.min(8, Number(it.depth || 0)) * 12 }}
                        onClick={() => revealInActiveEditor(it.line, 1)}
                        title={`跳转到第 ${it.line} 行`}
                      >
                        <i className={`codicon ${it.icon || 'codicon-symbol-field'}`} aria-hidden />
                        <span className="outline-label">{it.name}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="sidebar-empty">当前文件无可用大纲（支持 js/ts/css/md/json）。</div>
                )
              ) : (
                runtimeOutlineItems.length > 0 ? (
                  <div className="outline-list" role="tree" aria-label="Runtime outline">
                    {runtimeOutlineItems.map((it, idx) => (
                      <div
                        key={`${it.label}-${idx}`}
                        className="outline-item"
                        role="treeitem"
                        style={{ paddingLeft: 10 + Math.min(8, Number(it.depth || 0)) * 12 }}
                        title={it.value ? `${it.label}: ${it.value}` : it.label}
                      >
                        <i className={`codicon ${it.icon || 'codicon-symbol-field'}`} aria-hidden />
                        <span className="outline-label">{it.label}</span>
                        {it.value ? <span className="outline-value">{it.value}</span> : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="sidebar-empty">暂无运行时信息。</div>
                )
              )}
            </div>
          ) : null}
        </div>

        <div className={`sidebar-section ${timelineCollapsed ? 'collapsed' : ''}`}>
          <div
            className="sidebar-section-header"
            role="button"
            tabIndex={0}
            onClick={() => setTimelineCollapsed((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setTimelineCollapsed((v) => !v);
              }
            }}
          >
            <div className="sidebar-section-title">
              <i className={`codicon ${timelineCollapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'}`} aria-hidden />
              <span>时间线</span>
              {activeFile ? <span className="sidebar-section-sub">{activeFile.split('/').pop()}</span> : null}
            </div>
            <div className="sidebar-section-actions" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="sidebar-icon-btn"
                onClick={() => loadTimeline()}
                title="刷新时间线"
                aria-label="刷新时间线"
                disabled={timelineLoading || !activeFile || !hasWorkspace}
              >
                <i className={`codicon ${timelineLoading ? 'codicon-loading codicon-modifier-spin' : 'codicon-refresh'}`} aria-hidden />
              </button>
            </div>
          </div>
          {!timelineCollapsed ? (
            <div className="sidebar-section-body timeline-body">
              {!activeFile ? (
                <div className="sidebar-empty">未打开文件。</div>
              ) : timelineError ? (
                <div className="sidebar-empty">时间线加载失败：{timelineError}</div>
              ) : timelineLoading && timelineItems.length === 0 ? (
                <div className="sidebar-empty">加载中…</div>
              ) : timelineItems.length > 0 ? (
                <div className="timeline-list" role="list" aria-label="Timeline">
                  {timelineItems.map((it, idx) => (
                    <div key={`${it.hash || it.id || idx}`} className="timeline-item" role="listitem" title={it.hash || ''}>
                      <div className="timeline-bullet" aria-hidden />
                      <div className="timeline-main">
                        <div className="timeline-message">{it.message || it.subject || ''}</div>
                        <div className="timeline-meta">
                          <span className="timeline-author">{it.author_name || it.author || ''}</span>
                          <span className="timeline-time">{formatRelativeTime(it.date)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="sidebar-empty">暂无提交记录或非 Git 仓库。</div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {contextMenu && (
        <div
          className="context-menu"
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-soft)',
            zIndex: 30,
            minWidth: 180,
            padding: 4,
          }}
        >
          {renderContextItem('打开', () => onOpenFile?.(contextTargetPath, { mode: 'persistent' }), { disabled: !hasContextTarget })}
          {renderContextItem('新建文件', () => onAddFile?.())}
          {renderContextItem('新建文件夹', () => onAddFolder?.())}
          {renderContextItem('重命名 / 移动', () => onRenamePath?.(contextTargetPath), { disabled: !hasContextTarget })}
          {renderContextItem('删除', () => onDeletePath?.(contextTargetPath), { danger: true, disabled: !hasContextTarget })}
        </div>
      )}
    </div>
  );
}

export default React.memo(ExplorerPanel);
