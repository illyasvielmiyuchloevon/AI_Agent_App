export const createDebouncedCachedRequest = ({ debounceMs, cacheMs, emptyValue, onCancel, shouldCache } = {}) => {
  const pendingByKey = new Map();
  const cacheByKey = new Map();
  const getEmpty = typeof emptyValue === 'function' ? emptyValue : () => emptyValue;
  const shouldStore = typeof shouldCache === 'function' ? shouldCache : () => true;
  const debounce = Math.max(0, Number(debounceMs || 0));
  const cacheTtl = Math.max(0, Number(cacheMs || 0));

  return async ({ key, versionId, positionKey, token, cancelToken, isStale, exec } = {}) => {
    const k = String(key || '');
    if (!k) return getEmpty();

    const cached = cacheByKey.get(k);
    if (cached && cached.versionId === versionId && cached.positionKey === positionKey && (Date.now() - cached.ts) <= cacheTtl) {
      return cached.value;
    }

    const prev = pendingByKey.get(k);
    if (prev) {
      pendingByKey.delete(k);
      try { clearTimeout(prev.timer); } catch {}
      try { prev.resolve(getEmpty()); } catch {}
      try { if (prev.cancelToken) onCancel?.(prev.cancelToken); } catch {}
    }

    return await new Promise((resolve) => {
      const finishEmpty = () => resolve(getEmpty());

      const timer = setTimeout(async () => {
        pendingByKey.delete(k);
        if (token?.isCancellationRequested) return finishEmpty();
        if (typeof isStale === 'function' && isStale()) return finishEmpty();

        try {
          const value = await exec?.(cancelToken);
          if (shouldStore(value)) cacheByKey.set(k, { ts: Date.now(), versionId, positionKey, value });
          resolve(value);
        } catch {
          finishEmpty();
        }
      }, debounce);

      pendingByKey.set(k, { timer, resolve: finishEmpty, cancelToken });
      token?.onCancellationRequested?.(() => {
        const cur = pendingByKey.get(k);
        if (cur?.timer === timer) pendingByKey.delete(k);
        try { clearTimeout(timer); } catch {}
        try { onCancel?.(cancelToken); } catch {}
        finishEmpty();
      });
    });
  };
};
