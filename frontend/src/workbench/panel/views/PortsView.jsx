import React from 'react';

export default function PortsView({ ports = [], onForwardPort }) {
  if (!ports.length) {
    return (
      <div className="panel-empty">
        <div className="panel-empty-title">没有转发的端口。</div>
        <div className="panel-empty-subtitle">转发端口以通过 Internet 访问本地运行的服务。</div>
        <div style={{ marginTop: 10 }}>
          <button type="button" className="primary-btn" style={{ height: 30, fontSize: 13 }} onClick={() => onForwardPort?.()}>
            转发端口
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-list">
      {ports.map((p) => (
        <div key={`${p.host}:${p.port}`} className="panel-list-row static">
          <span className="codicon codicon-globe" aria-hidden />
          <div className="panel-list-main">
            <div className="panel-list-title">{p.label || `${p.host}:${p.port}`}</div>
            <div className="panel-list-meta">
              <span className="panel-list-file">{p.host}:{p.port}</span>
              {p.visibility ? <span className="panel-list-source">{p.visibility}</span> : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

