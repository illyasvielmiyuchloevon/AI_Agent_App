import React, { useEffect, useMemo, useState } from 'react';
import { outputService } from '../../services/outputService';
import { useSyncExternalStore } from 'react';

const CHANNEL = { id: 'DebugConsole', label: '调试控制台' };

export default function DebugConsoleView() {
  const [input, setInput] = useState('');
  useSyncExternalStore(outputService.subscribe, outputService.getSnapshot, outputService.getSnapshot);

  useEffect(() => {
    outputService.ensureChannel(CHANNEL.id, CHANNEL.label);
  }, []);

  const lines = outputService.getChannelLines(CHANNEL.id);

  const text = useMemo(() => lines.join('\n'), [lines]);

  return (
    <div className="debug-console">
      <div className="debug-console-body">
        {lines.length === 0 ? (
          <div className="panel-empty" style={{ paddingTop: 28 }}>
            <div className="panel-empty-title">请发起调试会话来求表达式求值</div>
            <div className="panel-empty-subtitle">当前实现为 Debug Console 通道占位，后续可接入 Debug Adapter。</div>
          </div>
        ) : (
          <pre className="panel-mono">{text}</pre>
        )}
      </div>
      <form
        className="debug-console-input"
        onSubmit={(e) => {
          e.preventDefault();
          const v = input.trim();
          if (!v) return;
          outputService.append(CHANNEL.id, `> ${v}`);
          outputService.append(CHANNEL.id, 'undefined');
          setInput('');
        }}
      >
        <span className="codicon codicon-debug-console" aria-hidden />
        <input
          className="ghost-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入表达式并回车（占位）"
          spellCheck={false}
        />
      </form>
    </div>
  );
}
