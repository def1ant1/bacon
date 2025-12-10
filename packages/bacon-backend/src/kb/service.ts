import { Logger } from '../types'
import { chunkText } from './chunking'
import { MemoryKnowledgeStore } from './store-memory'
import { KnowledgeChunk, KnowledgeStore, UploadIngestRequest, UploadIngestResponse, RetrievalOptions, RetrievalResult } from './types'

function deterministicEmbedding(text: string): number[] {
  const base = new Array(8).fill(0)
  for (let i = 0; i < text.length; i++) {
    base[i % base.length] += text.charCodeAt(i) / 1024
  }
  return base.map((v) => Number(v.toFixed(6)))
}

export class KnowledgeBaseService {
  private cache = new Map<string, { expiresAt: number; chunks: KnowledgeChunk[] }>()
  private lastRate: Record<string, number> = {}
  constructor(private store: KnowledgeStore = new MemoryKnowledgeStore(), private logger: Logger = console, private ttlMs = 30_000) {}

  async ingestUpload(req: UploadIngestRequest): Promise<UploadIngestResponse> {
    const { brandId, botId } = req
    const text = this.extractText(req.buffer, req.mimeType)
    const doc = await this.store.upsertDocument({
      brandId,
      botId,
      name: req.filename,
      sourceType: 'upload',
      metadata: { mimeType: req.mimeType, ...(req.metadata || {}) },
    })
    const chunks = chunkText(text)
    const prepared: Omit<KnowledgeChunk, 'id' | 'createdAt'>[] = await Promise.all(
      chunks.map(async (c) => ({
        documentId: doc.id,
        brandId,
        botId,
        content: c.content,
        order: c.order,
        tokenEstimate: c.tokenEstimate,
        embedding: await this.embed(c.content),
        metadata: { filename: req.filename },
      })),
    )
    const saved = await this.store.appendChunks(doc.id, prepared)
    await this.store.recordRebuild({ brandId, botId, documentId: doc.id })
    this.cache.clear()
    return { document: doc, chunks: saved }
  }

  async rebuildIndex(filter: { brandId: string; botId: string; documentId?: string }) {
    const all = await this.store.listChunks({ brandId: filter.brandId, botId: filter.botId, documentId: filter.documentId })
    const updated: Omit<KnowledgeChunk, 'id' | 'createdAt'>[] = await Promise.all(
      all.map(async (c) => ({
        ...c,
        embedding: await this.embed(c.content),
      })),
    )
    if (filter.documentId) {
      await this.store.appendChunks(filter.documentId, updated)
    } else {
      const byDoc = new Map<string, Omit<KnowledgeChunk, 'id' | 'createdAt'>[]>();
      for (const c of updated) {
        const list = byDoc.get(c.documentId) || []
        list.push(c)
        byDoc.set(c.documentId, list)
      }
      for (const [docId, list] of byDoc.entries()) {
        await this.store.appendChunks(docId, list)
      }
    }
    await this.store.recordRebuild(filter)
    this.cache.clear()
  }

  async retrieve(query: string, opts: RetrievalOptions): Promise<RetrievalResult> {
    const key = `${opts.brandId}:${opts.botId}:${query}`
    const now = Date.now()
    if (this.cache.has(key)) {
      const entry = this.cache.get(key)!
      if (entry.expiresAt > now) return { chunks: entry.chunks, timingMs: 0, cache: 'hit' }
    }
    const last = this.lastRate[key] || 0
    if (now - last < 250) {
      throw new Error('rate_limited')
    }
    this.lastRate[key] = now
    const started = Date.now()
    const embedding = opts.queryEmbedding || (await this.embed(query))
    const chunks = await this.store.search(embedding, opts)
    const result = { chunks, timingMs: Date.now() - started as number, cache: 'miss' as const }
    this.cache.set(key, { chunks, expiresAt: now + this.ttlMs })
    return result
  }

  private extractText(buffer: Buffer, mimeType?: string) {
    const text = buffer.toString('utf8')
    if (mimeType?.includes('pdf')) {
      this.logger.warn('[kb] PDF parsing is best-effort in OSS build; ensure production parser is wired.')
    }
    return text
  }

  private async embed(text: string): Promise<number[]> {
    // TODO: wire into provider registry; use deterministic embedding for tests now
    return deterministicEmbedding(text)
  }
}

export function createKnowledgeBase(logger?: Logger) {
  return new KnowledgeBaseService(new MemoryKnowledgeStore(), logger)
}
