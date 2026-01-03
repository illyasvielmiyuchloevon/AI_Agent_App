import React, { useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import { portsService } from '../../services/portsService';

export default function PortsView() {
  const snap = useSyncExternalStore(portsService.subscribe, portsService.getSnapshot, portsService.getSnapshot);

  useEffect(() => {
    portsService.refresh().catch(() => {});
  }, []);

  if (snap.loading) {
    return (
      <div className="panel-empty">
        <div className="panel-empty-title">正在扫描端口…</div>
        <div className="panel-empty-subtitle">读取本机监听端口（后端解析 netstat/lsof）。</div>
      </div>
    );
  }

  if (snap.error) {
    return (
      <div className="panel-empty">
        <div className="panel-empty-title">端口扫描失败</div>
        <div className="panel-empty-subtitle">{snap.error}</div>
      </div>
    );
  }

  const ports = Array.isArray(snap.ports) ? snap.ports : [];
  if (!ports.length) {
    return (
      <div className="panel-empty">
        <div className="panel-empty-title">没有检测到监听端口。</div>
        <div className="panel-empty-subtitle">运行本地服务后（如 3000/5173）会在此出现。</div>
      </div>
    );
  }

  return (
    <div className="panel-list">
      {ports.map((p) => (
        <button
          key={`${p.host}:${p.port}:${p.pid || ''}`}
          type="button"
          className="panel-list-row"
          onClick={() => {
            const rawHost = String(p.host || '').trim();
            const host = (rawHost === '0.0.0.0' || rawHost === '::' || rawHost === '*' || rawHost === '') ? '127.0.0.1' : rawHost;
            const urlHost = host.includes(':') ? `[${host}]` : host;
            const url = `http://${urlHost}:${p.port}/`;
            try { window.open(url, '_blank', 'noopener,noreferrer'); } catch {}
          }}
          title={`${p.host}:${p.port} pid=${p.pid || '—'}`}
        >
          <span className="codicon codicon-globe" aria-hidden />
          <div className="panel-list-main">
            <div className="panel-list-title">{p.host}:{p.port}</div>
            <div className="panel-list-meta">
              {p.pid ? <span className="panel-list-source">pid {p.pid}</span> : null}
              {p.process ? <span className="panel-list-source">{p.process}</span> : null}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
