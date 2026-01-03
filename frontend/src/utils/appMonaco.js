import { normalizeUndoRedoLimit } from './appDefaults';

export const loadMonacoEditorWithUndoRedoPatch = async () => {
  const [{ UndoRedoService }, mod] = await Promise.all([
    import('monaco-editor/esm/vs/platform/undoRedo/common/undoRedoService.js'),
    import('@monaco-editor/react'),
  ]);

  if (!globalThis.__AI_CHAT_MONACO_UNDO_REDO_PATCHED) {
    globalThis.__AI_CHAT_MONACO_UNDO_REDO_PATCHED = true;

    const originalPushElement = UndoRedoService?.prototype?._pushElement;
    if (typeof originalPushElement === 'function') {
      UndoRedoService.prototype._pushElement = function patchedPushElement(element) {
        originalPushElement.call(this, element);

        const stacks = this?._editStacks;
        const strResources = element?.strResources;
        if (!stacks || typeof stacks.get !== 'function' || !Array.isArray(strResources)) return;

        for (const strResource of strResources) {
          const editStack = stacks.get(strResource);
          if (!editStack) continue;
          if (editStack._aiChatMaxPast == null) {
            editStack._aiChatMaxPast = normalizeUndoRedoLimit(globalThis.__AI_CHAT_MONACO_UNDO_REDO_LIMIT);
          }
          const maxPast = editStack._aiChatMaxPast;
          const past = editStack._past;
          if (!Array.isArray(past) || past.length <= maxPast) continue;

          const overflow = past.length - maxPast;
          const removed = past.splice(0, overflow);
          for (const removedElement of removed) {
            if (removedElement?.type === 1 && typeof removedElement.removeResource === 'function') {
              removedElement.removeResource(editStack.resourceLabel, editStack.strResource, 0);
            }
          }
          editStack.versionId += 1;
        }
      };
    }
  }

  return mod;
};

