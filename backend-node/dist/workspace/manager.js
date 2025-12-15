"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.workspaceManager = exports.WorkspaceManager = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const serviceContainer_1 = require("./serviceContainer");
const context_1 = require("../context");
const db = __importStar(require("../db"));
function normalizeRoot(rootPath) {
    return path_1.default.resolve(String(rootPath || ""));
}
function getDefaultWorkspaceName(rootPath) {
    const base = path_1.default.basename(rootPath);
    return base || "workspace";
}
function getWorkspaceFilePath(rootPath) {
    const normalized = normalizeRoot(rootPath);
    return path_1.default.join(normalized, ".aichat", "workspace.json");
}
async function readWorkspaceFile(rootPath) {
    const filePath = getWorkspaceFilePath(rootPath);
    try {
        const raw = await promises_1.default.readFile(filePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object")
            return null;
        const id = typeof parsed.id === "string" && parsed.id ? parsed.id : normalizeRoot(rootPath);
        const name = typeof parsed.name === "string" && parsed.name ? parsed.name : getDefaultWorkspaceName(rootPath);
        const foldersArray = Array.isArray(parsed.folders) ? parsed.folders : [];
        const folders = foldersArray.map((entry) => {
            if (entry && typeof entry.path === "string" && entry.path) {
                return { path: normalizeRoot(entry.path) };
            }
            if (typeof entry === "string" && entry) {
                return { path: normalizeRoot(entry) };
            }
            return null;
        }).filter(Boolean);
        const foldersValue = folders.length > 0 ? folders : [{ path: normalizeRoot(rootPath) }];
        const openedAt = typeof parsed.openedAt === "string" && parsed.openedAt ? parsed.openedAt : new Date().toISOString();
        const closedAt = typeof parsed.closedAt === "string" ? parsed.closedAt : null;
        const settings = parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {};
        const state = parsed.state && typeof parsed.state === "object" ? parsed.state : {};
        const descriptor = {
            id,
            name,
            folders: foldersValue,
            settings,
            state,
            openedAt,
            closedAt,
            workspaceFile: filePath,
        };
        return descriptor;
    }
    catch {
        return null;
    }
}
async function writeWorkspaceFile(descriptor) {
    const firstFolder = descriptor.folders[0];
    if (!firstFolder)
        return;
    const rootPath = normalizeRoot(firstFolder.path);
    const dir = path_1.default.join(rootPath, ".aichat");
    try {
        await promises_1.default.mkdir(dir, { recursive: true });
    }
    catch {
    }
    const filePath = getWorkspaceFilePath(rootPath);
    const payload = {
        id: descriptor.id,
        name: descriptor.name,
        folders: descriptor.folders.map(f => ({ path: normalizeRoot(f.path) })),
        settings: descriptor.settings,
        state: descriptor.state,
        openedAt: descriptor.openedAt,
        closedAt: descriptor.closedAt ?? null,
    };
    const json = JSON.stringify(payload, null, 2);
    await promises_1.default.writeFile(filePath, json, "utf-8");
}
class DbWorkspaceService {
    async dispose() {
    }
}
class WorkspaceManager {
    workspaces = new Map();
    async openWorkspace(rootPath, options = {}) {
        const normalizedRoot = normalizeRoot(rootPath);
        const fromFile = await readWorkspaceFile(normalizedRoot);
        const id = options.id || fromFile?.id || normalizedRoot;
        const existing = this.workspaces.get(id);
        if (existing) {
            const mergedSettings = {
                ...(existing.descriptor.settings || {}),
                ...(options.settings || {}),
            };
            existing.descriptor.settings = mergedSettings;
            existing.descriptor.closedAt = null;
            await writeWorkspaceFile(existing.descriptor);
            return existing;
        }
        const stats = await promises_1.default.stat(normalizedRoot);
        if (!stats.isDirectory()) {
            throw new Error("Workspace root is not a directory");
        }
        const name = options.name || fromFile?.name || getDefaultWorkspaceName(normalizedRoot);
        const descriptor = {
            id,
            name,
            folders: fromFile?.folders && fromFile.folders.length > 0 ? fromFile.folders : [{ path: normalizedRoot }],
            settings: options.settings || fromFile?.settings || {},
            state: fromFile?.state || {},
            openedAt: fromFile?.openedAt || new Date().toISOString(),
            closedAt: null,
            workspaceFile: getWorkspaceFilePath(normalizedRoot),
        };
        const services = new serviceContainer_1.WorkspaceServiceContainer({ workspace: descriptor });
        services.register("db", () => new DbWorkspaceService());
        await writeWorkspaceFile(descriptor);
        await context_1.workspaceContext.run({ id: descriptor.id, root: normalizedRoot }, async () => {
            await db.initDb();
        });
        const handle = { descriptor, services };
        this.workspaces.set(id, handle);
        return handle;
    }
    async closeWorkspace(id) {
        const handle = this.workspaces.get(id);
        if (!handle)
            return;
        handle.descriptor.closedAt = new Date().toISOString();
        await writeWorkspaceFile(handle.descriptor);
        await handle.services.disposeAll();
        this.workspaces.delete(id);
    }
    getWorkspace(id) {
        return this.workspaces.get(id);
    }
    getWorkspaceByRoot(rootPath) {
        const normalizedRoot = normalizeRoot(rootPath);
        for (const handle of this.workspaces.values()) {
            const first = handle.descriptor.folders[0];
            if (first && normalizeRoot(first.path) === normalizedRoot) {
                return handle;
            }
        }
        return undefined;
    }
    listWorkspaces() {
        return Array.from(this.workspaces.values()).map(h => h.descriptor);
    }
    async switchWorkspace(currentId, nextRootPath, options = {}) {
        if (currentId) {
            await this.closeWorkspace(currentId);
        }
        const handle = await this.openWorkspace(nextRootPath, { name: options.name, settings: options.settings });
        return handle;
    }
}
exports.WorkspaceManager = WorkspaceManager;
exports.workspaceManager = new WorkspaceManager();
