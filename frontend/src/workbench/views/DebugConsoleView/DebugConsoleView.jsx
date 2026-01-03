import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { List } from 'react-window';
import { debugService } from '../../services/debugService';

const RowHeight = 20;
const isNearBottom = (scrollOffset, viewportHeight, contentHeight) => {
  const threshold = 24;
  return scrollOffset + viewportHeight >= contentHeight - threshold;
};

export default function DebugConsoleView() {
  const snap = useSyncExternalStore(debugService.subscribe, debugService.getSnapshot, debugService.getSnapshot);
  const entries = snap.entries || [];
  const sessionActive = !!snap.sessionActive;

  const listRef = useRef(null);
  const inputRef = useRef(null);
  const historyIndexRef = useRef(-1);
  const [input, setInput] = useState('');

  const scrollToBottom = useCallback(() => {
    if (!listRef.current) return;
    const idx = Math.max(0, entries.length - 1);
    listRef.current.scrollToRow?.({ index: idx, align: 'end' });
  }, [entries.length]);

  useEffect(() => {
    if (!snap.follow) return;
    if (entries.length === 0) return;
    scrollToBottom();
  }, [entries.length, scrollToBottom, snap.follow]);

  useEffect(() => {
    if (!snap.scrollToBottomTick) return;
    scrollToBottom();
  }, [snap.scrollToBottomTick, scrollToBottom]);

  useEffect(() => {
    if (!sessionActive) return;
    inputRef.current?.focus?.();
  }, [sessionActive]);

  const onSubmit = useCallback(async () => {
    const v = String(input || '').trim();
    if (!v) return;
    historyIndexRef.current = -1;
    setInput('');
    await debugService.evaluate(v);
  }, [input]);

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      debugService.clear();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit().catch(() => {});
      return;
    }

    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const list = debugService.getHistory();
    if (!list.length) return;
    e.preventDefault();

    const idx = historyIndexRef.current;
    const nextIdx = e.key === 'ArrowUp'
      ? Math.min(list.length - 1, idx + 1)
      : Math.max(-1, idx - 1);
    historyIndexRef.current = nextIdx;
    setInput(debugService.historyAt(nextIdx));
  };

  const Row = useMemo(() => {
    return ({ index, style }) => {
      const it = entries[index];
      const kind = it?.kind || 'stdout';
      return (
        <div className={`debug-console-line ${kind}`} style={{ ...style, height: RowHeight }}>
          <span className="debug-console-gutter" aria-hidden />
          <span className="debug-console-text">{it?.text || ''}</span>
        </div>
      );
    };
  }, [entries]);

  const empty = entries.length === 0;
  const title = sessionActive ? 'Debug Console' : '请发起调试会话来求表达式求值';
  const subtitle = sessionActive
    ? `当前会话：${snap.session?.name || '—'}`
    : 'Debug Console 绑定调试上下文，不等同于终端。';

  return (
    <div className="debug-console">
      <div className="debug-console-body">
        {empty ? (
          <div className="panel-empty" style={{ paddingTop: 28 }}>
            <div className="panel-empty-title">{title}</div>
            <div className="panel-empty-subtitle">{subtitle}</div>
          </div>
        ) : null}

        <div className="debug-console-list">
          <List
            listRef={listRef}
            defaultHeight={240}
            style={{ height: '100%', width: '100%', overflowX: 'auto' }}
            rowCount={entries.length}
            rowHeight={RowHeight}
            rowComponent={Row}
            onScroll={({ scrollOffset, scrollHeight, clientHeight }) => {
              const near = isNearBottom(scrollOffset, clientHeight || 0, scrollHeight || 0);
              if (near && !snap.follow) debugService.setFollow(true);
              if (!near && snap.follow) debugService.setFollow(false);
            }}
            rowProps={{}}
          />
        </div>
      </div>

      <div className="debug-console-input">
        <span className="codicon codicon-debug-console" aria-hidden />
        <input
          ref={inputRef}
          className="ghost-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={sessionActive ? '输入表达式并回车' : '启动调试会话后可输入表达式'}
          disabled={!sessionActive}
          spellCheck={false}
        />
      </div>
    </div>
  );
}
