"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolRegistry = void 0;
const ajv_1 = __importDefault(require("ajv"));
const db = __importStar(require("../db"));
const monitor_1 = require("./monitor");
class ToolRegistry {
    tools = new Map();
    ajv;
    validators = new Map();
    debugMode = false;
    constructor() {
        this.ajv = new ajv_1.default();
    }
    register(tool) {
        if (this.tools.has(tool.name)) {
            console.warn(`[ToolRegistry] Tool ${tool.name} is already registered. Overwriting.`);
        }
        this.tools.set(tool.name, tool);
        // Compile validator
        try {
            const validate = this.ajv.compile(tool.input_schema);
            this.validators.set(tool.name, validate);
        }
        catch (e) {
            console.error(`[ToolRegistry] Failed to compile schema for tool ${tool.name}: ${e.message}`);
        }
    }
    getTool(name) {
        return this.tools.get(name);
    }
    getTools() {
        return Array.from(this.tools.values());
    }
    async execute(name, args, sessionId) {
        const tool = this.tools.get(name);
        const startTime = Date.now();
        const logData = {
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
            monitor_1.Monitor.recordExecution(false);
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
            monitor_1.Monitor.recordExecution(false);
            if (sessionId) {
                await db.addLog(sessionId, 'system', 'tool_execution', name, logData, { error: errorMsg, validation_errors: errors }, 400, false, false, errorMsg);
            }
            throw new Error(errorMsg);
        }
        try {
            console.log(`[ToolRegistry] Executing ${name} with args: ${JSON.stringify(args)}`);
            const result = await tool.execute(args, { sessionId });
            const duration = Date.now() - startTime;
            if (this.debugMode) {
                console.log(`[ToolRegistry][DEBUG] Execution result for ${name}:`, JSON.stringify(result, null, 2));
            }
            const resultPreview = typeof result === 'string' ? result.slice(0, 400) : JSON.stringify(result).slice(0, 400);
            console.log(`[ToolRegistry] Executed ${name} ok in ${duration}ms, result preview: ${resultPreview}${resultPreview.length >= 400 ? '...trimmed' : ''}`);
            monitor_1.Monitor.recordExecution(true);
            if (sessionId) {
                await db.addLog(sessionId, 'system', 'tool_execution', name, logData, { result, duration }, 200, true, true);
            }
            return result;
        }
        catch (e) {
            const duration = Date.now() - startTime;
            console.error(`[ToolRegistry] Error executing ${name}: ${e.message}`);
            monitor_1.Monitor.recordExecution(false);
            if (sessionId) {
                await db.addLog(sessionId, 'system', 'tool_execution', name, logData, { error: e.message, stack: e.stack, duration }, 500, false, false, e.message);
            }
            throw e;
        }
    }
}
exports.ToolRegistry = ToolRegistry;
