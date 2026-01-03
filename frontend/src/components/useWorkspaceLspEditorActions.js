import { useEffect } from 'react';
import { lspService } from '../workbench/services/lspService';

export const useWorkspaceLspEditorActions = ({ editorRef, monacoRef, editorVersion }) => {
  useEffect(() => {
    if (!editorVersion) return undefined;
    const editor = editorRef?.current;
    const monaco = monacoRef?.current;
    if (!editor || !monaco) return undefined;

    const lspRangeToMonaco = (r) => {
      const s = r?.start;
      const e = r?.end;
      const sl = Number(s?.line);
      const sc = Number(s?.character);
      const el = Number(e?.line);
      const ec = Number(e?.character);
      if (!Number.isFinite(sl) || !Number.isFinite(sc) || !Number.isFinite(el) || !Number.isFinite(ec)) return null;
      return new monaco.Range(sl + 1, sc + 1, el + 1, ec + 1);
    };

    const showLocationsAsReferences = (locations) => {
      const model = editor.getModel?.();
      const position = editor.getPosition?.();
      if (!model || !position) return;

      const refs = (Array.isArray(locations) ? locations : [])
        .map((loc) => {
          const uri = String(loc?.uri || '');
          const range = loc?.range || null;
          if (!uri || !range) return null;
          const modelPath = lspService.lspUriToModelPath(uri);
          const r = lspRangeToMonaco(range);
          if (!modelPath || !r) return null;
          return { uri: monaco.Uri.parse(modelPath), range: r };
        })
        .filter(Boolean);

      if (!refs.length) return;
      try {
        editor.trigger('lsp', 'editor.action.showReferences', {
          resource: model.uri,
          position,
          references: refs,
        });
      } catch {
      }
    };

    const runCallHierarchy = async (direction) => {
      const model = editor.getModel?.();
      const position = editor.getPosition?.();
      if (!model || !position) return;

      const prepared = await lspService.prepareCallHierarchy(model, position).catch(() => ({ serverId: '', items: [] }));
      const serverId = String(prepared?.serverId || '');
      const items = Array.isArray(prepared?.items) ? prepared.items : [];
      const item = items[0] || null;
      if (!serverId || !item) return;

      if (direction === 'incoming') {
        const calls = await lspService.callHierarchyIncoming(serverId, item).catch(() => []);
        const locs = calls.map((c) => ({
          uri: c?.from?.uri,
          range: c?.from?.selectionRange || c?.from?.range,
        }));
        showLocationsAsReferences(locs);
        return;
      }

      const calls = await lspService.callHierarchyOutgoing(serverId, item).catch(() => []);
      const locs = calls.map((c) => ({
        uri: c?.to?.uri,
        range: c?.to?.selectionRange || c?.to?.range,
      }));
      showLocationsAsReferences(locs);
    };

    const disposables = [];
    try {
      disposables.push(
        editor.addAction({
          id: 'lsp.callHierarchyIncoming',
          label: 'LSP：Incoming Calls',
          contextMenuGroupId: '8_lsp',
          contextMenuOrder: 1.0,
          run: () => runCallHierarchy('incoming'),
        }),
      );

      disposables.push(
        editor.addAction({
          id: 'lsp.callHierarchyOutgoing',
          label: 'LSP：Outgoing Calls',
          contextMenuGroupId: '8_lsp',
          contextMenuOrder: 1.01,
          run: () => runCallHierarchy('outgoing'),
        }),
      );
    } catch {
    }

    return () => disposables.forEach((d) => d?.dispose?.());
  }, [editorRef, editorVersion, monacoRef]);
};

