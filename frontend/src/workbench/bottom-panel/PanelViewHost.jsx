import React, { useMemo } from 'react';

export default function PanelViewHost({ views, activeId, viewPropsById, viewRefsById }) {
  const active = useMemo(() => views.find((v) => v.id === activeId) || views[0] || null, [views, activeId]);
  if (!active) return null;

  return (
    <>
      {views.map((v) => {
        const Comp = v.Component;
        const props = viewPropsById?.[v.id] || {};
        const ref = viewRefsById?.[v.id] || null;
        const visible = v.id === active.id;
        const shouldRender = visible || !!v.keepAlive;
        if (!shouldRender) return null;
        return (
          <div key={v.id} style={{ height: '100%', display: visible ? 'block' : 'none' }}>
            {ref ? <Comp ref={ref} {...props} /> : <Comp {...props} />}
          </div>
        );
      })}
    </>
  );
}

