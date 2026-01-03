import fs from 'fs/promises';
import { watch } from 'fs';
import os from 'os';
import path from 'path';
import { normalizeRuntimeConfig, AiEngineRuntimeConfig } from './runtime_config';

export interface AiEngineConfigStoreOptions {
  configPath?: string;
}

function getGlobalDataDir(): string {
  const isWin = process.platform === 'win32';
  const baseDir = isWin ? (process.env.APPDATA || process.env.LOCALAPPDATA || os.homedir()) : os.homedir();
  return path.join(baseDir, '.aichat', 'global');
}

function defaultConfigPath() {
  return path.join(getGlobalDataDir(), 'ai_engine_config.json');
}

export class AiEngineConfigStore {
  private current: AiEngineRuntimeConfig;
  private configPath: string;
  private watcher: ReturnType<typeof watch> | null = null;
  private lastLoadedAt = 0;

  constructor(opts: AiEngineConfigStoreOptions = {}) {
    this.configPath = opts.configPath || defaultConfigPath();
    this.current = normalizeRuntimeConfig(null);
  }

  getConfigPath() {
    return this.configPath;
  }

  get(): AiEngineRuntimeConfig {
    return this.current;
  }

  async loadOnce(): Promise<AiEngineRuntimeConfig> {
    const cfg = await this.readConfigFile();
    this.current = cfg;
    this.lastLoadedAt = Date.now();
    return cfg;
  }

  startWatching() {
    if (this.watcher) return;
    try {
      this.watcher = watch(this.configPath, { persistent: false }, async () => {
        const now = Date.now();
        if (now - this.lastLoadedAt < 200) return;
        await this.loadOnce();
      });
    } catch {
      this.watcher = null;
    }
  }

  stopWatching() {
    try {
      this.watcher?.close();
    } finally {
      this.watcher = null;
    }
  }

  private async readConfigFile(): Promise<AiEngineRuntimeConfig> {
    try {
      const raw = await fs.readFile(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return normalizeRuntimeConfig(parsed);
    } catch {
      return normalizeRuntimeConfig(null);
    }
  }
}

