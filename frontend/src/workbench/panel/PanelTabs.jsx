import React from 'react';

function PanelTab({ view, active, onSelect }) {
  return (
    <button
      type="button"
      className={`bottom-panel-tab ${active ? 'active' : ''}`}
      onClick={() => onSelect(view.id)}
      title={view.label}
    >
      {view.icon ? <span className={`codicon ${view.icon}`} aria-hidden /> : null}
      <span className="bottom-panel-tab-label">{view.label}</span>
      {typeof view.badge === 'number' && view.badge > 0 ? (
        <span className="bottom-panel-tab-badge">{view.badge}</span>
      ) : null}
    </button>
  );
}

export default function PanelTabs({ views, activeViewId, onSelectView }) {
  return (
    <div className="bottom-panel-tabs" role="tablist" aria-label="Bottom Panel Tabs">
      {views.map((view) => (
        <PanelTab
          key={view.id}
          view={view}
          active={view.id === activeViewId}
          onSelect={onSelectView}
        />
      ))}
    </div>
  );
}

