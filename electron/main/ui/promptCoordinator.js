function createPromptCoordinator({ timeoutMs = 30_000 } = {}) {
  const pending = new Map(); // requestId -> { resolve, timer, webContentsId, kind }

  const request = ({ requestId, webContentsId, kind, send }) => {
    const id = String(requestId || '');
    const wid = Number(webContentsId || 0);
    const k = String(kind || '');
    if (!id) return Promise.resolve({ ok: false, error: 'missing requestId' });
    if (!Number.isFinite(wid) || wid <= 0) return Promise.resolve({ ok: false, error: 'missing webContentsId' });
    if (!k) return Promise.resolve({ ok: false, error: 'missing kind' });
    if (typeof send !== 'function') return Promise.resolve({ ok: false, error: 'missing send()' });
    if (pending.has(id)) return Promise.resolve({ ok: false, error: 'duplicate requestId' });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: `prompt timed out after ${timeoutMs}ms` });
      }, Math.max(1, Number(timeoutMs) || 30_000));

      pending.set(id, { resolve, timer, webContentsId: wid, kind: k });

      try {
        send();
      } catch (err) {
        clearTimeout(timer);
        pending.delete(id);
        resolve({ ok: false, error: err?.message || String(err) });
      }
    });
  };

  const handleResponse = ({ senderWebContentsId, requestId, kind, result } = {}) => {
    const id = String(requestId || '');
    const senderId = Number(senderWebContentsId || 0);
    const k = String(kind || '');
    if (!id) return { ok: false, error: 'missing requestId' };
    const entry = pending.get(id);
    if (!entry) return { ok: false, error: 'request not found' };
    if (entry.kind !== k) return { ok: false, error: 'wrong kind' };
    if (!Number.isFinite(senderId) || senderId <= 0) return { ok: false, error: 'missing senderWebContentsId' };
    if (entry.webContentsId !== senderId) return { ok: false, error: 'wrong sender' };

    pending.delete(id);
    try { clearTimeout(entry.timer); } catch {}
    const payload = result && typeof result === 'object' ? result : {};
    try { entry.resolve({ ok: true, result: payload }); } catch {}
    return { ok: true };
  };

  const dispose = () => {
    for (const [id, entry] of Array.from(pending.entries())) {
      pending.delete(id);
      try { clearTimeout(entry.timer); } catch {}
      try { entry.resolve({ ok: false, error: 'disposed' }); } catch {}
    }
  };

  return { request, handleResponse, dispose, _pending: pending };
}

module.exports = { createPromptCoordinator };

