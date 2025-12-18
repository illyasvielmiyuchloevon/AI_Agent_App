export type AiCapability = 'chat' | 'inline' | 'editorAction' | 'tools' | 'embeddings';

export type AiProviderId = 'openai' | 'anthropic' | 'local';

export type AiEnvironment = 'dev' | 'test' | 'prod';

export interface AiEngineRequestBase {
  requestId?: string;
  sessionId?: string;
  workspaceId?: string;
  workspaceRoot?: string;
  capability: AiCapability;
  env?: AiEnvironment;
  stream?: boolean;
}

export interface AiEditorSelection {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface AiEditorContext {
  filePath?: string;
  languageId?: string;
  cursorLine?: number;
  cursorColumn?: number;
  selection?: AiEditorSelection;
  visibleText?: string;
  selectedText?: string;
}

export interface AiChatRequest extends AiEngineRequestBase {
  capability: 'chat';
  message: string;
  mode?: string;
  attachments?: Array<{ name: string; contentType?: string; size?: number }>;
  toolOverrides?: string[];
  editor?: AiEditorContext;
  llmConfig?: Record<string, unknown>;
}

export interface AiInlineRequest extends AiEngineRequestBase {
  capability: 'inline';
  editor: AiEditorContext & { visibleText: string };
  maxTokens?: number;
  llmConfig?: Record<string, unknown>;
}

export type AiEditorActionKind = 'refactor' | 'explain' | 'optimize';

export interface AiEditorActionRequest extends AiEngineRequestBase {
  capability: 'editorAction';
  action: AiEditorActionKind;
  instruction: string;
  editor: AiEditorContext & { visibleText: string };
  llmConfig?: Record<string, unknown>;
}

export interface AiToolsRequest extends AiEngineRequestBase {
  capability: 'tools';
  toolName: string;
  args: unknown;
}

export interface AiEmbeddingsRequest extends AiEngineRequestBase {
  capability: 'embeddings';
  texts: string[];
  model?: string;
  llmConfig?: Record<string, unknown>;
}

export type AiEngineRequest =
  | AiChatRequest
  | AiInlineRequest
  | AiEditorActionRequest
  | AiToolsRequest
  | AiEmbeddingsRequest;

export interface AiRouteTarget {
  provider: AiProviderId;
  model?: string;
  tags?: string[];
}

export interface AiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AiEngineResponseBase {
  requestId: string;
  capability: AiCapability;
  route: AiRouteTarget;
  latencyMs: number;
  usage?: AiUsage;
}

export interface AiChatResponse extends AiEngineResponseBase {
  capability: 'chat';
  content: string;
}

export interface AiInlineSuggestion {
  text: string;
  kind?: 'insert' | 'snippet';
}

export interface AiInlineResponse extends AiEngineResponseBase {
  capability: 'inline';
  suggestions: AiInlineSuggestion[];
}

export interface AiEditorEdit {
  filePath: string;
  selection?: AiEditorSelection;
  newText: string;
}

export interface AiEditorActionResponse extends AiEngineResponseBase {
  capability: 'editorAction';
  content: string;
  edits?: AiEditorEdit[];
}

export interface AiToolsResponse extends AiEngineResponseBase {
  capability: 'tools';
  result: unknown;
}

export interface AiEmbeddingsResponse extends AiEngineResponseBase {
  capability: 'embeddings';
  vectors: number[][];
}

export type AiEngineResponse =
  | AiChatResponse
  | AiInlineResponse
  | AiEditorActionResponse
  | AiToolsResponse
  | AiEmbeddingsResponse;

