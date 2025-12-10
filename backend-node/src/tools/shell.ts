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

    async execute(args: { command: string, workdir?: string }): Promise<any> {
        const root = getWorkspaceRoot();
        const cwd = args.workdir ? require('path').resolve(root, args.workdir) : root;
        
        // Security check for cwd
        if (!cwd.startsWith(root)) {
             return `Error: Working directory must be within workspace root.`;
        }

        try {
            const { stdout, stderr } = await execAsync(args.command, { cwd });
            return stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
        } catch (e: any) {
            return `Error executing command: ${e.message}\nSTDOUT: ${e.stdout}\nSTDERR: ${e.stderr}`;
        }
    }
}
