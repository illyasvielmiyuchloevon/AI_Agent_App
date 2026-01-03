import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { embedTexts } from './embeddings';
import { AiEngineRuntimeConfig } from './runtime_config';
import { getProjectStructure } from '../tools/filesystem';

type FileKey = string;

interface RagIndexChunkRecord {
  id: string;
  startLine: number;
  endLine: number;
  text: string;
  textHash: string;
  vector: number[];
}

interface RagIndexFileRecord {
  workspaceRoot: string;
  path: string;
  mtimeMs: number;
  size: number;
  chunks: RagIndexChunkRecord[];
}

interface RagIndexDataV1 {
  version: 1;
  root: string;
  embeddingModel: string;
  dims: number;
  createdAt: string;
  updatedAt: string;
  files: Record<FileKey, RagIndexFileRecord>;
}

function normalizeRoot(p: string) {
  return path.resolve(String(p || ''));
}

function normalizeRelPath(p: string) {
  return String(p || '').replace(/^[\\/]+/, '').replace(/\\/g, '/');
}

function makeFileKey(workspaceRoot: string, relPath: string): FileKey {
  return `${normalizeRoot(workspaceRoot)}|${normalizeRelPath(relPath)}`;
}

function sha256(text: string) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function chunkByLines(text: string, opts?: { maxLines?: number; maxChars?: number; overlapLines?: number }) {
  const maxLines = opts?.maxLines ?? 80;
  const maxChars = opts?.maxChars ?? 2400;
  const overlapLines = opts?.overlapLines ?? 10;
  const lines = (text || '').split(/\r?\n/);
  const chunks: Array<{ startLine: number; endLine: number; text: string }> = [];
  let i = 0;
  while (i < lines.length) {
    const start = i;
    let end = Math.min(lines.length, start + maxLines);
    let out = lines.slice(start, end).join('\n');
    while (out.length > maxChars && end > start + 10) {
      end -= 5;
      out = lines.slice(start, end).join('\n');
    }
    if (out.trim().length > 0) {
      chunks.push({ startLine: start + 1, endLine: end, text: out });
    }
    if (end >= lines.length) break;
    i = Math.max(start + 1, end - overlapLines);
  }
  return chunks;
}

function cosine(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

function extractQueryTokens(text: string) {
  const raw = (text || '').toLowerCase();
  const matches = raw.match(/[a-z_][a-z0-9_]{2,}/g) || [];
  const stop = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'your', 'you', 'are', 'not', 'can', 'will', 'use', 'using']);
  const uniq: string[] = [];
  for (const m of matches) {
    if (stop.has(m)) continue;
    if (!uniq.includes(m)) uniq.push(m);
    if (uniq.length >= 16) break;
  }
  return uniq;
}

function isQwen3EmbeddingModelName(model: string | undefined) {
  const m = (model || '').toLowerCase();
  return m.includes('qwen3-embedding');
}

function withQwen3Eot(text: string) {
  const t = text || '';
  return t.endsWith('<|endoftext|>') ? t : `${t}<|endoftext|>`;
}

function shouldIndexFile(relPath: string) {
  const p = normalizeRelPath(relPath).toLowerCase();
  if (!p) return false;
  if (p.startsWith('.git/')) return false;
  if (p.startsWith('.aichat/')) return false;
  if (p.includes('/node_modules/')) return false;
  if (p.includes('/dist/')) return false;
  if (p.includes('/build/')) return false;
  if (p.includes('/out/')) return false;
  if (p.includes('/release/')) return false;
  if (p.includes('/debug/')) return false;
  if (p.includes('/.venv/')) return false;
  if (p.includes('/venv/')) return false;
  if (p.includes('/__pycache__/')) return false;
  if (p.endsWith('.gguf') || p.endsWith('.bin') || p.endsWith('.exe') || p.endsWith('.dll') || p.endsWith('.so') || p.endsWith('.dylib')) return false;
  const ext = path.extname(p);
  const allow = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.py', '.go', '.rs', '.java', '.cs', '.cpp', '.c', '.h', '.hpp', '.toml', '.yaml', '.yml', '.txt']);
  return allow.has(ext);
}

export class RagIndex {
  private root: string;
  private indexPath: string;
  private loaded = false;
  private data: RagIndexDataV1 | null = null;
  private cfg: AiEngineRuntimeConfig | null = null;
  private watchers: fs.FSWatcher[] = [];
  private pending = new Set<string>();
  private flushTimer: NodeJS.Timeout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private running = false;
  private initialRefreshStarted = false;

