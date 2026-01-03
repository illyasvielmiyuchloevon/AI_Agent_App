import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { List } from 'react-window';
import { gitService } from '../../services/gitService';

const RowHeight = 26;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const basename = (p = '') => {
  const s = String(p || '').replace(/[\\\/]+$/, '');
  const idx1 = s.lastIndexOf('/');
  const idx2 = s.lastIndexOf('\\');
  const idx = Math.max(idx1, idx2);
  return idx >= 0 ? s.slice(idx + 1) : s;
};

const formatRelativeTime = (dateInput) => {
  const t = new Date(dateInput || 0).getTime();
  if (!Number.isFinite(t) || t <= 0) return String(dateInput || '');
  const diff = Date.now() - t;
  const m = 60 * 1000;
  const h = 60 * m;
  const d = 24 * h;
  if (diff < m) return '刚刚';
  if (diff < h) return `${Math.max(1, Math.floor(diff / m))} 分钟前`;
  if (diff < d) return `${Math.max(1, Math.floor(diff / h))} 小时前`;
  if (diff < 7 * d) return `${Math.max(1, Math.floor(diff / d))} 天前`;
  return new Date(t).toLocaleDateString();
};

const parseNaturalTimeFilter = (q = '') => {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return null;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (/(last\s+week|上周|最近一周)/i.test(s)) return { since: now - 7 * day };
  const m = s.match(/last\s+(\d+)\s+days?/i);
  if (m) return { since: now - Math.max(1, Number(m[1] || 1)) * day };
  if (/(today|今天)/i.test(s)) {
    const d0 = new Date();
    d0.setHours(0, 0, 0, 0);
    return { since: d0.getTime() };
  }
  if (/(yesterday|昨天)/i.test(s)) {
    const d0 = new Date();
    d0.setHours(0, 0, 0, 0);
    return { since: d0.getTime() - day, until: d0.getTime() };
  }
  return null;
};

const computeWorkingCounts = (status) => {
  const files = Array.isArray(status?.files) ? status.files : [];
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  files.forEach((f) => {
    const idx = String(f?.index ?? ' ');
    const wd = String(f?.working_dir ?? ' ');
    if (idx !== ' ') staged += 1;
    if (wd !== ' ') unstaged += 1;
    if (idx === '?' || wd === '?') untracked += 1;
  });
  return { staged, unstaged, untracked, total: files.length };
};

const groupChangesByTopLevel = (files = []) => {
  const groups = new Map();
  files.forEach((f) => {
    const p = String(f?.path || '').replace(/\\/g, '/');
    if (!p) return;
    const top = p.includes('/') ? p.split('/')[0] : '(root)';
    if (!groups.has(top)) groups.set(top, []);
    groups.get(top).push({ ...f, path: p });
  });
  const list = Array.from(groups.entries()).map(([name, items]) => ({
    name,
    items: items.slice().sort((a, b) => String(a.path).localeCompare(String(b.path))),
  }));
  return list.sort((a, b) => a.name.localeCompare(b.name));
};

const parseParents = (commit) => {
  const raw = commit?.parents ?? commit?.parent ?? '';
  if (Array.isArray(raw)) return raw.map((x) => String(x || '').trim()).filter(Boolean);
  return String(raw || '').trim().split(/\s+/).filter(Boolean);
};

