import React, { useMemo, useState } from 'react';

const buildFileTree = (files) => {
  const root = {};
  files.forEach((file) => {
    const parts = file.path.split('/');
    let current = root;
    parts.forEach((part, index) => {
      if (!current[part]) {
        current[part] = {
          name: part,
          path: parts.slice(0, index + 1).join('/'),
          children: {},
          file: index === parts.length - 1 ? file : null,
        };
      }
      current = current[part].children;
    });
  });
  return root;
};

const FileTreeItem = ({ node, depth = 0, onOpenCommitDiff, commitHash }) => {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = Object.keys(node.children).length > 0;
  const isFile = !!node.file;

  return (
    <div>
      <div
        className="sc-file-item"
        style={{ paddingLeft: `${depth * 12 + 4}px`, height: '24px' }}
        onClick={(e) => {
          e.stopPropagation();
          if (isFile) {
            onOpenCommitDiff(commitHash, node.file.path);
          } else {
            setExpanded(!expanded);
          }
        }}
      >
        {hasChildren && (
          <span
            style={{ marginRight: '4px', fontSize: '10px', width: '10px', display: 'inline-block' }}
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          >
            {expanded ? '▼' : '▶'}
          </span>
        )}
        {!hasChildren && <span style={{ width: '14px' }}></span>}

        {isFile && (
          <span
            className="sc-status-icon"
            style={{
              color: node.file.status === 'M'
                ? 'var(--warning)'
                : (node.file.status === 'A'
                  ? 'var(--success)'
                  : (node.file.status === 'D' ? 'var(--danger)' : 'var(--muted)')),
              marginRight: '6px',
            }}
          >
            {node.file.status}
          </span>
        )}
        <span className="sc-file-name" style={{ fontSize: '12px' }}>{node.name}</span>
      </div>
      {expanded && hasChildren && (
        <div>
          {Object.values(node.children).map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              onOpenCommitDiff={onOpenCommitDiff}
              commitHash={commitHash}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default function CommitDetails({ commitHash, files, viewMode, onOpenCommitDiff }) {
  const treeRoot = useMemo(
    () => (viewMode === 'tree' && files ? buildFileTree(files) : null),
    [files, viewMode]
  );

  if (!files) return null;

  return (
    <div className="sc-file-list" style={{ marginTop: '4px', borderLeft: '1px solid var(--border)', marginLeft: '4px' }}>
      {viewMode === 'list' ? (
        files.map((file) => (
          <div
            key={file.path}
            className="sc-file-item"
            style={{ height: '24px' }}
            onClick={(e) => { e.stopPropagation(); onOpenCommitDiff(commitHash, file.path); }}
            title={`Click to diff ${file.path}`}
          >
            <span className="sc-status-icon" style={{
              color: file.status === 'M'
                ? 'var(--warning)'
                : (file.status === 'A'
                  ? 'var(--success)'
                  : (file.status === 'D' ? 'var(--danger)' : 'var(--muted)')),
            }}
            >
              {file.status}
            </span>
            <span className="sc-file-name" style={{ fontSize: '12px' }}>{file.path}</span>
          </div>
        ))
      ) : (
        Object.values(treeRoot || {}).map((node) => (
          <FileTreeItem
            key={node.path}
            node={node}
            onOpenCommitDiff={onOpenCommitDiff}
            commitHash={commitHash}
          />
        ))
      )}
    </div>
  );
}

