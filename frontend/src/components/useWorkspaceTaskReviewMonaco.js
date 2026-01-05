import { useCallback, useEffect, useMemo, useRef } from 'react';

export const useWorkspaceTaskReviewMonaco = ({
  editorRef,
  monacoRef,
  editorVersion,
  activeFile,
  hasTaskReview,
  taskBlocks,
  pendingBlocks,
  taskActiveIndex,
  taskActiveBlock,
  getKeybinding,
  onTaskSetCursor,
  onTaskKeepBlock,
  onTaskRevertBlock,
  onTaskResetBlock,
  resolveBlockPosition,
  toLines,
  parseMonacoKeybinding,
}) => {
  const decorationsRef = useRef(null);
  const widgetsRef = useRef(new Map());
  const keyDisposableRef = useRef(null);
  const shouldRevealTaskBlockRef = useRef(true);

  const setTaskCursor = useCallback((nextIndex) => {
    if (!activeFile || typeof onTaskSetCursor !== 'function') return;
    shouldRevealTaskBlockRef.current = true;
    onTaskSetCursor(activeFile, nextIndex);
  }, [activeFile, onTaskSetCursor]);

  const applyTaskBlockToModel = useCallback((block, nextAction) => {
    if (!hasTaskReview) return false;
    if (!block || !activeFile) return false;
    if (nextAction !== 'kept' && nextAction !== 'reverted') return false;
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return false;
    const model = editor.getModel?.();
    if (!model) return false;

    const currentLines = (model.getValue?.() || '').split('\n');

    const beforeLines = toLines(block.beforeText || '');
    const afterLines = toLines(block.afterText || '');
    const ctxBefore = toLines(block.contextBefore || '');
    const ctxAfter = toLines(block.contextAfter || '');
    const preferredIndex = Number.isFinite(Number(block.afterStartIndex)) ? Number(block.afterStartIndex) : 0;

    const currentState = block.action === 'reverted' ? 'before' : 'after';
    if (nextAction === 'reverted' && currentState === 'before') return true;

    let fromLines;
    let toReplaceText;
    if (nextAction === 'reverted') {
      fromLines = afterLines;
      toReplaceText = beforeLines.join('\n');
    } else {
      fromLines = currentState === 'before' ? beforeLines : afterLines;
      toReplaceText = afterLines.join('\n');
    }

    const pos = resolveBlockPosition(currentLines, {
      needleLines: fromLines,
      contextBefore: ctxBefore,
      contextAfter: ctxAfter,
      preferredIndex,
    });

    const lineCount = model.getLineCount?.() || 1;
    const startLineNumber = Math.max(1, Math.min(lineCount, pos.anchorLineNumber));
    const range = (() => {
      if (!fromLines.length) return new monaco.Range(startLineNumber, 1, startLineNumber, 1);
      const endLineNumber = Math.min(lineCount, Math.max(startLineNumber, startLineNumber + fromLines.length - 1));
      const endCol = model.getLineMaxColumn?.(endLineNumber) || 1;
      return new monaco.Range(startLineNumber, 1, endLineNumber, endCol);
    })();

    model.pushStackElement();
    editor.executeEdits('task-review', [{ range, text: toReplaceText, forceMoveMarkers: true }]);
    model.pushStackElement();
    editor.focus?.();
    return true;
  }, [activeFile, editorRef, hasTaskReview, monacoRef, resolveBlockPosition, toLines]);

  const keepActiveTaskBlock = useCallback(() => {
    if (!taskActiveBlock || typeof onTaskKeepBlock !== 'function') return;
    const changed = applyTaskBlockToModel(taskActiveBlock, 'kept');
    if (changed) onTaskKeepBlock(activeFile, taskActiveBlock.id);
  }, [activeFile, applyTaskBlockToModel, onTaskKeepBlock, taskActiveBlock]);

  const revertActiveTaskBlock = useCallback(() => {
    if (!taskActiveBlock || typeof onTaskRevertBlock !== 'function') return;
    const changed = applyTaskBlockToModel(taskActiveBlock, 'reverted');
    if (changed) onTaskRevertBlock(activeFile, taskActiveBlock.id);
  }, [activeFile, applyTaskBlockToModel, onTaskRevertBlock, taskActiveBlock]);

  const revealTaskBlock = useCallback((block) => {
    const editor = editorRef.current;
    const model = editor?.getModel?.();
    if (!editor || !model || !block) return;
    const lines = (model.getValue?.() || '').split('\n');
    const needleLines = block.action === 'reverted' ? toLines(block.beforeText || '') : toLines(block.afterText || '');
    const pos = resolveBlockPosition(lines, {
      needleLines,
      contextBefore: toLines(block.contextBefore || ''),
      contextAfter: toLines(block.contextAfter || ''),
      preferredIndex: block.afterStartIndex,
    });
    const boundedLine = Math.max(1, Math.min(model.getLineCount?.() || 1, pos.anchorLineNumber));
    editor.revealLineInCenter?.(boundedLine);
    editor.setPosition?.({ lineNumber: boundedLine, column: 1 });
  }, [editorRef, resolveBlockPosition, toLines]);

  useEffect(() => {
    shouldRevealTaskBlockRef.current = true;
  }, [activeFile]);

  useEffect(() => {
    if (!hasTaskReview || pendingBlocks.length === 0) return;
    const currentBlock = taskBlocks[taskActiveIndex];
    if (currentBlock && currentBlock.action !== 'pending') {
      let nextIdx = taskBlocks.findIndex((b, i) => i >= taskActiveIndex && b.action === 'pending');
      if (nextIdx === -1) {
        const revIdx = [...taskBlocks].reverse().findIndex((b, i) => (taskBlocks.length - 1 - i) < taskActiveIndex && b.action === 'pending');
        if (revIdx !== -1) nextIdx = taskBlocks.length - 1 - revIdx;
      }

      if (nextIdx !== -1 && nextIdx !== taskActiveIndex) {
        shouldRevealTaskBlockRef.current = false;
        onTaskSetCursor?.(activeFile, nextIdx);
      }
    }
  }, [activeFile, hasTaskReview, onTaskSetCursor, pendingBlocks.length, taskActiveIndex, taskBlocks]);

  useEffect(() => {
    if (!hasTaskReview || !editorVersion) return undefined;
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return undefined;

    const disposables = [];
    const keepShortcut = getKeybinding?.('taskReview.keepBlock', 'Alt+Y') || 'Alt+Y';
    const revertShortcut = getKeybinding?.('taskReview.revertBlock', 'Alt+N') || 'Alt+N';
    const keepKb = parseMonacoKeybinding?.(keepShortcut, monaco);
    const revertKb = parseMonacoKeybinding?.(revertShortcut, monaco);

    disposables.push(editor.addAction({
      id: 'taskReview.keepBlock',
      label: 'Task Review: Keep Block',
      keybindings: keepKb ? [keepKb] : undefined,
      run: () => keepActiveTaskBlock(),
    }));
    disposables.push(editor.addAction({
      id: 'taskReview.revertBlock',
      label: 'Task Review: Revert Block',
      keybindings: revertKb ? [revertKb] : undefined,
      run: () => revertActiveTaskBlock(),
    }));

    keyDisposableRef.current?.dispose?.();
    keyDisposableRef.current = { dispose: () => disposables.forEach((d) => d?.dispose?.()) };

    return () => {
      disposables.forEach((d) => d?.dispose?.());
      if (keyDisposableRef.current) keyDisposableRef.current = null;
    };
  }, [editorRef, editorVersion, getKeybinding, hasTaskReview, keepActiveTaskBlock, monacoRef, parseMonacoKeybinding, revertActiveTaskBlock]);

  useEffect(() => {
    if (!hasTaskReview || !editorVersion) return undefined;
    if (!taskActiveBlock) return undefined;
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return undefined;

    if (shouldRevealTaskBlockRef.current) {
      revealTaskBlock(taskActiveBlock);
      shouldRevealTaskBlockRef.current = false;
    }
    return undefined;
  }, [editorRef, editorVersion, hasTaskReview, monacoRef, revealTaskBlock, taskActiveBlock, taskActiveIndex]);

  useEffect(() => {
    if (!editorVersion) return undefined;
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return undefined;

    const widgets = widgetsRef.current;
    for (const widget of widgets.values()) {
      try {
        editor.removeContentWidget?.(widget);
      } catch {
      }
    }
    widgets.clear();

    try {
      decorationsRef.current?.clear?.();
    } catch {
    }
    decorationsRef.current = null;

    if (!hasTaskReview) {
      editor.layout?.();
      return undefined;
    }

    const model = editor.getModel?.();
    if (!model) return undefined;
    const lines = (model.getValue?.() || '').split('\n');

    const decorations = [];
    pendingBlocks.forEach((block) => {
      const idx = taskBlocks.findIndex((b) => b.id === block.id);
      const needleLines = block.action === 'reverted' ? toLines(block.beforeText || '') : toLines(block.afterText || '');
      const fromLen = needleLines.length || 1;
      const pos = resolveBlockPosition(lines, {
        needleLines,
        contextBefore: toLines(block.contextBefore || ''),
        contextAfter: toLines(block.contextAfter || ''),
        preferredIndex: block.afterStartIndex,
      });
      const startLineNumber = Math.max(1, Math.min(model.getLineCount?.() || 1, pos.anchorLineNumber));
      const endLineNumber = Math.max(startLineNumber, Math.min(model.getLineCount?.() || 1, startLineNumber + fromLen - 1));
      decorations.push({
        range: new monaco.Range(startLineNumber, 1, endLineNumber, 1),
        options: {
          isWholeLine: true,
          className: `task-review-hunk task-review-${block.changeType || 'modified'} task-review-${block.action || 'pending'}`,
          linesDecorationsClassName: `task-review-glyph task-review-${block.changeType || 'modified'} task-review-${block.action || 'pending'}`,
        },
      });

      const widgetId = `task-review-widget:${activeFile}:${block.id}`;
      const dom = document.createElement('div');
      dom.className = `task-review-hunk-overlay ${idx === taskActiveIndex ? 'active' : ''}`;
      const layoutInfo = editor.getLayoutInfo?.();
      if (layoutInfo) dom.style.width = `${layoutInfo.contentWidth}px`;

      const actions = document.createElement('div');
      actions.className = 'task-review-hunk-actions';

      const btnRevert = document.createElement('button');
      btnRevert.type = 'button';
      btnRevert.className = 'task-review-hunk-btn revert';
      btnRevert.title = '撤销 (Alt+N)';
      btnRevert.innerHTML = '<span class="kb">Alt+N</span><span class="label"> 撤销</span>';
      btnRevert.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        shouldRevealTaskBlockRef.current = false;
        onTaskSetCursor?.(activeFile, idx);
        applyTaskBlockToModel(block, 'reverted');
        onTaskRevertBlock?.(activeFile, block.id);
      };

      const btnKeep = document.createElement('button');
      btnKeep.type = 'button';
      btnKeep.className = 'task-review-hunk-btn keep';
      btnKeep.title = '保留 (Alt+Y)';
      btnKeep.innerHTML = '<span class="kb">Alt+Y</span><span class="label"> 保留</span>';
      btnKeep.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        shouldRevealTaskBlockRef.current = false;
        onTaskSetCursor?.(activeFile, idx);
        applyTaskBlockToModel(block, 'kept');
        onTaskKeepBlock?.(activeFile, block.id);
      };

      actions.appendChild(btnRevert);
      actions.appendChild(btnKeep);
      dom.appendChild(actions);

      const widget = {
        getId: () => widgetId,
        getDomNode: () => dom,
        getPosition: () => ({
          position: { lineNumber: startLineNumber, column: 1 },
          preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
        }),
      };

      widgets.set(widgetId, widget);
      try {
        editor.addContentWidget?.(widget);
      } catch {
      }
    });

    const contentSub = model.onDidChangeContent((e) => {
      if (!e.isFlush && (e.isUndoing || e.isRedoing)) {
        const currentLines = (model.getValue() || '').split('\n');
        taskBlocks.forEach((block, idx) => {
          if (block.action === 'kept') {
            const pos = resolveBlockPosition(currentLines, {
              needleLines: toLines(block.beforeText || ''),
              contextBefore: toLines(block.contextBefore || ''),
              contextAfter: toLines(block.contextAfter || ''),
              preferredIndex: block.afterStartIndex,
            });
            if (pos.anchorLineNumber > 0) {
              onTaskResetBlock?.(activeFile, block.id);
              shouldRevealTaskBlockRef.current = false;
              onTaskSetCursor?.(activeFile, idx);
            }
          } else if (block.action === 'reverted') {
            const pos = resolveBlockPosition(currentLines, {
              needleLines: toLines(block.afterText || ''),
              contextBefore: toLines(block.contextBefore || ''),
              contextAfter: toLines(block.contextAfter || ''),
              preferredIndex: block.afterStartIndex,
            });
            if (pos.anchorLineNumber > 0) {
              onTaskResetBlock?.(activeFile, block.id);
              shouldRevealTaskBlockRef.current = false;
              onTaskSetCursor?.(activeFile, idx);
            }
          }
        });
      }
    });

    const mouseMoveSub = editor.onMouseMove((e) => {
      if (!e.target || !e.target.position) return;
      const lineNumber = e.target.position.lineNumber;

      const hoveredBlockIdx = taskBlocks.findIndex((block) => {
        if (block.action !== 'pending') return false;
        const needleLines = block.action === 'reverted' ? toLines(block.beforeText || '') : toLines(block.afterText || '');
        const fromLen = needleLines.length || 1;
        const pos = resolveBlockPosition(lines, {
          needleLines,
          contextBefore: toLines(block.contextBefore || ''),
          contextAfter: toLines(block.contextAfter || ''),
          preferredIndex: block.afterStartIndex,
        });
        const startLineNumber = Math.max(1, Math.min(model.getLineCount?.() || 1, pos.anchorLineNumber));
        const endLineNumber = Math.max(startLineNumber, Math.min(model.getLineCount?.() || 1, startLineNumber + fromLen - 1));
        return lineNumber >= startLineNumber && lineNumber <= endLineNumber;
      });

      if (hoveredBlockIdx !== -1 && hoveredBlockIdx !== taskActiveIndex) {
        shouldRevealTaskBlockRef.current = false;
        onTaskSetCursor?.(activeFile, hoveredBlockIdx);
      }
    });

    decorationsRef.current = editor.createDecorationsCollection(decorations);
    editor.layout?.();

    return () => {
      contentSub.dispose();
      mouseMoveSub.dispose();
      try {
        decorationsRef.current?.clear?.();
      } catch {
      }
      decorationsRef.current = null;
      for (const widget of widgets.values()) {
        try {
          editor.removeContentWidget?.(widget);
        } catch {
        }
      }
      widgets.clear();
    };
  }, [
    activeFile,
    applyTaskBlockToModel,
    editorRef,
    editorVersion,
    hasTaskReview,
    monacoRef,
    onTaskKeepBlock,
    onTaskRevertBlock,
    onTaskResetBlock,
    onTaskSetCursor,
    pendingBlocks,
    resolveBlockPosition,
    taskActiveIndex,
    taskBlocks,
    toLines,
  ]);

  return useMemo(() => ({ setTaskCursor }), [setTaskCursor]);
};
