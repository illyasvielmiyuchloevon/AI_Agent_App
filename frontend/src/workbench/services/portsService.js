const listeners = new Set();

let state = {
  loading: false,
  error: '',
  ports: [],
};

const emit = () => {
  for (const fn of Array.from(listeners)) {
    try { fn(); } catch {}
  }
};

export const portsService = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getSnapshot() {
    return state;
  },
  async refresh() {
    state = { ...state, loading: true, error: '' };
    emit();
    try {
      const res = await fetch('/api/ports/listening', { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || res.statusText || 'Request failed');
      const ports = Array.isArray(data?.ports) ? data.ports : [];
      state = { ...state, ports, loading: false, error: '' };
      emit();
      return ports;
    } catch (e) {
      state = { ...state, loading: false, error: e?.message || String(e) };
      emit();
      return [];
    }
  },
};

