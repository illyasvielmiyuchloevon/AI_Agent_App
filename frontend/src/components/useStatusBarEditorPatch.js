import { useEffect } from 'react';
import { inferMonacoLanguage } from '../utils/appAlgorithms';

export const useStatusBarEditorPatch = ({ editorRef, monacoRef, activeFile, editorVersion }) => {
  useEffect(() => {
    if (!editorVersion) return undefined;
    const editor = editorRef?.current;
    const monaco = monacoRef?.current;
    if (!editor || !monaco) return undefined;

    const disposables = [];
    let rafId = 0;

    const emit = () => {
      rafId = 0;
      const model = editor.getModel?.();
      const pos = editor.getPosition?.();
      const sel = editor.getSelection?.();

      const languageId = model?.getLanguageId?.() || inferMonacoLanguage(activeFile || '');
      const eol = model?.getEOL?.() === '\r\n' ? 'CRLF' : 'LF';
      const options = model?.getOptions?.() || null;
      const tabSize = Number(options?.tabSize) || 4;
      const insertSpaces = options?.insertSpaces !== undefined ? !!options.insertSpaces : true;

      let selectionLength = 0;
      try {
        const isEmpty = sel && typeof sel.isEmpty === 'function' ? sel.isEmpty() : true;
        if (!isEmpty && model?.getValueInRange) selectionLength = String(model.getValueInRange(sel) || '').length;
      } catch {
        selectionLength = 0;
      }

      const detail = {
        filePath: activeFile || '',
        languageId,
        line: pos?.lineNumber || 1,
        column: pos?.column || 1,
        selectionLength,
        tabSize,
        insertSpaces,
        eol,
        encoding: 'UTF-8',
      };

      try {
        globalThis.window?.dispatchEvent?.(new CustomEvent('workbench:statusBarEditorPatch', { detail }));
      } catch {
      }
    };

    const schedule = () => {
      if (rafId) return;
      rafId = globalThis.window?.requestAnimationFrame?.(emit) || 0;
    };

    try {
      disposables.push(editor.onDidChangeCursorPosition(schedule));
      disposables.push(editor.onDidChangeCursorSelection(schedule));
      disposables.push(editor.onDidChangeModel(schedule));
    } catch {
    }

    schedule();

    return () => {
      disposables.forEach((d) => d?.dispose?.());
      if (rafId) {
        globalThis.window?.cancelAnimationFrame?.(rafId);
        rafId = 0;
      }
    };
  }, [activeFile, editorRef, editorVersion, monacoRef]);
};

