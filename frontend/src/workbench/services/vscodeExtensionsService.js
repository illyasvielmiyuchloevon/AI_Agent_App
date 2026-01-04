import { outputService } from './outputService';

const getBus = () => globalThis?.window?.electronAPI?.ideBus || null;

export const vscodeExtensionsService = (() => {
  let subscribed = false;
  const listeners = new Set();
  let snapshot = { installed: [], lastProgress: null, lastError: null };

  const emit = () => {
    for (const fn of Array.from(listeners)) {
      try { fn(snapshot); } catch {}
    }
  };

  const ensureSubscriptions = () => {
    if (subscribed) return () => {};
    const bus = getBus();
    if (!bus?.onNotification) return () => {};
    subscribed = true;

    const unsubs = [];
    unsubs.push(bus.onNotification('vscodeExtensions/changed', (p) => {
      const items = Array.isArray(p?.items) ? p.items : [];
      snapshot = { ...snapshot, installed: items };
      emit();
    }));
    unsubs.push(bus.onNotification('vscodeExtensions/progress', (p) => {
      snapshot = { ...snapshot, lastProgress: p || null };
      emit();
    }));
    unsubs.push(bus.onNotification('vscodeExtensions/error', (p) => {
      snapshot = { ...snapshot, lastError: p || null };
      try {
        outputService.append('Extensions', `[VSCODE EXT ERROR] ${String(p?.message || '').trim()}`);
      } catch {}
      emit();
    }));

    return () => unsubs.forEach((fn) => fn?.());
  };

  const request = async (method, params, options) => {
    const bus = getBus();
    if (!bus?.request) return { ok: false, error: 'ideBus not available' };
    ensureSubscriptions();
    return bus.request(method, params, options);
  };

  const listInstalled = async () => {
    const res = await request('vscodeExtensions/listInstalled', {});
    const items = Array.isArray(res?.items) ? res.items : [];
    snapshot = { ...snapshot, installed: items };
    emit();
    return { ok: !!res?.ok, items };
  };

  const search = async (query, providerIds, options) => {
    const q = String(query || '').trim();
    if (!q) return { ok: true, items: [] };
    const res = await request('vscodeExtensions/search', {
      query: q,
      providerIds: Array.isArray(providerIds) ? providerIds : undefined,
      options: options && typeof options === 'object' ? options : undefined,
    });
    const items = Array.isArray(res?.items) ? res.items : [];
    return { ok: !!res?.ok, items, error: res?.error };
  };

  return {
    isAvailable: () => !!getBus()?.request,
    subscribe: (fn) => {
      listeners.add(fn);
      ensureSubscriptions();
      try { fn(snapshot); } catch {}
      return () => listeners.delete(fn);
    },
    getSnapshot: () => snapshot,
    listInstalled,
    search,
    getDetail: async (id) => request('vscodeExtensions/getDetail', { id }),
    installFromVsixFile: async (filePath) => request('vscodeExtensions/install', { filePath: String(filePath || '') }),
    installFromOpenVsx: async ({ namespace, name, version } = {}) => request('vscodeExtensions/installFromOpenVsx', { namespace, name, version }),
    enable: async (id) => request('vscodeExtensions/enable', { id }),
    disable: async (id) => request('vscodeExtensions/disable', { id }),
    uninstall: async (id) => request('vscodeExtensions/uninstall', { id }),
  };
})();
