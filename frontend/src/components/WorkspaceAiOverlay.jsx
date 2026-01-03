import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clipText,
  extractFirstCodeBlock,
  getKeybindingValue,
  inferMonacoLanguage,
  parseMonacoKeybinding,
} from '../utils/appAlgorithms';

export const useWorkspaceAi = ({
  canUseEditorAi,
  editorRef,
  monacoRef,
  editorVersion,
  activeFile,
  keybindings,
  aiEngineClient,
  getBackendConfig,
  currentSessionId,
  backendWorkspaceId,
  backendRoot,
  onRegisterEditorAiInvoker,
}) => {
  const lastSelectionRef = useRef({ isEmpty: true, range: null });
  const [inlineAi, setInlineAi] = useState({ visible: false, top: 0, left: 0 });
  const [aiPanel, setAiPanel] = useState({
    open: false,
    busy: false,
    action: '',
    applyTarget: '',
    selectionRange: null,
    title: '',
    content: '',
    error: '',
    canApplySelection: false,
    canApplyFile: false,
  });
  const [aiPrompt, setAiPrompt] = useState({ open: false, action: '', title: '', placeholder: '', value: '' });

  const applyActions = useMemo(() => new Set(['optimize', 'generateComments', 'rewrite', 'modify']), []);

  const getKeybinding = useCallback((id, fallback = '') => {
    return getKeybindingValue(keybindings, id, fallback);
  }, [keybindings]);

  const getEditorSnapshot = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return null;
    const model = editor.getModel?.();
    if (!model) return null;

    const selection = editor.getSelection?.() || null;
    const hasSelection = !!selection && typeof selection.isEmpty === 'function' ? !selection.isEmpty() : false;
    const selectedText = hasSelection ? (model.getValueInRange?.(selection) || '') : '';

    const visibleRanges = editor.getVisibleRanges?.() || [];
    const visibleText = visibleRanges.length
      ? visibleRanges.map((r) => model.getValueInRange?.(r) || '').join('\n')
      : (model.getValue?.() || '');

    const cursor = editor.getPosition?.() || null;

    const selectionPayload = hasSelection
      ? {
          startLine: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLine: selection.endLineNumber,
          endColumn: selection.endColumn,
        }
      : undefined;

    lastSelectionRef.current = { isEmpty: !hasSelection, range: selection || null };

    return {
      filePath: activeFile || '',
      languageId: inferMonacoLanguage(activeFile || ''),
      cursorLine: cursor?.lineNumber,
      cursorColumn: cursor?.column,
      selection: selectionPayload,
      visibleText: clipText(visibleText, 14000),
      selectedText: clipText(selectedText, 8000),
    };
  }, [activeFile, editorRef, monacoRef]);

  const buildInstruction = useCallback((action, { hasSelection, userInstruction }) => {
    if (action === 'explain') {
      return hasSelection
        ? '用自然语言解释选中代码的功能、逻辑和关键点。'
        : '用自然语言解释当前文件的功能、逻辑和关键点。';
    }
    if (action === 'generateTests') {
      return hasSelection
        ? '为选中代码生成高质量单元测试。优先匹配项目中已有的测试框架与约定。输出测试代码。'
        : '为当前文件生成高质量单元测试。优先匹配项目中已有的测试框架与约定。输出测试代码。';
    }
    if (action === 'optimize') {
      return hasSelection
        ? '在不改变行为的前提下优化选中代码的性能与可读性。输出可直接替换选中代码的新实现。'
        : '在不改变行为的前提下优化当前文件的性能与可读性。输出修改后的完整文件内容。';
    }
    if (action === 'generateComments') {
      return hasSelection
        ? '为选中代码补充必要注释（遵循语言风格）。输出可直接替换选中代码的新实现。'
        : '为当前文件补充必要注释（遵循语言风格）。输出修改后的完整文件内容。';
    }
    if (action === 'review') {
      return hasSelection
        ? '审阅选中代码，指出问题与风险，并给出可执行的改进建议。'
        : '审阅当前文件，指出问题与风险，并给出可执行的改进建议。';
    }
    if (action === 'rewrite') {
      return hasSelection
        ? '重写选中代码，保持行为一致并提升可读性。输出可直接替换选中代码的新实现。'
        : '重写当前文件，保持行为一致并提升可读性。输出修改后的完整文件内容。';
    }
    if (action === 'generateDocs') {
      return hasSelection
        ? '为选中代码所在模块生成 Markdown 风格文档（用途、关键接口、示例）。'
        : '为当前文件/模块生成 Markdown 风格文档（用途、关键接口、示例）。';
    }
    if (action === 'modify') {
      const base = hasSelection
        ? '按以下指令修改选中代码。输出可直接替换选中代码的新实现。'
        : '按以下指令修改当前文件。输出修改后的完整文件内容。';
      const extra = String(userInstruction || '').trim();
      return extra ? `${base}\n\n指令：${extra}` : base;
    }
    return String(userInstruction || '').trim() || '请根据上下文完成编辑器动作。';
  }, []);

  const runEditorAiAction = useCallback(async ({ action, userInstruction } = {}) => {
    if (!canUseEditorAi) return;
    const snapshot = getEditorSnapshot();
    if (!snapshot) return;

    const hasSelection = !!snapshot.selectedText && snapshot.selectedText.trim().length > 0;
    const instruction = buildInstruction(action, { hasSelection, userInstruction });
    const applyTarget = hasSelection ? 'selection' : 'file';
    const selection = lastSelectionRef.current?.range;
    const selectionRange = hasSelection && selection
      ? {
          startLineNumber: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLineNumber: selection.endLineNumber,
          endColumn: selection.endColumn,
        }
      : null;
    const canApplySelectionByAction = applyTarget === 'selection' && applyActions.has(action);
    const canApplyFileByAction = applyTarget === 'file' && applyActions.has(action);

    const titleMap = {
      explain: 'AI：解释代码',
      generateTests: 'AI：生成单元测试',
      optimize: 'AI：优化代码',
      generateComments: 'AI：生成注释',
      review: 'AI：审阅代码',
      rewrite: 'AI：重写代码',
      modify: 'AI：按指令修改',
      generateDocs: 'AI：生成文档',
    };

    setAiPanel({
      open: true,
      busy: true,
      action,
      applyTarget,
      selectionRange,
      title: titleMap[action] || 'AI',
      content: '',
      error: '',
      canApplySelection: false,
      canApplyFile: false,
    });

    try {
      const llmConfig = typeof getBackendConfig === 'function' ? getBackendConfig() : undefined;
      const res = await aiEngineClient.editorAction({
        sessionId: currentSessionId,
        workspaceId: backendWorkspaceId,
        workspaceRoot: backendRoot,
        action,
        instruction,
        editor: snapshot,
        llmConfig,
      });

      const content = typeof res?.content === 'string' ? res.content : '';
      const canApplySelection = canApplySelectionByAction && content.trim().length > 0;
      const canApplyFile = canApplyFileByAction && content.trim().length > 0;
      setAiPanel((prev) => ({
        ...prev,
        busy: false,
        content,
        error: '',
        canApplySelection,
        canApplyFile,
      }));
    } catch (e) {
      setAiPanel((prev) => ({
        ...prev,
        busy: false,
        content: '',
        error: e?.message || String(e),
        canApplySelection: false,
        canApplyFile: false,
      }));
    }
  }, [
    aiEngineClient,
    backendRoot,
    backendWorkspaceId,
    buildInstruction,
    canUseEditorAi,
    currentSessionId,
    getBackendConfig,
    getEditorSnapshot,
    applyActions,
  ]);

  const openPromptForAction = useCallback((action) => {
    if (action !== 'modify') return;
    setAiPrompt({
      open: true,
      action,
      title: 'AI：按指令修改',
      placeholder: '例如：将 for 循环改为 map/reduce；增加异常处理；提取为函数…',
      value: '',
    });
  }, []);

  const triggerAiAction = useCallback((action) => {
    if (!canUseEditorAi) return;
    if (action === 'modify') {
      openPromptForAction(action);
      return;
    }
    runEditorAiAction({ action }).catch(() => {});
  }, [canUseEditorAi, openPromptForAction, runEditorAiAction]);

  const applyAiResultToSelection = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const range = aiPanel.selectionRange || lastSelectionRef.current?.range;
    if (!range) return;
    const model = editor.getModel?.();
    if (!model) return;
    const text = extractFirstCodeBlock(aiPanel.content || '');
    if (!text) return;
    editor.executeEdits('ai-editor-action', [{ range, text, forceMoveMarkers: true }]);
    editor.focus?.();
  }, [aiPanel.content, aiPanel.selectionRange, editorRef, monacoRef]);

  const applyAiResultToFile = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel?.();
    if (!model) return;
    const lineCount = model.getLineCount?.() || 1;
    const lastCol = model.getLineMaxColumn?.(lineCount) || 1;
    const fullRange = new monaco.Range(1, 1, lineCount, lastCol);
    const text = extractFirstCodeBlock(aiPanel.content || '');
    if (!text) return;
    editor.executeEdits('ai-editor-action', [{ range: fullRange, text, forceMoveMarkers: true }]);
    editor.focus?.();
  }, [aiPanel.content, editorRef, monacoRef]);

  useEffect(() => {
    if (!editorVersion) return undefined;
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return undefined;

    const aiDisposables = [];

    if (canUseEditorAi) {
      const defs = [
        { id: 'ai.explain', label: 'AI：解释代码', action: 'explain', fallbackKey: 'Ctrl+Alt+E' },
        { id: 'ai.tests', label: 'AI：生成单元测试', action: 'generateTests', fallbackKey: 'Ctrl+Alt+T' },
        { id: 'ai.optimize', label: 'AI：优化代码', action: 'optimize', fallbackKey: 'Ctrl+Alt+O' },
        { id: 'ai.comments', label: 'AI：生成注释', action: 'generateComments', fallbackKey: 'Ctrl+Alt+C' },
        { id: 'ai.review', label: 'AI：审阅代码', action: 'review', fallbackKey: 'Ctrl+Alt+R' },
        { id: 'ai.rewrite', label: 'AI：重写代码', action: 'rewrite', fallbackKey: 'Ctrl+Alt+W' },
        { id: 'ai.modify', label: 'AI：按指令修改…', action: 'modify', fallbackKey: 'Ctrl+Alt+M' },
        { id: 'ai.docs', label: 'AI：生成文档', action: 'generateDocs', fallbackKey: 'Ctrl+Alt+D' },
      ];

      defs.forEach((d, idx) => {
        const shortcut = getKeybinding(`editor.${d.id}`, d.fallbackKey);
        const parsed = parseMonacoKeybinding(shortcut, monaco);
        const disposable = editor.addAction({
          id: d.id,
          label: d.label,
          keybindings: parsed ? [parsed] : undefined,
          contextMenuGroupId: '9_ai',
          contextMenuOrder: 1.0 + idx / 100,
          run: () => {
            triggerAiAction(d.action);
          },
        });
        aiDisposables.push(disposable);
      });

      const selectionDisposable = editor.onDidChangeCursorSelection(() => {
        const sel = editor.getSelection?.();
        const model = editor.getModel?.();
        if (!sel || !model) {
          setInlineAi({ visible: false, top: 0, left: 0 });
          return;
        }
        const isEmpty = typeof sel.isEmpty === 'function' ? sel.isEmpty() : true;
        lastSelectionRef.current = { isEmpty, range: sel };
        if (isEmpty) {
          setInlineAi({ visible: false, top: 0, left: 0 });
          return;
        }
        const pos = sel.getEndPosition?.();
        if (!pos) {
          setInlineAi({ visible: false, top: 0, left: 0 });
          return;
        }
        const coords = editor.getScrolledVisiblePosition?.(pos);
        if (!coords) {
          setInlineAi({ visible: false, top: 0, left: 0 });
          return;
        }
        const padding = 10;
        const top = Math.max(padding, Math.round(coords.top + coords.height + 6));
        const left = Math.max(padding, Math.round(coords.left));
        setInlineAi({ visible: true, top, left });
      });
      aiDisposables.push(selectionDisposable);
    } else {
      setInlineAi({ visible: false, top: 0, left: 0 });
    }

    return () => {
      aiDisposables.forEach((d) => d?.dispose?.());
    };
  }, [canUseEditorAi, editorVersion, editorRef, monacoRef, getKeybinding, triggerAiAction]);

  useEffect(() => {
    if (typeof onRegisterEditorAiInvoker !== 'function') return undefined;
    if (!canUseEditorAi) {
      onRegisterEditorAiInvoker(null);
      return undefined;
    }
    const invoker = {
      run: (action) => triggerAiAction(action),
      runWithInstruction: (action, instruction) => runEditorAiAction({ action, userInstruction: instruction }),
    };
    onRegisterEditorAiInvoker(invoker);
    return () => onRegisterEditorAiInvoker(null);
  }, [canUseEditorAi, onRegisterEditorAiInvoker, runEditorAiAction, triggerAiAction]);

  return {
    inlineAi,
    aiPanel,
    setAiPanel,
    aiPrompt,
    setAiPrompt,
    openPromptForAction,
    triggerAiAction,
    runEditorAiAction,
    applyAiResultToSelection,
    applyAiResultToFile,
  };
};

