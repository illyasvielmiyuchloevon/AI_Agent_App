import { useLayoutEffect, useRef, useState } from 'react';

export function useMeasuredHeight() {
  const ref = useRef(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const update = () => {
      try {
        setHeight(el.clientHeight || 0);
      } catch {
        setHeight(0);
      }
    };

    update();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => update());
      ro.observe(el);
      return () => ro.disconnect();
    }

    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return [ref, height];
}

