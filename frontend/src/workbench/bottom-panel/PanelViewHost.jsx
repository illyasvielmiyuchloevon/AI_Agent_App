import React, { useMemo } from 'react';

export default function PanelViewHost({ views, activeId, viewPropsById, viewRefsById }) {
  const active = useMemo(() => views.find((v) => v.id === activeId) || views[0] || null, [views, activeId]);
  if (!active) return null;

  return (
    <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
      {views.map((v) => {
        const Comp = v.Component;
        const props = viewPropsById?.[v.id] || {};
        const ref = viewRefsById?.[v.id] || null;
        const visible = v.id === active.id;
        const shouldRender = visible || !!v.keepAlive;
        if (!shouldRender) return null;
        return (
          <div
            key={v.id}
            className="bottom-panel-view"
            role="tabpanel"
            style={{
              position: 'absolute',
              inset: 0,
              ...(visible ? {} : { display: 'none' }),
            }}
          >
            {ref ? <Comp ref={ref} {...props} /> : <Comp {...props} />}
          </div>
        );
      })}
    </div>
  );
}
