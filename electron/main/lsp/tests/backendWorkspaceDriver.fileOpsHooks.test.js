const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const importBackendWorkspaceDriver = async () => {
  const modPath = path.join(__dirname, '../../../../frontend/src/utils/backendWorkspaceDriver.js');
  const url = pathToFileURL(modPath).href;
  return await import(url);
};

test('BackendWorkspaceDriver: calls fileOpsHooks for create/delete/rename', async () => {
  const { BackendWorkspaceDriver } = await importBackendWorkspaceDriver();

  const events = [];
  const prevFetch = global.fetch;

  let nextReadExists = false;
  global.fetch = async (url, options = {}) => {
    const u = String(url || '');
    const method = String(options?.method || 'GET').toUpperCase();
    events.push({ kind: 'fetch', method, url: u });

    if (u.startsWith('/api/workspace/read')) {
      return {
        ok: true,
        async json() {
          return { exists: nextReadExists, content: '', truncated: false };
        },
      };
    }

    if (u === '/api/workspace/write' || u === '/api/workspace/mkdir' || u === '/api/workspace/delete' || u === '/api/workspace/rename') {
      return {
        ok: true,
        async json() {
          return {};
        },
      };
    }

    return {
      ok: false,
      statusText: 'not found',
      async json() {
        return { detail: 'not found' };
      },
    };
  };

  try {
    const driver = await BackendWorkspaceDriver.fromFsPath('D:\\workspace');
    driver.setFileOperationsHooks({
      willCreateFiles: async (paths) => events.push({ kind: 'hook', name: 'willCreateFiles', paths }),
      didCreateFiles: async (paths) => events.push({ kind: 'hook', name: 'didCreateFiles', paths }),
      willDeleteFiles: async (paths) => events.push({ kind: 'hook', name: 'willDeleteFiles', paths }),
      didDeleteFiles: async (paths) => events.push({ kind: 'hook', name: 'didDeleteFiles', paths }),
      willRenameFiles: async (pairs) => events.push({ kind: 'hook', name: 'willRenameFiles', pairs }),
      didRenameFiles: async (pairs) => events.push({ kind: 'hook', name: 'didRenameFiles', pairs }),
    });

    nextReadExists = false;
    events.length = 0;
    await driver.writeFile('a.txt', 'x', { createDirectories: true });
    assert.equal(events.some((e) => e.kind === 'hook' && e.name === 'willCreateFiles'), true);
    assert.equal(events.some((e) => e.kind === 'hook' && e.name === 'didCreateFiles'), true);
    assert.ok(
      events.findIndex((e) => e.kind === 'hook' && e.name === 'willCreateFiles')
        < events.findIndex((e) => e.kind === 'fetch' && e.url === '/api/workspace/write'),
    );
    assert.ok(
      events.findIndex((e) => e.kind === 'fetch' && e.url === '/api/workspace/write')
        < events.findIndex((e) => e.kind === 'hook' && e.name === 'didCreateFiles'),
    );

    nextReadExists = false;
    events.length = 0;
    await driver.writeFile('b.txt', 'y', { createDirectories: true, notifyCreate: false });
    assert.equal(events.some((e) => e.kind === 'hook' && e.name === 'willCreateFiles'), false);
    assert.equal(events.some((e) => e.kind === 'hook' && e.name === 'didCreateFiles'), false);
    assert.equal(events.some((e) => e.kind === 'fetch' && e.url === '/api/workspace/read'), false);
    assert.equal(events.some((e) => e.kind === 'fetch' && e.url === '/api/workspace/write'), true);

    events.length = 0;
    await driver.deletePath('a.txt');
    assert.ok(
      events.findIndex((e) => e.kind === 'hook' && e.name === 'willDeleteFiles')
        < events.findIndex((e) => e.kind === 'fetch' && e.url === '/api/workspace/delete'),
    );
    assert.ok(
      events.findIndex((e) => e.kind === 'fetch' && e.url === '/api/workspace/delete')
        < events.findIndex((e) => e.kind === 'hook' && e.name === 'didDeleteFiles'),
    );

    events.length = 0;
    await driver.renamePath('a.txt', 'c.txt');
    assert.ok(
      events.findIndex((e) => e.kind === 'hook' && e.name === 'willRenameFiles')
        < events.findIndex((e) => e.kind === 'fetch' && e.url === '/api/workspace/rename'),
    );
    assert.ok(
      events.findIndex((e) => e.kind === 'fetch' && e.url === '/api/workspace/rename')
        < events.findIndex((e) => e.kind === 'hook' && e.name === 'didRenameFiles'),
    );
  } finally {
    global.fetch = prevFetch;
  }
});

