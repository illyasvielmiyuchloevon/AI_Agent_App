import fs from "fs/promises";
import path from "path";
import { WorkspaceDescriptor } from "./types";
import { WorkspaceServiceContainer, WorkspaceService } from "./serviceContainer";
import { workspaceContext } from "../context";
import * as db from "../db";

export interface WorkspaceHandle {
  descriptor: WorkspaceDescriptor;
  services: WorkspaceServiceContainer;
}

function normalizeRoot(rootPath: string): string {
  return path.resolve(String(rootPath || ""));
}

function getDefaultWorkspaceName(rootPath: string): string {
  const base = path.basename(rootPath);
  return base || "workspace";
}

function getWorkspaceFilePath(rootPath: string): string {
  const normalized = normalizeRoot(rootPath);
  return path.join(normalized, ".aichat", "workspace.json");
}

async function readWorkspaceFile(rootPath: string): Promise<WorkspaceDescriptor | null> {
  const filePath = getWorkspaceFilePath(rootPath);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const id = typeof parsed.id === "string" && parsed.id ? parsed.id : normalizeRoot(rootPath);
    const name = typeof parsed.name === "string" && parsed.name ? parsed.name : getDefaultWorkspaceName(rootPath);
    const foldersArray = Array.isArray(parsed.folders) ? parsed.folders : [];
    const folders = foldersArray.map((entry: any) => {
      if (entry && typeof entry.path === "string" && entry.path) {
        return { path: normalizeRoot(entry.path) };
      }
      if (typeof entry === "string" && entry) {
        return { path: normalizeRoot(entry) };
      }
      return null;
    }).filter(Boolean) as { path: string }[];
    const foldersValue = folders.length > 0 ? folders : [{ path: normalizeRoot(rootPath) }];
    const openedAt = typeof parsed.openedAt === "string" && parsed.openedAt ? parsed.openedAt : new Date().toISOString();
    const closedAt = typeof parsed.closedAt === "string" ? parsed.closedAt : null;
    const settings = parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {};
    const state = parsed.state && typeof parsed.state === "object" ? parsed.state : {};
    const descriptor: WorkspaceDescriptor = {
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
  } catch {
    return null;
  }
}

async function writeWorkspaceFile(descriptor: WorkspaceDescriptor): Promise<void> {
  const firstFolder = descriptor.folders[0];
  if (!firstFolder) return;
  const rootPath = normalizeRoot(firstFolder.path);
  const dir = path.join(rootPath, ".aichat");
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
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
  await fs.writeFile(filePath, json, "utf-8");
}

class DbWorkspaceService implements WorkspaceService {
  async dispose(): Promise<void> {
  }
}

export class WorkspaceManager {
  private readonly workspaces = new Map<string, WorkspaceHandle>();

  async openWorkspace(rootPath: string, options: { id?: string; name?: string; settings?: Record<string, any> } = {}): Promise<WorkspaceHandle> {
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
    const stats = await fs.stat(normalizedRoot);
    if (!stats.isDirectory()) {
      throw new Error("Workspace root is not a directory");
    }
    const name = options.name || fromFile?.name || getDefaultWorkspaceName(normalizedRoot);
    const descriptor: WorkspaceDescriptor = {
      id,
      name,
      folders: fromFile?.folders && fromFile.folders.length > 0 ? fromFile.folders : [{ path: normalizedRoot }],
      settings: options.settings || fromFile?.settings || {},
      state: fromFile?.state || {},
      openedAt: fromFile?.openedAt || new Date().toISOString(),
      closedAt: null,
      workspaceFile: getWorkspaceFilePath(normalizedRoot),
    };
    const services = new WorkspaceServiceContainer({ workspace: descriptor });
    services.register("db", () => new DbWorkspaceService());
    await writeWorkspaceFile(descriptor);
    await workspaceContext.run({ id: descriptor.id, root: normalizedRoot }, async () => {
      await db.initDb();
    });
    const handle: WorkspaceHandle = { descriptor, services };
    this.workspaces.set(id, handle);
    return handle;
  }

  async closeWorkspace(id: string): Promise<void> {
    const handle = this.workspaces.get(id);
    if (!handle) return;
    handle.descriptor.closedAt = new Date().toISOString();
    await writeWorkspaceFile(handle.descriptor);
    await handle.services.disposeAll();
    this.workspaces.delete(id);
  }

  getWorkspace(id: string): WorkspaceHandle | undefined {
    return this.workspaces.get(id);
  }

  getWorkspaceByRoot(rootPath: string): WorkspaceHandle | undefined {
    const normalizedRoot = normalizeRoot(rootPath);
    for (const handle of this.workspaces.values()) {
      const first = handle.descriptor.folders[0];
      if (first && normalizeRoot(first.path) === normalizedRoot) {
        return handle;
      }
    }
    return undefined;
  }

  listWorkspaces(): WorkspaceDescriptor[] {
    return Array.from(this.workspaces.values()).map(h => h.descriptor);
  }

  async switchWorkspace(currentId: string, nextRootPath: string, options: { name?: string; settings?: Record<string, any> } = {}): Promise<WorkspaceHandle> {
    if (currentId) {
      await this.closeWorkspace(currentId);
    }
    const handle = await this.openWorkspace(nextRootPath, { name: options.name, settings: options.settings });
    return handle;
  }
}

export const workspaceManager = new WorkspaceManager();

