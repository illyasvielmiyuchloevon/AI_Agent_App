import { outputService } from './outputService';

const getApi = () => globalThis?.window?.electronAPI?.plugins || null;

export const pluginsService = (() => {
  const api = () => getApi();
  let subscribed = false;
  const listeners = new Set();
  let snapshot = { installed: [], updates: [], lastProgress: null, lastError: null };

  const emit = () => {
    for (const fn of Array.from(listeners)) {
      try { fn(snapshot); } catch {}
    }
  };

  const ensureSubscriptions = () => {
    if (subscribed) return () => {};
    const a = api();
    if (!a) return () => {};
    subscribed = true;

    const unsubs = [];
    if (typeof a.onProgress === 'function') {
      unsubs.push(a.onProgress((p) => {
        snapshot = { ...snapshot, lastProgress: p || null };
        emit();
      }));
    }
    if (typeof a.onChanged === 'function') {
      unsubs.push(a.onChanged((p) => {
        const items = Array.isArray(p?.items) ? p.items : [];
        snapshot = { ...snapshot, installed: items };
        emit();
      }));
    }
    if (typeof a.onError === 'function') {
      unsubs.push(a.onError((p) => {
        snapshot = { ...snapshot, lastError: p || null };
        try {
          outputService.append('LSP', `[PLUGIN ERROR] ${String(p?.message || '').trim()}`);
        } catch {}
        emit();
      }));
    }

    return () => unsubs.forEach((fn) => fn?.());
  };

  const listInstalled = async () => {
    const a = api();
    if (!a?.listInstalled) return { ok: false, items: [] };
    ensureSubscriptions();
    const res = await a.listInstalled();
    const items = Array.isArray(res?.items) ? res.items : [];
    snapshot = { ...snapshot, installed: items };
    emit();
    return { ok: true, items };
  };

  const listUpdates = async () => {
    const a = api();
    if (!a?.listUpdates) return { ok: false, items: [] };
    ensureSubscriptions();
    const res = await a.listUpdates();
    const items = Array.isArray(res?.items) ? res.items : [];
    snapshot = { ...snapshot, updates: items };
    emit();
    return { ok: true, items };
  };

  return {
    isAvailable: () => !!api(),
    subscribe: (fn) => {
      listeners.add(fn);
      ensureSubscriptions();
      try { fn(snapshot); } catch {}
      return () => listeners.delete(fn);
    },
    getSnapshot: () => snapshot,
    search: async (query, providerIds) => {
      const a = api();
      if (!a?.search) return { ok: false, items: [] };
      ensureSubscriptions();
      return a.search(query, providerIds);
    },
    listInstalled,
    listUpdates,
    install: async (ref) => {
      const a = api();
      if (!a?.install) return { ok: false };
      ensureSubscriptions();
      return a.install(ref);
    },
    uninstall: async (id) => {
      const a = api();
      if (!a?.uninstall) return { ok: false };
      ensureSubscriptions();
      return a.uninstall(id);
    },
    enable: async (id, trust) => {
      const a = api();
      if (!a?.enable) return { ok: false };
      ensureSubscriptions();
      return a.enable(id, trust);
    },
    disable: async (id) => {
      const a = api();
      if (!a?.disable) return { ok: false };
      ensureSubscriptions();
      return a.disable(id);
    },
    doctor: async (id) => {
      const a = api();
      if (!a?.doctor) return { ok: false };
      ensureSubscriptions();
      return a.doctor(id);
    },
    listEnabledLanguages: async () => {
      const a = api();
      if (!a?.listEnabledLanguages) return { ok: false, items: [] };
      ensureSubscriptions();
      return a.listEnabledLanguages();
    },
  };
})();

