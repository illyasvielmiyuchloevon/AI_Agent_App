"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceServiceContainer = void 0;
class WorkspaceServiceContainer {
    context;
    factories = new Map();
    instances = new Map();
    constructor(context) {
        this.context = context;
    }
    register(name, factory) {
        if (!name)
            return;
        this.factories.set(name, factory);
    }
    get(name) {
        if (!name)
            return undefined;
        let instance = this.instances.get(name);
        if (instance)
            return instance;
        const factory = this.factories.get(name);
        if (!factory)
            return undefined;
        instance = factory(this.context);
        this.instances.set(name, instance);
        return instance;
    }
    async disposeAll() {
        const values = Array.from(this.instances.values());
        this.instances.clear();
        for (const service of values) {
            try {
                const result = service.dispose();
                if (result && typeof result.then === "function") {
                    await result;
                }
            }
            catch {
            }
        }
    }
}
exports.WorkspaceServiceContainer = WorkspaceServiceContainer;
