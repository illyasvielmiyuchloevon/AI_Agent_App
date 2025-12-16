"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKSPACE_RPC_VERSION = void 0;
exports.createWorkspaceRpcEnvelope = createWorkspaceRpcEnvelope;
exports.WORKSPACE_RPC_VERSION = "1.0.0";
function createWorkspaceRpcEnvelope(workspaceId, data) {
    return {
        version: exports.WORKSPACE_RPC_VERSION,
        workspaceId,
        data,
    };
}
