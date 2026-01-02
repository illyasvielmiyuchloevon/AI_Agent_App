import React from 'react';
import { useSyncExternalStore } from 'react';
import { debugService } from '../../services/debugService';

export default function DebugConsoleToolbar() {
  const snap = useSyncExternalStore(debugService.subscribe, debugService.getSnapshot, debugService.getSnapshot);
  const active = !!snap.sessionActive;
  const follow = !!snap.follow;

  return (
    <>
      <button
        type="button"
        className={`bottom-panel-icon-btn ${follow ? 'active' : ''}`}
        onClick={() => debugService.setFollow(!follow)}
        title={follow ? '自动滚动：开' : '自动滚动：关'}
      >
        <span className="codicon codicon-arrow-down" aria-hidden />
      </button>
      <button
        type="button"
        className="bottom-panel-icon-btn"
        onClick={() => debugService.requestScrollToBottom()}
        title="滚动到底部"
      >
        <span className="codicon codicon-chevron-down" aria-hidden />
      </button>
      <button
        type="button"
        className="bottom-panel-icon-btn"
        onClick={() => debugService.clear()}
        title="清空"
      >
        <span className="codicon codicon-clear-all" aria-hidden />
      </button>
      <button
        type="button"
        className="bottom-panel-icon-btn"
        onClick={() => {
          const text = debugService.getPlainText();
          if (!text) return;
          Promise.resolve()
            .then(() => navigator.clipboard?.writeText?.(text))
            .catch(() => {});
        }}
        title="复制全部"
      >
        <span className="codicon codicon-copy" aria-hidden />
      </button>
      <span className="bottom-panel-sep" aria-hidden />
      {!active ? (
        <button
          type="button"
          className="bottom-panel-icon-btn"
          onClick={() => debugService.startSession({}).catch(() => {})}
          title="启动调试会话"
        >
          <span className="codicon codicon-debug-start" aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          className="bottom-panel-icon-btn"
          onClick={() => debugService.stopSession().catch(() => {})}
          title="停止调试会话"
        >
          <span className="codicon codicon-debug-stop" aria-hidden />
        </button>
      )}
    </>
  );
}
