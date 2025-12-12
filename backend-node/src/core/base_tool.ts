import { BaseTool, ToolSchema } from './types';

export abstract class BaseToolImplementation implements BaseTool {
    abstract name: string;
    abstract description: string;
    abstract input_schema: any;

    abstract execute(args: any, context?: { sessionId?: string }): Promise<any>;

    toOpenAISchema(): ToolSchema {
        return {
            type: "function",
            function: {
                name: this.name,
                description: this.description,
                parameters: this.input_schema
            }
        };
    }
}
