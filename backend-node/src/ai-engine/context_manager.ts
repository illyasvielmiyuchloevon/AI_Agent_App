import fs from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { AiEditorContext } from './contracts';
import { getWorkspaceRoot } from '../context';
import { getProjectStructure, resolveWorkspaceFilePath } from '../tools/filesystem';
import * as db from '../db';
import { LLMClient } from '../core/llm';
import { UnifiedMessage } from '../core/types';

export interface AiContextOptions {
  maxChars?: number;
}

function sha1(text: string) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function clip(text: string, maxChars: number) {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[...truncated...]`;
}

function isTsLike(languageId: string | undefined, filePath: string | undefined) {
  const ext = filePath ? path.extname(filePath).toLowerCase() : '';
  if (languageId) {
    const l = languageId.toLowerCase();
    if (['typescript', 'javascript', 'typescriptreact', 'javascriptreact'].includes(l)) return true;
  }
  return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext);
}

function outlineTsLike(sourceText: string) {
  const exports: string[] = [];
  const decls: string[] = [];

  const uniqPush = (arr: string[], value: string) => {
    if (!value) return;
    if (arr.includes(value)) return;
    arr.push(value);
  };

  const exportRe = /^\s*export\s+(?:default\s+)?(const|function|class|interface|type)\s+([A-Za-z_$][\w$]*)/gm;
  const declRe = /^\s*(?:export\s+)?(const|function|class|interface|type)\s+([A-Za-z_$][\w$]*)/gm;

  let m: RegExpExecArray | null = null;
  while ((m = exportRe.exec(sourceText))) {
    uniqPush(exports, m[2]);
    if (exports.length >= 40) break;
  }

  m = null;
  while ((m = declRe.exec(sourceText))) {
    uniqPush(decls, `${m[1]} ${m[2]}`);
    if (decls.length >= 40) break;
  }

  return { exports, decls };
}

export class AiContextManager {
  private fileCache = new Map<string, { hash: string; outline: string; updatedAt: number }>();
  private projectCache = new Map<string, { hash: string; summary: string; updatedAt: number }>();
  private sessionCache = new Map<string, { key: string; summary: string; updatedAt: number }>();
  private maxCacheEntries = 64;

  async buildSystemContext(editor: AiEditorContext | undefined, opts: AiContextOptions = {}): Promise<string> {
    const maxChars = opts.maxChars ?? 6000;
    const parts: string[] = [];

    const root = (() => {
      try {
        return getWorkspaceRoot();
      } catch {
        return '';
      }
    })();

    if (editor?.filePath) {
      parts.push(`Active file: ${editor.filePath}`);
      if (editor.languageId) parts.push(`Language: ${editor.languageId}`);
      if (editor.selection) {
        const s = editor.selection;
        parts.push(`Selection: ${s.startLine}:${s.startColumn}-${s.endLine}:${s.endColumn}`);
      }
      if (editor.selectedText && editor.selectedText.trim().length > 0) {
        parts.push(`Selected text:\n${clip(editor.selectedText, 1600)}`);
      }
      const outline = await this.getFileOutline(editor, root);
      if (outline) parts.push(outline);
    }

    const project = await this.getProjectSummary(root);
    if (project) parts.push(project);

    return clip(parts.join('\n\n'), maxChars);
  }

  async buildSessionSummary(sessionId: string | undefined, llm: LLMClient, model: string | undefined) {
    if (!sessionId) return '';
    const messages = await db.getMessages(sessionId);
    if (messages.length <= 20) return '';
    const older = messages.slice(0, Math.max(0, messages.length - 20));
    const key = `${older.length}:${older[older.length - 1]?.id || 0}`;
    const cached = this.sessionCache.get(sessionId);
    if (cached && cached.key === key) return cached.summary;

    const lines = older.map(m => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `${m.role}: ${content}`;
    });

    const prompt = clip(lines.join('\n'), 12000);
    const system = 'Summarize the conversation history for an IDE AI assistant. Keep concrete requirements, decisions, file paths, commands, and unresolved questions. Be concise.';
    const msgs: UnifiedMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ];

    try {
      const resp = await llm.chatCompletion(msgs, undefined, sessionId, {
        model: model,
        max_tokens: 512,
        temperature: 0.2
      });
      const summary = typeof resp.content === 'string' ? resp.content : '';
      this.sessionCache.set(sessionId, { key, summary, updatedAt: Date.now() });
      this.evict();
      return summary;
    } catch {
      return '';
    }
  }

  private async getFileOutline(editor: AiEditorContext, root: string): Promise<string> {
    const filePath = editor.filePath;
    if (!filePath) return '';

    let content = editor.visibleText;
    if (!content && root) {
      try {
        const { fullPath } = await resolveWorkspaceFilePath(root, filePath, { mustExist: true });
        content = await fs.readFile(fullPath, 'utf-8');
      } catch {
        content = '';
      }
    }
    if (!content) return '';

    const key = `${root}:${filePath}`;
    const h = sha1(content);
    const cached = this.fileCache.get(key);
    if (cached && cached.hash === h) return cached.outline;

    let outline = '';
    if (isTsLike(editor.languageId, filePath)) {
      try {
        const o = outlineTsLike(content);
        const lines: string[] = [];
        if (o.exports.length > 0) lines.push(`Exports: ${o.exports.join(', ')}`);
        if (o.decls.length > 0) lines.push(`Top-level: ${o.decls.join(', ')}`);
        outline = lines.length > 0 ? `File outline:\n${lines.join('\n')}` : '';
      } catch {
        outline = '';
      }
    }

    this.fileCache.set(key, { hash: h, outline, updatedAt: Date.now() });
    this.evict();
    return outline;
  }

  private async getProjectSummary(root: string): Promise<string> {
    if (!root) return '';
    const key = root;

    let struct: any;
    try {
      struct = await getProjectStructure(root);
    } catch {
      struct = null;
    }

    const raw = struct ? JSON.stringify(struct).slice(0, 20000) : '';
    const h = sha1(raw);
    const cached = this.projectCache.get(key);
    if (cached && cached.hash === h) return cached.summary;

    const summary = struct ? `Project structure snapshot:\n${clip(raw, 2500)}` : '';
    this.projectCache.set(key, { hash: h, summary, updatedAt: Date.now() });
    this.evict();
    return summary;
  }

  private evict() {
    const evictMap = <T>(m: Map<string, { updatedAt: number }>) => {
      if (m.size <= this.maxCacheEntries) return;
      const entries = Array.from(m.entries()).sort((a, b) => a[1].updatedAt - b[1].updatedAt);
      const remove = entries.slice(0, Math.max(0, m.size - this.maxCacheEntries));
      remove.forEach(([k]) => m.delete(k));
    };
    evictMap(this.fileCache);
    evictMap(this.projectCache);
    evictMap(this.sessionCache);
  }
}
