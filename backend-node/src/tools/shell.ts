import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { BaseToolImplementation } from '../core/base_tool';
import { getWorkspaceRoot } from '../context';

const execAsync = promisify(exec);

export class ExecuteShellTool extends BaseToolImplementation {
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

    async execute(args: { command: string, workdir?: string }, _context: { sessionId?: string } = {}): Promise<any> {
        const root = getWorkspaceRoot();
        if (!root) {
            return 'Error: Workspace root is not bound; cannot execute shell command.';
        }

        const rootPath = path.resolve(root);
        const cwd = args.workdir ? path.resolve(rootPath, args.workdir) : rootPath;

        // Security check to ensure the working directory stays under the workspace
        const relative = path.relative(rootPath, cwd);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
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
        } catch (e: any) {
            const stdout = e?.stdout || '';
            const stderr = e?.stderr || '';
            const code = typeof e?.code !== 'undefined' ? e.code : 'unknown';
            return `Error executing command (code ${code}): ${e?.message || 'Unknown error'}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
        }
    }
}
