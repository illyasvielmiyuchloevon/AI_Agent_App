import { ToolRegistry } from '../core/tool_registry';
import { BaseTool } from '../core/types';
import {
  ReadFileTool,
  WriteFileTool,
  ListFilesTool,
  EditFileTool,
  CreateFolderTool,
  DeleteFileTool,
  RenameFileTool,
  SearchInFilesTool,
  ProjectStructureTool
} from '../tools/filesystem';
import { ExecuteShellTool } from '../tools/shell';
import { ScreenCaptureTool } from '../tools/screen_capture';
import { KeyboardControlTool, MouseControlTool } from '../tools/desktop';
import { WorkspaceSemanticSearchTool } from '../tools/rag_tools';
import { RagIndex } from './rag_index';
import { AiEngineRuntimeConfig } from './runtime_config';

export interface AiToolExecutorOptions {
  getRagIndex?: (root: string) => RagIndex;
  getConfig?: () => AiEngineRuntimeConfig;
}

export class AiToolExecutor {
  private registry: ToolRegistry;
  private tools: BaseTool[];

  constructor(opts: AiToolExecutorOptions = {}) {
    this.registry = new ToolRegistry();
    this.tools = [
      new ReadFileTool(),
      new WriteFileTool(),
      new ListFilesTool(),
      new EditFileTool(),
      new CreateFolderTool(),
      new DeleteFileTool(),
      new RenameFileTool(),
      new SearchInFilesTool(),
      new ProjectStructureTool(),
      new ExecuteShellTool(),
      new ScreenCaptureTool(),
      new KeyboardControlTool(),
      new MouseControlTool()
    ];

    if (opts.getRagIndex && opts.getConfig) {
      this.tools.push(new WorkspaceSemanticSearchTool(opts.getRagIndex, opts.getConfig));
    }

    this.tools.forEach(t => this.registry.register(t));
  }

  async execute(toolName: string, args: unknown, sessionId?: string) {
    return this.registry.execute(toolName, args as any, sessionId);
  }
}

