const commandOwners = new Map();
const commandMeta = new Map();
const builtins = new Map();
const extensionContributions = new Map();

function normalizeId(id) {
  return String(id || '').trim();
}

function registerBuiltin(command, handler, meta = {}) {
  const id = normalizeId(command);
  if (!id) return;
  if (typeof handler !== 'function') return;
  builtins.set(id, handler);
  commandMeta.set(id, {
    id,
    title: meta?.title ? String(meta.title) : id,
    source: 'builtin',
  });
}

function setExtensionContributions(items = []) {
  extensionContributions.clear();
  const list = Array.isArray(items) ? items : [];
  for (const it of list) {
    const id = normalizeId(it?.command);
    if (!id) continue;
    const title = it?.title != null ? String(it.title) : id;
    extensionContributions.set(id, { id, title, source: 'extension' });
  }

  for (const [id, meta] of Array.from(commandMeta.entries())) {
    if (meta?.source !== 'extension') continue;
    if (commandOwners.has(id)) continue;
    if (!extensionContributions.has(id)) commandMeta.delete(id);
  }

  for (const [id, meta] of extensionContributions.entries()) {
    if (builtins.has(id)) continue;
    if (commandOwners.has(id)) continue;
    commandMeta.set(id, meta);
  }
}

function registerFromExtensionHost({ command, title, owner } = {}) {
  const id = normalizeId(command);
  if (!id) return;
  commandOwners.set(id, owner || null);
  commandMeta.set(id, {
    id,
    title: title ? String(title) : id,
    source: 'extension',
  });
}

function unregisterFromExtensionHost(command) {
  const id = normalizeId(command);
  if (!id) return;
  const meta = commandMeta.get(id);
  if (meta?.source === 'extension') {
    commandOwners.delete(id);
    if (extensionContributions.has(id)) commandMeta.set(id, extensionContributions.get(id));
    else commandMeta.delete(id);
  }
}

function listCommands() {
  return Array.from(commandMeta.values()).sort((a, b) => String(a.title).localeCompare(String(b.title)));
}

function getCommandMeta(command) {
  const id = normalizeId(command);
  if (!id) return null;
  return commandMeta.get(id) || null;
}

function unregisterAllFromOwner(owner) {
  if (!owner) return 0;
  let removed = 0;
  for (const [id, existingOwner] of Array.from(commandOwners.entries())) {
    if (existingOwner !== owner) continue;
    commandOwners.delete(id);
    const meta = commandMeta.get(id);
    if (meta?.source === 'extension') {
      if (extensionContributions.has(id)) commandMeta.set(id, extensionContributions.get(id));
      else commandMeta.delete(id);
    }
    removed += 1;
  }
  return removed;
}

async function executeCommand(command, args = []) {
  const id = normalizeId(command);
  if (!id) throw new Error('missing command');

  if (builtins.has(id)) {
    const fn = builtins.get(id);
    return await fn(...(Array.isArray(args) ? args : [args]));
  }

  const owner = commandOwners.get(id);
  if (!owner || typeof owner.sendRequest !== 'function') {
    throw new Error(`command not found: ${id}`);
  }

  return await owner.sendRequest('extHost/executeCommand', { command: id, args: Array.isArray(args) ? args : [args] }, { timeoutMs: 30_000 });
}

module.exports = {
  registerBuiltin,
  setExtensionContributions,
  registerFromExtensionHost,
  unregisterFromExtensionHost,
  unregisterAllFromOwner,
  listCommands,
  getCommandMeta,
  executeCommand,
};
