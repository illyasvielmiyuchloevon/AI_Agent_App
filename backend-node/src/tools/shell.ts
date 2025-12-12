import path from 'path';
import { exec, spawnSync } from 'child_process';
import { promisify } from 'util';
import { BaseToolImplementation } from '../core/base_tool';
import { getWorkspaceRoot } from '../context';

const execAsync = promisify(exec);

const LS_FALLBACK_MODE = (process.env.SHELL_LS_FALLBACK || 'auto').toLowerCase(); // auto | always | never

function commandExists(cmd: string): boolean {
    const res = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return res.status === 0;
}

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
        } catch (e: any) {
            // If initial run failed and we are on Windows with an ls-like command, try fallback once
            if (allowFallback && command !== fallbackCommand) {
                let fallbackError: any = null;
                try {
                    const { stdout = '', stderr = '' } = await execAsync(fallbackCommand, {
                        cwd,
                        windowsHide: true,
                        maxBuffer: 10 * 1024 * 1024
                    });
                    const body = stdout || (stderr ? `STDERR:\n${stderr}` : '');
                    const note = `\n[FALLBACK ran "${fallbackCommand}" instead of "${args.command}"]`;
                    return body ? `${body}${note}` : note.trim();
                } catch {
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
