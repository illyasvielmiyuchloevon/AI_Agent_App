import fs from 'fs/promises';
import path from 'path';
import { BaseToolImplementation } from '../core/base_tool';
import { getWorkspaceRoot } from '../context';
import { takeSnapshot, persistDiffSafely, emptySnapshot } from '../diffs';
import { workspaceManager } from '../workspace/manager';

function isLikelyText(content: string): boolean {
    return content.indexOf('\0') === -1;
}

function escapeRegex(query: string): string {
    return query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchGlob(patterns: string[] | undefined, candidate: string): boolean {
    if (!patterns || patterns.length === 0) return true;
    return patterns.some(pat => {
        const escaped = pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
        const re = new RegExp(`^${escaped}$`, 'i');
        return re.test(candidate);
    });
}

function findNthIndex(haystack: string, needle: string, occurrence: number): number {
    if (!needle.length) return -1;
    let idx = -1;
    let from = 0;
    let count = 0;
    while (count < occurrence) {
        idx = haystack.indexOf(needle, from);
        if (idx === -1) return -1;
        count++;
        from = idx + needle.length;
    }
    return idx;
}

function buildLineIndex(content: string) {
    const lines = content.split('\n');
    const offsets: number[] = [];
    let acc = 0;
    for (const line of lines) {
        offsets.push(acc);
        acc += line.length + 1; // +1 for newline
    }
    return { lines, offsets };
}

function offsetToLineCol(offsets: number[], index: number) {
    let low = 0;
    let high = offsets.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const start = offsets[mid];
        const nextStart = mid + 1 < offsets.length ? offsets[mid + 1] : Number.MAX_SAFE_INTEGER;
        if (index >= start && index < nextStart) {
            return { line: mid + 1, column: index - start + 1 };
        } else if (index < start) {
            high = mid - 1;
        } else {
            low = mid + 1;
        }
    }
    return { line: offsets.length, column: 1 };
}

async function walkDir(dir: string, root: string, entries: any[], folderIndex = 0, folderName?: string) {
    const stack: string[] = [dir];
    while (stack.length > 0) {
        const currentDir = stack.pop() as string;
        let list: any[] = [];
        try {
            // Note: Avoid per-file stat() here. It dominates latency on large workspaces.
            list = await fs.readdir(currentDir, { withFileTypes: true }) as any[];
        } catch {
            continue;
        }
        for (const item of list) {
            const fullPath = path.join(currentDir, item.name);
            const relPath = path.relative(root, fullPath).replace(/\\/g, '/'); // ensure forward slashes

            // Basic ignore
            if (item.name === 'node_modules' || item.name === '.git' || item.name === '__pycache__') continue;
            // Keep common dotfiles visible (.gitignore/.vscode/.env etc), but hide internal agent data.
            if (item.name === '.aichat') continue;

            if (item.isDirectory()) {
                entries.push({
                    path: relPath,
                    type: 'dir',
                    workspace_root: root,
                    workspace_folder_index: folderIndex,
                    workspace_folder: folderName
                });
                stack.push(fullPath);
            } else {
                entries.push({
                    path: relPath,
                    type: 'file',
                    workspace_root: root,
                    workspace_folder_index: folderIndex,
                    workspace_folder: folderName
                });
            }
        }
    }
}

export async function getProjectStructure(root: string): Promise<any> {
    console.log(`[Filesystem] getting structure for ${root}`);
    const entries: any[] = [];
    const roots: { path: string, name?: string }[] = [];
    const handle = workspaceManager.getWorkspaceByRoot(root);
    const folders = handle && handle.descriptor && handle.descriptor.folders && handle.descriptor.folders.length > 0
        ? handle.descriptor.folders
        : [{ path: root }];

    for (let index = 0; index < folders.length; index++) {
        const folder = folders[index];
        const folderRoot = path.resolve(folder.path);
        const folderName = folder.name || path.basename(folderRoot) || folderRoot;
        roots.push({ path: folderRoot, name: folderName });
        try {
            await walkDir(folderRoot, folderRoot, entries, index, folderName);
        } catch (e: any) {
            console.error(`[Filesystem] walkDir error: ${e.message}`);
        }
    }
    
    // Simple candidates logic
    const priority = ['index.html', 'main.py', 'app.jsx', 'src/App.jsx', 'src/index.ts'];
    const candidates = priority.filter(p => entries.some(e => e.path.toLowerCase().endsWith(p.toLowerCase())));
    if (candidates.length === 0 && entries.length > 0) {
        const firstFile = entries.find(e => e.type === 'file');
        if (firstFile) candidates.push(firstFile.path);
    }
    console.log(`[Filesystem] structure entries=${entries.length} candidates=${candidates.length}`);

    return {
        root,
        roots,
        entries,
        entry_candidates: candidates
    };
}

