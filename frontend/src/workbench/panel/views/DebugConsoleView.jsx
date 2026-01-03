import React, { useEffect, useRef } from 'react';

export default function DebugConsoleView({
  lines = [],
  sessionActive = false,
  inputValue = '',
  onChangeInput,
  onSubmitExpression,
}) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [lines.length]);

  return (
    <div className="debug-console">
      <div className="debug-console-body">
        {lines.length === 0 && !sessionActive ? (
          <div className="panel-empty" style={{ paddingTop: 28 }}>
            <div className="panel-empty-title">请发起调试会话来求表达式求值</div>
            <div className="panel-empty-subtitle">Debug Console 绑定调试上下文，不等同于终端。</div>
          </div>
        ) : (
          <pre className="panel-mono">{lines.join('\n')}</pre>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="debug-console-input"
        onSubmit={(e) => {
          e.preventDefault();
          const v = String(inputValue || '').trim();
          if (!v) return;
          onSubmitExpression?.(v);
        }}
      >
        <span className="codicon codicon-debug-console" aria-hidden />
        <input
          className="ghost-input"
          value={inputValue}
          onChange={(e) => onChangeInput?.(e.target.value)}
          placeholder={sessionActive ? '输入表达式并回车' : '启动调试会话后可输入表达式'}
          disabled={!sessionActive}
          spellCheck={false}
        />
      </form>
    </div>
  );
}

