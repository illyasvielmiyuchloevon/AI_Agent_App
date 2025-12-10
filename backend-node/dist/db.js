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
exports.loadLlmConfig = loadLlmConfig;
exports.saveLlmConfig = saveLlmConfig;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const uuid_1 = require("uuid");
const context_1 = require("./context");
const DATA_FILE_NAME = "sessions.json";
const LLM_CONFIG_FILE = "llm_config.json";
function getDefaultState() {
    return {
        sessions: [],
        messages: {},
        logs: {},
        meta: { message_seq: 0, log_seq: 0 }
    };
}
function getDataDir(create = false) {
    const root = (0, context_1.getWorkspaceRoot)();
    const dataDir = path_1.default.join(root, ".aichat");
    // We rely on the caller or init to ensure existence usually, but for safe access:
    // fs.mkdir is async, so this helper is a bit tricky if used synchronously in path generation.
    // But we just return string here.
    return dataDir;
}
async function ensureDataDir() {
    const dir = getDataDir();
    try {
        await promises_1.default.mkdir(dir, { recursive: true });
    }
    catch (e) {
        // ignore
    }
    return dir;
}
function getDataFilePath() {
    return path_1.default.join(getDataDir(), DATA_FILE_NAME);
}
async function loadState() {
    const filePath = getDataFilePath();
    try {
        const content = await promises_1.default.readFile(filePath, 'utf-8');
        const raw = JSON.parse(content);
        return { ...getDefaultState(), ...raw };
    }
    catch (e) {
        const state = getDefaultState();
        await saveState(state);
        return state;
    }
}
async function saveState(state) {
    const dir = await ensureDataDir();
    const filePath = path_1.default.join(dir, DATA_FILE_NAME);
    const tempPath = `${filePath}.tmp`;
    await promises_1.default.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf-8');
    await promises_1.default.rename(tempPath, filePath);
}
// --- Public API ---
async function initDb() {
    try {
        await ensureDataDir();
        await loadState();
    }
    catch (e) {
        // ignore workspace error
    }
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
// LLM Config
function getLlmConfigPath() {
    return path_1.default.join(getDataDir(), LLM_CONFIG_FILE);
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
    await promises_1.default.writeFile(tempPath, JSON.stringify(config, null, 2), 'utf-8');
    await promises_1.default.rename(tempPath, filePath);
    return config;
}
