import assert from 'node:assert/strict';

import { URI } from 'monaco-editor/esm/vs/base/common/uri.js';
import { UndoRedoService } from 'monaco-editor/esm/vs/platform/undoRedo/common/undoRedoService.js';

class NoopDialogService {
  async confirm() {
    return { confirmed: true };
  }
}

class NoopNotificationService {
  error() {}
  warn() {}
  info() {}
}

const makeResourceElement = (resource, label) => ({
  type: 0,
  resource,
  label,
  confirmBeforeUndo: false,
});

const applyUndoLimitPatch = () => {
  if (globalThis.__AI_CHAT_MONACO_UNDO_REDO_PATCHED) return;
  globalThis.__AI_CHAT_MONACO_UNDO_REDO_PATCHED = true;

  const normalizeUndoRedoLimit = (value) => {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return 16;
    const n = Math.round(raw);
    return Math.max(8, Math.min(64, n));
  };

  const originalPushElement = UndoRedoService?.prototype?._pushElement;
  if (typeof originalPushElement !== 'function') return;

  UndoRedoService.prototype._pushElement = function patchedPushElement(element) {
    originalPushElement.call(this, element);

    const stacks = this?._editStacks;
    const strResources = element?.strResources;
    if (!stacks || typeof stacks.get !== 'function' || !Array.isArray(strResources)) return;

    for (const strResource of strResources) {
      const editStack = stacks.get(strResource);
      if (!editStack) continue;
      if (editStack._aiChatMaxPast == null) {
        editStack._aiChatMaxPast = normalizeUndoRedoLimit(globalThis.__AI_CHAT_MONACO_UNDO_REDO_LIMIT);
      }
      const maxPast = editStack._aiChatMaxPast;
      const past = editStack._past;
      if (!Array.isArray(past) || past.length <= maxPast) continue;

      past.splice(0, past.length - maxPast);
      editStack.versionId += 1;
    }
  };
};

const run = () => {
  globalThis.__AI_CHAT_MONACO_UNDO_REDO_LIMIT = 16;
  applyUndoLimitPatch();

  const service = new UndoRedoService(new NoopDialogService(), new NoopNotificationService());
  const a = URI.parse('file:///a.txt');
  const b = URI.parse('file:///b.txt');

  for (let i = 0; i < 20; i += 1) {
    service.pushElement(makeResourceElement(a, `a-${i}`));
  }
  let aElems = service.getElements(a);
  assert.equal(aElems.past.length, 16);
  assert.equal(aElems.past[0].label, 'a-4');
  assert.equal(aElems.past[15].label, 'a-19');

  globalThis.__AI_CHAT_MONACO_UNDO_REDO_LIMIT = 8;
  for (let i = 20; i < 26; i += 1) {
    service.pushElement(makeResourceElement(a, `a-${i}`));
  }
  aElems = service.getElements(a);
  assert.equal(aElems.past.length, 16);
  assert.equal(aElems.past[0].label, 'a-10');
  assert.equal(aElems.past[15].label, 'a-25');

  for (let i = 0; i < 20; i += 1) {
    service.pushElement(makeResourceElement(b, `b-${i}`));
  }
  const bElems = service.getElements(b);
  assert.equal(bElems.past.length, 8);
  assert.equal(bElems.past[0].label, 'b-12');
  assert.equal(bElems.past[7].label, 'b-19');
};

run();
console.log('verify_monaco_undo_redo: Passed');