export async function resolveWorkspaceFilePath(hintRoot: string, relativePath: string, options: { mustExist?: boolean; preferExistingParent?: boolean } = {}): Promise<{ fullPath: string; rootPath: string }> {
    const rel = String(relativePath || '');
    const normalizedRel = rel.replace(/^[\\/]+/, '');

    const handle = workspaceManager.getWorkspaceByRoot(hintRoot);
    const candidateFolders = handle && handle.descriptor && handle.descriptor.folders && handle.descriptor.folders.length > 0
        ? handle.descriptor.folders
        : [{ path: hintRoot }];

    const candidateRoots = candidateFolders.map(f => path.resolve(f.path));

    if (options.mustExist) {
        for (const rootCandidate of candidateRoots) {
            const rootPath = rootCandidate.replace(/[\\\/]+$/, '');
            const fullPath = path.resolve(rootPath, normalizedRel);
            const rootLower = rootPath.toLowerCase();
            const fullLower = fullPath.toLowerCase();
            const prefix = rootLower.endsWith(path.sep) ? rootLower : `${rootLower}${path.sep}`;
            if (!(fullLower === rootLower || fullLower.startsWith(prefix))) {
                continue;
            }
            try {
                await fs.stat(fullPath);
                return { fullPath, rootPath };
            } catch {
            }
        }
        throw new Error("Path does not exist in any workspace folder.");
    }

    if (options.preferExistingParent) {
        for (const rootCandidate of candidateRoots) {
            const rootPath = rootCandidate.replace(/[\\\/]+$/, '');
            const fullPath = path.resolve(rootPath, normalizedRel);
            const rootLower = rootPath.toLowerCase();
            const fullLower = fullPath.toLowerCase();
            const prefix = rootLower.endsWith(path.sep) ? rootLower : `${rootLower}${path.sep}`;
            if (!(fullLower === rootLower || fullLower.startsWith(prefix))) {
                continue;
            }
            const parentDir = path.dirname(fullPath);
            try {
                const stats = await fs.stat(parentDir);
                if (stats.isDirectory()) {
                    return { fullPath, rootPath };
                }
            } catch {
            }
        }
    }

    const fallbackRoot = candidateRoots[0] || path.resolve(String(hintRoot || ''));
    const rootPath = fallbackRoot.replace(/[\\\/]+$/, '');
    const fullPath = path.resolve(rootPath, normalizedRel);
    const rootLower = rootPath.toLowerCase();
    const fullLower = fullPath.toLowerCase();
    const prefix = rootLower.endsWith(path.sep) ? rootLower : `${rootLower}${path.sep}`;
    if (!(fullLower === rootLower || fullLower.startsWith(prefix))) {
        throw new Error("Access denied");
    }
    return { fullPath, rootPath };
}

export class ReadFileTool extends BaseToolImplementation {
    name = "read_file";
    description = "Read the content of a file from the filesystem.";
    input_schema = {
        type: "object",
        properties: {
            path: { type: "string", description: "The path to the file to read." }
        },
        required: ["path"]
    };

    async execute(args: { path: string }, _context: { sessionId?: string } = {}): Promise<any> {
        console.log(`[Filesystem] ReadFileTool: ${args.path}`);
        const root = getWorkspaceRoot();
        try {
            const { fullPath } = await resolveWorkspaceFilePath(root, args.path, { mustExist: true });
            const content = await fs.readFile(fullPath, 'utf-8');
            console.log(`[Filesystem] Read success: ${args.path} (${content.length} chars)`);
            return content;
        } catch (e: any) {
            console.error(`[Filesystem] Read error: ${e.message}`);
            return `Error reading file: ${e.message}`;
        }
    }
}

