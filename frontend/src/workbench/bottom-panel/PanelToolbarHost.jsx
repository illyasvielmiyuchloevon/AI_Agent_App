import React from 'react';

export default function PanelToolbarHost({ activeView, viewPropsById }) {
  if (!activeView?.Toolbar) return null;
  const Toolbar = activeView.Toolbar;
  const props = viewPropsById?.[activeView.id] || {};
  return <Toolbar {...props} />;
}
