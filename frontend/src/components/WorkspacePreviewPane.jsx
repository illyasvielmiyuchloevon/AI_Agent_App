import React, { useMemo } from 'react';
import { buildPreviewDoc } from '../utils/appAlgorithms';

function WorkspacePreviewPane({
  files,
  livePreviewContent,
  entryCandidates,
  previewEntry,
  onPreviewEntryChange,
  onToggleView,
  onRefreshPreview,
  hotReloadToken,
}) {
  const previewOptions = useMemo(
    () =>
      (Array.isArray(files) ? files : [])
        .filter((f) => {
          const ext = String(f?.path || '').toLowerCase();
          return ext.endsWith('.html') || ext.endsWith('.jsx') || ext.endsWith('.tsx') || ext.endsWith('.js') || ext.endsWith('.py');
        })
        .map((f) => String(f?.path || ''))
        .filter(Boolean),
    [files],
  );

  const previewDoc = useMemo(
    () => buildPreviewDoc({ files, liveContent: livePreviewContent, entryCandidates, preferredEntry: previewEntry }),
    [entryCandidates, files, livePreviewContent, previewEntry],
  );

  return (
    <div className="workspace-preview fullscreen-preview">
      <div className="preview-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span>Live Preview</span>
            <select
              value={String(previewEntry || '')}
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
  );
}

export default React.memo(WorkspacePreviewPane);

