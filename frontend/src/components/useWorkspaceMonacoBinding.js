import { useCallback, useEffect, useRef, useState } from 'react';
import { diagnosticsService } from '../workbench/services/diagnosticsService';
import { lspService } from '../workbench/services/lspService';

export const useWorkspaceMonacoBinding = ({
  backendRoot,
  backendWorkspaceId,
  lspUiContext,
  normalizedUndoRedoLimit,
  activeGroupId,
  onOpenFile,
}) => {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const editorInstancesRef = useRef(new Map());
  const disposablesRef = useRef([]);
  const timeoutRef = useRef(0);
  const [editorVersion, setEditorVersion] = useState(0);

  useEffect(() => {
    globalThis.__AI_CHAT_MONACO_UNDO_REDO_LIMIT = normalizedUndoRedoLimit;
  }, [normalizedUndoRedoLimit]);

  const getEditorInstanceByGroupId = useCallback((groupId) => {
    const gid = String(groupId || 'group-1');
    return editorInstancesRef.current.get(gid) || null;
  }, []);

  const getActiveEditorInstance = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return null;
    return { editor, monaco };
  }, []);

  const mountActiveEditor = useCallback((editor, monaco) => {
    disposablesRef.current.forEach((d) => d?.dispose?.());
    disposablesRef.current = [];

    editorRef.current = editor;
    monacoRef.current = monaco;

    diagnosticsService.attachMonaco(monaco);
    lspService.updateWorkspace({ nextWorkspaceId: backendWorkspaceId, nextRootFsPath: backendRoot, nextWorkspaceFolders: [backendRoot] });
    lspService.attachMonaco(
      monaco,
      { nextWorkspaceId: backendWorkspaceId, nextRootFsPath: backendRoot, nextWorkspaceFolders: [backendRoot] },
      lspUiContext,
    );

    globalThis.__AI_CHAT_MONACO_UNDO_REDO_LIMIT = normalizedUndoRedoLimit;
    setEditorVersion((v) => v + 1);

    if (timeoutRef.current) globalThis.clearTimeout?.(timeoutRef.current);
    timeoutRef.current = globalThis.setTimeout?.(() => {
      setEditorVersion((v) => v + 1);
    }, 500);
  }, [backendRoot, backendWorkspaceId, lspUiContext, normalizedUndoRedoLimit]);

  const handleEditorMountForGroup = useCallback((groupId) => (editor, monaco) => {
    const gid = String(groupId || 'group-1');
    editorInstancesRef.current.set(gid, { editor, monaco });
    if (gid === String(activeGroupId || 'group-1')) {
      mountActiveEditor(editor, monaco);
    }
  }, [activeGroupId, mountActiveEditor]);

  useEffect(() => {
    lspService.updateWorkspace({ nextWorkspaceId: backendWorkspaceId, nextRootFsPath: backendRoot, nextWorkspaceFolders: [backendRoot] });
  }, [backendWorkspaceId, backendRoot]);

  useEffect(() => {
    const inst = editorInstancesRef.current.get(String(activeGroupId || 'group-1'));
    if (!inst?.editor || !inst?.monaco) return;
    mountActiveEditor(inst.editor, inst.monaco);
  }, [activeGroupId, mountActiveEditor]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) globalThis.clearTimeout?.(timeoutRef.current);
      timeoutRef.current = 0;
      disposablesRef.current.forEach((d) => d?.dispose?.());
      disposablesRef.current = [];
    };
  }, []);

  return {
    editorRef,
    monacoRef,
    editorVersion,
    handleEditorMountForGroup,
    getActiveEditorInstance,
    getEditorInstanceByGroupId,
  };
};
