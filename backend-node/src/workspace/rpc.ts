export const WORKSPACE_RPC_VERSION = "1.0.0";

export interface WorkspaceRpcEnvelope<T = any> {
  version: string;
  workspaceId: string;
  data: T;
}

export function createWorkspaceRpcEnvelope<T>(workspaceId: string, data: T): WorkspaceRpcEnvelope<T> {
  return {
    version: WORKSPACE_RPC_VERSION,
    workspaceId,
    data,
  };
}

