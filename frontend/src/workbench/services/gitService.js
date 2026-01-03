import { GitDriver } from '../../utils/gitDriver';

const listeners = new Set();
let state = {
  loading: false,
  error: '',
  cwd: '',
  commits: [],
  selected: null,
  status: null,
  branches: null,
  lastFetchedAt: 0,
  busy: { refresh: false, fetch: false, pull: false, push: false },
};

const emit = () => {
  for (const fn of Array.from(listeners)) {
    try { fn(); } catch {}
  }
};

const updateState = (patch) => {
  state = { ...state, ...(patch || {}) };
  emit();
};

const toCommitList = (log) => {
  if (!log) return [];
  if (Array.isArray(log)) return log;
  if (Array.isArray(log.all)) return log.all;
  return [];
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
      updateState({ error: 'No workspace root', loading: false, commits: [], cwd: '' });
      return [];
    }
    if (!GitDriver.isAvailable()) {
      updateState({ error: 'Git is not available (need Electron)', loading: false, commits: [], cwd: root });
      return [];
    }
    updateState({ loading: true, busy: { ...state.busy, refresh: true }, error: '', cwd: root });
    try {
      const [log, status, branches] = await Promise.all([
        GitDriver.log(root),
        GitDriver.status(root),
        GitDriver.branch(root),
      ]);
      const commits = toCommitList(log);
      const selectedHash = state.selected?.hash || state.selected?.id || '';
      const preserved = selectedHash ? commits.find((c) => (c?.hash || c?.id) === selectedHash) : null;
      updateState({
        loading: false,
        busy: { ...state.busy, refresh: false },
        error: '',
        commits,
        status: status || null,
        branches: branches || null,
        selected: preserved || state.selected || commits[0] || null,
      });
      return commits;
    } catch (e) {
      updateState({
        loading: false,
        busy: { ...state.busy, refresh: false },
        error: e?.message || String(e),
        commits: [],
        status: null,
        branches: null,
        selected: null,
      });
      return [];
    }
  },
  select(commit) {
    updateState({ selected: commit || null });
  },
  async fetch({ cwd }) {
    const root = String(cwd || '').trim();
    if (!root || !GitDriver.isAvailable()) return false;
    updateState({ busy: { ...state.busy, fetch: true } });
    try {
      const ok = await GitDriver.fetch(root);
      if (ok) updateState({ lastFetchedAt: Date.now() });
      await this.refresh({ cwd: root });
      return !!ok;
    } finally {
      updateState({ busy: { ...state.busy, fetch: false } });
    }
  },
  async pull({ cwd }) {
    const root = String(cwd || '').trim();
    if (!root || !GitDriver.isAvailable()) return false;
    updateState({ busy: { ...state.busy, pull: true } });
    try {
      const ok = await GitDriver.pull(root);
      await this.refresh({ cwd: root });
      return !!ok;
    } finally {
      updateState({ busy: { ...state.busy, pull: false } });
    }
  },
  async push({ cwd }) {
    const root = String(cwd || '').trim();
    if (!root || !GitDriver.isAvailable()) return false;
    updateState({ busy: { ...state.busy, push: true } });
    try {
      const ok = await GitDriver.push(root);
      await this.refresh({ cwd: root });
      return !!ok;
    } finally {
      updateState({ busy: { ...state.busy, push: false } });
    }
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
  async stage({ cwd, files }) {
    const root = String(cwd || '').trim();
    const list = Array.isArray(files) ? files : [files];
    if (!root || list.length === 0 || !GitDriver.isAvailable()) return false;
    const ok = await GitDriver.stage(root, list);
    await this.refresh({ cwd: root });
    return !!ok;
  },
  async unstage({ cwd, files }) {
    const root = String(cwd || '').trim();
    const list = Array.isArray(files) ? files : [files];
    if (!root || list.length === 0 || !GitDriver.isAvailable()) return false;
    const ok = await GitDriver.unstage(root, list);
    await this.refresh({ cwd: root });
    return !!ok;
  },
  async restore({ cwd, files }) {
    const root = String(cwd || '').trim();
    const list = Array.isArray(files) ? files : [files];
    if (!root || list.length === 0 || !GitDriver.isAvailable()) return false;
    const ok = await GitDriver.restore(root, list);
    await this.refresh({ cwd: root });
    return !!ok;
  },
};
