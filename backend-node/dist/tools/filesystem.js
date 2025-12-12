"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectStructureTool = exports.SearchInFilesTool = exports.RenameFileTool = exports.DeleteFileTool = exports.CreateFolderTool = exports.ListFilesTool = exports.EditFileTool = exports.WriteFileTool = exports.ReadFileTool = void 0;
exports.getProjectStructure = getProjectStructure;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const base_tool_1 = require("../core/base_tool");
const context_1 = require("../context");
const MAX_DIFF_CHARS = 120_000; // keep diff payloads bounded to avoid blowing up context
async function readFileSafe(fullPath) {
    try {
        const content = await promises_1.default.readFile(fullPath, 'utf-8');
        return content;
    }
    catch {
        return null;
    }
}
function snapshotContent(raw) {
    if (typeof raw !== 'string')
        return { content: '', truncated: false };
    if (raw.length <= MAX_DIFF_CHARS)
        return { content: raw, truncated: false };
    return { content: raw.slice(0, MAX_DIFF_CHARS), truncated: true };
}
function buildDiffPayload(filePath, beforeRaw, afterRaw) {
    const before = snapshotContent(beforeRaw);
    const after = snapshotContent(afterRaw);
    return {
        path: filePath,
        before: before.content,
        after: after.content,
        before_truncated: before.truncated,
        after_truncated: after.truncated
    };
}
function isLikelyText(content) {
    return content.indexOf('\0') === -1;
}
function escapeRegex(query) {
    return query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function matchGlob(patterns, candidate) {
    if (!patterns || patterns.length === 0)
        return true;
    return patterns.some(pat => {
        const escaped = pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
        const re = new RegExp(`^${escaped}$`, 'i');
        return re.test(candidate);
    });
}
function findNthIndex(haystack, needle, occurrence) {
    if (!needle.length)
        return -1;
    let idx = -1;
    let from = 0;
    let count = 0;
    while (count < occurrence) {
        idx = haystack.indexOf(needle, from);
        if (idx === -1)
            return -1;
        count++;
        from = idx + needle.length;
    }
    return idx;
}
function buildLineIndex(content) {
    const lines = content.split('\n');
    const offsets = [];
    let acc = 0;
    for (const line of lines) {
        offsets.push(acc);
        acc += line.length + 1; // +1 for newline
    }
    return { lines, offsets };
}
function offsetToLineCol(offsets, index) {
    let low = 0;
    let high = offsets.length - 1;
    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const start = offsets[mid];
        const nextStart = mid + 1 < offsets.length ? offsets[mid + 1] : Number.MAX_SAFE_INTEGER;
        if (index >= start && index < nextStart) {
            return { line: mid + 1, column: index - start + 1 };
        }
        else if (index < start) {
            high = mid - 1;
        }
        else {
            low = mid + 1;
        }
    }
    return { line: offsets.length, column: 1 };
}
// Helper for recursive walk
async function walkDir(dir, root, entries) {
    const list = await promises_1.default.readdir(dir, { withFileTypes: true });
    for (const item of list) {
        const fullPath = path_1.default.join(dir, item.name);
        const relPath = path_1.default.relative(root, fullPath).replace(/\\/g, '/'); // ensure forward slashes
        // Basic ignore
        if (item.name === 'node_modules' || item.name === '.git' || item.name === '__pycache__')
            continue;
        if (item.name.startsWith('.'))
            continue; // ignore hidden files/dirs by default for now
        if (item.isDirectory()) {
            entries.push({ path: relPath, type: 'dir' });
            await walkDir(fullPath, root, entries);
        }
        else {
            const stats = await promises_1.default.stat(fullPath);
            entries.push({ path: relPath, type: 'file', size: stats.size });
        }
    }
}
async function getProjectStructure(root) {
    console.log(`[Filesystem] getting structure for ${root}`);
    const entries = [];
    try {
        await walkDir(root, root, entries);
    }
    catch (e) {
        console.error(`[Filesystem] walkDir error: ${e.message}`);
        // ignore access errors
    }
    // Simple candidates logic
    const priority = ['index.html', 'main.py', 'app.jsx', 'src/App.jsx', 'src/index.ts'];
    const candidates = priority.filter(p => entries.some(e => e.path.toLowerCase().endsWith(p.toLowerCase())));
    if (candidates.length === 0 && entries.length > 0) {
        const firstFile = entries.find(e => e.type === 'file');
        if (firstFile)
            candidates.push(firstFile.path);
    }
    console.log(`[Filesystem] structure entries=${entries.length} candidates=${candidates.length}`);
    return {
        root,
        entries,
        entry_candidates: candidates
    };
}
class ReadFileTool extends base_tool_1.BaseToolImplementation {
    name = "read_file";
    description = "Read the content of a file from the filesystem.";
    input_schema = {
        type: "object",
        properties: {
            path: { type: "string", description: "The path to the file to read." }
        },
        required: ["path"]
    };
    async execute(args) {
        console.log(`[Filesystem] ReadFileTool: ${args.path}`);
        const root = (0, context_1.getWorkspaceRoot)();
        const fullPath = path_1.default.resolve(root, args.path);
        // Security check
        if (!fullPath.startsWith(root)) {
            console.error(`[Filesystem] Access denied: ${fullPath} is outside ${root}`);
            throw new Error("Access denied: Cannot read files outside workspace.");
        }
        try {
            const content = await promises_1.default.readFile(fullPath, 'utf-8');
            console.log(`[Filesystem] Read success: ${args.path} (${content.length} chars)`);
            return content;
        }
        catch (e) {
            console.error(`[Filesystem] Read error: ${e.message}`);
            return `Error reading file: ${e.message}`;
        }
    }
}
exports.ReadFileTool = ReadFileTool;
class WriteFileTool extends base_tool_1.BaseToolImplementation {
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
    async execute(args) {
        console.log(`[Filesystem] WriteFileTool: ${args.path}`);
        const root = (0, context_1.getWorkspaceRoot)();
        const fullPath = path_1.default.resolve(root, args.path);
        if (!fullPath.startsWith(root)) {
            console.error(`[Filesystem] Access denied: ${fullPath} is outside ${root}`);
            throw new Error("Access denied: Cannot write files outside workspace.");
        }
        try {
            if (args.create_directories !== false) {
                await promises_1.default.mkdir(path_1.default.dirname(fullPath), { recursive: true });
            }
            const beforeContent = await readFileSafe(fullPath);
            await promises_1.default.writeFile(fullPath, args.content, 'utf-8');
            console.log(`[Filesystem] Write success: ${args.path}`);
            return {
                status: "ok",
                path: args.path,
                bytes: (args.content || "").length,
                message: `Successfully wrote to ${args.path}`,
                diff: buildDiffPayload(args.path, beforeContent, args.content || '')
            };
        }
        catch (e) {
            console.error(`[Filesystem] Write error: ${e.message}`);
            return `Error writing file: ${e.message}`;
        }
    }
}
exports.WriteFileTool = WriteFileTool;
class EditFileTool extends base_tool_1.BaseToolImplementation {
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
    async execute(args) {
        console.log(`[Filesystem] EditFileTool: ${args.path}`);
        const root = (0, context_1.getWorkspaceRoot)();
        const fullPath = path_1.default.resolve(root, args.path);
        if (!fullPath.startsWith(root)) {
            throw new Error("Access denied: Cannot edit files outside workspace.");
        }
        try {
            let content = await promises_1.default.readFile(fullPath, 'utf-8');
            const originalContent = content;
            const { edits, warnings } = this.normalizeEdits(args);
            const appliedDetails = [];
            for (const edit of edits) {
                if (edit.type === 'search_replace') {
                    const occurrence = edit.occurrence || 1;
                    const idx = findNthIndex(content, edit.search, occurrence);
                    if (idx === -1) {
                        throw new Error(`Search content not found (occurrence ${occurrence}): "${edit.search.substring(0, 80)}"`);
                    }
                    content = content.substring(0, idx) + (edit.replace ?? '') + content.substring(idx + edit.search.length);
                    appliedDetails.push({ type: 'search_replace', occurrence, preview: edit.search.substring(0, 80) });
                }
                else if (edit.type === 'line_range_replace') {
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
                }
                else if (edit.type === 'insert_before') {
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
                }
                else if (edit.type === 'insert_after') {
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
            await promises_1.default.writeFile(fullPath, content, 'utf-8');
            return {
                status: "ok",
                path: args.path,
                applied: appliedDetails.length,
                details: appliedDetails,
                warnings,
                message: `Edited ${args.path} (${appliedDetails.length} changes applied)`,
                diff: buildDiffPayload(args.path, originalContent, content)
            };
        }
        catch (e) {
            console.error(`[Filesystem] Edit error: ${e.message}`);
            return { status: "error", message: e.message };
        }
    }
    normalizeEdits(args) {
        const warnings = [];
        let rawEdits = [];
        if (Array.isArray(args.edits)) {
            rawEdits = args.edits;
        }
        else if (args.edits && typeof args.edits === 'object') {
            rawEdits = [args.edits];
        }
        else if (typeof args.edits === 'string' && args.replace !== undefined) {
            rawEdits = [{ search: args.edits, replace: args.replace, description: args.description }];
        }
        if (rawEdits.length === 0 && args.search !== undefined && args.replace !== undefined) {
            rawEdits = [{ search: args.search, replace: args.replace, description: args.description }];
        }
        if (rawEdits.length === 0) {
            throw new Error("No valid edits provided. Supply 'edits' or top-level 'search' and 'replace'.");
        }
        const edits = [];
        for (const edit of rawEdits) {
            if (edit === null || edit === undefined)
                continue;
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
                }
                else {
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
exports.EditFileTool = EditFileTool;
class ListFilesTool extends base_tool_1.BaseToolImplementation {
    name = "list_files";
    description = "List files and folders under the given path (recursive).";
    input_schema = {
        type: "object",
        properties: {
            path: { type: "string", description: "Folder path to list. Leave empty for workspace root." }
        }
    };
    async execute(args) {
        console.log(`[Filesystem] ListFilesTool: ${args.path || '.'}`);
        const root = (0, context_1.getWorkspaceRoot)();
        const targetPath = args.path ? path_1.default.resolve(root, args.path) : root;
        if (!targetPath.startsWith(root)) {
            console.error(`[Filesystem] Access denied: ${targetPath} is outside ${root}`);
            throw new Error("Access denied.");
        }
        try {
            const entries = [];
            // Reuse walkDir helper
            await walkDir(targetPath, root, entries);
            console.log(`[Filesystem] List success: ${entries.length} items found`);
            // Format to match Python output if possible, or just return entries
            // Python returns a list of objects with path, type, size.
            // walkDir returns similar structure.
            return {
                status: "ok",
                items: entries.map(e => e.path),
                tree: entries
            };
        }
        catch (e) {
            console.error(`[Filesystem] List error: ${e.message}`);
            return `Error listing files: ${e.message}`;
        }
    }
}
exports.ListFilesTool = ListFilesTool;
class CreateFolderTool extends base_tool_1.BaseToolImplementation {
    name = "create_folder";
    description = "Create a folder (and parents) inside the workspace.";
    input_schema = {
        type: "object",
        properties: {
            path: { type: "string", description: "Folder path to create" }
        },
        required: ["path"]
    };
    async execute(args) {
        console.log(`[Filesystem] CreateFolderTool: ${args.path}`);
        const root = (0, context_1.getWorkspaceRoot)();
        const fullPath = path_1.default.resolve(root, args.path);
        if (!fullPath.startsWith(root)) {
            throw new Error("Access denied: Cannot create folder outside workspace.");
        }
        try {
            await promises_1.default.mkdir(fullPath, { recursive: true });
            return { status: "ok", path: args.path, created: true };
        }
        catch (e) {
            console.error(`[Filesystem] CreateFolder error: ${e.message}`);
            return { status: "error", message: e.message };
        }
    }
}
exports.CreateFolderTool = CreateFolderTool;
class DeleteFileTool extends base_tool_1.BaseToolImplementation {
    name = "delete_file";
    description = "Delete a file or folder from the workspace.";
    input_schema = {
        type: "object",
        properties: {
            path: { type: "string", description: "Path to delete" }
        },
        required: ["path"]
    };
    async execute(args) {
        console.log(`[Filesystem] DeleteFileTool: ${args.path}`);
        const root = (0, context_1.getWorkspaceRoot)();
        const fullPath = path_1.default.resolve(root, args.path);
        if (!fullPath.startsWith(root)) {
            throw new Error("Access denied: Cannot delete files outside workspace.");
        }
        try {
            let beforeContent = null;
            try {
                const stats = await promises_1.default.stat(fullPath);
                if (stats.isFile()) {
                    beforeContent = await readFileSafe(fullPath);
                }
            }
            catch {
                /* ignore missing files */
            }
            await promises_1.default.rm(fullPath, { recursive: true, force: true });
            const diff = beforeContent !== null ? buildDiffPayload(args.path, beforeContent, '') : undefined;
            return { status: "ok", path: args.path, deleted: true, diff };
        }
        catch (e) {
            console.error(`[Filesystem] DeleteFile error: ${e.message}`);
            return { status: "error", message: e.message };
        }
    }
}
exports.DeleteFileTool = DeleteFileTool;
class RenameFileTool extends base_tool_1.BaseToolImplementation {
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
    async execute(args) {
        console.log(`[Filesystem] RenameFileTool: ${args.old_path} -> ${args.new_path}`);
        const root = (0, context_1.getWorkspaceRoot)();
        const oldFullPath = path_1.default.resolve(root, args.old_path);
        const newFullPath = path_1.default.resolve(root, args.new_path);
        if (!oldFullPath.startsWith(root) || !newFullPath.startsWith(root)) {
            throw new Error("Access denied: Cannot rename files outside workspace.");
        }
        try {
            let beforeContent = null;
            let isFile = false;
            try {
                const stats = await promises_1.default.stat(oldFullPath);
                isFile = stats.isFile();
                if (isFile) {
                    beforeContent = await readFileSafe(oldFullPath);
                }
            }
            catch {
                /* ignore stat errors; proceed to rename for robustness */
            }
            await promises_1.default.mkdir(path_1.default.dirname(newFullPath), { recursive: true });
            await promises_1.default.rename(oldFullPath, newFullPath);
            const diff = isFile && beforeContent !== null
                ? buildDiffPayload(args.new_path, beforeContent, await readFileSafe(newFullPath) ?? '')
                : undefined;
            return { status: "ok", from: args.old_path, to: args.new_path, diff };
        }
        catch (e) {
            console.error(`[Filesystem] RenameFile error: ${e.message}`);
            return { status: "error", message: e.message };
        }
    }
}
exports.RenameFileTool = RenameFileTool;
class SearchInFilesTool extends base_tool_1.BaseToolImplementation {
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
    async execute(args) {
        console.log(`[Filesystem] SearchInFilesTool: ${args.query} in ${args.path || args.paths?.join(',') || args.files?.join(',') || '.'}`);
        const root = (0, context_1.getWorkspaceRoot)();
        const searchRoots = (args.paths && args.paths.length > 0)
            ? args.paths.map(p => path_1.default.resolve(root, p))
            : [args.path ? path_1.default.resolve(root, args.path) : root];
        try {
            const results = [];
            const MAX_RESULTS = args.max_results || 200;
            const context = args.context_lines ?? 2;
            const isRegex = !!args.regex;
            const flags = args.case_sensitive ? 'g' : 'gi';
            const pattern = isRegex ? new RegExp(args.query, flags) : new RegExp(escapeRegex(args.query), flags);
            const candidateFiles = [];
            if (args.files && args.files.length > 0) {
                for (const f of args.files) {
                    const full = path_1.default.resolve(root, f);
                    if (full.startsWith(root))
                        candidateFiles.push(path_1.default.relative(root, full).replace(/\\/g, '/'));
                }
            }
            for (const r of searchRoots) {
                if (!r.startsWith(root)) {
                    throw new Error("Access denied: Cannot search outside workspace.");
                }
                const entries = [];
                await walkDir(r, root, entries);
                entries.filter(e => e.type === 'file').forEach(e => candidateFiles.push(e.path));
            }
            const seen = new Set();
            for (const relPath of candidateFiles) {
                if (results.length >= MAX_RESULTS)
                    break;
                if (seen.has(relPath))
                    continue;
                seen.add(relPath);
                if (!matchGlob(args.file_globs, relPath))
                    continue;
                try {
                    const fullPath = path_1.default.resolve(root, relPath);
                    const content = await promises_1.default.readFile(fullPath, 'utf-8');
                    if (!isLikelyText(content))
                        continue;
                    const { lines, offsets } = buildLineIndex(content);
                    let match;
                    pattern.lastIndex = 0;
                    while ((match = pattern.exec(content)) !== null) {
                        const absoluteIndex = match.index;
                        const { line, column } = offsetToLineCol(offsets, absoluteIndex);
                        const startLine = Math.max(1, line - context);
                        const endLine = Math.min(lines.length, line + context);
                        const snippet = lines.slice(startLine - 1, endLine).join('\n');
                        results.push({
                            path: relPath,
                            line,
                            column,
                            match: match[0],
                            context: snippet
                        });
                        if (results.length >= MAX_RESULTS)
                            break;
                        if (!pattern.global)
                            break;
                    }
                }
                catch (e) {
                    // Ignore binary files or read errors
                }
            }
            return { status: "ok", query: args.query, regex: isRegex, results, truncated: results.length >= MAX_RESULTS };
        }
        catch (e) {
            console.error(`[Filesystem] SearchInFiles error: ${e.message}`);
            return { status: "error", message: e.message };
        }
    }
}
exports.SearchInFilesTool = SearchInFilesTool;
class ProjectStructureTool extends base_tool_1.BaseToolImplementation {
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
    async execute(args) {
        const root = (0, context_1.getWorkspaceRoot)();
        try {
            const structure = await getProjectStructure(root);
            if (args.include_content) {
                const filesWithContent = [];
                const textFiles = structure.entries.filter((e) => e.type === 'file');
                for (const file of textFiles) {
                    try {
                        const fullPath = path_1.default.resolve(root, file.path);
                        const content = await promises_1.default.readFile(fullPath, 'utf-8');
                        // Basic binary check (null bytes)
                        if (content.indexOf('\0') === -1 && content.length < 100000) {
                            filesWithContent.push({ path: file.path, content });
                        }
                    }
                    catch (e) { }
                }
                structure.files = filesWithContent;
            }
            structure.status = "ok";
            return structure;
        }
        catch (e) {
            return { status: "error", message: e.message };
        }
    }
}
exports.ProjectStructureTool = ProjectStructureTool;
