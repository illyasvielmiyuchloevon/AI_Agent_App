"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDb = initDb;
exports.createSession = createSession;
exports.getSessions = getSessions;
exports.getSession = getSession;
exports.deleteSession = deleteSession;
exports.updateSessionMeta = updateSessionMeta;
exports.addLog = addLog;
exports.addMessage = addMessage;
exports.getMessages = getMessages;
exports.getLogs = getLogs;
exports.addDiff = addDiff;
exports.getDiffById = getDiffById;
exports.getDiffs = getDiffs;
exports.loadLlmConfig = loadLlmConfig;
exports.saveLlmConfig = saveLlmConfig;
const promises_1 = __importDefault(require("fs/promises"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const uuid_1 = require("uuid");
const DATA_FILE_NAME = "sessions.json";
const LLM_CONFIG_FILE = "llm_config.json";
function getDefaultState() {
    return {
        sessions: [],
        messages: {},
        logs: {},
        file_diffs: [],
        meta: { message_seq: 0, log_seq: 0, diff_seq: 0 }
    };
}
function getGlobalDataDir() {
    const isWin = process.platform === 'win32';
    const baseDir = isWin
        ? (process.env.APPDATA || process.env.LOCALAPPDATA || os_1.default.homedir())
        : os_1.default.homedir();
    return path_1.default.join(baseDir, ".aichat", "global");
}
async function ensureDataDir() {
    const dir = getGlobalDataDir();
    try {
        await promises_1.default.mkdir(dir, { recursive: true });
    }
    catch (e) {
        // ignore
    }
    return dir;
}
function getDataFilePath() {
    return path_1.default.join(getGlobalDataDir(), DATA_FILE_NAME);
}
async function loadState() {
    const filePath = getDataFilePath();
    try {
        const content = await promises_1.default.readFile(filePath, 'utf-8');
        const raw = JSON.parse(content);
        return normalizeState(raw);
    }
    catch (e) {
        const state = getDefaultState();
        await saveState(state);
        return state;
    }
}
function normalizeState(raw) {
    const base = getDefaultState();
    const legacyDiffs = Array.isArray(raw?.diffs) ? raw.diffs : [];
    const fileDiffs = Array.isArray(raw?.file_diffs) ? raw.file_diffs : legacyDiffs;
    const state = {
        ...base,
        ...raw,
        sessions: Array.isArray(raw?.sessions) ? raw.sessions : base.sessions,
        messages: raw?.messages && typeof raw.messages === 'object' ? raw.messages : base.messages,
        logs: raw?.logs && typeof raw.logs === 'object' ? raw.logs : base.logs,
        file_diffs: fileDiffs,
        meta: {
            message_seq: raw?.meta?.message_seq || 0,
            log_seq: raw?.meta?.log_seq || 0,
            diff_seq: raw?.meta?.diff_seq || 0
        }
    };
    return state;
}
async function saveState(state) {
    const dir = await ensureDataDir();
    const filePath = path_1.default.join(dir, DATA_FILE_NAME);
    const tempPath = `${filePath}.tmp`;
    const payload = JSON.stringify(state, null, 2);
    await promises_1.default.writeFile(tempPath, payload, 'utf-8');
    try {
        await promises_1.default.rename(tempPath, filePath);
    }
    catch (e) {
        console.warn(`[DB] rename failed (${e?.code || e?.message}), fallback to direct write`);
        try {
            await promises_1.default.writeFile(filePath, payload, 'utf-8');
        }
        catch (inner) {
            console.error(`[DB] direct write failed: ${inner?.message}`);
            throw inner;
        }
        finally {
            try {
                await promises_1.default.unlink(tempPath);
            }
            catch { }
        }
    }
}
// --- Public API ---
async function initDb() {
    await ensureDataDir();
    await loadState();
}
async function createSession(title = "New Chat", mode = "chat") {
    const state = await loadState();
    const now = new Date().toISOString();
    const session = {
        id: (0, uuid_1.v4)(),
        title,
        mode,
        created_at: now,
        updated_at: now
    };
    state.sessions.unshift(session);
    state.messages[session.id] = [];
    state.logs[session.id] = [];
    await saveState(state);
    return session;
}
async function getSessions() {
    const state = await loadState();
    return state.sessions.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}
async function getSession(sessionId) {
    const state = await loadState();
    return state.sessions.find(s => s.id === sessionId);
}
async function deleteSession(sessionId) {
    const state = await loadState();
    state.sessions = state.sessions.filter(s => s.id !== sessionId);
    delete state.messages[sessionId];
    delete state.logs[sessionId];
    await saveState(state);
}
async function updateSessionMeta(sessionId, updates) {
    const state = await loadState();
    const session = state.sessions.find(s => s.id === sessionId);
    if (!session)
        return null;
    if (updates.title !== undefined)
        session.title = updates.title;
    if (updates.mode !== undefined)
        session.mode = updates.mode;
    session.updated_at = new Date().toISOString();
    await saveState(state);
    return session;
}
async function addLog(sessionId, provider, method, url, request_body, response_body, status_code, success, parsed_success = false, parse_error) {
    const state = await loadState();
    const seq = (state.meta.log_seq || 0) + 1;
    state.meta.log_seq = seq;
    const entry = {
        id: seq,
        session_id: sessionId,
        provider,
        method,
        url,
        request_body,
        response_body,
        status_code,
        success,
        parsed_success,
        parse_error,
        created_at: new Date().toISOString()
    };
    if (!state.logs[sessionId]) {
        state.logs[sessionId] = [];
    }
    state.logs[sessionId].push(entry);
    try {
        const statusLabel = success ? 'ok' : 'fail';
        const detail = parse_error ? ` parse_error=${parse_error}` : '';
        console.log(`[DB][Log] ${provider}:${method} status=${status_code} success=${statusLabel}${detail}`);
    }
    catch (e) {
        // ignore debug log errors
    }
    await saveState(state);
}
async function addMessage(sessionId, message) {
    const state = await loadState();
    if (!state.messages[sessionId])
        state.messages[sessionId] = [];
    const seq = (state.meta.message_seq || 0) + 1;
    state.meta.message_seq = seq;
    const entry = {
        id: seq,
        session_id: sessionId,
        role: message.role,
        content: message.content ?? "",
        tool_calls: message.tool_calls,
        tool_call_id: message.tool_call_id,
        name: message.name,
        mode: message.mode,
        raw: message.raw,
        created_at: new Date().toISOString()
    };
    state.messages[sessionId].push(entry);
    const session = state.sessions.find(s => s.id === sessionId);
    if (session) {
        session.updated_at = entry.created_at;
    }
    await saveState(state);
    return entry;
}
async function getMessages(sessionId) {
    const state = await loadState();
    const messages = state.messages[sessionId] || [];
    return messages.map(msg => {
        let content = msg.content;
        try {
            content = typeof content === 'string' ? JSON.parse(content) : content;
        }
        catch (e) {
            // keep as string
        }
        const tool_calls = msg.tool_calls || undefined;
        return { ...msg, content, tool_calls };
    }).sort((a, b) => a.id - b.id);
}
async function getLogs(sessionId) {
    const state = await loadState();
    const logs = state.logs[sessionId] || [];
    return logs.sort((a, b) => b.id - a.id); // Descending by ID (newest first)
}
// --- Diff Snapshots ---
async function addDiff(entry) {
    const state = await loadState();
    if (!Array.isArray(state.file_diffs)) {
        state.file_diffs = [];
    }
    const seq = (state.meta.diff_seq || 0) + 1;
    state.meta.diff_seq = seq;
    const created_at = new Date().toISOString();
    const record = {
        id: seq,
        session_id: entry.session_id,
        path: entry.path,
        before: entry.before,
        after: entry.after,
        before_truncated: !!entry.before_truncated,
        after_truncated: !!entry.after_truncated,
        created_at
    };
    state.file_diffs.push(record);
    // keep legacy mirror for any older consumers
    state.diffs = state.file_diffs;
    await saveState(state);
    return record;
}
async function getDiffById(id) {
    const state = await loadState();
    return state.file_diffs.find(d => d.id === id) || null;
}
async function getDiffs(options) {
    const state = await loadState();
    const limit = options.limit && options.limit > 0 ? options.limit : 20;
    let list = state.file_diffs;
    if (options.session_id)
        list = list.filter(d => d.session_id === options.session_id);
    if (options.path)
        list = list.filter(d => d.path === options.path);
    return list.sort((a, b) => b.id - a.id).slice(0, limit);
}
// LLM Config
function getLlmConfigPath() {
    return path_1.default.join(getGlobalDataDir(), LLM_CONFIG_FILE);
}
async function loadLlmConfig() {
    const filePath = getLlmConfigPath();
    console.log(`[DB] Loading LLM config from: ${filePath}`);
    try {
        const content = await promises_1.default.readFile(filePath, 'utf-8');
        const config = JSON.parse(content);
        console.log(`[DB] Loaded config provider: ${config.provider}`);
        return config;
    }
    catch (e) {
        console.log(`[DB] Failed to load LLM config: ${e.message}`);
        return null;
    }
}
async function saveLlmConfig(config) {
    const dir = await ensureDataDir();
    const filePath = path_1.default.join(dir, LLM_CONFIG_FILE);
    console.log(`[DB] Saving LLM config to: ${filePath}`);
    console.log(`[DB] Saving config provider: ${config.provider}`);
    const tempPath = `${filePath}.tmp`;
    const payload = JSON.stringify(config, null, 2);
    await promises_1.default.writeFile(tempPath, payload, 'utf-8');
    try {
        await promises_1.default.rename(tempPath, filePath);
    }
    catch (e) {
        console.warn(`[DB] rename config failed (${e?.code || e?.message}), fallback to direct write`);
        try {
            await promises_1.default.writeFile(filePath, payload, 'utf-8');
        }
        catch (inner) {
            console.error(`[DB] direct write config failed: ${inner?.message}`);
            throw inner;
        }
        finally {
            try {
                await promises_1.default.unlink(tempPath);
            }
            catch { }
        }
    }
    return config;
}
