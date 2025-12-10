"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecuteShellTool = void 0;
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
    async execute(args) {
        const root = (0, context_1.getWorkspaceRoot)();
        const cwd = args.workdir ? require('path').resolve(root, args.workdir) : root;
        // Security check for cwd
        if (!cwd.startsWith(root)) {
            return `Error: Working directory must be within workspace root.`;
        }
        try {
            const { stdout, stderr } = await execAsync(args.command, { cwd });
            return stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
        }
        catch (e) {
            return `Error executing command: ${e.message}\nSTDOUT: ${e.stdout}\nSTDERR: ${e.stderr}`;
        }
    }
}
exports.ExecuteShellTool = ExecuteShellTool;
