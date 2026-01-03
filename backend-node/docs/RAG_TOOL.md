# 语义检索工具 (Workspace Semantic Search Tool) 维护文档

## 工具定义
- **类名**: `WorkspaceSemanticSearchTool`
- **内部名称**: `workspace_semantic_search`
- **描述**: 对整个工作区进行语义搜索，查找相关的代码片段、定义和逻辑。该工具利用向量索引和关键词初筛技术，提供高精度的代码检索能力。

## 参数说明
| 参数名 | 类型 | 必填 | 描述 |
| :--- | :--- | :--- | :--- |
| `query` | `string` | 是 | 自然语言查询或技术问题。 |
| `scopes` | `string[]` | 否 | 可选的文件路径或 Glob 模式，用于限制搜索范围。 |
| `budget_tokens` | `number` | 否 | 结果的最大 Token 预算（默认 4000）。 |
| `mode` | `enum` | 否 | 检索策略：`precise` (Top-5), `balanced` (Top-10), `comprehensive` (Top-20)。 |
| `top_k` | `number` | 否 | 手动指定返回的片段数量。如果提供，将覆盖 `mode` 的默认值。 |

## 工作原理
1. **向量化**: 使用本地 `llama.cpp` (AMD GPU 加速) 或配置的 Embedding Provider 将 `query` 转换为向量。
2. **混合检索**:
   - 首先在 `RagIndex` 中提取与查询相关的关键词。
   - 过滤出包含这些关键词的候选代码块。
   - 计算候选块与查询向量的余弦相似度。
3. **重排序**: 结合关键词命中数和向量相似度进行综合评分排序。
4. **上下文打包**: 将命中的代码片段、文件路径、行号范围格式化为 `context_pack` 字符串。

## 返回格式
工具返回一个包含状态、消息和 `context_pack` 的对象。`context_pack` 是一个格式化的字符串，直接供 LLM 阅读。

```json
{
  "status": "ok",
  "message": "Found 5 relevant items.",
  "context_pack": "Relevant code snippets (retrieved):\n\nsrc/main.ts:10-20\nexport function main() {\n  console.log('hello');\n}\n\nsrc/utils.ts:5-15\nexport function add(a, b) {\n  return a + b;\n}"
}
```

## 集成方式

### 后端集成
在 `src/agent.ts` 中通过 `AgentOptions` 注入依赖：
```typescript
const agent = new Agent(client, {
  sessionId,
  contextMaxLength,
  getRagIndex: (root) => aiEngine.getOrCreateRagIndex(root),
  getConfig: () => aiEngine.configStore.get()
});
```

### 前端集成
在 `App.jsx` 的 `DEFAULT_TOOL_SETTINGS` 中配置开启状态。用户可以在“设置 -> 语义检索 (RAG)”中手动切换。

## 常见问题与排查
1. **找不到结果**: 
   - 检查 `.aichat/rag_index.json` 是否存在。
   - 确认文件扩展名是否在支持范围内（`.ts`, `.py`, `.go` 等）。
   - 检查 `shouldIndexFile` 逻辑是否过滤了目标文件。
2. **硬件加速失效**:
   - 检查 `LLAMACPP_EMBEDDINGS_BASE_URL` 环境变量。
   - 检查 AMD 驱动和 ROCm 环境是否正常。
   - 查看后端日志中是否有 `[LLM] Requesting embeddings` 的输出。
3. **结果不相关**: 
   - 增加 `top_k` 或切换到 `comprehensive` 模式。
   - 确保 Embedding 模型已正确加载且维度一致。
