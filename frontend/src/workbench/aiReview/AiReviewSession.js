const DEFAULT_CONTEXT_LINES = 2;

const clampLine = (line, maxLine, fallback) => {
  if (!Number.isFinite(line)) return fallback;
  if (line < 1) return 1;
  if (line > maxLine) return maxLine;
  return line;
};

const buildLineRange = (model, monaco, startLine, endLine) => {
  const lineCount = model.getLineCount();
  const start = clampLine(startLine, lineCount, 1);
  const end = clampLine(endLine, lineCount, start);
  if (end < start) return null;
  const endColumn = model.getLineMaxColumn(end);
  return new monaco.Range(start, 1, end, endColumn);
};

const buildAnchorRange = (model, monaco, lineNumber) => {
  const lineCount = model.getLineCount();
  const line = clampLine(lineNumber, lineCount, 1);
  return new monaco.Range(line, 1, line, 1);
};

const buildContext = (model, monaco, startLine, endLine, contextLines = DEFAULT_CONTEXT_LINES) => {
  const lineCount = model.getLineCount();
  const start = clampLine(startLine, lineCount, 1);
  const end = clampLine(endLine, lineCount, start);
  const beforeStart = Math.max(1, start - contextLines);
  const beforeEnd = Math.max(1, start - 1);
  const afterStart = Math.min(lineCount, end + 1);
  const afterEnd = Math.min(lineCount, end + contextLines);
  const before = beforeEnd >= beforeStart
    ? model.getValueInRange(new monaco.Range(beforeStart, 1, beforeEnd, model.getLineMaxColumn(beforeEnd)))
    : '';
  const after = afterEnd >= afterStart
    ? model.getValueInRange(new monaco.Range(afterStart, 1, afterEnd, model.getLineMaxColumn(afterEnd)))
    : '';
  return { before, after };
};

const computeBlockId = (() => {
  let seq = 0;
  return () => `ai-review-block-${seq++}`;
})();

const getModelText = (model, range) => {
  if (!range) return '';
  return model.getValueInRange(range) || '';
};

const normalizeDiffRange = (model, monaco, startLine, endLine) => {
  if (!Number.isFinite(startLine) || !Number.isFinite(endLine)) return null;
  if (endLine < startLine) return null;
  return buildLineRange(model, monaco, startLine, endLine);
};

const findUniqueMatchRange = (model, text) => {
  if (!text) return null;
  const matches = model.findMatches(text, false, false, false, null, true);
  if (matches && matches.length === 1) {
    return matches[0].range;
  }
  return null;
};

class AiReviewBlockWidget {
  constructor(session, block) {
    this.session = session;
    this.block = block;
    this.domNode = document.createElement('div');
    this.domNode.className = 'ai-review-block-widget';
    const revertBtn = document.createElement('button');
    revertBtn.className = 'ghost-btn ai-review-btn';
    revertBtn.type = 'button';
    revertBtn.textContent = '撤销';
    revertBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      session.revertBlock(block.id);
    });
    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'ghost-btn ai-review-btn';
    acceptBtn.type = 'button';
    acceptBtn.textContent = '保留';
    acceptBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      session.acceptBlock(block.id);
    });
    this.domNode.appendChild(revertBtn);
    this.domNode.appendChild(acceptBtn);
  }

  getId() {
    return `${this.block.id}-widget`;
  }

  getDomNode() {
    return this.domNode;
  }

  getPosition() {
    const range = this.session.getBlockRange(this.block);
    if (!range) return null;
    return {
      position: { lineNumber: range.startLineNumber, column: 1 },
      preference: [this.session.monaco.editor.ContentWidgetPositionPreference.ABOVE],
    };
  }
}

export class AiReviewSession {
  constructor({ editor, monaco, fileUri, baselineSnapshot, blocks, onUpdate, onDispose, source }) {
    this.editor = editor;
    this.monaco = monaco;
    this.fileUri = fileUri;
    this.modelUri = editor.getModel()?.uri?.toString() || '';
    this.baselineSnapshot = baselineSnapshot;
    this.blocks = Array.isArray(blocks) ? blocks : [];
    this.source = source || null;
    this.onUpdate = typeof onUpdate === 'function' ? onUpdate : () => {};
    this.onDispose = typeof onDispose === 'function' ? onDispose : () => {};
    this.disposables = [];
    this.blockWidgets = new Map();
    this.blockDeleteZones = new Map();

    this.applyDecorations();
    this.applyWidgets();
    this.applyDeleteZones();

    const model = this.editor.getModel();
    if (model) {
      this.disposables.push(this.editor.onDidChangeModelContent(() => {
        this.refreshAnchors();
      }));
    }
  }

