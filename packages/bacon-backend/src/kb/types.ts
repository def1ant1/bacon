export interface KnowledgeDocument {
  id: string
  brandId: string
  botId: string
  name: string
  sourceType: 'upload' | 'faq' | 'url'
  version: number
  createdAt: string
  updatedAt: string
  metadata?: Record<string, any>
}

export interface KnowledgeChunk {
  id: string
  documentId: string
  brandId: string
  botId: string
  content: string
  embedding: number[]
  order: number
  tokenEstimate: number
  createdAt: string
  metadata?: Record<string, any>
}

export interface RetrievalOptions {
  brandId: string
  botId: string
  topK?: number
  minSimilarity?: number
  queryEmbedding?: number[]
}

export interface KnowledgeStore {
  upsertDocument(doc: Omit<KnowledgeDocument, 'id' | 'createdAt' | 'updatedAt' | 'version'>): Promise<KnowledgeDocument>
  appendChunks(docId: string, chunks: Omit<KnowledgeChunk, 'id' | 'createdAt'>[]): Promise<KnowledgeChunk[]>
  listChunks(filter: { brandId: string; botId: string; documentId?: string }): Promise<KnowledgeChunk[]>
  search(queryEmbedding: number[], opts: RetrievalOptions): Promise<KnowledgeChunk[]>
  recordRebuild(meta: { brandId: string; botId: string; documentId?: string }): Promise<void>
  lastRebuild(filter: { brandId: string; botId: string }): Promise<string | null>
}

export interface UploadIngestRequest {
  brandId: string
  botId: string
  filename: string
  mimeType?: string
  buffer: Buffer
  metadata?: Record<string, any>
}

export interface UploadIngestResponse {
  document: KnowledgeDocument
  chunks: KnowledgeChunk[]
}

export interface RetrievalResult {
  chunks: KnowledgeChunk[]
  timingMs: number
  cache?: 'hit' | 'miss'
}