export const WorkspaceAiOverlay = React.memo(({ enabled, ai }) => {
  if (!enabled) return null;

  return (
    <>
      {ai.inlineAi.visible ? (
        <button
          type="button"
          className="ghost-btn"
          style={{
            position: 'absolute',
            top: ai.inlineAi.top,
            left: ai.inlineAi.left,
            zIndex: 20,
            height: 26,
            padding: '0 8px',
            borderRadius: 999,
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
          onClick={() => ai.setAiPanel((prev) => ({ ...prev, open: true, title: 'AI', content: prev.content || '', error: prev.error || '' }))}
          title="AI Actions"
        >
          <span aria-hidden>✨</span>
          <span>AI</span>
        </button>
      ) : null}

      {ai.aiPanel.open ? (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 99990, background: 'rgba(0,0,0,0.28)' }}
            onClick={() => ai.setAiPanel((prev) => ({ ...prev, open: false }))}
          />
          <div
            style={{
              position: 'fixed',
              zIndex: 99991,
              right: 16,
              top: 56,
              width: 'min(720px, calc(100vw - 32px))',
              maxHeight: 'min(70vh, 720px)',
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              boxShadow: 'var(--shadow-strong)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 700, fontSize: 13, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ai.aiPanel.title || 'AI'}
              </div>
              <button type="button" className="ghost-btn" style={{ height: 28 }} onClick={() => ai.triggerAiAction('explain')}>解释</button>
              <button type="button" className="ghost-btn" style={{ height: 28 }} onClick={() => ai.triggerAiAction('optimize')}>优化</button>
              <button type="button" className="ghost-btn" style={{ height: 28 }} onClick={() => ai.triggerAiAction('review')}>审阅</button>
              <button type="button" className="ghost-btn" style={{ height: 28 }} onClick={() => ai.openPromptForAction('modify')}>修改</button>
              <button type="button" className="ghost-btn" style={{ height: 28 }} onClick={() => ai.setAiPanel((prev) => ({ ...prev, open: false }))}>
                <span className="codicon codicon-close" aria-hidden />
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
              <button type="button" className="ghost-btn" style={{ height: 30 }} onClick={() => ai.triggerAiAction('generateTests')}>单测</button>
              <button type="button" className="ghost-btn" style={{ height: 30 }} onClick={() => ai.triggerAiAction('generateComments')}>注释</button>
              <button type="button" className="ghost-btn" style={{ height: 30 }} onClick={() => ai.triggerAiAction('rewrite')}>重写</button>
              <button type="button" className="ghost-btn" style={{ height: 30 }} onClick={() => ai.triggerAiAction('generateDocs')}>文档</button>
              {ai.aiPanel.canApplySelection ? (
                <button type="button" className="primary-btn" style={{ height: 30 }} onClick={ai.applyAiResultToSelection}>应用到选中</button>
              ) : null}
              {ai.aiPanel.canApplyFile ? (
                <button type="button" className="primary-btn" style={{ height: 30 }} onClick={ai.applyAiResultToFile}>替换文件</button>
              ) : null}
              <button
                type="button"
                className="ghost-btn"
                style={{ height: 30 }}
                onClick={() => {
                  const text = ai.aiPanel.content || '';
                  if (!text) return;
                  navigator.clipboard?.writeText?.(text).catch(() => {});
                }}
              >
                复制
              </button>
            </div>

            <div style={{ padding: 12, overflow: 'auto', flex: 1 }}>
              {ai.aiPanel.busy ? (
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>生成中…</div>
              ) : ai.aiPanel.error ? (
                <div style={{ color: 'var(--danger)', fontSize: 13 }}>{ai.aiPanel.error}</div>
              ) : (
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, lineHeight: 1.55, color: 'var(--text)' }}>
                  {ai.aiPanel.content || ''}
                </pre>
              )}
            </div>
          </div>
        </>
      ) : null}

      {ai.aiPrompt.open ? (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 99992, background: 'rgba(0,0,0,0.28)' }}
            onClick={() => ai.setAiPrompt((prev) => ({ ...prev, open: false }))}
          />
          <div
            style={{
              position: 'fixed',
              zIndex: 99993,
              left: '50%',
              top: '20%',
              transform: 'translateX(-50%)',
              width: 'min(640px, calc(100vw - 32px))',
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              boxShadow: 'var(--shadow-strong)',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>{ai.aiPrompt.title}</div>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <textarea
                className="ghost-input"
                value={ai.aiPrompt.value}
                onChange={(e) => ai.setAiPrompt((prev) => ({ ...prev, value: e.target.value }))}
                placeholder={ai.aiPrompt.placeholder}
                style={{ width: '100%', minHeight: 96, resize: 'vertical', padding: 10, lineHeight: 1.5 }}
                autoFocus
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="ghost-btn" style={{ height: 32 }} onClick={() => ai.setAiPrompt((prev) => ({ ...prev, open: false }))}>取消</button>
                <button
                  type="button"
                  className="primary-btn"
                  style={{ height: 32 }}
                  disabled={!ai.aiPrompt.value.trim()}
                  onClick={() => {
                    const instruction = ai.aiPrompt.value;
                    ai.setAiPrompt((prev) => ({ ...prev, open: false }));
                    ai.runEditorAiAction({ action: ai.aiPrompt.action, userInstruction: instruction }).catch(() => {});
                  }}
                >
                  运行
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
});