const parseRefs = (refs) => {
  const raw = String(refs || '').trim();
  if (!raw) return [];

  const parts = raw.split(',').map((s) => String(s || '').trim()).filter(Boolean);
  const out = [];

  for (const part of parts) {
    if (/^HEAD\s*->/i.test(part)) {
      const name = part.replace(/^HEAD\s*->\s*/i, '').trim();
      if (name) {
        out.push({ type: 'head', name: 'HEAD', target: name, raw: part });
        out.push({ type: 'branch', name, current: true, raw: part });
      }
      continue;
    }
    if (/^tag:\s*/i.test(part)) {
      const name = part.replace(/^tag:\s*/i, '').trim();
      if (name) out.push({ type: 'tag', name, raw: part });
      continue;
    }
    if (/^[^/]+\/[^/]+/.test(part)) {
      out.push({ type: 'remote', name: part, raw: part });
      continue;
    }
    out.push({ type: 'branch', name: part, current: false, raw: part });
  }

  const deduped = new Map();
  for (const r of out) {
    const key = `${r.type}:${r.name}`;
    const prev = deduped.get(key);
    if (!prev) {
      deduped.set(key, r);
      continue;
    }
    if (r.type === 'branch' && r.current && !prev.current) {
      deduped.set(key, r);
    }
  }

  const list = Array.from(deduped.values());
  const rank = { head: 0, branch: 1, remote: 2, tag: 3 };
  list.sort((a, b) => {
    const ra = rank[a.type] ?? 9;
    const rb = rank[b.type] ?? 9;
    if (ra !== rb) return ra - rb;
    if (a.type === 'branch') return (a.current ? -1 : 0) - (b.current ? -1 : 0);
    return String(a.name).localeCompare(String(b.name));
  });
  return list;
};

const computeCommitLanes = (commits) => {
  const laneByHash = new Map();
  const laneHeads = [];
  let maxLaneIndex = 0;

  commits.forEach((c) => {
    const hash = String(c?.hash || c?.id || '').trim();
    if (!hash) return;

    let lane = laneHeads.indexOf(hash);
    if (lane < 0) {
      lane = 0;
      laneHeads.unshift(hash);
    }

    laneByHash.set(hash, lane);
    maxLaneIndex = Math.max(maxLaneIndex, lane);

    const parents = parseParents(c);
    if (parents.length === 0) {
      laneHeads.splice(lane, 1);
    } else {
      laneHeads[lane] = parents[0];
      if (parents.length > 1) laneHeads.splice(lane + 1, 0, ...parents.slice(1));
    }

    const deduped = [];
    laneHeads.forEach((h) => {
      if (!h) return;
      if (deduped.includes(h)) return;
      deduped.push(h);
    });
    laneHeads.length = 0;
    laneHeads.push(...deduped);
  });

  return { laneByHash, laneCount: Math.max(1, Math.min(maxLaneIndex + 1, 12)) };
};

