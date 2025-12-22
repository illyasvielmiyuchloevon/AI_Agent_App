import { BaseToolImplementation } from '../core/base_tool';
import { getWorkspaceRoot } from '../context';
import { RagIndex } from '../ai-engine/rag_index';
import { AiEngineRuntimeConfig } from '../ai-engine/runtime_config';
import path from 'path';

export interface WorkspaceSemanticSearchArgs {
  query: string;
  scopes?: string[];
  budget_tokens?: number;
  mode?: 'precise' | 'balanced' | 'comprehensive';
  top_k?: number;
}

export class WorkspaceSemanticSearchTool extends BaseToolImplementation {
  name = "workspace_semantic_search";
  description = "Semantic search across the entire workspace to find relevant code snippets, definitions, and logic. Uses vector embeddings to match concepts even without exact keyword matches.";
  input_schema = {
    type: "object",
    properties: {
      query: { type: "string", description: "The natural language query or technical question to search for" },
      scopes: { type: "array", items: { type: "string" }, description: "Optional file paths or globs to restrict search to specific areas" },
      budget_tokens: { type: "number", description: "Maximum token budget for the search results (default 4000)" },
      mode: { 
        type: "string", 
        enum: ["precise", "balanced", "comprehensive"],
        description: "Strategy for retrieval. precise=fewer high-quality hits, comprehensive=more hits with less context."
      },
      top_k: { type: "number", description: "Manual override for number of hits to retrieve" }
    },
    required: ["query"]
  };

  private getRagIndex: (root: string) => RagIndex;
  private getConfig: () => AiEngineRuntimeConfig;

  constructor(getRagIndex: (root: string) => RagIndex, getConfig: () => AiEngineRuntimeConfig) {
    super();
    this.getRagIndex = getRagIndex;
    this.getConfig = getConfig;
  }

  async execute(args: WorkspaceSemanticSearchArgs, _context: { sessionId?: string } = {}): Promise<any> {
    const root = getWorkspaceRoot();
    const cfg = this.getConfig();
    const idx = this.getRagIndex(root);
    
    const budgetTokens = args.budget_tokens || 4000;
    const mode = args.mode || 'balanced';
    
    let topK = args.top_k || 8;
    if (mode === 'precise') topK = 4;
    if (mode === 'comprehensive') topK = 15;

    const embeddingModel = cfg.defaultModels?.embeddings || 'text-embedding-3-small';
    
    try {
      // 1. Vector Search
      const items = await idx.queryTopK({
        query: args.query,
        cfg,
        embeddingModel,
        topK: topK * 2, // Get more candidates for filtering/dedup
        maxCandidates: 1000
      });

      if (items.length === 0) {
        return {
          status: "ok",
          message: "No relevant context found.",
          context_pack: ""
        };
      }

      // 2. Filter by scopes if provided
      let filtered = items;
      if (args.scopes && args.scopes.length > 0) {
        const scopeSet = new Set(args.scopes.map(s => s.toLowerCase()));
        filtered = items.filter(it => {
          const lowerPath = it.filePath.toLowerCase();
          return args.scopes!.some(s => lowerPath.includes(s.toLowerCase()));
        });
      }

      // 3. Dedup and Rank
      // Sort by score and take top_k
      const topItems = filtered.sort((a, b) => b.score - a.score).slice(0, topK);

      // 4. Pack and "Compress" (simple truncation based on token budget)
      // Approx 1 token = 4 chars
      const charLimit = budgetTokens * 4;
      let currentChars = 0;
      const packedItems: any[] = [];

      for (const it of topItems) {
        const header = `File: ${it.filePath} (lines ${it.startLine}-${it.endLine})`;
        const itemChars = header.length + it.text.length + 10;
        
        if (currentChars + itemChars > charLimit && packedItems.length > 0) {
          // If we're over budget, maybe add a truncated version or skip
          if (currentChars < charLimit * 0.8) {
             const remaining = charLimit - currentChars - header.length - 50;
             if (remaining > 200) {
               packedItems.push({
                 file: it.filePath,
                 lines: `${it.startLine}-${it.endLine}`,
                 content: it.text.slice(0, remaining) + "\n[...truncated due to budget...]"
               });
             }
          }
          break;
        }

        packedItems.push({
          file: it.filePath,
          lines: `${it.startLine}-${it.endLine}`,
          content: it.text
        });
        currentChars += itemChars;
      }

      // 5. Build the final context pack string
      const packStr = packedItems.map(p => `--- ${p.file}:${p.lines} ---\n${p.content}`).join('\n\n');

      return {
        status: "ok",
        query: args.query,
        mode,
        hits: packedItems.length,
        context_pack: packStr,
        metadata: {
          budget_tokens: budgetTokens,
          used_approx_tokens: Math.ceil(currentChars / 4)
        }
      };
    } catch (e: any) {
      console.error(`[RAG Tool] Error in workspace_semantic_search: ${e.message}`);
      return { status: "error", message: e.message };
    }
  }
}
