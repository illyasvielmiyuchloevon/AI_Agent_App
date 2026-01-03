const path = require('path');
const { toFileUri, fromFileUri } = require('./uri');

function serverKey({ workspaceId, rootKey, languageId, serverConfigId }) {
  const wid = String(workspaceId);
  const root = String(rootKey || '');
  const lang = String(languageId);
  const cfg = String(serverConfigId);
  return `${wid}::${root}::${lang}::${cfg}`;
}

function normalizeWorkspace(workspace) {
  const rootUri = String(workspace?.rootUri || '');
  const workspaceId = String(workspace?.workspaceId || '');
  const folders = Array.isArray(workspace?.folders) ? workspace.folders : [];
  let rootFsPath = String(workspace?.rootFsPath || '').trim();
  if (!rootFsPath && rootUri && rootUri.startsWith('file://')) {
    rootFsPath = fromFileUri(rootUri);
  }
  return { workspaceId, rootUri, folders, rootFsPath };
}

function inferWorkspaceFromRootFsPath({ workspaceId, rootFsPath }) {
  const p = String(rootFsPath || '').trim();
  if (!p) return { workspaceId: String(workspaceId || ''), rootUri: '', folders: [] };
  const uri = toFileUri(p);
  return {
    workspaceId: String(workspaceId || ''),
    rootUri: uri,
    folders: [{ name: path.basename(p), uri }],
    rootFsPath: p,
  };
}

module.exports = {
  serverKey,
  normalizeWorkspace,
  inferWorkspaceFromRootFsPath,
};

