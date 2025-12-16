
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

const getIconClass = (path) => {
  const ext = path.split('.').pop();
  return EXT_ICONS[ext] || 'codicon-file';
};

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
  const { rows, activeFile, updatedPaths, onToggle, onOpen, onContext, collapsed, gitStatusMap } = data;
  const node = rows[index];
  const isDir = node.type === 'dir';
  const isActive = activeFile === node.path;
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
      className={`tree-item-virtual explorer-row ${isActive ? 'active' : ''} ${isUpdated ? 'updated' : ''}`}
      onClick={() => (isDir ? onToggle(node.path) : onOpen(node.path))}
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
          <i className={`codicon ${getIconClass(node.path)}`} aria-hidden style={{ color: gitColor || 'inherit' }} />
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
  const { rows: prevRows, activeFile: prevActive, updatedPaths: prevUpdated, collapsed: prevCollapsed, gitStatusMap: prevGit } = prevProps.data;
  const { rows: nextRows, activeFile: nextActive, updatedPaths: nextUpdated, collapsed: nextCollapsed, gitStatusMap: nextGit } = nextProps.data;
  const prevNode = prevRows[prevProps.index];
  const nextNode = nextRows[nextProps.index];
  
  return (
    prevProps.index === nextProps.index &&
    prevProps.style === nextProps.style &&
    prevNode?.path === nextNode?.path &&
    prevActive === nextActive &&
    (prevNode?.path ? prevUpdated.has(prevNode.path) === nextUpdated.has(nextNode.path) : true) &&
    (prevNode?.type === 'dir' ? prevCollapsed.has(prevNode.path) === nextCollapsed.has(nextNode.path) : true) &&
    (prevNode?.path ? prevGit?.get(prevNode.path) === nextGit?.get(nextNode.path) : true)
  );
});

const VirtualizedList = ({ height, itemSize, items, rowData, children }) => {
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);

  const onScroll = useCallback((e) => {
    setScrollTop(e.currentTarget.scrollTop || 0);
  }, []);

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

  const updatedPaths = useMemo(
    () => new Set(files.filter((f) => f.updated).map((f) => f.path)),
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

  const headerLabel = useMemo(() => {
    if (Array.isArray(workspaceRoots) && workspaceRoots.length > 1) {
      const names = workspaceRoots.map((r) => (r && (r.name || r.path)) || '').filter(Boolean);
      if (names.length > 0) return names.join(' • ');
    }
    return projectLabel;
  }, [projectLabel, workspaceRoots]);

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
      <div className="explorer-header" style={{ height: 'auto', flexDirection: 'column', gap: '4px', paddingBottom: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
            <div className="explorer-title">
              <div className="explorer-label">EXPLORER</div>
              <div className="explorer-sub" title={projectLabel || '未绑定项目'}>
                {projectLabel || '未绑定项目'}
              </div>
            </div>
            <div className="explorer-actions">
              <button onClick={onAddFile} className="ghost-btn tiny" title="新建文件">＋</button>
              <button onClick={onAddFolder} className="ghost-btn tiny" title="新建文件夹">📂</button>
              <button onClick={onSyncStructure} className="ghost-btn tiny" title="刷新">⟳</button>
            </div>
        </div>
      </div>
      
      <div
        className="workspace-tree explorer-tree"
        ref={treeRef}
        onContextMenu={(e) => handleContextMenu(e, null)}
      >
        <div className="tree-header">
          <div>Files {headerLabel ? `· ${headerLabel}` : ''}</div>
          {loading && <span className="tree-badge">同步中...</span>}
        </div>
        {virtualRows.length > 0 ? (
          <VirtualizedList
            height={treeHeight}
            itemSize={28}
            items={virtualRows}
            rowData={{
              rows: virtualRows,
              activeFile,
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
          {renderContextItem('打开', () => onOpenFile?.(contextTargetPath), { disabled: !hasContextTarget })}
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
