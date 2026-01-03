function createApplyEditCoordinator({ timeoutMs = 10_000 } = {}) {
  const pending = new Map(); // requestId -> { resolve, timer, webContentsId }

  const request = ({ requestId, webContentsId, send }) => {
    const id = String(requestId || '');
    const wid = Number(webContentsId || 0);
    if (!id) return Promise.resolve({ applied: false, failureReason: 'missing requestId' });
    if (!Number.isFinite(wid) || wid <= 0) return Promise.resolve({ applied: false, failureReason: 'missing webContentsId' });
    if (typeof send !== 'function') return Promise.resolve({ applied: false, failureReason: 'missing send()' });

    if (pending.has(id)) return Promise.resolve({ applied: false, failureReason: 'duplicate requestId' });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ applied: false, failureReason: `applyEdit timed out after ${timeoutMs}ms` });
      }, Math.max(1, Number(timeoutMs) || 10_000));

      pending.set(id, { resolve, timer, webContentsId: wid });

      try {
        send();
      } catch (err) {
        clearTimeout(timer);
        pending.delete(id);
        resolve({ applied: false, failureReason: err?.message || String(err) });
      }
    });
  };

  const handleResponse = ({ senderWebContentsId, requestId, result } = {}) => {
    const id = String(requestId || '');
    const senderId = Number(senderWebContentsId || 0);
    if (!id) return { ok: false, error: 'missing requestId' };
    const entry = pending.get(id);
    if (!entry) return { ok: false, error: 'request not found' };
    if (!Number.isFinite(senderId) || senderId <= 0) return { ok: false, error: 'missing senderWebContentsId' };
    if (entry.webContentsId !== senderId) return { ok: false, error: 'wrong sender' };

    pending.delete(id);
    try {
      clearTimeout(entry.timer);
    } catch {}

    const r = result && typeof result === 'object' ? result : {};
    const applied = !!r.applied;
    const failureReason = r.failureReason != null ? String(r.failureReason) : undefined;
    try {
      entry.resolve({ applied, ...(failureReason ? { failureReason } : {}) });
    } catch {}
    return { ok: true };
  };

  const dispose = () => {
    for (const [id, entry] of Array.from(pending.entries())) {
      pending.delete(id);
      try {
        clearTimeout(entry.timer);
      } catch {}
      try {
        entry.resolve({ applied: false, failureReason: 'disposed' });
      } catch {}
    }
  };

  return { request, handleResponse, dispose, _pending: pending };
}

module.exports = { createApplyEditCoordinator };

