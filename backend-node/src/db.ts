import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getWorkspaceRoot } from './context';

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
    meta: {
        message_seq: number;
        log_seq: number;
    };
}

function getDefaultState(): DBState {
    return {
        sessions: [],
        messages: {},
        logs: {},
        meta: { message_seq: 0, log_seq: 0 }
    };
}

function getDataDir(create = false): string {
    const root = getWorkspaceRoot();
    const dataDir = path.join(root, ".aichat");
    // We rely on the caller or init to ensure existence usually, but for safe access:
    // fs.mkdir is async, so this helper is a bit tricky if used synchronously in path generation.
    // But we just return string here.
    return dataDir;
}

async function ensureDataDir(): Promise<string> {
    const dir = getDataDir();
    try {
        await fs.mkdir(dir, { recursive: true });
    } catch (e) {
        // ignore
    }
    return dir;
}

function getDataFilePath(): string {
    return path.join(getDataDir(), DATA_FILE_NAME);
}

async function loadState(): Promise<DBState> {
    const filePath = getDataFilePath();
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const raw = JSON.parse(content);
        return { ...getDefaultState(), ...raw };
    } catch (e) {
        const state = getDefaultState();
        await saveState(state);
        return state;
    }
}

async function saveState(state: DBState): Promise<void> {
    const dir = await ensureDataDir();
    const filePath = path.join(dir, DATA_FILE_NAME);
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf-8');
    await fs.rename(tempPath, filePath);
}

// --- Public API ---

export async function initDb(): Promise<void> {
    try {
        await ensureDataDir();
        await loadState();
    } catch (e) {
        // ignore workspace error
    }
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

// LLM Config

function getLlmConfigPath(): string {
    return path.join(getDataDir(), LLM_CONFIG_FILE);
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
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(config, null, 2), 'utf-8');
    await fs.rename(tempPath, filePath);
    return config;
}