export class WriteFileTool extends BaseToolImplementation {
    name = "write_file";
    description = "Write content to a file. Overwrites existing files.";
    input_schema = {
        type: "object",
        properties: {
            path: { type: "string", description: "The path to the file to write." },
            content: { type: "string", description: "The content to write." },
            create_directories: { 
                type: "boolean", 
                description: "Whether to create missing parent directories. Default is true.",
                default: true
            }
        },
        required: ["path", "content"]
    };

    async execute(args: { path: string, content: string, create_directories?: boolean }, context: { sessionId?: string } = {}): Promise<any> {
        console.log(`[Filesystem] WriteFileTool: ${args.path}`);
        const root = getWorkspaceRoot();

        try {
            const { fullPath } = await resolveWorkspaceFilePath(root, args.path, { mustExist: false, preferExistingParent: true });
            if (args.create_directories !== false) {
                await fs.mkdir(path.dirname(fullPath), { recursive: true });
            }
            const beforeSnapshot = await takeSnapshot(args.path);
            await fs.writeFile(fullPath, args.content, 'utf-8');
            const afterSnapshot = await takeSnapshot(args.path);
            const diff = await persistDiffSafely({
                sessionId: context.sessionId,
                path: args.path,
                before: beforeSnapshot,
                after: afterSnapshot
            });
            console.log(`[Filesystem] Write success: ${args.path}`);
            return {
                status: "ok",
                path: args.path,
                bytes: (args.content || "").length,
                message: `Successfully wrote to ${args.path}`,
                diff
            };
        } catch (e: any) {
            console.error(`[Filesystem] Write error: ${e.message}`);
            return `Error writing file: ${e.message}`;
        }
    }
}

