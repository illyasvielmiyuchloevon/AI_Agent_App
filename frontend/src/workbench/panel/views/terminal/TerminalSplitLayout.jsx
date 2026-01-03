import React from 'react';

export default function TerminalSplitLayout({
  mainPaneRef,
  gridClass,
  split,
  splitIds,
  isTwoPaneSplit,
  leftId,
  rightId,
  splitPct,
  terminals,
  activeId,
  onActivate,
  onContextMenu,
  onSplitterPointerDown,
  setXtermContainer,
  children,
}) {
  return (
    <div
      className={`vscode-terminal-main ${gridClass}`}
      ref={mainPaneRef}
      style={(() => {
        if (isTwoPaneSplit) return { '--terminal-split': splitPct };
        if (!split?.enabled) return undefined;
        const n = (splitIds?.length || 1);
        if (split?.orientation === 'horizontal') {
          return { gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: `repeat(${n}, minmax(0, 1fr))` };
        }
        return { gridTemplateRows: 'minmax(0, 1fr)', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` };
      })()}
    >
      {(Array.isArray(terminals) ? terminals : []).map((t) => (
        <div
          key={t.id}
          className={`vscode-terminal-instance ${t.id === activeId ? 'active' : ''}`}
          style={(() => {
            if (!split?.enabled) return { display: t.id === activeId ? 'block' : 'none' };
            if (isTwoPaneSplit) {
              if (t.id === leftId) return split?.orientation === 'horizontal' ? { display: 'block', gridRow: 1, gridColumn: 1 } : { display: 'block', gridRow: 1, gridColumn: 1 };
              if (t.id === rightId) return split?.orientation === 'horizontal' ? { display: 'block', gridRow: 3, gridColumn: 1 } : { display: 'block', gridRow: 1, gridColumn: 3 };
              return { display: 'none' };
            }
            const idx = (Array.isArray(splitIds) ? splitIds : []).indexOf(t.id);
            if (idx < 0) return { display: 'none' };
            if (split?.orientation === 'horizontal') return { display: 'block', gridRow: idx + 1, gridColumn: 1 };
            return { display: 'block', gridRow: 1, gridColumn: idx + 1 };
          })()}
          onPointerDown={() => onActivate?.(t.id)}
          onContextMenu={(e) => onContextMenu?.(e, t.id)}
          ref={(el) => {
            if (!el) return;
            setXtermContainer?.(t.id, el);
          }}
          aria-label={`terminal-${t.title || t.id}`}
        />
      ))}

      {isTwoPaneSplit ? (
        <div
          className={`vscode-terminal-splitter ${split?.orientation === 'horizontal' ? 'h' : 'v'}`}
          onPointerDown={onSplitterPointerDown}
          role="separator"
          aria-orientation={split?.orientation === 'horizontal' ? 'horizontal' : 'vertical'}
          aria-label="Resize split panes"
        />
      ) : null}

      {children}
    </div>
  );
}

