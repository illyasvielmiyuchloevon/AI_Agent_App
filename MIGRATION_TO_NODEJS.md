# Migration Guide: Python Backend to Node.js

This document outlines the feasibility and plan for migrating the existing Python (FastAPI) backend to a Node.js (Express/TypeScript) stack.

## 1. Feasibility Analysis

**Verdict:** **Yes, 100% Feasible.**

Node.js is an excellent choice for this architecture, particularly because the application is I/O heavy (waiting for LLM responses, file system operations) rather than CPU-bound.

| Feature | Current Python Stack | Proposed Node.js Stack | Difficulty |
| :--- | :--- | :--- | :--- |
| **API Server** | FastAPI (ASGI) | Express.js or NestJS | Easy |
| **Language** | Python 3.10+ | TypeScript (Recommended) | Easy |
| **Database** | SQLite (`sqlite3`) | `better-sqlite3` or Prisma | Easy |
| **LLM Client** | Custom + `openai`/`anthropic` libs | `@langchain/core` or direct SDKs | Easy |
| **File System** | `os`, `shutil` | `fs/promises`, `path` | Very Easy |
| **Shell Exec** | `subprocess` | `child_process` | Very Easy |
| **Screen Capture** | `mss`, `Pillow` | `screenshot-desktop` + `sharp` | Medium |
| **Mouse/Key** | `pyautogui` | `@nut-tree/nut-js` or `robotjs` | Medium |

## 2. Detailed Service Mapping

### A. API Gateway (`main.py` -> `src/server.ts`)
- **FastAPI** -> **Express**:
  - `app.post("/sessions")` -> `app.post("/api/sessions", ...)`
  - Middleware: `inject_workspace_root` -> Express middleware.
  - Streaming: Python `StreamingResponse` -> Node.js `res.write()` or SSE.

### B. Agent Core (`agent.py` -> `src/agent.ts`)
- The **ReAct Loop** logic is language-independent.
- Python's `async/await` maps directly to JavaScript's `async/await`.
- **State**: The `Agent` class structure can be preserved almost exactly.

### C. LLM Client (`core/llm_client.py` -> `src/core/llm.ts`)
- **OpenAI**: Use `openai` npm package.
- **Anthropic**: Use `@anthropic-ai/sdk` npm package.
- Interfaces: Define TypeScript interfaces (`UnifiedMessage`, `ToolCall`) to match the Python Pydantic models.

### D. Tools (`tools/` -> `src/tools/`)
- **File System**: Node.js `fs` module is non-blocking by default, which is great for the agent.
- **Shell**: `exec` or `spawn` from `child_process`.
- **System Control**:
  - *Screenshot*: Use `screenshot-desktop` to get a Buffer, then `sharp` to resize/compress to JPEG/Base64.
  - *Mouse/Keyboard*: `@nut-tree/nut-js` is a powerful cross-platform automation library for Node.js.

### E. Database (`database.py` -> `src/db.ts`)
- Use `better-sqlite3` for synchronous-like syntax with high performance, or `Prisma` for a type-safe ORM.
- Migration of existing `ai_agent.db` is not needed; the file format is standard SQLite and can be opened by Node.js drivers directly.

## 3. Benefits of Migration

1.  **Unified Stack**: Use JavaScript/TypeScript for both Frontend and Backend.
2.  **Performance**: Node.js event loop handles concurrent I/O (like streaming multiple LLM responses) very efficiently.
3.  **Type Safety**: TypeScript offers stronger static typing than Python's type hints (though Python is catching up).

## 4. Migration Plan

### Phase 1: Setup & Infrastructure
1.  Initialize `backend-node/` with `package.json` and `tsconfig.json`.
2.  Install core dependencies: `express`, `cors`, `better-sqlite3`, `openai`, `anthropic-ai/sdk`.
3.  Set up the server entry point.

### Phase 2: Core Logic Porting
1.  Port `database.py` to `db.ts`.
2.  Port `llm_client.py` to `llm.ts`.
3.  Port `agent.py` (The brain).

### Phase 3: Tools Implementation
1.  Implement basic file/shell tools (Easy).
2.  Implement system tools (Screenshot/Mouse) using Node.js native modules.

### Phase 4: Integration
1.  Connect Express routes to the Agent.
2.  Verify Frontend works with the new backend (API compatibility).

## 5. Proof of Concept (PoC)

A scaffold folder `backend-node` has been created to demonstrate the structure.
