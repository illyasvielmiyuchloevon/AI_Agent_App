export interface ContentPart {
    type: 'text' | 'image_url';
    text?: string;
    image_url?: { url: string };
}

export interface ToolCall {
    id: string;
    function: {
        name: string;
        arguments: any; // Parsed JSON object
    };
}

export interface UnifiedMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string | ContentPart[];
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    name?: string;
}

export interface ToolSchema {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: any;
    };
}

export interface BaseTool {
    name: string;
    description: string;
    input_schema: any;
    execute(args: any, context?: { sessionId?: string }): Promise<any>;
    toOpenAISchema(): ToolSchema;
}