export class EditFileTool extends BaseToolImplementation {
    name = "edit_file";
    description = "Apply precise edits to a workspace file (search/replace, line range replace, insert before/after lines). Supports multiple, non-contiguous edits in one call.";
    input_schema = {
        type: "object",
        properties: {
            path: { type: "string", description: "Relative file path inside the workspace" },
            edits: {
                description: "Edits to apply. Can be an array, a single edit object, or a string when paired with replace.",
                anyOf: [
                    {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                search: { type: "string", description: "Exact contiguous block to replace" },
                                replace: { type: "string", description: "Replacement text (empty string to delete)" },
                                description: { type: "string", description: "Optional description of the change" },
                                start_line: { type: "integer", minimum: 1, description: "Start line (1-based) for a line range replace" },
                                end_line: { type: "integer", minimum: 1, description: "End line (inclusive). Defaults to start_line" },
                                insert_before_line: { type: "integer", minimum: 1, description: "Insert text before this line number" },
                                insert_after_line: { type: "integer", minimum: 0, description: "Insert text after this line number (0 means before first line)" },
                                text: { type: "string", description: "Text to insert or replace when using line-based edits" },
                                occurrence: { type: "integer", minimum: 1, description: "Nth occurrence to replace for search-based edits (default 1)" }
                            }
                        },
                        minItems: 1
                    },
                    {
                        type: "object",
                        properties: {
                            search: { type: "string" },
                            replace: { type: "string" },
                            description: { type: "string" },
                            start_line: { type: "integer", minimum: 1 },
                            end_line: { type: "integer", minimum: 1 },
                            insert_before_line: { type: "integer", minimum: 1 },
                            insert_after_line: { type: "integer", minimum: 0 },
                            text: { type: "string" },
                            occurrence: { type: "integer", minimum: 1 }
                        }
                    },
                    { type: "string" }
                ]
            },
            search: { type: "string", description: "Shorthand: exact text to replace (paired with top-level replace)" },
            replace: { type: "string", description: "Shorthand: replacement text when using top-level search" },
            description: { type: "string", description: "Optional description for shorthand edit" }
        },
        required: ["path"],
        anyOf: [
            { required: ["edits"] },
            { required: ["search", "replace"] }
        ]
    };

    async execute(args: { path: string, edits?: any, search?: string, replace?: string, description?: string }, context: { sessionId?: string } = {}): Promise<any> {
        console.log(`[Filesystem] EditFileTool: ${args.path}`);
        const root = getWorkspaceRoot();
        try {
            const { fullPath } = await resolveWorkspaceFilePath(root, args.path, { mustExist: true });
            const beforeSnapshot = await takeSnapshot(args.path);
            let content = await fs.readFile(fullPath, 'utf-8');
            const { edits, warnings } = this.normalizeEdits(args);
            const appliedDetails: any[] = [];

            for (const edit of edits) {
                if (edit.type === 'search_replace') {
                    const occurrence = edit.occurrence || 1;
                    const idx = findNthIndex(content, edit.search, occurrence);
                    if (idx === -1) {
                        throw new Error(`Search content not found (occurrence ${occurrence}): "${edit.search.substring(0, 80)}"`);
                    }
                    content = content.substring(0, idx) + (edit.replace ?? '') + content.substring(idx + edit.search.length);
                    appliedDetails.push({ type: 'search_replace', occurrence, preview: edit.search.substring(0, 80) });
                } else if (edit.type === 'line_range_replace') {
                    const { lines } = buildLineIndex(content);
                    const start = Math.max(1, edit.start_line);
                    const end = Math.max(start, edit.end_line || edit.start_line);
                    if (start > lines.length + 1) {
                        throw new Error(`start_line ${start} is beyond file length (${lines.length} lines)`);
                    }
                    const before = lines.slice(0, start - 1);
                    const after = lines.slice(end);
                    const replacementLines = (edit.text ?? edit.replace ?? '').split('\n');
                    content = [...before, ...replacementLines, ...after].join('\n');
                    appliedDetails.push({ type: 'line_range_replace', start_line: start, end_line: end });
                } else if (edit.type === 'insert_before') {
                    const { lines } = buildLineIndex(content);
                    const lineNum = Math.max(1, edit.line);
                    if (lineNum > lines.length + 1) {
                        throw new Error(`insert_before_line ${lineNum} is beyond file length (${lines.length} lines)`);
                    }
                    const insertLines = (edit.text ?? '').split('\n');
                    const before = lines.slice(0, lineNum - 1);
                    const after = lines.slice(lineNum - 1);
                    content = [...before, ...insertLines, ...after].join('\n');
                    appliedDetails.push({ type: 'insert_before', line: lineNum });
                } else if (edit.type === 'insert_after') {
                    const { lines } = buildLineIndex(content);
                    const lineNum = Math.max(0, edit.line); // 0 means before first
                    if (lineNum > lines.length) {
                        throw new Error(`insert_after_line ${lineNum} is beyond file length (${lines.length} lines)`);
                    }
                    const insertLines = (edit.text ?? '').split('\n');
                    const before = lines.slice(0, lineNum);
                    const after = lines.slice(lineNum);
                    content = [...before, ...insertLines, ...after].join('\n');
                    appliedDetails.push({ type: 'insert_after', line: lineNum });
                }
            }

            await fs.writeFile(fullPath, content, 'utf-8');
            const afterSnapshot = await takeSnapshot(args.path);
            const diff = await persistDiffSafely({
                sessionId: context.sessionId,
                path: args.path,
                before: beforeSnapshot,
                after: afterSnapshot
            });
            return {
                status: "ok",
                path: args.path,
                applied: appliedDetails.length,
                details: appliedDetails,
                warnings,
                message: `Edited ${args.path} (${appliedDetails.length} changes applied)`,
                diff
            };
        } catch (e: any) {
            console.error(`[Filesystem] Edit error: ${e.message}`);
            return { status: "error", message: e.message };
        }
    }

    private normalizeEdits(args: any): { edits: Array<any>, warnings: string[] } {
        const warnings: string[] = [];
        let rawEdits: any[] = [];

        const parseStringEdits = (value: string): any => {
            const trimmed = (value || '').trim();
            if (!trimmed) return null;
            try {
                return JSON.parse(trimmed);
            } catch (err: any) {
                warnings.push(`Failed to parse string edits as JSON: ${err?.message || err}`);
                return null;
            }
        };

        if (Array.isArray(args.edits)) {
            rawEdits = args.edits;
        } else if (args.edits && typeof args.edits === 'object') {
            rawEdits = [args.edits];
        } else if (typeof args.edits === 'string') {
            const parsed = parseStringEdits(args.edits);
            if (Array.isArray(parsed)) {
                rawEdits = parsed;
            } else if (parsed && typeof parsed === 'object') {
                rawEdits = [parsed];
            } else if (parsed && typeof parsed === 'string' && args.replace !== undefined) {
                rawEdits = [{ search: parsed, replace: args.replace, description: args.description }];
            } else if (args.replace !== undefined) {
                // Fallback: treat the raw string as search text when replace is provided
                rawEdits = [{ search: args.edits, replace: args.replace, description: args.description }];
            } else {
                warnings.push("String 'edits' provided but no 'replace' given; supply replace or use JSON edits array.");
            }
        }

        if (rawEdits.length === 0 && args.search !== undefined && args.replace !== undefined) {
            rawEdits = [{ search: args.search, replace: args.replace, description: args.description }];
        }

        if (rawEdits.length === 0) {
            throw new Error("No valid edits provided. Supply 'edits' or top-level 'search' and 'replace'.");
        }

        const edits: any[] = [];
        for (const edit of rawEdits) {
            if (edit === null || edit === undefined) continue;

            if (edit.search !== undefined && edit.replace !== undefined) {
                edits.push({
                    type: 'search_replace',
                    search: String(edit.search),
                    replace: String(edit.replace),
                    occurrence: edit.occurrence ? Number(edit.occurrence) : 1,
                    description: edit.description
                });
                continue;
            }

            if (edit.start_line !== undefined || edit.end_line !== undefined) {
                const start = Number(edit.start_line || edit.end_line);
                const end = Number(edit.end_line || edit.start_line);
                edits.push({
                    type: 'line_range_replace',
                    start_line: start,
                    end_line: end,
                    text: edit.text !== undefined ? String(edit.text) : (edit.replace !== undefined ? String(edit.replace) : '')
                });
                continue;
            }

            if (edit.insert_before_line !== undefined) {
                edits.push({
                    type: 'insert_before',
                    line: Number(edit.insert_before_line),
                    text: edit.text !== undefined ? String(edit.text) : (edit.replace !== undefined ? String(edit.replace) : '')
                });
                continue;
            }

            if (edit.insert_after_line !== undefined) {
                edits.push({
                    type: 'insert_after',
                    line: Number(edit.insert_after_line),
                    text: edit.text !== undefined ? String(edit.text) : (edit.replace !== undefined ? String(edit.replace) : '')
                });
                continue;
            }

            if (typeof edit === 'string') {
                if (args.replace !== undefined) {
                    edits.push({ type: 'search_replace', search: edit, replace: String(args.replace), occurrence: 1 });
                } else {
                    warnings.push("String edit provided without replacement; skipped.");
                }
                continue;
            }

            warnings.push("Unsupported edit shape encountered; skipped.");
        }

        if (edits.length === 0) {
            throw new Error("No actionable edits after normalization.");
        }

        return { edits, warnings };
    }
}

