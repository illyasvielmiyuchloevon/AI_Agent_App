import { WorkspaceDescriptor } from "./types";

export interface WorkspaceService {
  dispose(): Promise<void> | void;
}

export interface WorkspaceServiceContext {
  workspace: WorkspaceDescriptor;
}

export type WorkspaceServiceFactory = (context: WorkspaceServiceContext) => WorkspaceService;

export class WorkspaceServiceContainer {
  private readonly context: WorkspaceServiceContext;
  private readonly factories = new Map<string, WorkspaceServiceFactory>();
  private readonly instances = new Map<string, WorkspaceService>();

  constructor(context: WorkspaceServiceContext) {
    this.context = context;
  }

  register(name: string, factory: WorkspaceServiceFactory): void {
    if (!name) return;
    this.factories.set(name, factory);
  }

  get<T extends WorkspaceService = WorkspaceService>(name: string): T | undefined {
    if (!name) return undefined;
    let instance = this.instances.get(name);
    if (instance) return instance as T;
    const factory = this.factories.get(name);
    if (!factory) return undefined;
    instance = factory(this.context);
    this.instances.set(name, instance);
    return instance as T;
  }

  async disposeAll(): Promise<void> {
    const values = Array.from(this.instances.values());
    this.instances.clear();
    for (const service of values) {
      try {
        const result = service.dispose();
        if (result && typeof (result as Promise<void>).then === "function") {
          await result;
        }
      } catch {
      }
    }
  }
}

