"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecuteShellTool = void 0;
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const base_tool_1 = require("../core/base_tool");
const context_1 = require("../context");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
const LS_FALLBACK_MODE = (process.env.SHELL_LS_FALLBACK || 'auto').toLowerCase(); // auto | always | never
function commandExists(cmd) {
    const res = (0, child_process_1.spawnSync)(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return res.status === 0;
}
class ExecuteShellTool extends base_tool_1.BaseToolImplementation {
    name = "execute_shell";
    description = "Execute a shell command in the workspace root.";
    input_schema = {
        type: "object",
        properties: {
            command: { type: "string", description: "The command to execute." },
            workdir: { type: "string", description: "Optional working directory relative to the workspace root." }
        },
        required: ["command"]
    };
    async execute(args, _context = {}) {
        let root = '';
        try {
            root = (0, context_1.getWorkspaceRoot)();
        }
        catch (e) {
            return `Error: ${e?.message || String(e)}`;
        }
        const rootPath = path_1.default.resolve(root);
        const cwd = args.workdir ? path_1.default.resolve(rootPath, args.workdir) : rootPath;
        // Security check to ensure the working directory stays under the workspace
        const relative = path_1.default.relative(rootPath, cwd);
        if (relative.startsWith('..') || path_1.default.isAbsolute(relative)) {
            return 'Error: Working directory must remain within the workspace root.';
        }
        const isWin = process.platform === 'win32';
        // Simple Windows compatibility shim: translate common *nix ls to dir
        let command = args.command;
        let fallbackCommand = command;
        const trimmed = command.trim();
        const lsMatch = isWin && /^ls\b/i.test(trimmed);
        const mode = ['auto', 'always', 'never'].includes(LS_FALLBACK_MODE) ? LS_FALLBACK_MODE : 'auto';
        const allowFallback = lsMatch && mode !== 'never';
        if (lsMatch && mode !== 'never') {
            const hasAll = /-a/.test(trimmed) || /-l/.test(trimmed);
            fallbackCommand = `dir ${hasAll ? '/a' : ''}`.trim();
            // Prefer running dir up front unless explicitly disabled
            command = fallbackCommand;
        }
        try {
            const { stdout = '', stderr = '' } = await execAsync(command, {
                cwd,
                windowsHide: true,
                maxBuffer: 10 * 1024 * 1024 // allow larger outputs before failing
            });
            if (stderr && stdout) {
                return `${stdout}\nSTDERR:\n${stderr}`;
            }
            return stdout || (stderr ? `STDERR:\n${stderr}` : '');
        }
        catch (e) {
            // If initial run failed and we are on Windows with an ls-like command, try fallback once
            if (allowFallback && command !== fallbackCommand) {
                let fallbackError = null;
                try {
                    const { stdout = '', stderr = '' } = await execAsync(fallbackCommand, {
                        cwd,
                        windowsHide: true,
                        maxBuffer: 10 * 1024 * 1024
                    });
                    const body = stdout || (stderr ? `STDERR:\n${stderr}` : '');
                    const note = `\n[FALLBACK ran "${fallbackCommand}" instead of "${args.command}"]`;
                    return body ? `${body}${note}` : note.trim();
                }
                catch {
                    fallbackError = true;
                    // fall through to original error reporting but annotate
                }
            }
            const stdout = e?.stdout || '';
            const stderr = e?.stderr || '';
            const code = typeof e?.code !== 'undefined' ? e.code : 'unknown';
            const note = allowFallback && command !== fallbackCommand ? '\n(Fallback to "dir" also failed or was skipped)' : '';
            return `Error executing command (code ${code}): ${e?.message || 'Unknown error'}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}${note}`;
        }
    }
}
exports.ExecuteShellTool = ExecuteShellTool;
