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
        const root = (0, context_1.getWorkspaceRoot)();
        if (!root) {
            return 'Error: Workspace root is not bound; cannot execute shell command.';
        }
        const rootPath = path_1.default.resolve(root);
        const cwd = args.workdir ? path_1.default.resolve(rootPath, args.workdir) : rootPath;
        // Security check to ensure the working directory stays under the workspace
        const relative = path_1.default.relative(rootPath, cwd);
        if (relative.startsWith('..') || path_1.default.isAbsolute(relative)) {
            return 'Error: Working directory must remain within the workspace root.';
        }
        try {
            const { stdout = '', stderr = '' } = await execAsync(args.command, {
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
            const stdout = e?.stdout || '';
            const stderr = e?.stderr || '';
            const code = typeof e?.code !== 'undefined' ? e.code : 'unknown';
            return `Error executing command (code ${code}): ${e?.message || 'Unknown error'}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
        }
    }
}
exports.ExecuteShellTool = ExecuteShellTool;
