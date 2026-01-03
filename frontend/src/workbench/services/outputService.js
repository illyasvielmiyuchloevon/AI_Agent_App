const listeners = new Set();
const channels = new Map();
let consolePatched = false;
let version = 0;
let snapshot = { version: 0, channels: [] };

const nowTime = () => {
  try {
    return new Date().toLocaleTimeString();
  } catch {
    return '';
  }
};

const rebuildSnapshot = () => {
  snapshot = {
    version,
    channels: Array.from(channels.values()).map((c) => ({ id: c.id, label: c.label, lineCount: c.lines.length })),
  };
};

const emit = () => {
  for (const fn of Array.from(listeners)) {
    try { fn(); } catch {}
  }
};

const ensureChannel = (id, label) => {
  const key = String(id || '').trim();
  if (!key) return null;
  if (!channels.has(key)) {
    channels.set(key, { id: key, label: label || key, lines: [], maxLines: 20000 });
  } else if (label) {
    const ch = channels.get(key);
    if (ch && ch.label !== label) ch.label = label;
  }
  return channels.get(key);
};

const normalizeLine = (value) => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const appendToChannel = (id, label, text) => {
  const ch = ensureChannel(id, label);
  if (!ch) return;
  const line = normalizeLine(text);
  if (!line) return;
  ch.lines.push(line);
  if (ch.lines.length > ch.maxLines) {
    ch.lines.splice(0, ch.lines.length - ch.maxLines);
  }
  version += 1;
  rebuildSnapshot();
  emit();
};

export const outputService = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getSnapshot() {
    return snapshot;
  },
  getChannelLines(id) {
    const ch = channels.get(String(id || ''));
    return ch ? ch.lines : [];
  },
  ensureChannel(id, label) {
    ensureChannel(id, label);
    version += 1;
    rebuildSnapshot();
    emit();
  },
  clear(id) {
    const ch = channels.get(String(id || ''));
    if (!ch) return;
    ch.lines = [];
    version += 1;
    rebuildSnapshot();
    emit();
  },
  append(id, text, { label } = {}) {
    appendToChannel(id, label, text);
  },
  appendMany(id, lines, { label } = {}) {
    const arr = Array.isArray(lines) ? lines : [lines];
    for (const l of arr) appendToChannel(id, label, l);
  },
  installConsoleCapture({ channelId = 'Workbench', channelLabel = '工作台', timestamp = true } = {}) {
    ensureChannel(channelId, channelLabel);
    rebuildSnapshot();
    if (consolePatched) return;
    if (typeof window === 'undefined') return;
    consolePatched = true;

    const levels = ['log', 'info', 'warn', 'error', 'debug'];
    for (const level of levels) {
      const orig = console[level];
      if (typeof orig !== 'function') continue;
      console[level] = (...args) => {
        try {
          const prefix = timestamp ? `[${nowTime()}] ` : '';
          const rendered = args.map(normalizeLine).join(' ');
          appendToChannel(channelId, channelLabel, `${prefix}${rendered}`);
        } catch {
          // ignore
        }
        return orig.apply(console, args);
      };
    }
  },
};
