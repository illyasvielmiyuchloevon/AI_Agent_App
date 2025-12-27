import { GitDriver } from '../../utils/gitDriver';

const listeners = new Set();
let state = { loading: false, error: '', commits: [], selected: null };

const emit = () => {
  for (const fn of Array.from(listeners)) {
    try { fn(); } catch {}
  }
};

export const gitService = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getSnapshot() {
    return state;
  },
  async refresh({ cwd }) {
    const root = String(cwd || '').trim();
    if (!root) {
      state = { ...state, error: 'No workspace root', loading: false, commits: [] };
      emit();
      return [];
    }
    if (!GitDriver.isAvailable()) {
      state = { ...state, error: 'Git is not available (need Electron)', loading: false, commits: [] };
      emit();
      return [];
    }
    state = { ...state, loading: true, error: '' };
    emit();
    try {
      const log = await GitDriver.log(root);
      const commits = Array.isArray(log) ? log : [];
      state = { ...state, loading: false, error: '', commits };
      if (!state.selected && commits[0]) state = { ...state, selected: commits[0] };
      emit();
      return commits;
    } catch (e) {
      state = { ...state, loading: false, error: e?.message || String(e), commits: [] };
      emit();
      return [];
    }
  },
  select(commit) {
    state = { ...state, selected: commit || null };
    emit();
  },
  async getCommitDetails({ cwd, hash }) {
    const root = String(cwd || '').trim();
    const h = String(hash || '').trim();
    if (!root || !h || !GitDriver.isAvailable()) return [];
    return await GitDriver.getCommitDetails(root, h);
  },
  async getCommitStats({ cwd, hash }) {
    const root = String(cwd || '').trim();
    const h = String(hash || '').trim();
    if (!root || !h || !GitDriver.isAvailable()) return null;
    return await GitDriver.getCommitStats(root, h);
  },
  async getCommitFileDiffs({ cwd, hash }) {
    const root = String(cwd || '').trim();
    const h = String(hash || '').trim();
    if (!root || !h || !GitDriver.isAvailable()) return [];
    return await GitDriver.getCommitFileDiffs(root, h);
  },
};