export class ListFilesTool extends BaseToolImplementation {
    name = "list_files";
    description = "List files and folders under the given path (recursive).";
    input_schema = {
        type: "object",
        properties: {
            path: { type: "string", description: "Folder path to list. Leave empty for workspace root." }
        }
    };

    async execute(args: { path?: string }, _context: { sessionId?: string } = {}): Promise<any> {
        console.log(`[Filesystem] ListFilesTool: ${args.path || '.'}`);
        const root = getWorkspaceRoot();
        const handle = workspaceManager.getWorkspaceByRoot(root);
        const folders = handle && handle.descriptor && handle.descriptor.folders && handle.descriptor.folders.length > 0
            ? handle.descriptor.folders
            : [{ path: root }];

        try {
            const entries: any[] = [];
            if (args.path) {
                const { fullPath, rootPath } = await resolveWorkspaceFilePath(root, args.path, { mustExist: false, preferExistingParent: true });
                const folder = folders[0];
                const folderName = folder ? (folder.name || path.basename(path.resolve(folder.path)) || folder.path) : rootPath;
                await walkDir(fullPath, rootPath, entries, 0, folderName);
            } else {
                for (let index = 0; index < folders.length; index++) {
                    const folder = folders[index];
                    const folderRoot = path.resolve(folder.path);
                    const folderName = folder.name || path.basename(folderRoot) || folderRoot;
                    await walkDir(folderRoot, folderRoot, entries, index, folderName);
                }
            }
            console.log(`[Filesystem] List success: ${entries.length} items found`);
            return {
                status: "ok",
                items: entries.map(e => e.path),
                tree: entries
            };
        } catch (e: any) {
            console.error(`[Filesystem] List error: ${e.message}`);
            return `Error listing files: ${e.message}`;
        }
    }
}

