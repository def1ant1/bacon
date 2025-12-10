import { randomUUID } from 'crypto'
import { KnowledgeChunk, KnowledgeDocument, KnowledgeStore } from './types'

function nowIso() {
  return new Date().toISOString()
}

export class MemoryKnowledgeStore implements KnowledgeStore {
  private docs: KnowledgeDocument[] = []
  private chunks: KnowledgeChunk[] = []
  private rebuilds: Record<string, string> = {}

  async upsertDocument(doc: Omit<KnowledgeDocument, 'id' | 'createdAt' | 'updatedAt' | 'version'>): Promise<KnowledgeDocument> {
    const existing = this.docs.find((d) => d.brandId === doc.brandId && d.botId === doc.botId && d.name === doc.name)
    if (existing) {
      existing.version += 1
      existing.updatedAt = nowIso()
      existing.metadata = { ...(existing.metadata || {}), ...(doc.metadata || {}) }
      return existing
    }
    const next: KnowledgeDocument = {
      ...doc,
      id: randomUUID(),
      version: 1,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    this.docs.push(next)
    return next
  }

  async appendChunks(docId: string, chunks: Omit<KnowledgeChunk, 'id' | 'createdAt'>[]): Promise<KnowledgeChunk[]> {
    const created = chunks.map((c) => ({ ...c, id: randomUUID(), createdAt: nowIso() }))
    this.chunks = this.chunks.filter((c) => c.documentId !== docId)
    this.chunks.push(...created)
    return created
  }

  async listChunks(filter: { brandId: string; botId: string; documentId?: string }): Promise<KnowledgeChunk[]> {
    return this.chunks.filter(
      (c) => c.brandId === filter.brandId && c.botId === filter.botId && (!filter.documentId || c.documentId === filter.documentId),
    )
  }

  async search(queryEmbedding: number[], opts: { brandId: string; botId: string; topK?: number; minSimilarity?: number }): Promise<KnowledgeChunk[]> {
    const topK = opts.topK ?? 5
    const min = opts.minSimilarity ?? -1
    const scored = this.chunks
      .filter((c) => c.brandId === opts.brandId && c.botId === opts.botId)
      .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
      .filter((s) => s.score >= min)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
    return scored.map((s) => s.chunk)
  }

  async recordRebuild(meta: { brandId: string; botId: string; documentId?: string }): Promise<void> {
    this.rebuilds[`${meta.brandId}:${meta.botId}`] = nowIso()
  }

  async lastRebuild(filter: { brandId: string; botId: string }): Promise<string | null> {
    return this.rebuilds[`${filter.brandId}:${filter.botId}`] || null
  }
}

function cosineSimilarity(a: number[], b: number[]) {
  const len = Math.min(a.length, b.length)
  if (!len) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}
