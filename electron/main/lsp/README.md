# LSP Client (Electron main)

This folder implements a minimal LSP client stack (stdio + JSON-RPC) and exposes it to the renderer via Electron IPC (`lsp:*`).

## Demo (TypeScript)

Renderer-side default behavior (see `frontend/src/workbench/services/lspService.js`):

- Tries to start `typescript-language-server --stdio` for `typescript` / `javascript`.
- If that fails (e.g. not installed), falls back to the bundled fake server:
  - `node main/lsp/tests/fakeLspServer.js` (dev-only convenience).

To use a real server, install it and ensure it is on `PATH` (or change the command in `frontend/src/workbench/services/lspService.js`).

