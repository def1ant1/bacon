/**
 * Provider-neutral contracts for AI services used across the backend.
 * The goal is to provide enough structure for observability, retries,
 * and circuit-breakers without coupling to a specific vendor SDK.
 */
import { Logger, MetricsHooks } from '../../types'

export type ProviderName = 'echo' | 'openai' | 'grok' | 'gemini' | 'llama'

export interface ChatHistoryItem {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ChatRequest {
  /**
   * Raw prompt text from the end user or the orchestrating pipeline.
   * Providers should prepend/apply system prompts internally if needed.
   */
  prompt: string
  history?: ChatHistoryItem[]
  requestId?: string
  metadata?: Record<string, any>
  model?: string
}

export interface ChatResponse {
  text: string
  raw?: any
  requestId?: string
  timingMs?: number
}

export interface EmbedRequest {
  text: string
  model?: string
}

export interface EmbedResponse {
  vector: number[]
  raw?: any
}

export interface ProviderMetadata {
  name: ProviderName
  models: string[]
  supportsEmbeddings: boolean
  supportsSystemPrompt: boolean
}

export interface ProviderHealth {
  name: ProviderName
  ok: boolean
  details?: string
  lastCheckedAt: string
}

export interface ProviderHooks {
  logger?: Logger
  metrics?: MetricsHooks
  /** Optional hook to fan out traces for observability tools. */
  onTrace?: (event: { name: string; meta?: Record<string, any> }) => void
}

/** Provider contract with explicit chat/embed/metadata APIs. */
export interface AiProviderV2 {
  chat(request: ChatRequest, hooks?: ProviderHooks): Promise<ChatResponse>
  embed(request: EmbedRequest, hooks?: ProviderHooks): Promise<EmbedResponse>
  metadata(): ProviderMetadata
  checkHealth?(hooks?: ProviderHooks): Promise<ProviderHealth>
}
