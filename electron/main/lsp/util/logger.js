function normalizeError(err) {
  if (!err) return { message: '' };
  if (err instanceof Error) return { message: err.message, stack: err.stack, name: err.name };
  return { message: String(err) };
}

function createLogger({ namespace = 'lsp', enabled = true, sink } = {}) {
  const write = (level, message, extra) => {
    if (!enabled) return;
    const payload = {
      ts: Date.now(),
      namespace,
      level,
      message: String(message || ''),
      ...(extra ? { extra } : {}),
    };

    try {
      if (typeof sink === 'function') {
        sink(payload);
        return;
      }
    } catch {
      // ignore sink errors
    }

    const line = `[${namespace}] ${payload.level.toUpperCase()} ${payload.message}`;
    if (level === 'error') console.error(line, extra || '');
    else if (level === 'warn') console.warn(line, extra || '');
    else if (level === 'debug') console.debug(line, extra || '');
    else console.log(line, extra || '');
  };

  return {
    child(childNamespace) {
      return createLogger({
        namespace: `${namespace}:${String(childNamespace || '').trim()}`,
        enabled,
        sink,
      });
    },
    debug(message, extra) { write('debug', message, extra); },
    info(message, extra) { write('info', message, extra); },
    warn(message, extra) { write('warn', message, extra); },
    error(message, extra) { write('error', message, extra); },
    exception(message, err, extra) {
      write('error', message, { ...extra, error: normalizeError(err) });
    },
  };
}

module.exports = { createLogger, normalizeError };