export class CreateFolderTool extends BaseToolImplementation {
    name = "create_folder";
    description = "Create a folder (and parents) inside the workspace.";
    input_schema = {
        type: "object",
        properties: {
            path: { type: "string", description: "Folder path to create" }
        },
        required: ["path"]
    };

    async execute(args: { path: string }, _context: { sessionId?: string } = {}): Promise<any> {
        console.log(`[Filesystem] CreateFolderTool: ${args.path}`);
        const root = getWorkspaceRoot();
        try {
            const { fullPath } = await resolveWorkspaceFilePath(root, args.path, { mustExist: false, preferExistingParent: true });
            await fs.mkdir(fullPath, { recursive: true });
            return { status: "ok", path: args.path, created: true };
        } catch (e: any) {
            console.error(`[Filesystem] CreateFolder error: ${e.message}`);
            return { status: "error", message: e.message };
        }
    }
}

export class DeleteFileTool extends BaseToolImplementation {
    name = "delete_file";
    description = "Delete a file or folder from the workspace.";
    input_schema = {
        type: "object",
        properties: {
            path: { type: "string", description: "Path to delete" }
        },
        required: ["path"]
    };

    async execute(args: { path: string }, context: { sessionId?: string } = {}): Promise<any> {
        console.log(`[Filesystem] DeleteFileTool: ${args.path}`);
        const root = getWorkspaceRoot();
        try {
            const { fullPath } = await resolveWorkspaceFilePath(root, args.path, { mustExist: true });
            let shouldCapture = false;
            try {
                const stats = await fs.stat(fullPath);
                shouldCapture = stats.isFile();
            } catch {
                /* ignore missing files */
            }
            const beforeSnapshot = shouldCapture ? await takeSnapshot(args.path) : emptySnapshot();
            await fs.rm(fullPath, { recursive: true, force: true });
            const diff = shouldCapture
                ? await persistDiffSafely({
                    sessionId: context.sessionId,
                    path: args.path,
                    before: beforeSnapshot,
                    after: emptySnapshot()
                })
                : undefined;
            return { status: "ok", path: args.path, deleted: true, diff };
        } catch (e: any) {
             console.error(`[Filesystem] DeleteFile error: ${e.message}`);
             return { status: "error", message: e.message };
        }
    }
}

export class RenameFileTool extends BaseToolImplementation {
    name = "rename_file";
    description = "Rename or move a file/folder within the workspace.";
    input_schema = {
        type: "object",
        properties: {
            old_path: { type: "string", description: "Existing file/folder path" },
            new_path: { type: "string", description: "New path for the item" }
        },
        required: ["old_path", "new_path"]
    };