  constructor(root: string) {
    this.root = normalizeRoot(root);
    this.indexPath = path.join(this.root, '.aichat', 'rag_index.json');
  }

  setRuntimeConfig(cfg: AiEngineRuntimeConfig) {
    this.cfg = cfg;
  }

  async ensureLoaded(embeddingModel: string) {
    if (this.loaded && this.data && this.data.embeddingModel === embeddingModel) return;
    const dir = path.dirname(this.indexPath);
    try {
      await fsp.mkdir(dir, { recursive: true });
    } catch {
    }
    try {
      const raw = await fsp.readFile(this.indexPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1 && typeof parsed.files === 'object') {
        const normalized: RagIndexDataV1 = {
          version: 1,
          root: typeof parsed.root === 'string' ? parsed.root : this.root,
          embeddingModel: typeof parsed.embeddingModel === 'string' ? parsed.embeddingModel : embeddingModel,
          dims: typeof parsed.dims === 'number' ? parsed.dims : 0,
          createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date().toISOString(),
          updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
          files: parsed.files as any
        };
        this.data = normalized;
        this.loaded = true;
      }
    } catch {
    }
    if (!this.data || this.data.embeddingModel !== embeddingModel) {
      const now = new Date().toISOString();
      this.data = {
        version: 1,
        root: this.root,
        embeddingModel,
        dims: 0,
        createdAt: now,
        updatedAt: now,
        files: {}
      };
      this.loaded = true;
      await this.saveNow();
    }
  }

  startWatching() {
    if (this.running) return;
    this.running = true;
    const handleEvent = (folderRoot: string, filename: string | Buffer | null | undefined) => {
      const name = filename ? String(filename) : '';
      if (!name) return;
      const abs = path.resolve(folderRoot, name);
      const rel = normalizeRelPath(path.relative(folderRoot, abs));
      if (!rel) return;
      this.enqueueForUpdate(folderRoot, rel);
    };

    const roots = this.getWorkspaceRoots();
    for (const folderRoot of roots) {
      try {
        const watcher = fs.watch(folderRoot, { recursive: true }, (_eventType, filename) => handleEvent(folderRoot, filename));
        this.watchers.push(watcher);
      } catch {
      }
    }
  }

  kickoffInitialRefresh(cfg: AiEngineRuntimeConfig, embeddingModel: string) {
    if (this.initialRefreshStarted) return;
    this.initialRefreshStarted = true;
    this.setRuntimeConfig(cfg);
    void this.refreshAll(cfg, embeddingModel).catch(() => {
      this.initialRefreshStarted = false;
    });
  }

