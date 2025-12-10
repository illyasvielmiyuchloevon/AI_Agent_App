"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workspaceContext = void 0;
exports.getWorkspaceRoot = getWorkspaceRoot;
exports.tryGetWorkspaceRoot = tryGetWorkspaceRoot;
const async_hooks_1 = require("async_hooks");
exports.workspaceContext = new async_hooks_1.AsyncLocalStorage();
function getWorkspaceRoot() {
    const store = exports.workspaceContext.getStore();
    if (!store?.root) {
        console.error("[Context] Accessing workspace root but it is not bound!");
        throw new Error("Workspace root is not bound. Please select a project folder first.");
    }
    return store.root;
}
function tryGetWorkspaceRoot() {
    return exports.workspaceContext.getStore()?.root;
}
