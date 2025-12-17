import { v4 as uuidv4 } from 'uuid';
import { tryGetWorkspaceRoot } from '../context';
import { loadAiCoreSettings, saveAiCoreSettings } from '../db';
import { LLMClient, OpenAIProvider, AnthropicProvider, OpenAICompatibleProvider } from './llm';

export type Capability = 'chat' | 'inline' | 'tools' | 'embeddings' | 'editorAction';
export type ProviderType = 'openai' | 'anthropic' | 'openrouter' | 'xai' | 'ollama' | 'lmstudio';

export interface ProviderCapability {
    tools?: boolean;
    vision?: boolean;
    embeddings?: boolean;
    inline?: boolean;
}

export interface ProviderConfig {
    id: string;
    provider: ProviderType;
    displayName?: string;
    baseURL?: string;
    apiKey?: string;
    models?: string[];
    declaredCapabilities?: ProviderCapability;
    defaultModel?: string;
}

export interface CapabilityModel {
    providerId: string;
    model?: string;
}

export interface AiCoreSettings {
    schemaVersion: number;
    providers: ProviderConfig[];
    defaults: Record<Capability, CapabilityModel>;
    workspaces?: Record<string, Partial<Record<Capability, CapabilityModel>>>;
}

const DEFAULT_SETTINGS: AiCoreSettings = {
    schemaVersion: 1,
    providers: [
        {
            id: 'openai-default',
            provider: 'openai',
            displayName: 'OpenAI',
            models: ['gpt-4o', 'gpt-4o-mini'],
            declaredCapabilities: { tools: true, vision: true, embeddings: true, inline: true },
            defaultModel: 'gpt-4o'
        },
        {
            id: 'anthropic-default',
            provider: 'anthropic',
            displayName: 'Anthropic',
            models: ['claude-3-5-sonnet-20240620', 'claude-3-opus-20240229'],
            declaredCapabilities: { tools: true, vision: false, embeddings: false, inline: true },
            defaultModel: 'claude-3-5-sonnet-20240620'
        }
    ],
    defaults: {
        chat: { providerId: 'openai-default', model: 'gpt-4o' },
        inline: { providerId: 'openai-default', model: 'gpt-4o-mini' },
        tools: { providerId: 'openai-default', model: 'gpt-4o' },
        embeddings: { providerId: 'openai-default', model: 'text-embedding-3-large' },
        editorAction: { providerId: 'openai-default', model: 'gpt-4o-mini' }
    },
    workspaces: {}
};

function pickProvider(settings: AiCoreSettings, capability: Capability, workspaceId?: string): CapabilityModel | null {
    if (workspaceId) {
        const workspaceOverride = settings.workspaces?.[workspaceId]?.[capability];
        if (workspaceOverride) return workspaceOverride as CapabilityModel;
    }
    return settings.defaults[capability] || null;
}

function findProvider(settings: AiCoreSettings, providerId?: string): ProviderConfig | undefined {
    if (!providerId) return undefined;
    return settings.providers.find((p) => p.id === providerId);
}

function ensureModel(model?: string, provider?: ProviderConfig): string | undefined {
    if (model) return model;
    return provider?.defaultModel;
}

export class AiCore {
    private settings: AiCoreSettings = DEFAULT_SETTINGS;
    private loaded = false;
    private loadedWorkspaceRoot?: string;

    private async ensureWorkspaceLoaded() {
        const currentRoot = tryGetWorkspaceRoot();
        if (!this.loaded || this.loadedWorkspaceRoot !== currentRoot) {
            await this.load();
        }
    }

    async load() {
        const currentRoot = tryGetWorkspaceRoot();
        let stored: AiCoreSettings | null = null;
        if (currentRoot) {
            try {
                stored = await loadAiCoreSettings();
            } catch (e) {
                // ignore and fall back to defaults
            }
        }
        this.settings = stored || DEFAULT_SETTINGS;
        this.loaded = true;
        this.loadedWorkspaceRoot = currentRoot;
        return this.settings;
    }