  async dispose() {
    this.running = false;
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {
      }
    }
    this.watchers = [];
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.flushTimer = null;
    this.saveTimer = null;
    this.pending.clear();
  }

  notifyFileChanged(workspaceRoot: string, relPath: string) {
    this.enqueueForUpdate(workspaceRoot, relPath);
  }

  async refreshAll(cfg: AiEngineRuntimeConfig, embeddingModel: string) {
    await this.ensureLoaded(embeddingModel);
    const struct = await getProjectStructure(this.root).catch(() => null);
    const entries: any[] = (struct && Array.isArray((struct as any).entries)) ? (struct as any).entries : [];
    const candidates = entries.filter(e => e && e.type === 'file' && typeof e.path === 'string');
    for (const e of candidates) {
      const baseRoot = typeof e.workspace_root === 'string' && e.workspace_root ? String(e.workspace_root) : this.root;
      const rel = normalizeRelPath(String(e.path));
      if (!shouldIndexFile(rel)) continue;
      await this.reindexIfStale(baseRoot, rel, cfg, embeddingModel);
    }
  }

  async queryTopK(opts: { query: string; cfg: AiEngineRuntimeConfig; embeddingModel: string; topK: number; maxCandidates: number }) {
    const query = (opts.query || '').trim();
    if (!query) return [];
    await this.ensureLoaded(opts.embeddingModel);
    const data = this.data!;
    const tokens = extractQueryTokens(query);
    const queryInput = `Instruct: Given a code search query, retrieve relevant code snippets that answer the query.\nQuery: ${query}`;
    const useQwen3Eot = isQwen3EmbeddingModelName(opts.embeddingModel);
    const qEmbeddingText = useQwen3Eot ? withQwen3Eot(queryInput) : queryInput;
    const out = await embedTexts([qEmbeddingText], opts.cfg, opts.embeddingModel);
    const qv = out.vectors[0] || [];
    const candidates: Array<{ filePath: string; startLine: number; endLine: number; text: string; vector: number[]; preScore: number }> = [];
    const maxCandidates = Math.max(50, Math.min(5000, opts.maxCandidates));

    const tokenSet = new Set(tokens);
    const scoreText = (filePath: string, text: string) => {
      if (tokenSet.size === 0) return 1;
      const lowerPath = (filePath || '').toLowerCase();
      const lower = (text || '').toLowerCase();
      let hits = 0;
      for (const t of tokenSet) {
        if (lowerPath.includes(t) || lower.includes(t)) hits += 1;
      }
      return hits;
    };

    for (const fr of Object.values(data.files)) {
      for (const c of fr.chunks) {
        if (!c.vector || c.vector.length === 0) continue;
        const preScore = scoreText(fr.path, c.text);
        if (preScore <= 0) continue;
        candidates.push({ filePath: fr.path, startLine: c.startLine, endLine: c.endLine, text: c.text, vector: c.vector, preScore });
        if (candidates.length >= maxCandidates) break;
      }
      if (candidates.length >= maxCandidates) break;
    }

    const ranked = candidates
      .map(c => ({ ...c, score: cosine(qv, c.vector) + c.preScore * 0.001 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, opts.topK));

    return ranked.map(r => ({ filePath: r.filePath, startLine: r.startLine, endLine: r.endLine, text: r.text, score: r.score }));
  }

  async buildAddendum(opts: { query: string; cfg: AiEngineRuntimeConfig; embeddingModel: string; maxChars: number; topK: number }) {
    const items = await this.queryTopK({ query: opts.query, cfg: opts.cfg, embeddingModel: opts.embeddingModel, topK: opts.topK, maxCandidates: 2500 });
    if (items.length === 0) return '';
    const lines: string[] = [];
    lines.push('Relevant code snippets (retrieved):');
    for (const it of items) {
      const header = `${it.filePath}:${it.startLine}-${it.endLine}`;
      const body = it.text.length > 1800 ? `${it.text.slice(0, 1800)}\n[...truncated...]` : it.text;
      lines.push(`${header}\n${body}`);
    }
    const joined = lines.join('\n\n');
    return joined.length > opts.maxChars ? `${joined.slice(0, opts.maxChars)}\n[...truncated...]` : joined;
  }

  private getWorkspaceRoots(): string[] {
    const structRoots: string[] = [];
    try {
      const workspaceJsonPath = path.join(this.root, '.aichat', 'workspace.json');
      const raw = fs.existsSync(workspaceJsonPath) ? fs.readFileSync(workspaceJsonPath, 'utf-8') : '';
      if (raw) {
        const parsed: any = JSON.parse(raw);
        const folders = Array.isArray(parsed?.folders) ? parsed.folders : [];
        for (const f of folders) {
          const p = typeof f?.path === 'string' ? f.path : (typeof f === 'string' ? f : '');
          if (p) structRoots.push(normalizeRoot(p));
        }
      }
    } catch {
    }
    const roots = Array.from(new Set([this.root, ...structRoots].filter(Boolean)));
    return roots;
  }

  private enqueueForUpdate(workspaceRoot: string, relPath: string) {
    const rel = normalizeRelPath(relPath);
    if (!shouldIndexFile(rel)) return;
    this.pending.add(makeFileKey(workspaceRoot, rel));
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushPending();
    }, 250);
  }

  private async flushPending() {
    const list = Array.from(this.pending.values());
    this.pending.clear();
    if (list.length === 0) return;
    const embeddingModel = this.data?.embeddingModel || '';
    if (!embeddingModel) return;
    const cfg = this.cfg;
    if (!cfg) return;
    for (const key of list) {
      const [workspaceRoot, rel] = key.split('|');
      if (!workspaceRoot || !rel) continue;
      await this.reindexIfStale(workspaceRoot, rel, cfg, embeddingModel);
    }
  }

  private async reindexIfStale(workspaceRoot: string, relPath: string, cfg: AiEngineRuntimeConfig, embeddingModel: string) {
    await this.ensureLoaded(embeddingModel);
    const data = this.data!;
    const key = makeFileKey(workspaceRoot, relPath);
    const abs = path.resolve(workspaceRoot, normalizeRelPath(relPath));
    let stat: any;
    try {
      stat = await fsp.stat(abs);
    } catch {
      if (data.files[key]) {
        delete data.files[key];
        data.updatedAt = new Date().toISOString();
        this.scheduleSave();
      }
      return;
    }
    if (!stat.isFile()) return;
    if (stat.size > 400_000) return;
    const prev = data.files[key];
    if (prev && prev.mtimeMs === stat.mtimeMs && prev.size === stat.size && prev.chunks.length > 0) return;
    await this.reindexFile(workspaceRoot, relPath, stat.mtimeMs, stat.size, cfg, embeddingModel);
  }

  private async reindexFile(workspaceRoot: string, relPath: string, mtimeMs: number, size: number, cfg: AiEngineRuntimeConfig, embeddingModel: string) {
    await this.ensureLoaded(embeddingModel);
    const data = this.data!;
    const key = makeFileKey(workspaceRoot, relPath);
    const abs = path.resolve(workspaceRoot, normalizeRelPath(relPath));
    let content = '';
    try {
      content = await fsp.readFile(abs, 'utf-8');
    } catch {
      return;
    }
    if (!content || content.indexOf('\0') !== -1) return;

    const prev = data.files[key];
    const prevVectors = new Map<string, number[]>();
    if (prev && Array.isArray(prev.chunks)) {
      for (const c of prev.chunks) {
        if (c && typeof c.textHash === 'string' && Array.isArray(c.vector) && c.vector.length > 0) {
          if (!prevVectors.has(c.textHash)) prevVectors.set(c.textHash, c.vector);
        }
      }
    }

    const chunks = chunkByLines(content, { maxLines: 80, maxChars: 2600, overlapLines: 12 });
    const useQwen3Eot = isQwen3EmbeddingModelName(embeddingModel);
    const toEmbed: Array<{ idx: number; input: string; hash: string }> = [];
    const nextChunks: RagIndexChunkRecord[] = chunks.map((c, idx) => {
      const body = `file:${normalizeRelPath(relPath)}:${c.startLine}-${c.endLine}\n${c.text}`;
      const input = useQwen3Eot ? withQwen3Eot(body) : body;
      const textHash = sha256(body);
      const reuse = prevVectors.get(textHash);
      if (!reuse) toEmbed.push({ idx, input, hash: textHash });
      const id = crypto.createHash('sha1').update(`${key}:${c.startLine}:${c.endLine}:${textHash}`).digest('hex');
      return {
        id,
        startLine: c.startLine,
        endLine: c.endLine,
        text: c.text,
        textHash,
        vector: reuse || []
      };
    });

    if (toEmbed.length > 0) {
      const inputs = toEmbed.map(x => x.input);
      const out = await embedTexts(inputs, cfg, embeddingModel);
      const vectors = out.vectors || [];
      for (let i = 0; i < toEmbed.length; i += 1) {
        const v = vectors[i] || [];
        const entry = nextChunks[toEmbed[i].idx];
        if (entry) entry.vector = v;
      }
      if (data.dims <= 0 && vectors[0] && vectors[0].length) data.dims = vectors[0].length;
    }

    data.files[key] = {
      workspaceRoot: normalizeRoot(workspaceRoot),
      path: normalizeRelPath(relPath),
      mtimeMs,
      size,
      chunks: nextChunks.filter(c => Array.isArray(c.vector) && c.vector.length > 0)
    };
    data.updatedAt = new Date().toISOString();
    this.scheduleSave();
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, 400);
  }

  private async saveNow() {
    if (!this.data) return;
    const dir = path.dirname(this.indexPath);
    try {
      await fsp.mkdir(dir, { recursive: true });
    } catch {
    }
    const tmp = `${this.indexPath}.tmp`;
    const payload = JSON.stringify(this.data, null, 2);
    await fsp.writeFile(tmp, payload, 'utf-8');
    try {
      await fsp.rename(tmp, this.indexPath);
    } catch {
      try {
        await fsp.writeFile(this.indexPath, payload, 'utf-8');
      } finally {
        try { await fsp.unlink(tmp); } catch {}
      }
    }
  }
}
