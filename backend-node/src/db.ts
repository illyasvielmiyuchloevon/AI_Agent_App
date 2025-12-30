import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const DATA_FILE_NAME = "sessions.json";
const LLM_CONFIG_FILE = "llm_config.json";

interface Session {
    id: string;
    title: string;
    mode: string;
    created_at: string;
    updated_at: string;
}

interface Message {
    id: number;
    session_id: string;
    role: string;
    content: any;
    tool_calls?: any;
    tool_call_id?: string;
    name?: string;
    mode?: string;
    raw?: any;
    created_at: string;
}

interface DBState {
    sessions: Session[];
    messages: Record<string, Message[]>;
    logs: Record<string, any[]>;
    file_diffs: DiffEntry[];
    meta: {
        message_seq: number;
        log_seq: number;
        diff_seq: number;
    };
}

export interface DiffEntry {
    id: number;
    session_id: string;
    path: string;
    before: string;
    after: string;
    before_truncated: boolean;
    after_truncated: boolean;
    created_at: string;
}

function getDefaultState(): DBState {
    return {
        sessions: [],
        messages: {},
        logs: {},
        file_diffs: [],
        meta: { message_seq: 0, log_seq: 0, diff_seq: 0 }
    };
}

function getGlobalDataDir(): string {
    const isWin = process.platform === 'win32';
    const baseDir = isWin
        ? (process.env.APPDATA || process.env.LOCALAPPDATA || os.homedir())
        : os.homedir();
    return path.join(baseDir, ".aichat", "global");
}

async function ensureDataDir(): Promise<string> {
    const dir = getGlobalDataDir();
    try {
        await fs.mkdir(dir, { recursive: true });
    } catch (e) {
        // ignore
    }
    return dir;
}

function getDataFilePath(): string {
    return path.join(getGlobalDataDir(), DATA_FILE_NAME);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function safeWriteJsonFile(filePath: string, payload: string, { tag = 'DB' } = {}): Promise<void> {
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, payload, 'utf-8');

    const tryRename = async () => {
        const isWin = process.platform === 'win32';
        const retryableCodes = new Set(['EPERM', 'EACCES', 'EBUSY']);
        const maxAttempts = isWin ? 6 : 1;

        let lastErr: any = null;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            try {
                await fs.rename(tempPath, filePath);
                return { ok: true as const, err: null };
            } catch (e: any) {
                lastErr = e;
                const code = String(e?.code || '');

                if (isWin && (code === 'EEXIST' || retryableCodes.has(code))) {
                    try {
                        await fs.unlink(filePath);
                    } catch (rmErr: any) {
                        if (String(rmErr?.code || '') !== 'ENOENT') {
                            // ignore and retry rename
                        }
                    }
                    await sleep(20 * (attempt + 1));
                    continue;
                }

                if (code === 'EXDEV') break;
                break;
            }
        }
        return { ok: false as const, err: lastErr };
    };

    try {
        const renamed = await tryRename();
        if (renamed.ok) return;

        try {
            await fs.copyFile(tempPath, filePath);
            return;
        } catch (copyErr: any) {
            const code = renamed.err?.code || renamed.err?.message || copyErr?.code || copyErr?.message;
            console.warn(`[${tag}] atomic replace failed (${code}), fallback to direct write`);
            await fs.writeFile(filePath, payload, 'utf-8');
        }
    } finally {
        try { await fs.unlink(tempPath); } catch {}
    }
}

async function loadState(): Promise<DBState> {
    const filePath = getDataFilePath();
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const raw = JSON.parse(content);
        return normalizeState(raw);
    } catch (e) {
        const state = getDefaultState();
        await saveState(state);
        return state;
    }
}

