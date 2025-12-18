import { Express } from 'express';
import { AiEngine } from './ai_engine';
import { AiChatRequest, AiEditorActionRequest, AiEmbeddingsRequest, AiInlineRequest, AiToolsRequest } from './contracts';

export function registerAiEngineRoutes(app: Express, engine: AiEngine) {
  app.get('/ai-engine/metrics', (req, res) => {
    res.json(engine.getMetrics());
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

