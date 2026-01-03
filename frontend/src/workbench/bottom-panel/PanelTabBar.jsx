import React from 'react';

function Tab({ label, active, onClick }) {
  return (
    <button
      type="button"
      className={`bottom-panel-tab ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      <span className="bottom-panel-tab-label">{label}</span>
    </button>
  );
}

export default function PanelTabBar({ views, activeId, onSelect }) {
  return (
    <div className="bottom-panel-tabs" role="tablist" aria-label="Bottom Panel Tabs">
      {views.map((v) => (
        <Tab key={v.id} label={v.label} active={v.id === activeId} onClick={() => onSelect(v.id)} />
      ))}
    </div>
  );
}