    async execute(args: { old_path: string, new_path: string }, context: { sessionId?: string } = {}): Promise<any> {
        console.log(`[Filesystem] RenameFileTool: ${args.old_path} -> ${args.new_path}`);
        const root = getWorkspaceRoot();
        try {
            const { fullPath: oldFullPath, rootPath } = await resolveWorkspaceFilePath(root, args.old_path, { mustExist: true });
            const newFullPath = path.resolve(rootPath, args.new_path);
            const rootLower = rootPath.toLowerCase();
            const newLower = newFullPath.toLowerCase();
            const prefix = rootLower.endsWith(path.sep) ? rootLower : `${rootLower}${path.sep}`;
            if (!(newLower === rootLower || newLower.startsWith(prefix))) {
                throw new Error("Access denied: Cannot rename files outside workspace.");
            }
            let isFile = false;
            let beforeSnapshot = emptySnapshot();
            try {
                const stats = await fs.stat(oldFullPath);
                isFile = stats.isFile();
                if (isFile) {
                    beforeSnapshot = await takeSnapshot(args.old_path);
                }
            } catch {
                /* ignore stat errors; proceed to rename for robustness */
            }
            await fs.mkdir(path.dirname(newFullPath), { recursive: true });
            await fs.rename(oldFullPath, newFullPath);
            const afterSnapshot = isFile ? await takeSnapshot(args.new_path) : emptySnapshot();
            const diff = isFile
                ? await persistDiffSafely({
                    sessionId: context.sessionId,
                    path: args.new_path,
                    before: beforeSnapshot,
                    after: afterSnapshot
                })
                : undefined;
            return { status: "ok", from: args.old_path, to: args.new_path, diff };
        } catch (e: any) {
             console.error(`[Filesystem] RenameFile error: ${e.message}`);
             return { status: "error", message: e.message };
        }
    }
}

export class SearchInFilesTool extends BaseToolImplementation {
    name = "search_in_files";
    description = "Search text or regex across one or many workspace files, returning file paths, line numbers, and context.";
    input_schema = {
        type: "object",
        properties: {
            query: { type: "string", description: "Search term or regex pattern" },
            path: { type: "string", description: "Optional sub-folder to scope the search" },
            paths: { type: "array", items: { type: "string" }, description: "Specific sub-folders to search" },
            files: { type: "array", items: { type: "string" }, description: "Specific files (relative to workspace) to search" },
            file_globs: { type: "array", items: { type: "string" }, description: "Glob patterns to include (e.g. **/*.ts, src/*.css)" },
            regex: { type: "boolean", description: "Treat query as regex (defaults to false)" },
            case_sensitive: { type: "boolean", description: "Case sensitive search (default false)" },
            context_lines: { type: "integer", minimum: 0, maximum: 20, description: "Number of context lines before/after match" },
            max_results: { type: "integer", minimum: 1, maximum: 1000, description: "Maximum results to return (default 200)" }
        },
        required: ["query"]
    };

