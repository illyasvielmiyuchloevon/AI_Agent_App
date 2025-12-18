async function safeReadJson(res) {
    try {
        return await res.json();
    } catch {
        return null;
    }
}

export async function readTextResponseBody(res) {
    if (!res?.body) return '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let out = '';
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
    return out;
}

export function createAiEngineClient({ fetch: fetcher }) {
    if (typeof fetcher !== 'function') {
        throw new Error('createAiEngineClient requires a fetch function');
    }

    const postJson = async (url, body, { signal } = {}) => {
        const res = await fetcher(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body ?? {}),
            signal,
        });
        const data = await safeReadJson(res);
        if (!res.ok) {
            const detail = data?.detail || res.statusText || 'Request failed';
            throw new Error(detail);
        }
        return data;
    };

    const postStream = async (url, body, { signal } = {}) => {
        return await fetcher(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body ?? {}),
            signal,
        });
    };

    return {
        async health(llmConfig, { signal } = {}) {
            const data = await postJson('/api/ai-engine/health', llmConfig || {}, { signal });
            return { ok: !!data?.ok, detail: data?.detail };
        },

        async listModels(req, { signal } = {}) {
            const payload = {
                provider: req?.provider,
                api_key: req?.api_key,
                base_url: req?.base_url,
            };
            return await postJson('/api/ai-engine/models/list', payload, { signal });
        },

        async chatStream(req, { signal } = {}) {
            const payload = {
                requestId: req?.requestId,
                sessionId: req?.sessionId,
                workspaceId: req?.workspaceId,
                workspaceRoot: req?.workspaceRoot,
                message: req?.message,
                mode: req?.mode,
                attachments: req?.attachments,
                toolOverrides: req?.toolOverrides,
                editor: req?.editor,
                llmConfig: req?.llmConfig,
            };
            return await postStream('/api/ai/chat/stream', payload, { signal });
        },

        async inline(req, { signal } = {}) {
            const payload = {
                requestId: req?.requestId,
                sessionId: req?.sessionId,
                workspaceId: req?.workspaceId,
                workspaceRoot: req?.workspaceRoot,
                editor: req?.editor,
                maxTokens: req?.maxTokens,
                llmConfig: req?.llmConfig,
            };
            return await postJson('/api/ai/inline', payload, { signal });
        },

        async editorAction(req, { signal } = {}) {
            const payload = {
                requestId: req?.requestId,
                sessionId: req?.sessionId,
                workspaceId: req?.workspaceId,
                workspaceRoot: req?.workspaceRoot,
                action: req?.action,
                instruction: req?.instruction,
                editor: req?.editor,
                llmConfig: req?.llmConfig,
            };
            return await postJson('/api/ai/editor-action', payload, { signal });
        },

        async tools(req, { signal } = {}) {
            const payload = {
                requestId: req?.requestId,
                sessionId: req?.sessionId,
                workspaceId: req?.workspaceId,
                workspaceRoot: req?.workspaceRoot,
                toolName: req?.toolName,
                args: req?.args,
            };
            return await postJson('/api/ai/tools', payload, { signal });
        },

        async embeddings(req, { signal } = {}) {
            const payload = {
                requestId: req?.requestId,
                sessionId: req?.sessionId,
                workspaceId: req?.workspaceId,
                workspaceRoot: req?.workspaceRoot,
                texts: Array.isArray(req?.texts) ? req.texts : [],
                model: req?.model,
                llmConfig: req?.llmConfig,
            };
            return await postJson('/api/ai/embeddings', payload, { signal });
        },
    };
}
