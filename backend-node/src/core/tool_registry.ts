import Ajv from 'ajv';
import { BaseTool } from './types';
import * as db from '../db';
import { Monitor } from './monitor';

export class ToolRegistry {
    private tools: Map<string, BaseTool> = new Map();
    private ajv: Ajv;
    private validators: Map<string, any> = new Map();
    public debugMode: boolean = false;

    constructor() {
        this.ajv = new Ajv();
    }

    register(tool: BaseTool) {
        if (this.tools.has(tool.name)) {
            console.warn(`[ToolRegistry] Tool ${tool.name} is already registered. Overwriting.`);
        }
        this.tools.set(tool.name, tool);
        
        // Compile validator
        try {
            const validate = this.ajv.compile(tool.input_schema);
            this.validators.set(tool.name, validate);
        } catch (e: any) {
            console.error(`[ToolRegistry] Failed to compile schema for tool ${tool.name}: ${e.message}`);
        }
    }

    getTool(name: string): BaseTool | undefined {
        return this.tools.get(name);
    }

    getTools(): BaseTool[] {
        return Array.from(this.tools.values());
    }

    async execute(name: string, args: any, sessionId?: string): Promise<any> {
        const tool = this.tools.get(name);
        const startTime = Date.now();
        const logData: any = {
            tool: name,
            args: args,
            timestamp: new Date().toISOString()
        };

        if (this.debugMode) {
            console.log(`[ToolRegistry][DEBUG] Request to execute ${name}`, JSON.stringify(args, null, 2));
        }

        if (!tool) {
            const error = `Tool ${name} not found`;
            console.error(`[ToolRegistry] ${error}`);
            Monitor.recordExecution(false);
            if (sessionId) {
                await db.addLog(sessionId, 'system', 'tool_execution', name, logData, { error }, 404, false, false, error);
            }
            throw new Error(error);
        }

        // Validate arguments
        const validate = this.validators.get(name);
        if (validate && !validate(args)) {
            const errors = validate.errors;
            const errorMsg = `Invalid arguments for tool ${name}: ${JSON.stringify(errors)}`;
            console.error(`[ToolRegistry] ${errorMsg}`);
            Monitor.recordExecution(false);
            if (sessionId) {
                await db.addLog(sessionId, 'system', 'tool_execution', name, logData, { error: errorMsg, validation_errors: errors }, 400, false, false, errorMsg);
            }
            throw new Error(errorMsg);
        }

        try {
            console.log(`[ToolRegistry] Executing ${name} with args: ${JSON.stringify(args)}`);
            const result = await tool.execute(args);
            const duration = Date.now() - startTime;
            
            if (this.debugMode) {
                console.log(`[ToolRegistry][DEBUG] Execution result for ${name}:`, JSON.stringify(result, null, 2));
            }
            const resultPreview = typeof result === 'string' ? result.slice(0, 400) : JSON.stringify(result).slice(0, 400);
            console.log(`[ToolRegistry] Executed ${name} ok in ${duration}ms, result preview: ${resultPreview}${resultPreview.length >= 400 ? '...trimmed' : ''}`);

            Monitor.recordExecution(true);
            if (sessionId) {
                await db.addLog(sessionId, 'system', 'tool_execution', name, logData, { result, duration }, 200, true, true);
            }
            return result;
        } catch (e: any) {
            const duration = Date.now() - startTime;
            console.error(`[ToolRegistry] Error executing ${name}: ${e.message}`);
            Monitor.recordExecution(false);
            if (sessionId) {
                await db.addLog(sessionId, 'system', 'tool_execution', name, logData, { error: e.message, stack: e.stack, duration }, 500, false, false, e.message);
            }
            throw e;
        }
    }
}