  static createFromDiff({ editor, monaco, fileUri, baselineSnapshot, onUpdate, onDispose, source }) {
    const model = editor.getModel();
    if (!model) return null;
    const originalModel = monaco.editor.createModel(baselineSnapshot || '', model.getLanguageId?.() || undefined);
    const modifiedModel = monaco.editor.createModel(model.getValue() || '', model.getLanguageId?.() || undefined);
    const diff = monaco.editor.computeDiff(originalModel, modifiedModel, {
      ignoreTrimWhitespace: false,
      maxComputationTime: 0,
    });
    const changes = Array.isArray(diff?.changes) ? diff.changes : [];
    const blocks = [];

    for (const change of changes) {
      const originalRange = normalizeDiffRange(originalModel, monaco, change.originalStartLineNumber, change.originalEndLineNumber);
      const modifiedRange = normalizeDiffRange(modifiedModel, monaco, change.modifiedStartLineNumber, change.modifiedEndLineNumber);
      const originalText = getModelText(originalModel, originalRange);
      const modifiedText = getModelText(modifiedModel, modifiedRange);

      if (!originalText && !modifiedText) continue;

      const anchorLine = change.modifiedStartLineNumber || change.originalStartLineNumber || 1;
      const anchorRange = modifiedRange || buildAnchorRange(modifiedModel, monaco, anchorLine);
      const contextSource = modifiedRange ? modifiedModel : originalModel;
      const context = buildContext(
        contextSource,
        monaco,
        modifiedRange?.startLineNumber || change.originalStartLineNumber,
        modifiedRange?.endLineNumber || change.originalEndLineNumber
      );

      blocks.push({
        id: computeBlockId(),
        status: 'pending',
        originalText,
        modifiedText,
        originalRange,
        modifiedRange: anchorRange,
        anchor: {
          decorationId: null,
          lastKnownRange: anchorRange,
          versionIdAtCreate: model.getVersionId?.() || 0,
        },
        context,
      });
    }

    originalModel.dispose();
    modifiedModel.dispose();

    if (!blocks.length) return null;
    return new AiReviewSession({ editor, monaco, fileUri, baselineSnapshot, blocks, onUpdate, onDispose, source });
  }

  getPendingBlocks() {
    return this.blocks.filter((b) => b.status === 'pending');
  }

  isActiveModel() {
    const model = this.editor.getModel();
    if (!model) return false;
    const uri = model.uri?.toString?.() || '';
    if (!this.modelUri) return true;
    return uri === this.modelUri;
  }

  getBlockById(id) {
    return this.blocks.find((b) => b.id === id) || null;
  }

  getBlockRange(block) {
    if (!this.isActiveModel()) return null;
    const model = this.editor.getModel();
    if (!model || !block) return null;
    const decorationId = block.anchor?.decorationId;
    if (decorationId) {
      const range = model.getDecorationRange(decorationId);
      if (range) return range;
    }
    return block.anchor?.lastKnownRange || null;
  }

  revealBlock(block) {
    const range = this.getBlockRange(block);
    if (!range) return;
    this.editor.revealRangeInCenter(range);
    this.editor.setPosition({ lineNumber: range.startLineNumber, column: 1 });
  }

  applyDecorations() {
    const model = this.editor.getModel();
    if (!model) return;
    const nextDecorations = [];
    for (const block of this.blocks) {
      const range = block.modifiedRange || buildAnchorRange(model, this.monaco, 1);
      const isDelete = !!block.originalText && !block.modifiedText;
      const options = isDelete
        ? {
            isWholeLine: true,
            className: 'ai-diff-del-marker',
            glyphMarginClassName: 'ai-diff-del-gutter',
          }
        : {
            isWholeLine: true,
            className: 'ai-diff-add',
          };
      nextDecorations.push({ range, options });
    }
    const ids = this.editor.deltaDecorations([], nextDecorations);
    ids.forEach((id, idx) => {
      this.blocks[idx].anchor.decorationId = id;
    });
  }

  applyWidgets() {
    for (const block of this.blocks) {
      if (block.status !== 'pending') continue;
      const widget = new AiReviewBlockWidget(this, block);
      this.editor.addContentWidget(widget);
      this.blockWidgets.set(block.id, widget);
    }
  }

  applyDeleteZones() {
    if (!this.isActiveModel()) return;
    const model = this.editor.getModel();
    if (!model) return;
    this.editor.changeViewZones((accessor) => {
      for (const block of this.blocks) {
        if (block.status !== 'pending') continue;
        if (!block.originalText || block.modifiedText) continue;
        const range = this.getBlockRange(block) || buildAnchorRange(model, this.monaco, 1);
        const domNode = document.createElement('div');
        domNode.className = 'ai-diff-delete-block';
        domNode.textContent = block.originalText;
        const lines = block.originalText.split('\n').length;
        const zoneId = accessor.addZone({
          afterLineNumber: Math.max(1, range.startLineNumber - 1),
          heightInLines: Math.max(1, lines),
          domNode,
        });
        this.blockDeleteZones.set(block.id, zoneId);
      }
    });
  }

