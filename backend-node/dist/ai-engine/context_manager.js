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
exports.AiContextManager = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const crypto_1 = __importDefault(require("crypto"));
const path_1 = __importDefault(require("path"));
const context_1 = require("../context");
const filesystem_1 = require("../tools/filesystem");
const db = __importStar(require("../db"));
function sha1(text) {
    return crypto_1.default.createHash('sha1').update(text).digest('hex');
}
function clip(text, maxChars) {
    if (!text)
        return '';
    if (text.length <= maxChars)
        return text;
    return `${text.slice(0, maxChars)}\n[...truncated...]`;
}
function isTsLike(languageId, filePath) {
    const ext = filePath ? path_1.default.extname(filePath).toLowerCase() : '';
    if (languageId) {
        const l = languageId.toLowerCase();
        if (['typescript', 'javascript', 'typescriptreact', 'javascriptreact'].includes(l))
            return true;
    }
    return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext);
}
function outlineTsLike(sourceText) {
    const exports = [];
    const decls = [];
    const uniqPush = (arr, value) => {
        if (!value)
            return;
        if (arr.includes(value))
            return;
        arr.push(value);
    };
    const exportRe = /^\s*export\s+(?:default\s+)?(const|function|class|interface|type)\s+([A-Za-z_$][\w$]*)/gm;
    const declRe = /^\s*(?:export\s+)?(const|function|class|interface|type)\s+([A-Za-z_$][\w$]*)/gm;
    let m = null;
    while ((m = exportRe.exec(sourceText))) {
        uniqPush(exports, m[2]);
        if (exports.length >= 40)
            break;
    }
    m = null;
    while ((m = declRe.exec(sourceText))) {
        uniqPush(decls, `${m[1]} ${m[2]}`);
        if (decls.length >= 40)
            break;
    }
    return { exports, decls };
}
class AiContextManager {
    fileCache = new Map();
    projectCache = new Map();
    sessionCache = new Map();
    maxCacheEntries = 64;
    async buildSystemContext(editor, opts = {}) {
        const maxChars = opts.maxChars ?? 6000;
        const parts = [];
        const root = (() => {
            try {
                return (0, context_1.getWorkspaceRoot)();
            }
            catch {
                return '';
            }
        })();
        if (editor?.filePath) {
            parts.push(`Active file: ${editor.filePath}`);
            if (editor.languageId)
                parts.push(`Language: ${editor.languageId}`);
            if (editor.selection) {
                const s = editor.selection;
                parts.push(`Selection: ${s.startLine}:${s.startColumn}-${s.endLine}:${s.endColumn}`);
            }
            if (editor.selectedText && editor.selectedText.trim().length > 0) {
                parts.push(`Selected text:\n${clip(editor.selectedText, 1600)}`);
            }
            const outline = await this.getFileOutline(editor, root);
            if (outline)
                parts.push(outline);
        }
        const project = await this.getProjectSummary(root);
        if (project)
            parts.push(project);
        return clip(parts.join('\n\n'), maxChars);
    }
    async buildSessionSummary(sessionId, llm, model) {
        if (!sessionId)
            return '';
        const messages = await db.getMessages(sessionId);
        if (messages.length <= 20)
            return '';
        const older = messages.slice(0, Math.max(0, messages.length - 20));
        const key = `${older.length}:${older[older.length - 1]?.id || 0}`;
        const cached = this.sessionCache.get(sessionId);
        if (cached && cached.key === key)
            return cached.summary;
        const lines = older.map(m => {
            const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
            return `${m.role}: ${content}`;
        });
        const prompt = clip(lines.join('\n'), 12000);
        const system = 'Summarize the conversation history for an IDE AI assistant. Keep concrete requirements, decisions, file paths, commands, and unresolved questions. Be concise.';
        const msgs = [
            { role: 'system', content: system },
            { role: 'user', content: prompt }
        ];
        try {
            const resp = await llm.chatCompletion(msgs, undefined, sessionId, {
                model: model,
                max_tokens: 512,
                temperature: 0.2
            });
            const summary = typeof resp.content === 'string' ? resp.content : '';
            this.sessionCache.set(sessionId, { key, summary, updatedAt: Date.now() });
            this.evict();
            return summary;
        }
        catch {
            return '';
        }
    }
    async getFileOutline(editor, root) {
        const filePath = editor.filePath;
        if (!filePath)
            return '';
        let content = editor.visibleText;
        if (!content && root) {
            try {
                const { fullPath } = await (0, filesystem_1.resolveWorkspaceFilePath)(root, filePath, { mustExist: true });
                content = await promises_1.default.readFile(fullPath, 'utf-8');
            }
            catch {
                content = '';
            }
        }
        if (!content)
            return '';
        const key = `${root}:${filePath}`;
        const h = sha1(content);
        const cached = this.fileCache.get(key);
        if (cached && cached.hash === h)
            return cached.outline;
        let outline = '';
        if (isTsLike(editor.languageId, filePath)) {
            try {
                const o = outlineTsLike(content);
                const lines = [];
                if (o.exports.length > 0)
                    lines.push(`Exports: ${o.exports.join(', ')}`);
                if (o.decls.length > 0)
                    lines.push(`Top-level: ${o.decls.join(', ')}`);
                outline = lines.length > 0 ? `File outline:\n${lines.join('\n')}` : '';
            }
            catch {
                outline = '';
            }
        }
        this.fileCache.set(key, { hash: h, outline, updatedAt: Date.now() });
        this.evict();
        return outline;
    }
    async getProjectSummary(root) {
        if (!root)
            return '';
        const key = root;
        let struct;
        try {
            struct = await (0, filesystem_1.getProjectStructure)(root);
        }
        catch {
            struct = null;
        }
        const raw = struct ? JSON.stringify(struct).slice(0, 20000) : '';
        const h = sha1(raw);
        const cached = this.projectCache.get(key);
        if (cached && cached.hash === h)
            return cached.summary;
        const summary = struct ? `Project structure snapshot:\n${clip(raw, 5000)}` : '';
        this.projectCache.set(key, { hash: h, summary, updatedAt: Date.now() });
        this.evict();
        return summary;
    }
    evict() {
        const evictMap = (m) => {
            if (m.size <= this.maxCacheEntries)
                return;
            const entries = Array.from(m.entries()).sort((a, b) => a[1].updatedAt - b[1].updatedAt);
            const remove = entries.slice(0, Math.max(0, m.size - this.maxCacheEntries));
            remove.forEach(([k]) => m.delete(k));
        };
        evictMap(this.fileCache);
        evictMap(this.projectCache);
        evictMap(this.sessionCache);
    }
}
exports.AiContextManager = AiContextManager;
