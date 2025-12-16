import { AsyncLocalStorage } from "async_hooks";

export interface WorkspaceContextValue {
  id: string;
  root: string;
}

export const workspaceContext = new AsyncLocalStorage<WorkspaceContextValue>();

export function getWorkspaceRoot(): string {
  const store = workspaceContext.getStore();
  if (!store?.root) {
    throw new Error("Workspace root is not bound. Please select a project folder first.");
  }
  return store.root;
}

export function tryGetWorkspaceRoot(): string | undefined {
  return workspaceContext.getStore()?.root;
}

export function getWorkspaceId(): string {
  const store = workspaceContext.getStore();
  if (!store?.id) {
    throw new Error("Workspace is not bound.");
  }
  return store.id;
}

export function tryGetWorkspaceId(): string | undefined {
  return workspaceContext.getStore()?.id;
}