    async getSettings(): Promise<AiCoreSettings> {
        await this.ensureWorkspaceLoaded();
        return this.settings;
    }

    async save(settings?: AiCoreSettings): Promise<AiCoreSettings> {
        const next = settings || this.settings;
        this.settings = await saveAiCoreSettings(next);
        return this.settings;
    }

    async upsertProvider(input: Omit<ProviderConfig, 'id'> & { id?: string }): Promise<ProviderConfig> {
        await this.ensureWorkspaceLoaded();
        const id = input.id || uuidv4();
        const provider: ProviderConfig = { ...input, id } as ProviderConfig;
        const existingIndex = this.settings.providers.findIndex((p) => p.id === id);
        if (existingIndex >= 0) {
            this.settings.providers[existingIndex] = { ...this.settings.providers[existingIndex], ...provider };
        } else {
            this.settings.providers.push(provider);
        }
        await this.save();
        return provider;
    }

    async setDefaults(defaults: Partial<Record<Capability, CapabilityModel>>, workspaceId?: string): Promise<AiCoreSettings> {
        await this.ensureWorkspaceLoaded();
        if (workspaceId) {
            if (!this.settings.workspaces) this.settings.workspaces = {};
            const current = this.settings.workspaces[workspaceId] || {};
            this.settings.workspaces[workspaceId] = { ...current, ...defaults };
        } else {
            this.settings.defaults = { ...this.settings.defaults, ...defaults } as any;
        }
        return this.save();
    }

    route(capability: Capability, workspaceId?: string): { provider: ProviderConfig; model?: string } {
        const resolved = pickProvider(this.settings, capability, workspaceId) || this.settings.defaults.chat;
        const provider = findProvider(this.settings, resolved?.providerId) || this.settings.providers[0];
        if (!provider) {
            throw new Error('No provider configured');
        }
        const model = ensureModel(resolved?.model, provider);
        return { provider, model };
    }

    buildClient(provider: ProviderConfig, model?: string): LLMClient {
        const base = provider.baseURL;
        const providerModel = ensureModel(model, provider);
        switch (provider.provider) {
            case 'openai':
                return new OpenAIProvider(provider.apiKey || '', providerModel, base);
            case 'anthropic':
                return new AnthropicProvider(provider.apiKey || '', providerModel, base);
            case 'openrouter':
                return new OpenAICompatibleProvider(provider.apiKey || '', providerModel, base, 'openrouter');
            case 'xai':
                return new OpenAICompatibleProvider(provider.apiKey || '', providerModel, base, 'xai');
            case 'ollama':
                return new OpenAICompatibleProvider(provider.apiKey || '', providerModel, base, 'ollama');
            case 'lmstudio':
                return new OpenAICompatibleProvider(provider.apiKey || '', providerModel, base, 'lmstudio');
            default:
                return new OpenAIProvider(provider.apiKey || '', providerModel, base);
        }
    }

    async getClientForCapability(capability: Capability, workspaceId?: string) {
        await this.ensureWorkspaceLoaded();
        const { provider, model } = this.route(capability, workspaceId);
        const client = this.buildClient(provider, model);
        return { client, provider, model };
    }

    async testProvider(providerId: string): Promise<{ ok: boolean; message?: string }> {
        await this.ensureWorkspaceLoaded();
        const provider = findProvider(this.settings, providerId);
        if (!provider) return { ok: false, message: 'Provider not found' };
        try {
            const client = this.buildClient(provider);
            const healthy = await client.checkHealth(provider.defaultModel);
            return { ok: healthy, message: healthy ? 'Connected' : 'Health check failed' };
        } catch (e: any) {
            return { ok: false, message: e?.message || 'Unknown error' };
        }
    }
}

export const aiCore = new AiCore();
