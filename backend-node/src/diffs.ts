import fs from 'fs/promises';
import path from 'path';
import { getWorkspaceRoot } from './context';
import * as db from './db';
import { DiffEntry } from './db';

export const DIFF_CHAR_LIMIT = 120_000;

export type Snapshot = {
    content: string;
    truncated: boolean;
};

export type DiffSnapshot = {
    id?: number;
    session_id?: string;
    path: string;
    before: string;
    after: string;
    before_truncated: boolean;
    after_truncated: boolean;
    created_at?: string;
};

const EMPTY_SNAPSHOT: Snapshot = { content: '', truncated: false };

function normalizeContent(raw: string): Snapshot {
    if (raw.length <= DIFF_CHAR_LIMIT) {
        return { content: raw, truncated: false };
    }
    return { content: raw.slice(0, DIFF_CHAR_LIMIT), truncated: true };
}

export async function takeSnapshot(relPath: string): Promise<Snapshot> {
    try {
        const root = getWorkspaceRoot();
        const full = path.resolve(root, relPath);
        if (!full.startsWith(root)) {
            return EMPTY_SNAPSHOT;
        }
        const data = await fs.readFile(full, 'utf-8');
        return normalizeContent(data);
    } catch {
        return EMPTY_SNAPSHOT;
    }
}

export function buildDiffPayload(path: string, before: Snapshot, after: Snapshot): DiffSnapshot {
    return {
        path,
        before: before.content,
        after: after.content,
        before_truncated: before.truncated,
        after_truncated: after.truncated
    };
}

export function mapEntryToPayload(entry: DiffEntry): DiffSnapshot {
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

export async function persistDiffSnapshot(options: {
    sessionId?: string;
    path: string;
    before: Snapshot;
    after: Snapshot;
}): Promise<DiffSnapshot> {
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

export async function persistDiffSafely(options: {
    sessionId?: string;
    path: string;
    before: Snapshot;
    after: Snapshot;
}): Promise<DiffSnapshot> {
    try {
        return await persistDiffSnapshot(options);
    } catch (e) {
        console.warn(`[Diff] Failed to persist diff for ${options.path}: ${(e as any)?.message}`);
        // Still return a payload so callers can surface data in responses
        return buildDiffPayload(options.path, options.before, options.after);
    }
}

export async function captureAndPersistDiff(options: {
    sessionId?: string;
    path: string;
    beforePath?: string;
    afterPath?: string;
}): Promise<DiffSnapshot> {
    const before = await takeSnapshot(options.beforePath || options.path);
    const after = await takeSnapshot(options.afterPath || options.path);
    return persistDiffSafely({
        sessionId: options.sessionId,
        path: options.path,
        before,
        after
    });
}

export function emptySnapshot(): Snapshot {
    return { ...EMPTY_SNAPSHOT };
}
