# 自研 IDE 内部数据交换与 VS Code 插件兼容方案（完整计划）

**版本**：v1.0  
**日期**：2026-01-01  
**作者**：ilya（草案）

---

## 1. 背景与目标

你在开发自研 IDE，希望：

- 在 IDE 内部（UI、核心、插件宿主、语言/调试等工具进程）之间建立稳定、高性能、可演进的数据交换机制；
- 尽可能兼容 VS Code 插件生态，提高通用性；
- 为未来 Remote IDE、云端开发、跨平台（Windows / macOS / Linux）预留空间。

本方案采用 **进程隔离 + 统一 RPC 协议 + 可替换传输层** 的设计，并直接拥抱 VS Code 生态核心标准 **LSP / DAP**。

---

## 2. 总体原则（Non-Functional Requirements）

- **兼容优先**：对外对齐 VS Code API 语义，对内接口稳定。
- **隔离优先**：插件与工具进程不共享内存，通过 IPC 交互。
- **协议优先**：统一 JSON-RPC 2.0。
- **URI 优先**：资源统一使用 URI，而不是物理路径。
- **可演进**：版本 + capability 协商。
- **可观测**：日志、Trace、性能指标内建。

---

## 3. 目标架构（参考 VS Code / Xcode）

### 3.1 逻辑分层

1. **UI / Renderer**
2. **IDE Core（主进程）**
3. **Extension Host（插件宿主，推荐独立进程，Node.js）**
4. **Tooling Hosts**
   - Language Server（LSP）
   - Debug Adapter（DAP）
   - Indexer / Search / Terminal

所有模块通过统一的 **IDE Bus** 通信。

---

### 3.2 IDE Bus 设计

- **协议语义**：JSON-RPC 2.0
- **默认传输**：stdio
- **可选传输**：
  - Windows Named Pipe
  - Unix Domain Socket
  - TCP / WebSocket（Remote）

---

## 4. VS Code 插件兼容策略（核心）

### 4.1 兼容对象

- `vscode` 扩展 API
- 扩展宿主模型（激活、贡献点、生命周期）
- 协议生态：**LSP / DAP**

---

### 4.2 Extension Host：vscode API 兼容层

- 插件运行在 Extension Host 中
- `vscode.*` API → JSON-RPC → IDE Core
- IDE Core 通过 notification 推送事件

目标：**让插件以为自己在 VS Code 中运行**

---

### 4.3 语言与调试

- **语言能力**：IDE Core = LSP Client
- **调试能力**：IDE Core = DAP Client
- 语言服务器 / 调试适配器 = 独立进程

---

## 5. 内部协议设计（JSON-RPC）

### 5.1 初始化与能力协商

```json
initialize(params) -> {
  protocolVersion,
  clientCapabilities
}
```

返回：

```json
{
  serverVersion,
  serverCapabilities
}
```

---

### 5.2 方法命名空间建议

- `workspace/*`
- `editor/*`
- `window/*`
- `commands/*`
- `extensions/*`
- `tasks/*`
- `debug/*`
- `telemetry/*`

---

### 5.3 资源标识（URI）

- `file:///path/to/file`
- `ide:///virtual/doc/123`
- `ssh://host/path`
- `git://repo#ref:path`

---

### 5.4 大数据传输

- 小数据：直接 JSON
- 大数据：旁路传输（handle + RPC 控制）

---

## 6. 传输层实现建议

### stdio（默认）

- 跨平台、实现简单
- stdout 只用于协议
- stderr 用于日志

### Pipe / Socket

- 高吞吐、低延迟
- 适合索引、诊断等高频事件

### Remote（预留）

- TCP / WebSocket
- 鉴权、压缩、断线重连

---

## 7. 安全与权限模型

### 7.1 插件权限分级

- 基础：编辑、语言能力
- 受限：网络、进程执行
- 高危：文件系统、系统调试

---

### 7.2 Workspace Trust

- 未信任：限制高危 API
- 信任后：提升权限
- 明确 UI 提示 + 可审计配置

---

### 7.3 稳定性

- 插件/工具崩溃不影响 Core
- Watchdog + 自动重启
- 文档状态由 Core 兜底

---

## 8. 可观测与性能目标

### 8.1 可观测性

- traceId / spanId
- 结构化日志
- RPC 耗时、队列长度

### 8.2 性能目标（示例）

| 场景 | p95 目标 |
|----|----|
| 补全 | < 60ms |
| 诊断更新 | < 200ms |
| 扩展激活 | < 800ms |

---

## 9. 实施路线图

### Phase 0：技术基线（1–2 周）

- JSON-RPC 框架
- 进程模型

### Phase 1：IDE Bus + Core API（2–4 周）

- workspace / editor / commands
- 文档模型

### Phase 2：VS Code API MVP（4–8 周）

- vscode API 子集
- 跑通典型扩展

### Phase 3：LSP / DAP（并行）

- 至少 1 门语言 + 1 个调试器

### Phase 4：安全与稳定性

### Phase 5：生态规模化

---

## 10. 风险与缓解

- API 面太大 → 子集优先
- IPC 性能 → 批处理 / pipe
- 安全风险 → 权限 + Trust
- 跨平台 → URI + 抽象

---

## 11. MVP API 子集（建议）

- commands.registerCommand / executeCommand
- workspace.openTextDocument
- workspace.getConfiguration
- window.showInformationMessage
- diagnostics
- languages.registerCompletionItemProvider（可桥接 LSP）

---

**结论**：  
这套方案在架构、协议与生态层面都与 VS Code 高度同构，同时保持你对 IDE Core 的完全控制，是当前“自研 IDE + 插件通用性”的最优工程解。
