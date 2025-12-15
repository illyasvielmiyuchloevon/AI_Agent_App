"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workspaceContext = void 0;
exports.getWorkspaceRoot = getWorkspaceRoot;
exports.tryGetWorkspaceRoot = tryGetWorkspaceRoot;
exports.getWorkspaceId = getWorkspaceId;
exports.tryGetWorkspaceId = tryGetWorkspaceId;
const async_hooks_1 = require("async_hooks");
exports.workspaceContext = new async_hooks_1.AsyncLocalStorage();
function getWorkspaceRoot() {
    const store = exports.workspaceContext.getStore();
    if (!store?.root) {
        throw new Error("Workspace root is not bound. Please select a project folder first.");
    }
    return store.root;
}
function tryGetWorkspaceRoot() {
    return exports.workspaceContext.getStore()?.root;
}
function getWorkspaceId() {
    const store = exports.workspaceContext.getStore();
    if (!store?.id) {
        throw new Error("Workspace is not bound.");
    }
    return store.id;
}
function tryGetWorkspaceId() {
    return exports.workspaceContext.getStore()?.id;
}
