"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiEngineConfigStore = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const fs_1 = require("fs");
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const runtime_config_1 = require("./runtime_config");
function getGlobalDataDir() {
    const isWin = process.platform === 'win32';
    const baseDir = isWin ? (process.env.APPDATA || process.env.LOCALAPPDATA || os_1.default.homedir()) : os_1.default.homedir();
    return path_1.default.join(baseDir, '.aichat', 'global');
}
function defaultConfigPath() {
    return path_1.default.join(getGlobalDataDir(), 'ai_engine_config.json');
}
class AiEngineConfigStore {
    current;
    configPath;
    watcher = null;
    lastLoadedAt = 0;
    constructor(opts = {}) {
        this.configPath = opts.configPath || defaultConfigPath();
        this.current = (0, runtime_config_1.normalizeRuntimeConfig)(null);
    }
    getConfigPath() {
        return this.configPath;
    }
    get() {
        return this.current;
    }
    async loadOnce() {
        const cfg = await this.readConfigFile();
        this.current = cfg;
        this.lastLoadedAt = Date.now();
        return cfg;
    }
    startWatching() {
        if (this.watcher)
            return;
        try {
            this.watcher = (0, fs_1.watch)(this.configPath, { persistent: false }, async () => {
                const now = Date.now();
                if (now - this.lastLoadedAt < 200)
                    return;
                await this.loadOnce();
            });
        }
        catch {
            this.watcher = null;
        }
    }
    stopWatching() {
        try {
            this.watcher?.close();
        }
        finally {
            this.watcher = null;
        }
    }
    async readConfigFile() {
        try {
            const raw = await promises_1.default.readFile(this.configPath, 'utf-8');
            const parsed = JSON.parse(raw);
            return (0, runtime_config_1.normalizeRuntimeConfig)(parsed);
        }
        catch {
            return (0, runtime_config_1.normalizeRuntimeConfig)(null);
        }
    }
}
exports.AiEngineConfigStore = AiEngineConfigStore;
