import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PROJECT_CONFIG } from '../utils/appDefaults';
import { pickLayoutNumber } from '../utils/appPersistence';

export function useLayoutResize({ debugSeparators = false } = {}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => pickLayoutNumber('sidebarWidth', DEFAULT_PROJECT_CONFIG.sidebarWidth));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSidebarPanel, setActiveSidebarPanel] = useState('sessions');
  const [explorerReveal, setExplorerReveal] = useState({ path: '', nonce: 0 });

  useEffect(() => {
    const handler = (event) => {
      const path = event?.detail?.path;
      if (!path) return;
      setSidebarCollapsed(false);
      setActiveSidebarPanel('explorer');
      setExplorerReveal((prev) => ({ path: String(path), nonce: (prev?.nonce || 0) + 1 }));
    };
    window.addEventListener('workbench:revealInExplorer', handler);
    return () => window.removeEventListener('workbench:revealInExplorer', handler);
  }, []);

  const [activeResizeTarget, setActiveResizeTarget] = useState(null);
  const resizeStateRef = useRef({ target: null, startX: 0, startWidth: 0, maxWidth: 0 });
  const resizePendingRef = useRef({ target: null, width: 0, delta: 0 });
  const resizeRafRef = useRef(null);

  const lastSidebarWidthRef = useRef(pickLayoutNumber('sidebarWidth', DEFAULT_PROJECT_CONFIG.sidebarWidth));
  const sidebarResizerGhostRef = useRef(null);
  const [showResizeOverlay, setShowResizeOverlay] = useState(false);

  const stopResize = useCallback(() => {
    if (debugSeparators) console.log('[resizer] stopResize');
    if (resizeRafRef.current) {
      cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = null;
    }

    resizePendingRef.current = { target: null, width: 0, delta: 0 };
    resizeStateRef.current = { target: null, startX: 0, startWidth: 0, maxWidth: 0 };
    setActiveResizeTarget(null);
    setShowResizeOverlay(false);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    try { if (sidebarResizerGhostRef.current) sidebarResizerGhostRef.current.style.background = 'var(--border)'; } catch {}
  }, [debugSeparators]);

  const startResize = useCallback((target) => (mouseDownEvent) => {
    mouseDownEvent.preventDefault();
    mouseDownEvent.stopPropagation();
    if (debugSeparators) console.log('[resizer] startResize', { target, clientX: mouseDownEvent.clientX });

    const startWidth = sidebarCollapsed ? 0 : sidebarWidth;

    const navWidth = 54;
    const resizersWidth = 2;
    const fixedDeduction = navWidth + resizersWidth;
    const maxWidth = window.innerWidth - fixedDeduction;

    resizeStateRef.current = { target, startX: mouseDownEvent.clientX, startWidth, maxWidth };
    setActiveResizeTarget(target);
    setShowResizeOverlay(true);
    resizePendingRef.current = { target, width: startWidth, delta: 0 };
    const ghost = sidebarResizerGhostRef.current;
    if (ghost) {
      ghost.style.transform = 'translateX(0px)';
    }
    if (sidebarResizerGhostRef.current) sidebarResizerGhostRef.current.style.background = 'var(--sidebar-active)';
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  }, [debugSeparators, sidebarCollapsed, sidebarWidth]);

  const handleMouseMove = useCallback((mouseMoveEvent) => {
    const { target, startX, startWidth, maxWidth } = resizeStateRef.current;
    if (!target) return;
    if (debugSeparators) console.log('[resizer] move', { clientX: mouseMoveEvent.clientX, target });

    const rawDelta = mouseMoveEvent.clientX - startX;
    const dampedDelta = rawDelta * 0.8;

    if (target === 'sidebar' && sidebarCollapsed) {
      if (rawDelta > 30) {
        const targetW = lastSidebarWidthRef.current || 260;
        setSidebarCollapsed(false);
        setSidebarWidth(targetW * 1.1);
        stopResize();
        setTimeout(() => {
          setSidebarWidth(targetW);
        }, 200);
      }
      return;
    }

    let nextWidth = startWidth + dampedDelta;

    if (target === 'sidebar') {
      const MIN_WIDTH = 220;
      if (nextWidth < MIN_WIDTH - 100) {
        setSidebarCollapsed(true);
        stopResize();
        return;
      }

      if (nextWidth <= MIN_WIDTH) {
        nextWidth = MIN_WIDTH;
        if (sidebarResizerGhostRef.current) {
          sidebarResizerGhostRef.current.style.background = '#FF5722';
        }
      } else if (sidebarResizerGhostRef.current) {
        sidebarResizerGhostRef.current.style.background = 'var(--sidebar-active, #2196F3)';
      }
    }

    if (maxWidth) {
      nextWidth = Math.min(nextWidth, maxWidth);
    }

    resizePendingRef.current = { target, width: nextWidth, delta: dampedDelta };
    if (!resizeRafRef.current) {
      resizeRafRef.current = requestAnimationFrame(() => {
        const pending = resizePendingRef.current;
        if (!pending.target) return;

        if (pending.target === 'sidebar') {
          setSidebarWidth(pending.width);
          lastSidebarWidthRef.current = pending.width;
        }
        resizeRafRef.current = null;
      });
    }
  }, [debugSeparators, sidebarCollapsed, stopResize]);

  useEffect(() => {
    if (!activeResizeTarget) return;
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopResize);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopResize);
    };
  }, [activeResizeTarget, handleMouseMove, stopResize]);

  useEffect(() => {
    if (debugSeparators) console.log('[resizer state]', { activeResizeTarget, showResizeOverlay, sidebarWidth, sidebarCollapsed });
  }, [debugSeparators, activeResizeTarget, showResizeOverlay, sidebarWidth, sidebarCollapsed]);

  const handleSidebarTabChange = useCallback((panelKey) => {
    setActiveSidebarPanel((prev) => {
      if (prev === panelKey && !sidebarCollapsed) {
        setSidebarCollapsed(true);
        return prev;
      }
      setSidebarCollapsed(false);
      return panelKey;
    });
  }, [sidebarCollapsed]);

  const sidebarStyle = useMemo(() => ({
    width: sidebarCollapsed ? '0px' : `${sidebarWidth}px`,
    minWidth: sidebarCollapsed ? '0' : '220px',
    maxWidth: sidebarCollapsed ? '0' : 'none',
    transition: activeResizeTarget === 'sidebar' ? 'none' : 'width 0.2s ease, min-width 0.2s ease',
    pointerEvents: sidebarCollapsed ? 'none' : 'auto',
  }), [activeResizeTarget, sidebarCollapsed, sidebarWidth]);

  return {
    sidebarWidth,
    setSidebarWidth,
    sidebarCollapsed,
    setSidebarCollapsed,
    activeSidebarPanel,
    setActiveSidebarPanel,
    explorerReveal,
    setExplorerReveal,
    lastSidebarWidthRef,
    sidebarResizerGhostRef,
    showResizeOverlay,
    activeResizeTarget,
    startResize,
    handleMouseMove,
    stopResize,
    handleSidebarTabChange,
    sidebarStyle,
  };
}