function normalizeState(raw: any): DBState {
    const base = getDefaultState();
    const legacyDiffs = Array.isArray(raw?.diffs) ? raw.diffs : [];
    const fileDiffs = Array.isArray(raw?.file_diffs) ? raw.file_diffs : legacyDiffs;
    const state: DBState = {
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

async function saveState(state: DBState): Promise<void> {
    const dir = await ensureDataDir();
    const filePath = path.join(dir, DATA_FILE_NAME);
    const payload = JSON.stringify(state, null, 2);
    await safeWriteJsonFile(filePath, payload, { tag: 'DB' });
}

// --- Public API ---

export async function initDb(): Promise<void> {
    await ensureDataDir();
    await loadState();
}

export async function createSession(title = "New Chat", mode = "chat"): Promise<Session> {
    const state = await loadState();
    const now = new Date().toISOString();
    const session: Session = {
        id: uuidv4(),
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

export async function getSessions(): Promise<Session[]> {
    const state = await loadState();
    return state.sessions.sort((a, b) => 
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
}

export async function getSession(sessionId: string): Promise<Session | undefined> {
    const state = await loadState();
    return state.sessions.find(s => s.id === sessionId);
}

export async function deleteSession(sessionId: string): Promise<void> {
    const state = await loadState();
    state.sessions = state.sessions.filter(s => s.id !== sessionId);
    delete state.messages[sessionId];
    delete state.logs[sessionId];
    await saveState(state);
}

export async function updateSessionMeta(sessionId: string, updates: { title?: string, mode?: string }): Promise<Session | null> {
    const state = await loadState();
    const session = state.sessions.find(s => s.id === sessionId);
    if (!session) return null;

    if (updates.title !== undefined) session.title = updates.title;
    if (updates.mode !== undefined) session.mode = updates.mode;
    session.updated_at = new Date().toISOString();
    
    await saveState(state);
    return session;
}

export async function addLog(
    sessionId: string,
    provider: string,
    method: string,
    url: string,
    request_body: any,
    response_body: any,
    status_code: number,
    success: boolean,
    parsed_success: boolean = false,
    parse_error?: string
): Promise<void> {
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
    } catch (e) {
        // ignore debug log errors
    }

    await saveState(state);
}

export async function addMessage(sessionId: string, message: Partial<Message> & { role: string, content?: any }): Promise<Message> {
    const state = await loadState();
    if (!state.messages[sessionId]) state.messages[sessionId] = [];
    
    const seq = (state.meta.message_seq || 0) + 1;
    state.meta.message_seq = seq;
    
    const entry: Message = {
        id: seq,
        session_id: sessionId,
        role: message.role,
        content: message.content ?? "",
        tool_calls: message.tool_calls,
        tool_call_id: message.tool_call_id,
        name: message.name,
        mode: (message as any).mode,
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

export async function getMessages(sessionId: string): Promise<any[]> {
    const state = await loadState();
    const messages = state.messages[sessionId] || [];
    return messages.map(msg => {
        let content = msg.content;
        try {
            content = typeof content === 'string' ? JSON.parse(content) : content;
        } catch (e) {
            // keep as string
        }
        const tool_calls = msg.tool_calls || undefined;
        return { ...msg, content, tool_calls };
    }).sort((a, b) => a.id - b.id);
}

export async function getLogs(sessionId: string): Promise<any[]> {
    const state = await loadState();
    const logs = state.logs[sessionId] || [];
    return logs.sort((a, b) => b.id - a.id); // Descending by ID (newest first)
}

// --- Diff Snapshots ---

export async function addDiff(entry: {
    session_id: string;
    path: string;
    before: string;
    after: string;
    before_truncated?: boolean;
    after_truncated?: boolean;
}): Promise<DiffEntry> {
    const state = await loadState();
    if (!Array.isArray((state as any).file_diffs)) {
        (state as any).file_diffs = [];
    }
    const seq = (state.meta.diff_seq || 0) + 1;
    state.meta.diff_seq = seq;
    const created_at = new Date().toISOString();
    const record: DiffEntry = {
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
    (state as any).diffs = state.file_diffs;
    await saveState(state);
    return record;
}

export async function getDiffById(id: number): Promise<DiffEntry | null> {
    const state = await loadState();
    return state.file_diffs.find(d => d.id === id) || null;
}

export async function getDiffs(options: { session_id?: string, path?: string, limit?: number }): Promise<DiffEntry[]> {
    const state = await loadState();
    const limit = options.limit && options.limit > 0 ? options.limit : 20;
    let list = state.file_diffs;
    if (options.session_id) list = list.filter(d => d.session_id === options.session_id);
    if (options.path) list = list.filter(d => d.path === options.path);
    return list.sort((a, b) => b.id - a.id).slice(0, limit);
}

// LLM Config

function getLlmConfigPath(): string {
    return path.join(getGlobalDataDir(), LLM_CONFIG_FILE);
}

export async function loadLlmConfig(): Promise<any | null> {
    const filePath = getLlmConfigPath();
    console.log(`[DB] Loading LLM config from: ${filePath}`);
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const config = JSON.parse(content);
        console.log(`[DB] Loaded config provider: ${config.provider}`);
        return config;
    } catch (e) {
        console.log(`[DB] Failed to load LLM config: ${(e as any).message}`);
        return null;
    }
}

export async function saveLlmConfig(config: any): Promise<any> {
    const dir = await ensureDataDir();
    const filePath = path.join(dir, LLM_CONFIG_FILE);
    console.log(`[DB] Saving LLM config to: ${filePath}`);
    console.log(`[DB] Saving config provider: ${config.provider}`);
    const payload = JSON.stringify(config, null, 2);
    await safeWriteJsonFile(filePath, payload, { tag: 'DB' });
    return config;
}
