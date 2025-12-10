import { AsyncLocalStorage } from 'async_hooks';

export const workspaceContext = new AsyncLocalStorage<{ root: string }>();

export function getWorkspaceRoot(): string {
    const store = workspaceContext.getStore();
    if (!store?.root) {
        console.error("[Context] Accessing workspace root but it is not bound!");
        throw new Error("Workspace root is not bound. Please select a project folder first.");
    }
    return store.root;
}

export function tryGetWorkspaceRoot(): string | undefined {
    return workspaceContext.getStore()?.root;
}
