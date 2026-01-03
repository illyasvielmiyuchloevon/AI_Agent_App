import { useEffect } from 'react';

export const useWorkbenchEditorEvents = ({
  activeGroupId,
  getEditorInstanceByGroupId,
  onOpenFile,
}) => {
  useEffect(() => {
    const onReveal = (e) => {
      const detail = e?.detail || {};
      const line = Number(detail.line);
      const column = Number(detail.column);
      if (!Number.isFinite(line) || line <= 0) return;
      const gid = String(activeGroupId || 'group-1');
      const inst = getEditorInstanceByGroupId?.(gid);
      if (!inst?.editor) return;
      const col = Number.isFinite(column) && column > 0 ? column : 1;
      try {
        inst.editor.focus?.();
        inst.editor.revealLineInCenter?.(line);
        inst.editor.setPosition?.({ lineNumber: line, column: col });
        const Range = inst.monaco?.Range;
        if (Range) {
          inst.editor.setSelection?.(new Range(line, col, line, col));
        }
      } catch {
      }
    };

    globalThis.window?.addEventListener?.('workbench:revealInActiveEditor', onReveal);
    return () => globalThis.window?.removeEventListener?.('workbench:revealInActiveEditor', onReveal);
  }, [activeGroupId, getEditorInstanceByGroupId]);

  useEffect(() => {
    const onOpenFileEvent = (e) => {
      const detail = e?.detail || {};
      const relPath = String(detail.path || '').trim();
      if (!relPath) return;
      const gid = String(activeGroupId || 'group-1');
      try {
        onOpenFile?.(relPath, { groupId: gid, mode: 'persistent' });
      } catch {
      }
    };

    globalThis.window?.addEventListener?.('workbench:openFile', onOpenFileEvent);
    return () => globalThis.window?.removeEventListener?.('workbench:openFile', onOpenFileEvent);
  }, [activeGroupId, onOpenFile]);
};

