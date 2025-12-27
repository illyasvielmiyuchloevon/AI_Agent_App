import React from 'react';

export default function PanelViewManager({ activeView, viewPropsById }) {
  if (!activeView) return null;
  const Component = activeView.Component;
  const props = viewPropsById?.[activeView.id] || {};
  const viewRef = activeView.ref || null;
  return (
    <div className="bottom-panel-view" role="tabpanel">
      {viewRef ? <Component ref={viewRef} {...props} /> : <Component {...props} />}
    </div>
  );
}
