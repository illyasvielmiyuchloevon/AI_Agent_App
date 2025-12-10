import React, { useState } from 'react';

const StatusBadge = ({ ok, label }) => (
  <span className={`log-badge ${ok ? 'ok' : 'error'}`}>{label}</span>
);

const LogRow = ({ log, onSelect }) => (
  <div className="log-row" onClick={() => onSelect(log)}>
    <div className="log-row-top">
      <span className="log-provider">{log.provider}</span>
      <span className="log-time">{new Date(log.created_at).toLocaleTimeString()}</span>
    </div>
    <div className="log-row-meta">
      <span className="log-method">{log.method} · {log.status_code}</span>
      <StatusBadge ok={!!log.success} label={log.success ? '请求成功' : '请求失败'} />
      <StatusBadge ok={log.parsed_success !== false} label={log.parsed_success === false ? '解析失败' : '解析成功'} />
    </div>
    {log.parse_error && <div className="log-parse-error">{log.parse_error}</div>}
  </div>
);

const LogDetail = ({ log, onBack }) => (
  <div className="log-detail">
    <button className="ghost-btn" onClick={onBack} style={{ marginBottom: '0.75rem' }}>← 返回列表</button>
    <div className="log-detail-card">
      <div className="log-detail-title">{log.method} {log.url}</div>
      <div className="log-detail-meta">
        <span>状态: {log.status_code}</span>
        <StatusBadge ok={!!log.success} label={log.success ? '请求成功' : '请求失败'} />
        <StatusBadge ok={log.parsed_success !== false} label={log.parsed_success === false ? '解析失败' : '解析成功'} />
      </div>
      {log.parse_error && <div className="log-parse-error">解析错误: {log.parse_error}</div>}
      <div className="log-time-full">{new Date(log.created_at).toLocaleString()}</div>
    </div>
    <div className="log-json-block">
      <div className="log-json-title">Request</div>
      <pre>{JSON.stringify(log.request_body, null, 2)}</pre>
    </div>
    <div className="log-json-block">
      <div className="log-json-title">Response</div>
      <pre>{JSON.stringify(log.response_body, null, 2)}</pre>
    </div>
  </div>
);

function LogPanel({ logs, onClose }) {
  const [selectedLog, setSelectedLog] = useState(null);

  return (
    <div className="log-panel">
      <header className="log-header">
        <div className="log-header-left">
          <div className="pill">API Logs</div>
          <div className="muted" style={{ fontSize: '0.85rem' }}>实时展示请求/响应、成功状态与解析状态</div>
        </div>
        <button className="ghost-btn" onClick={onClose}>×</button>
      </header>

      <div className="log-body">
        {logs.length === 0 && <div className="log-empty">暂无日志</div>}

        {selectedLog
          ? <LogDetail log={selectedLog} onBack={() => setSelectedLog(null)} />
          : logs.map((log) => <LogRow key={log.id} log={log} onSelect={setSelectedLog} />)}
      </div>
    </div>
  );
}

export default LogPanel;