  refreshAnchors() {
    if (!this.isActiveModel()) return;
    const model = this.editor.getModel();
    if (!model) return;
    let needsZoneRefresh = false;
    for (const block of this.blocks) {
      if (block.status !== 'pending') continue;
      const decorationId = block.anchor?.decorationId;
      let range = decorationId ? model.getDecorationRange(decorationId) : null;
      if (!range) {
        const matchRange = findUniqueMatchRange(model, block.modifiedText) || findUniqueMatchRange(model, block.originalText);
        if (matchRange) {
          const isDelete = !!block.originalText && !block.modifiedText;
          const options = isDelete
            ? { isWholeLine: true, className: 'ai-diff-del-marker', glyphMarginClassName: 'ai-diff-del-gutter' }
            : { isWholeLine: true, className: 'ai-diff-add' };
          const newId = this.editor.deltaDecorations([decorationId].filter(Boolean), [{
            range: matchRange,
            options,
          }]);
          block.anchor.decorationId = newId[0];
          range = matchRange;
          needsZoneRefresh = true;
        }
      }
      block.anchor.lastKnownRange = range || block.anchor.lastKnownRange;
      const widget = this.blockWidgets.get(block.id);
      if (widget) this.editor.layoutContentWidget(widget);
    }
    if (needsZoneRefresh) {
      this.refreshDeleteZones();
    }
  }

  refreshDeleteZones() {
    if (!this.blockDeleteZones.size) return;
    this.editor.changeViewZones((accessor) => {
      for (const zoneId of this.blockDeleteZones.values()) {
        accessor.removeZone(zoneId);
      }
      this.blockDeleteZones.clear();
    });
    this.applyDeleteZones();
  }

  acceptAll() {
    for (const block of this.blocks) {
      block.status = 'accepted';
    }
    this.dispose({ keepText: true });
  }

  revertAll() {
    const model = this.editor.getModel();
    if (!model) return;
    const lineCount = model.getLineCount();
    const endCol = model.getLineMaxColumn(lineCount);
    const fullRange = new this.monaco.Range(1, 1, lineCount, endCol);
    this.editor.pushUndoStop();
    this.editor.executeEdits('ai-review', [{ range: fullRange, text: this.baselineSnapshot, forceMoveMarkers: true }]);
    this.editor.pushUndoStop();
    for (const block of this.blocks) {
      block.status = 'rejected';
    }
    this.dispose({ keepText: true });
  }

  acceptBlock(blockId) {
    const block = this.getBlockById(blockId);
    if (!block || block.status !== 'pending') return;
    block.status = 'accepted';
    this.removeBlockArtifacts(block);
    this.onUpdate();
  }

  revertBlock(blockId) {
    const block = this.getBlockById(blockId);
    if (!block || block.status !== 'pending') return;
    const model = this.editor.getModel();
    if (!model) return;
    const range = this.getBlockRange(block);
    if (!range) return;
    const text = block.originalText || '';
    this.editor.pushUndoStop();
    this.editor.executeEdits('ai-review', [{ range, text, forceMoveMarkers: true }]);
    this.editor.pushUndoStop();
    block.status = 'rejected';
    this.removeBlockArtifacts(block);
    this.onUpdate();
  }

  removeBlockArtifacts(block) {
    const decorationId = block.anchor?.decorationId;
    if (decorationId) {
      this.editor.deltaDecorations([decorationId], []);
      block.anchor.decorationId = null;
    }
    const widget = this.blockWidgets.get(block.id);
    if (widget) {
      this.editor.removeContentWidget(widget);
      this.blockWidgets.delete(block.id);
    }
    const zoneId = this.blockDeleteZones.get(block.id);
    if (zoneId != null) {
      this.editor.changeViewZones((accessor) => {
        accessor.removeZone(zoneId);
      });
      this.blockDeleteZones.delete(block.id);
    }
  }

  dispose({ keepText = false } = {}) {
    for (const block of this.blocks) {
      if (block.status === 'pending' && !keepText) {
        block.status = 'accepted';
      }
      this.removeBlockArtifacts(block);
    }
    for (const disposable of this.disposables) {
      if (disposable && typeof disposable.dispose === 'function') {
        disposable.dispose();
      }
    }
    this.disposables = [];
    this.onDispose();
  }
}