export default function GitLensView({ workspacePath = '', onOpenFile, isResizing = false }) {

  const snap = useSyncExternalStore(gitService.subscribe, gitService.getSnapshot, gitService.getSnapshot);
  const [details, setDetails] = useState({ stats: null, files: [] });
  const [query, setQuery] = useState('');
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());

  useEffect(() => {
    gitService.refresh({ cwd: workspacePath }).catch(() => {});
  }, [workspacePath]);

  useEffect(() => {
    const selected = snap.selected;
    const hash = selected?.hash || selected?.id || '';
    if (!hash) return;
    let cancelled = false;
    Promise.all([
      gitService.getCommitStats({ cwd: workspacePath, hash }),
      gitService.getCommitDetails({ cwd: workspacePath, hash }),
    ]).then(([stats, files]) => {
      if (cancelled) return;
      setDetails({ stats: stats || null, files: Array.isArray(files) ? files : [] });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [snap.selected, workspacePath]);

  const commits = Array.isArray(snap.commits) ? snap.commits : [];
  const status = snap.status;
  const branch = snap.branches?.current || '';
  const rootLabel = basename(workspacePath) || workspacePath || 'Repository';
  const lanes = useMemo(() => computeCommitLanes(commits), [commits]);
  const graphWidth = useMemo(() => {
    const pad = 24;
    const step = 12;
    return clamp(pad + lanes.laneCount * step, 110, 280);
  }, [lanes.laneCount]);

  const workingCounts = useMemo(() => computeWorkingCounts(status), [status]);
  const hasWorkingChanges = workingCounts.total > 0;

  const displayRows = useMemo(() => {
    const rows = [];
    if (hasWorkingChanges) {
      rows.push({ type: 'wip', key: 'wip', message: 'Work in progress', date: '', author_name: '', hash: '' });
    }
    commits.forEach((c) => rows.push({ ...c, type: 'commit', key: c?.hash || c?.id || `${Math.random()}` }));
    return rows;
  }, [commits, hasWorkingChanges]);

  const filteredRows = useMemo(() => {
    const q = String(query || '').trim();
    if (!q) return displayRows;
    const timeFilter = parseNaturalTimeFilter(q);
    const needle = q.toLowerCase();
    return displayRows.filter((row) => {
      if (row.type === 'wip') return /wip|work|progress|改动|变更|working/i.test(needle);
      const msg = String(row?.message || '').toLowerCase();
      const author = String(row?.author_name || row?.author || '').toLowerCase();
      const hash = String(row?.hash || row?.id || '').toLowerCase();
      const dateStr = String(row?.date || '');
      if (timeFilter) {
        const t = new Date(dateStr || 0).getTime();
        if (!Number.isFinite(t) || t <= 0) return false;
        if (timeFilter.since && t < timeFilter.since) return false;
        if (timeFilter.until && t >= timeFilter.until) return false;
      }
      return msg.includes(needle) || author.includes(needle) || hash.includes(needle);
    });
  }, [displayRows, query]);

  const selected = snap.selected
    || (hasWorkingChanges ? { type: 'wip' } : null)
    || commits[0]
    || null;
  const selectedKey = selected?.type === 'wip' ? 'wip' : (selected?.hash || selected?.id || '');

  const statsCacheRef = useRef(new Map());
  const statsInFlightRef = useRef(new Set());
  const [, forceStatsUpdate] = useState(0);

  const requestStats = useCallback((hash) => {
    if (isResizing) return;
    const h = String(hash || '').trim();
    if (!h) return;
    if (!workspacePath) return;
    if (statsCacheRef.current.has(h)) return;
    if (statsInFlightRef.current.has(h)) return;
    statsInFlightRef.current.add(h);
    gitService.getCommitStats({ cwd: workspacePath, hash: h })
      .then((s) => {
        statsCacheRef.current.set(h, s || { files: 0, insertions: 0, deletions: 0 });
        forceStatsUpdate((v) => v + 1);
      })
      .catch(() => {})
      .finally(() => {
        statsInFlightRef.current.delete(h);
      });
  }, [isResizing, workspacePath]);

  const unstaged = useMemo(() => {
    const list = Array.isArray(status?.files) ? status.files : [];
    return list.filter((f) => String(f?.working_dir ?? ' ') !== ' ');
  }, [status]);

  const staged = useMemo(() => {
    const list = Array.isArray(status?.files) ? status.files : [];
    return list.filter((f) => String(f?.index ?? ' ') !== ' ');
  }, [status]);

  const unstagedGroups = useMemo(() => groupChangesByTopLevel(unstaged), [unstaged]);
  const stagedGroups = useMemo(() => groupChangesByTopLevel(staged), [staged]);

  const toggleGroup = useCallback((key) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const Row = ({ index, style }) => {
    const row = filteredRows[index];
    const rowHash = String(row?.hash || row?.id || '').trim();
    const laneIndex = row?.type === 'commit' ? (lanes.laneByHash.get(rowHash) ?? 0) : 0;
    const isActive = row?.type === 'wip'
      ? selectedKey === 'wip'
      : (!!selectedKey && selectedKey === (row?.hash || row?.id));
    const refs = row?.type === 'commit' ? parseRefs(row?.refs) : [];
    const stats = row?.type === 'commit' ? (statsCacheRef.current.get(rowHash) || null) : null;
    const parents = row?.type === 'commit' ? parseParents(row) : [];
    const mergeLines = parents.length > 1
      ? parents.slice(1, 4).map((p) => lanes.laneByHash.get(String(p || '').trim())).filter((x) => Number.isFinite(x))
      : [];

    const insertions = stats?.insertions || 0;
    const deletions = stats?.deletions || 0;
    const totalChanges = Math.max(1, insertions + deletions);
    const insPct = `${Math.min(100, Math.round((insertions / totalChanges) * 100))}%`;
    const delPct = `${Math.min(100, Math.round((deletions / totalChanges) * 100))}%`;

    return (
      <button
        type="button"
        className={`gitlens-row ${isActive ? 'active' : ''} ${row?.type === 'wip' ? 'wip' : ''}`}
        style={{ ...style, height: RowHeight }}
        onClick={() => gitService.select(row?.type === 'wip' ? { type: 'wip' } : row)}
        title={row?.type === 'wip' ? 'Working changes' : row?.message}
      >
        <span className="gitlens-branch-cell" aria-hidden>
          {row?.type === 'wip' ? <span className="gitlens-wip-pill">WIP</span> : null}
          {row?.type === 'commit' && refs.length ? (
            <span className="gitlens-refs" title={row?.refs}>
              {refs.slice(0, 2).map((r) => (
                <span
                  key={`${r.type}:${r.name}:${r.target || ''}`}
                  className={`gitlens-ref-pill ${r.type} ${r.current ? 'current' : ''}`}
                >
                  {r.type === 'head' ? <span className="codicon codicon-target" aria-hidden /> : null}
                  {r.type === 'tag' ? <span className="codicon codicon-tag" aria-hidden /> : null}
                  {r.type === 'remote' ? <span className="codicon codicon-cloud" aria-hidden /> : null}
                  {r.type === 'branch' ? <span className="codicon codicon-git-branch" aria-hidden /> : null}
                  {r.name}
                </span>
              ))}
              {refs.length > 2 ? <span className="gitlens-ref-more">+{refs.length - 2}</span> : null}
            </span>
          ) : null}
        </span>
        <span className="gitlens-graph-cell" aria-hidden style={{ '--gitlens-lane': laneIndex }}>
          <span className="gitlens-graph-lanes" />
          {mergeLines.map((t) => {
            const from = laneIndex;
            const to = Math.max(0, Math.min(lanes.laneCount - 1, t));
            if (to === from) return null;
            const pad = 12;
            const gap = 12;
            const left = `${pad + Math.min(from, to) * gap}px`;
            const width = `${Math.abs(from - to) * gap}px`;
            return <span key={`m:${rowHash}:${from}:${to}`} className="gitlens-graph-merge" style={{ left, width }} />;
          })}
          <span className="gitlens-graph-dot" />
        </span>
        <span className="gitlens-msg-cell">
          <span className="gitlens-msg">{row?.type === 'wip' ? 'Work in progress' : row?.message}</span>
          {row?.type === 'wip' ? (
            <span className="gitlens-wip-meta">
              <span className="gitlens-wip-count">+{workingCounts.unstaged}</span>
              <span className="gitlens-wip-count muted">staged {workingCounts.staged}</span>
            </span>
          ) : null}
        </span>
        <span className="gitlens-author-cell">{row?.author_name || row?.author || (row?.type === 'wip' ? '' : '—')}</span>
        <span className="gitlens-changes-cell">
          {row?.type === 'wip' ? (
            <span className="gitlens-change-summary">
              <span className="gitlens-change-files">{workingCounts.total} files</span>
            </span>
          ) : (stats ? (
            <span className="gitlens-change-summary">
              <span className="gitlens-change-files">{stats.files || 0}</span>
              <span className="gitlens-change-bar" aria-hidden>
                <span className="gitlens-change-ins" style={{ width: insPct }} />
                <span className="gitlens-change-del" style={{ width: delPct }} />
              </span>
            </span>
          ) : (
            <span className="gitlens-change-skel" />
          ))}
        </span>
        <span className="gitlens-date-cell">{row?.type === 'wip' ? '' : formatRelativeTime(row?.date || row?.when)}</span>
        <span className="gitlens-sha-cell">{row?.type === 'wip' ? '' : String(row?.hash || row?.id || '').slice(0, 7)}</span>
      </button>
    );
  };

  if (snap.loading) {
    return (
      <div className="panel-empty">
        <div className="panel-empty-title">加载 Git 历史…</div>
        <div className="panel-empty-subtitle">需要 Electron Git IPC 可用。</div>
      </div>
    );
  }

  if (snap.error) {
    return (
      <div className="panel-empty">
        <div className="panel-empty-title">GitLens 不可用</div>
        <div className="panel-empty-subtitle">{snap.error}</div>
      </div>
    );
  }

  if (!filteredRows.length) {
    return (
      <div className="panel-empty">
        <div className="panel-empty-title">暂无提交。</div>
        <div className="panel-empty-subtitle">初始化 Git 仓库或在 Electron 环境打开。</div>
      </div>
    );
  }

  const isWipSelected = selected?.type === 'wip' || selectedKey === 'wip';
  const selectedHash = isWipSelected ? '' : (selected?.hash || selected?.id || '');
  const selectedTitle = isWipSelected ? 'Working Changes' : (selected?.message || '');
  const selectedMeta = isWipSelected
    ? `${workingCounts.total} changed files · ${branch || '—'}`
    : `${selected?.author_name || '—'} · ${formatRelativeTime(selected?.date || '')} · ${selectedHash}`;

  const files = Array.isArray(details.files) ? details.files : [];
  const stats = details.stats;

  const onSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      const q = String(query || '').trim();
      if (q) {
        const next = [q, ...historyRef.current.filter((x) => x !== q)].slice(0, 50);
        historyRef.current = next;
        historyIndexRef.current = -1;
      }
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const list = historyRef.current || [];
    if (list.length === 0) return;
    e.preventDefault();
    const idx = historyIndexRef.current;
    const nextIdx = e.key === 'ArrowUp'
      ? Math.min(list.length - 1, idx + 1)
      : Math.max(-1, idx - 1);
    historyIndexRef.current = nextIdx;
    setQuery(nextIdx >= 0 ? list[nextIdx] : '');
  };

  const renderChangeGroup = (group, prefix) => {
    const key = `${prefix}:${group.name}`;
    const collapsed = collapsedGroups.has(key);
    return (
      <div key={key} className="gitlens-change-group">
        <button type="button" className="gitlens-change-group-header" onClick={() => toggleGroup(key)}>
          <span className={`codicon ${collapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'}`} aria-hidden />
          <span className="gitlens-change-group-title">{group.name}</span>
          <span className="gitlens-change-group-count">{group.items.length}</span>
        </button>
        {collapsed ? null : (
          <div className="gitlens-change-group-body">
            {group.items.map((f) => (
              <button
                key={`${key}:${f.path}`}
                type="button"
                className="gitlens-change-row"
                onClick={() => onOpenFile?.(f.path)}
                title={f.path}
              >
                <span className="codicon codicon-file" aria-hidden />
                <span className="gitlens-change-path">{f.path}</span>
                <span className="gitlens-change-status">{String(f.working_dir || f.index || '').trim()}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="gitlens-shell" style={{ '--gitlens-col-graph': `${graphWidth}px` }}>
      <div className="gitlens-topbar">
        <div className="gitlens-title">COMMIT GRAPH: {rootLabel}</div>
        <div className="gitlens-topbar-actions">
          <div className="gitlens-branch-pill" title="当前分支">
            <span className="codicon codicon-git-branch" aria-hidden />
            <span className="gitlens-branch-text">{branch || '—'}</span>
          </div>
          <button type="button" className="bottom-panel-icon-btn" onClick={() => gitService.fetch({ cwd: workspacePath }).catch(() => {})} title="Fetch">
            <span className="codicon codicon-repo-fetch" aria-hidden />
          </button>
          <button type="button" className="bottom-panel-icon-btn" onClick={() => gitService.pull({ cwd: workspacePath }).catch(() => {})} title="Pull">
            <span className="codicon codicon-arrow-down" aria-hidden />
          </button>
          <button type="button" className="bottom-panel-icon-btn" onClick={() => gitService.push({ cwd: workspacePath }).catch(() => {})} title="Push">
            <span className="codicon codicon-arrow-up" aria-hidden />
          </button>
        </div>
      </div>

      <div className="gitlens-searchbar">
        <div className="gitlens-scope">
          <button type="button" className="gitlens-scope-btn" title="All Branches (placeholder)">
            All Branches <span className="codicon codicon-chevron-down" aria-hidden />
          </button>
        </div>
        <div className="gitlens-search">
          <span className="codicon codicon-search" aria-hidden />
          <input
            className="gitlens-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Search commits using natural language (↑↓ for history), e.g. my commits from last week"
          />
          <span className="gitlens-search-meta">{filteredRows.length ? '' : 'No results'}</span>
        </div>
      </div>

      <div className="gitlens-body">
        <div className="gitlens-main">
          <div className="gitlens-table-header" role="row">
            <span className="gitlens-branch-cell">BRANCH / TAG</span>
            <span className="gitlens-graph-cell">GRAPH</span>
            <span className="gitlens-msg-cell">COMMIT MESSAGE</span>
            <span className="gitlens-author-cell">AUTHOR</span>
            <span className="gitlens-changes-cell">CHANGES</span>
            <span className="gitlens-date-cell">COMMIT DATE / TIME</span>
            <span className="gitlens-sha-cell">SHA</span>
          </div>
          <div className="gitlens-list">
            <List
              defaultHeight={420}
              style={{ height: '100%', width: '100%' }}
              onRowsRendered={(visible, overscan) => {
                if (isResizing) return;
                const start = Math.max(0, overscan?.startIndex ?? visible?.startIndex ?? 0);
                const stop = Math.min(filteredRows.length - 1, overscan?.stopIndex ?? visible?.stopIndex ?? -1);
                for (let i = start; i <= stop; i += 1) {
                  const r = filteredRows[i];
                  if (r?.type !== 'commit') continue;
                  requestStats(r?.hash || r?.id || '');
                }
              }}
              rowCount={filteredRows.length}
              rowHeight={RowHeight}
              rowComponent={Row}
              rowProps={{}}
            />
          </div>
        </div>

        <div className="gitlens-inspect">
          <div className="gitlens-inspect-header">
            <div className="gitlens-inspect-title">COMMIT GRAPH INSPECT: OVERVIEW</div>
            <div className="gitlens-inspect-actions">
              <button type="button" className="bottom-panel-icon-btn" onClick={() => gitService.refresh({ cwd: workspacePath }).catch(() => {})} title="Refresh">
                <span className="codicon codicon-refresh" aria-hidden />
              </button>
            </div>
          </div>

          <div className="gitlens-inspect-body">
            <div className="gitlens-details">
              <div className="gitlens-details-title">{selectedTitle}</div>
              <div className="gitlens-details-meta">{selectedMeta}</div>
              {!isWipSelected && stats ? (
                <div className="panel-list-meta" style={{ marginBottom: 10 }}>
                  <span>{stats.files} files</span>
                  <span>+{stats.insertions}</span>
                  <span>-{stats.deletions}</span>
                </div>
              ) : null}

              {!isWipSelected ? (
                <div className="gitlens-details-section">
                  <div className="gitlens-details-section-title">FILES CHANGED</div>
                  <div className="gitlens-files">
                    {files.map((f) => (
                      <button
                        key={f.path || f}
                        type="button"
                        className="gitlens-file"
                        onClick={() => onOpenFile?.(f.path || String(f))}
                        title={f.path || String(f)}
                      >
                        <span className="codicon codicon-file" aria-hidden />
                        <span className="gitlens-file-path">{f.path || String(f)}</span>
                        {f.status ? <span className="gitlens-file-status">{f.status}</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="gitlens-working">
              <div className="gitlens-working-header">
                <div className="gitlens-working-title">WORKING CHANGES</div>
              </div>
              <div className="gitlens-working-actions">
                <button
                  type="button"
                  className="gitlens-compose-btn"
                  onClick={() => gitService.select({ type: 'wip' })}
                  title="Compose commits (placeholder)"
                >
                  <span className="codicon codicon-merge" aria-hidden />
                  Compose Commits...
                </button>
              </div>

              <div className="gitlens-working-section">
                <div className="gitlens-working-section-title">
                  <span className="codicon codicon-ellipsis" aria-hidden />
                  Unstaged Changes
                  <span className="gitlens-working-count">{unstaged.length}</span>
                </div>
                <div className="gitlens-working-tree">
                  {unstagedGroups.length ? unstagedGroups.map((g) => renderChangeGroup(g, 'unstaged')) : (
                    <div className="gitlens-empty-small">No unstaged changes.</div>
                  )}
                </div>
              </div>

              <div className="gitlens-working-section">
                <div className="gitlens-working-section-title">
                  <span className="codicon codicon-ellipsis" aria-hidden />
                  Staged Changes
                  <span className="gitlens-working-count">{staged.length}</span>
                </div>
                <div className="gitlens-working-tree">
                  {stagedGroups.length ? stagedGroups.map((g) => renderChangeGroup(g, 'staged')) : (
                    <div className="gitlens-empty-small">No staged changes.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
