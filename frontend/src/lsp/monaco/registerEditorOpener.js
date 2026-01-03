import { guessIsWindows, fileUriToFsPath, toWorkspaceRelativePath } from '../util/fsPath';

export const registerEditorOpener = (monaco, { rootFsPath } = {}) => {
  if (!monaco?.editor?.registerEditorOpener) return null;
  const root = String(rootFsPath || '');
  return monaco.editor.registerEditorOpener({
    openCodeEditor: (_source, resource, selectionOrPosition) => {
      const windows = guessIsWindows(root);
      const uri = resource?.toString?.() || '';
      let relPath = '';
      if (String(resource?.scheme || '') === 'file' || uri.startsWith('file://')) {
        const fsPath = fileUriToFsPath(uri, { windows });
        relPath = toWorkspaceRelativePath(fsPath, root);
      } else {
        relPath = String(resource?.path || uri || '').replace(/^\//, '');
      }

      if (!relPath) return false;
      try {
        globalThis.window.dispatchEvent(new CustomEvent('workbench:openFile', { detail: { path: relPath } }));
        if (selectionOrPosition?.startLineNumber || selectionOrPosition?.lineNumber) {
          const line = Number(selectionOrPosition?.startLineNumber || selectionOrPosition?.lineNumber);
          const column = Number(selectionOrPosition?.startColumn || selectionOrPosition?.column || 1);
          setTimeout(() => {
            try {
              globalThis.window.dispatchEvent(new CustomEvent('workbench:revealInActiveEditor', { detail: { line, column } }));
            } catch {}
          }, 50);
        }
        return true;
      } catch {
        return false;
      }
    },
  });
};

