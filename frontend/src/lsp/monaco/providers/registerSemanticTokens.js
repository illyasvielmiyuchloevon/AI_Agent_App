export const registerSemanticTokens = (monaco, {
  lang,
  bridge,
  getDocState,
  getSemanticTokenMap,
  mapSemanticTokenData,
  toLspRangeFromMonacoRange,
  nextCancelToken,
  tokenTypes,
  tokenModifiers,
} = {}) => {
  const disposables = [];
  const languageId = String(lang || '');
  if (!languageId) return disposables;
  if (typeof monaco?.languages?.registerDocumentSemanticTokensProvider !== 'function') return disposables;

  const legend = monaco?.languages?.SemanticTokensLegend
    ? new monaco.languages.SemanticTokensLegend(tokenTypes, tokenModifiers)
    : { tokenTypes, tokenModifiers };

  disposables.push(monaco.languages.registerDocumentSemanticTokensProvider(languageId, {
    getLegend: () => legend,
    provideDocumentSemanticTokens: async (model, lastResultId, token) => {
      const state = getDocState?.(model);
      if (!state) return { data: new Uint32Array() };
      const map = await getSemanticTokenMap?.(state.serverId);
      if (!map) return { data: new Uint32Array() };

      const cancelToken = nextCancelToken?.('st') || '';
      token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });

      if (lastResultId && map.supportsDelta) {
        const deltaRes = await bridge?.semanticTokensFullDelta?.(
          state.serverId,
          { textDocument: { uri: state.uri }, previousResultId: String(lastResultId) },
          { timeoutMs: 4000, cancelToken },
        ).catch(() => null);

        if (deltaRes && Array.isArray(deltaRes.edits)) {
          const edits = deltaRes.edits.map((e) => ({
            start: Number(e?.start || 0),
            deleteCount: Number(e?.deleteCount || 0),
            data: Array.isArray(e?.data) ? mapSemanticTokenData?.(e.data, map) : undefined,
          }));
          return { resultId: deltaRes?.resultId ? String(deltaRes.resultId) : undefined, edits };
        }

        if (deltaRes && Array.isArray(deltaRes.data)) {
          return {
            resultId: deltaRes?.resultId ? String(deltaRes.resultId) : undefined,
            data: mapSemanticTokenData?.(deltaRes.data, map),
          };
        }
      }

      const fullRes = await bridge?.semanticTokensFull?.(
        state.serverId,
        { textDocument: { uri: state.uri } },
        { timeoutMs: 4000, cancelToken },
      ).catch(() => null);

      const data = mapSemanticTokenData?.(fullRes?.data, map) || new Uint32Array();
      return { resultId: fullRes?.resultId ? String(fullRes.resultId) : undefined, data };
    },
  }));

  if (typeof monaco?.languages?.registerDocumentRangeSemanticTokensProvider === 'function') {
    disposables.push(monaco.languages.registerDocumentRangeSemanticTokensProvider(languageId, {
      getLegend: () => legend,
      provideDocumentRangeSemanticTokens: async (model, range, token) => {
        const state = getDocState?.(model);
        if (!state) return { data: new Uint32Array() };
        const map = await getSemanticTokenMap?.(state.serverId);
        if (!map || !map.supportsRange) return { data: new Uint32Array() };
        const cancelToken = nextCancelToken?.('sr') || '';
        token?.onCancellationRequested?.(() => { void bridge?.cancel?.(cancelToken); });
        const res = await bridge?.semanticTokensRange?.(
          state.serverId,
          { textDocument: { uri: state.uri }, range: toLspRangeFromMonacoRange?.(range) },
          { timeoutMs: 4000, cancelToken },
        ).catch(() => null);
        return {
          resultId: res?.resultId ? String(res.resultId) : undefined,
          data: mapSemanticTokenData?.(res?.data, map) || new Uint32Array(),
        };
      },
    }));
  }

  return disposables;
};

