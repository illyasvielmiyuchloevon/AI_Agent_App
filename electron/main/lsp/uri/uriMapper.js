const fs = require('fs');
const path = require('path');
const { toFileUri, fromFileUri } = require('../util/uri');
const { normalizePathForCompare, workspaceFolderRootsFsPaths, pickContainingRoot } = require('../util/fsRoots');

const ensureUriMap = (state) => {
  const s = state;
  if (!s.uriMap) s.uriMap = { clientToServer: new Map(), serverToClient: new Map() };
  if (!s.uriMap.clientToServer) s.uriMap.clientToServer = new Map();
  if (!s.uriMap.serverToClient) s.uriMap.serverToClient = new Map();
  return s.uriMap;
};

async function mapClientToServer(state, clientUri) {
  const s = state;
  const u = String(clientUri || '');
  if (!s || !u) return u;
  if (!u.startsWith('file://')) return u;
  if (s.uriMap?.clientToServer?.has(u)) return s.uriMap.clientToServer.get(u);

  const fsPath = fromFileUri(u);
  const baseRoot = String(s.workspace?.rootFsPath || '').trim();
  if (!fsPath || !baseRoot) return u;

  const normFs = normalizePathForCompare(fsPath);
  const normBase = normalizePathForCompare(baseRoot);
  if (!normFs.startsWith(normBase)) return u;

  const rel = path.relative(baseRoot, fsPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return u;

  const roots = workspaceFolderRootsFsPaths(s.workspace);
  let chosenFsPath = '';
  for (const root of roots) {
    const candidate = path.join(root, rel);
    try {
      // eslint-disable-next-line no-await-in-loop
      const st = await fs.promises.stat(candidate);
      if (st?.isFile?.() || st?.isFIFO?.() || st?.isSymbolicLink?.() || st) {
        chosenFsPath = candidate;
        break;
      }
    } catch {
      // ignore
    }
  }
  if (!chosenFsPath && roots[0]) chosenFsPath = path.join(roots[0], rel);
  if (!chosenFsPath) return u;

  const serverUri = toFileUri(chosenFsPath) || u;
  const map = ensureUriMap(s);
  map.clientToServer.set(u, serverUri);
  map.serverToClient.set(serverUri, u);
  return serverUri;
}

function mapServerToClient(state, serverUri) {
  const s = state;
  const u = String(serverUri || '');
  if (!s || !u) return u;
  if (!u.startsWith('file://')) return u;
  if (s.uriMap?.serverToClient?.has(u)) return s.uriMap.serverToClient.get(u);

  const fsPath = fromFileUri(u);
  const baseRoot = String(s.workspace?.rootFsPath || '').trim();
  if (!fsPath || !baseRoot) return u;

  const roots = workspaceFolderRootsFsPaths(s.workspace);
  const containing = pickContainingRoot(roots, fsPath);
  if (!containing) return u;

  const rel = path.relative(containing, fsPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return u;
  const clientFsPath = path.join(baseRoot, rel);
  const clientUri = toFileUri(clientFsPath) || u;

  const map = ensureUriMap(s);
  map.serverToClient.set(u, clientUri);
  map.clientToServer.set(clientUri, u);
  return clientUri;
}

module.exports = { mapClientToServer, mapServerToClient };

