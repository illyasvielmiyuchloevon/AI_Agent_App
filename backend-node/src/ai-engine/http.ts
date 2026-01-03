import { Express } from 'express';
import OpenAI from 'openai';
import { AiEngine } from './ai_engine';
import { AiChatRequest, AiEditorActionRequest, AiEmbeddingsRequest, AiInlineRequest, AiToolsRequest } from './contracts';

export function registerAiEngineRoutes(app: Express, engine: AiEngine) {
  app.get('/ai-engine/metrics', (req, res) => {
    res.json(engine.getMetrics());
  });

  app.post('/ai-engine/models/list', async (req, res) => {
    try {
      const body = req.body && typeof req.body === 'object' ? (req.body as any) : {};
      const provider = typeof body.provider === 'string' ? body.provider : '';
      const apiKey = typeof body.api_key === 'string' ? body.api_key : '';
      const baseUrl = typeof body.base_url === 'string' ? body.base_url : '';

      if (!provider) {
        res.status(400).json({ ok: false, detail: 'provider is required' });
        return;
      }

      if (provider === 'anthropic') {
        res.json({ ok: true, models: [], detail: 'Anthropic model listing is not supported. Configure manually.' });
        return;
      }

      if (provider === 'ollama') {
        let root = baseUrl && baseUrl.trim().length > 0 ? baseUrl.trim().replace(/\/+$/, '') : 'http://localhost:11434';
        if (root.endsWith('/v1')) root = root.slice(0, -3);
        const resp = await fetch(`${root}/api/tags`);
        const data = await resp.json();
        const models = Array.isArray(data?.models) ? data.models.map((m: any) => m?.name).filter(Boolean) : [];
        res.json({ ok: true, models });
        return;
      }

      if (!apiKey || apiKey.trim().length === 0) {
        res.status(400).json({ ok: false, detail: `api_key is required for provider ${provider}` });
        return;
      }

      const cleanedBaseUrl = baseUrl && baseUrl.trim().length > 0 ? baseUrl.trim().replace(/^['"`]+|['"`]+$/g, '') : undefined;
      const client = new OpenAI({ apiKey, baseURL: cleanedBaseUrl });
      const list: any = await client.models.list();
      const data = Array.isArray(list?.data) ? list.data : (Array.isArray(list) ? list : []);
      const models = data.map((m: any) => m?.id).filter(Boolean).sort();
      res.json({ ok: true, models });
    } catch (e: any) {
      res.status(500).json({ ok: false, detail: e?.message || String(e) });
    }
  });

  app.post('/ai-engine/health', async (req, res) => {
    try {
      const ok = await engine.checkHealth(req.body && typeof req.body === 'object' ? req.body : undefined);
      res.json({ ok });
    } catch (e: any) {
      res.status(500).json({ ok: false, detail: e?.message || String(e) });
    }
  });

  app.post('/ai/chat/stream', async (req, res) => {
    const body = req.body as AiChatRequest;
    res.setHeader('Content-Type', 'text/plain');
    try {
      for await (const chunk of engine.chatStream({ ...body, capability: 'chat', stream: true })) {
        res.write(chunk);
      }
      res.end();
    } catch (e: any) {
      res.write(`\nError: ${e?.message || String(e)}`);
      res.end();
    }
  });

  app.post('/ai/inline', async (req, res) => {
    try {
      const body = req.body as AiInlineRequest;
      const out = await engine.inline({ ...body, capability: 'inline', stream: false });
      res.json(out);
    } catch (e: any) {
      res.status(500).json({ detail: e?.message || String(e) });
    }
  });

  app.post('/ai/editor-action', async (req, res) => {
    try {
      const body = req.body as AiEditorActionRequest;
      const out = await engine.editorAction({ ...body, capability: 'editorAction', stream: false });
      res.json(out);
    } catch (e: any) {
      res.status(500).json({ detail: e?.message || String(e) });
    }
  });

  app.post('/ai/tools', async (req, res) => {
    try {
      const body = req.body as AiToolsRequest;
      const out = await engine.tools({ ...body, capability: 'tools', stream: false });
      res.json(out);
    } catch (e: any) {
      res.status(500).json({ detail: e?.message || String(e) });
    }
  });

  app.post('/ai/embeddings', async (req, res) => {
    try {
      const body = req.body as AiEmbeddingsRequest;
      const out = await engine.embeddings({ ...body, capability: 'embeddings', stream: false });
      res.json(out);
    } catch (e: any) {
      res.status(500).json({ detail: e?.message || String(e) });
    }
  });
}
