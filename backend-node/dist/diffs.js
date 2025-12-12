"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIFF_CHAR_LIMIT = void 0;
exports.takeSnapshot = takeSnapshot;
exports.buildDiffPayload = buildDiffPayload;
exports.mapEntryToPayload = mapEntryToPayload;
exports.persistDiffSnapshot = persistDiffSnapshot;
exports.persistDiffSafely = persistDiffSafely;
exports.captureAndPersistDiff = captureAndPersistDiff;
exports.emptySnapshot = emptySnapshot;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const context_1 = require("./context");
const db = __importStar(require("./db"));
exports.DIFF_CHAR_LIMIT = 120_000;
const EMPTY_SNAPSHOT = { content: '', truncated: false };
function normalizeContent(raw) {
    if (raw.length <= exports.DIFF_CHAR_LIMIT) {
        return { content: raw, truncated: false };
    }
    return { content: raw.slice(0, exports.DIFF_CHAR_LIMIT), truncated: true };
}
async function takeSnapshot(relPath) {
    try {
        const root = (0, context_1.getWorkspaceRoot)();
        const full = path_1.default.resolve(root, relPath);
        if (!full.startsWith(root)) {
            return EMPTY_SNAPSHOT;
        }
        const data = await promises_1.default.readFile(full, 'utf-8');
        return normalizeContent(data);
    }
    catch {
        return EMPTY_SNAPSHOT;
    }
}
function buildDiffPayload(path, before, after) {
    return {
        path,
        before: before.content,
        after: after.content,
        before_truncated: before.truncated,
        after_truncated: after.truncated
    };
}
function mapEntryToPayload(entry) {
    return {
        id: entry.id,
        session_id: entry.session_id,
        path: entry.path,
        before: entry.before,
        after: entry.after,
        before_truncated: entry.before_truncated,
        after_truncated: entry.after_truncated,
        created_at: entry.created_at
    };
}
async function persistDiffSnapshot(options) {
    const saved = await db.addDiff({
        session_id: options.sessionId || '',
        path: options.path,
        before: options.before.content,
        after: options.after.content,
        before_truncated: options.before.truncated,
        after_truncated: options.after.truncated
    });
    return mapEntryToPayload(saved);
}
async function persistDiffSafely(options) {
    try {
        return await persistDiffSnapshot(options);
    }
    catch (e) {
        console.warn(`[Diff] Failed to persist diff for ${options.path}: ${e?.message}`);
        // Still return a payload so callers can surface data in responses
        return buildDiffPayload(options.path, options.before, options.after);
    }
}
async function captureAndPersistDiff(options) {
    const before = await takeSnapshot(options.beforePath || options.path);
    const after = await takeSnapshot(options.afterPath || options.path);
    return persistDiffSafely({
        sessionId: options.sessionId,
        path: options.path,
        before,
        after
    });
}
function emptySnapshot() {
    return { ...EMPTY_SNAPSHOT };
}