    async execute(args: { query: string, path?: string, paths?: string[], files?: string[], file_globs?: string[], regex?: boolean, case_sensitive?: boolean, context_lines?: number, max_results?: number }, _context: { sessionId?: string } = {}): Promise<any> {
        console.log(`[Filesystem] SearchInFilesTool: ${args.query} in ${args.path || args.paths?.join(',') || args.files?.join(',') || '.'}`);
        const root = getWorkspaceRoot();
        try {
            const results: any[] = [];
            const MAX_RESULTS = args.max_results || 200;
            const context = args.context_lines ?? 2;
            const isRegex = !!args.regex;
            const flags = args.case_sensitive ? 'g' : 'gi';
            const pattern = isRegex ? new RegExp(args.query, flags) : new RegExp(escapeRegex(args.query), flags);
            const handle = workspaceManager.getWorkspaceByRoot(root);
            const folders = handle && handle.descriptor && handle.descriptor.folders && handle.descriptor.folders.length > 0
                ? handle.descriptor.folders
                : [{ path: root }];

            const candidateFiles: { root: string, path: string }[] = [];

            if (args.files && args.files.length > 0) {
                for (const f of args.files) {
                    try {
                        const { fullPath, rootPath } = await resolveWorkspaceFilePath(root, f, { mustExist: true });
                        const relPath = path.relative(rootPath, fullPath).replace(/\\/g, '/');
                        candidateFiles.push({ root: rootPath, path: relPath });
                    } catch {
                    }
                }
            }

            if (args.paths && args.paths.length > 0) {
                for (const p of args.paths) {
                    const { fullPath, rootPath } = await resolveWorkspaceFilePath(root, p, { mustExist: false, preferExistingParent: true });
                    const entries: any[] = [];
                    await walkDir(fullPath, rootPath, entries, 0);
                    entries.filter(e => e.type === 'file').forEach(e => candidateFiles.push({ root: e.workspace_root || rootPath, path: e.path }));
                }
            } else if (args.path) {
                const { fullPath, rootPath } = await resolveWorkspaceFilePath(root, args.path, { mustExist: false, preferExistingParent: true });
                const entries: any[] = [];
                await walkDir(fullPath, rootPath, entries, 0);
                entries.filter(e => e.type === 'file').forEach(e => candidateFiles.push({ root: e.workspace_root || rootPath, path: e.path }));
            } else {
                for (let index = 0; index < folders.length; index++) {
                    const folder = folders[index];
                    const folderRoot = path.resolve(folder.path);
                    const entries: any[] = [];
                    await walkDir(folderRoot, folderRoot, entries, index, folder.name || path.basename(folderRoot) || folderRoot);
                    entries.filter(e => e.type === 'file').forEach(e => candidateFiles.push({ root: e.workspace_root || folderRoot, path: e.path }));
                }
            }

            const seen = new Set<string>();
            for (const file of candidateFiles) {
                if (results.length >= MAX_RESULTS) break;
                const key = `${file.root}:${file.path}`;
                if (seen.has(key)) continue;
                seen.add(key);
                if (!matchGlob(args.file_globs, file.path)) continue;

                try {
                    const fullPath = path.resolve(file.root, file.path);
                    const content = await fs.readFile(fullPath, 'utf-8');
                    if (!isLikelyText(content)) continue;

                    const { lines, offsets } = buildLineIndex(content);
                    let match: RegExpExecArray | null;
                    pattern.lastIndex = 0;
                    while ((match = pattern.exec(content)) !== null) {
                        const absoluteIndex = match.index;
                        const { line, column } = offsetToLineCol(offsets, absoluteIndex);
                        const startLine = Math.max(1, line - context);
                        const endLine = Math.min(lines.length, line + context);
                        const snippet = lines.slice(startLine - 1, endLine).join('\n');
                        results.push({
                            path: file.path,
                            workspace_root: file.root,
                            line,
                            column,
                            match: match[0],
                            context: snippet
                        });
                        if (results.length >= MAX_RESULTS) break;
                        if (!pattern.global) break;
                    }
                } catch (e) {
                    // Ignore binary files or read errors
                }
            }
            
            return { status: "ok", query: args.query, regex: isRegex, results, truncated: results.length >= MAX_RESULTS };
        } catch (e: any) {
             console.error(`[Filesystem] SearchInFiles error: ${e.message}`);
             return { status: "error", message: e.message };
        }
    }
}

export class ProjectStructureTool extends BaseToolImplementation {
    name = "get_current_project_structure";
    description = "Return the current workspace tree and top-level entry candidates.";
    input_schema = {
        type: "object",
        properties: {
            include_content: { 
                type: "boolean", 
                description: "Whether to include file contents for text files",
                default: false 
            }
        },
        required: []
    };

    async execute(args: { include_content?: boolean }, _context: { sessionId?: string } = {}): Promise<any> {
        const root = getWorkspaceRoot();
        try {
            const structure = await getProjectStructure(root);
            
            if (args.include_content) {
                const filesWithContent: any[] = [];
                const textFiles = structure.entries.filter((e: any) => e.type === 'file');
                for (const file of textFiles) {
                    try {
                        const baseRoot = typeof file.workspace_root === 'string' && file.workspace_root
                            ? file.workspace_root
                            : root;
                        const fullPath = path.resolve(baseRoot, file.path);
                        const content = await fs.readFile(fullPath, 'utf-8');
                        if (content.indexOf('\0') === -1 && content.length < 100000) {
                            filesWithContent.push({
                                path: file.path,
                                content,
                                workspace_root: baseRoot,
                                workspace_folder_index: file.workspace_folder_index,
                                workspace_folder: file.workspace_folder
                            });
                        }
                    } catch (e) {
                    }
                }
                structure.files = filesWithContent;
            }
            
            structure.status = "ok";
            return structure;
        } catch (e: any) {
             return { status: "error", message: e.message };
        }
    }
}
