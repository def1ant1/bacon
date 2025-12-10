import { HttpClient } from './http'
import { AiProviderV2, ChatRequest, ChatResponse, EmbedRequest, EmbedResponse, ProviderHealth, ProviderMetadata, ProviderHooks } from './types'

export interface LlamaConfig {
  apiKey: string
  baseUrl?: string
  model?: string
}

export class LlamaProvider implements AiProviderV2 {
  constructor(private readonly http: HttpClient, private readonly config: LlamaConfig) {}

  metadata(): ProviderMetadata {
    return { name: 'llama', models: [this.config.model || 'llama-3-405b-instruct'], supportsEmbeddings: false, supportsSystemPrompt: true }
  }

  private endpoint(path: string) {
    return `${this.config.baseUrl || 'https://graph.facebook.com/v1'}${path}`
  }

  async chat(request: ChatRequest, hooks?: ProviderHooks): Promise<ChatResponse> {
    const res = await this.http.request<{ result?: string }>(
      {
        url: this.endpoint('/llama/chat'),
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        body: { model: request.model || this.config.model || 'llama-3-405b-instruct', prompt: request.prompt },
      },
      hooks,
    )
    return { text: res.data.result || '', raw: res.data }
  }

  async embed(_: EmbedRequest): Promise<EmbedResponse> {
    return { vector: [], raw: { note: 'embeddings not exposed by mock' } }
  }

  async checkHealth(hooks?: ProviderHooks): Promise<ProviderHealth> {
    try {
      await this.http.request({ url: this.endpoint('/llama/health'), method: 'GET', headers: { Authorization: `Bearer ${this.config.apiKey}` } }, hooks)
      return { name: 'llama', ok: true, lastCheckedAt: new Date().toISOString() }
    } catch (err: any) {
      return { name: 'llama', ok: false, details: err?.message, lastCheckedAt: new Date().toISOString() }
    }
  }
}

export function buildLlamaFromEnv(http: HttpClient): LlamaProvider {
  const apiKey = process.env.LLAMA_API_KEY || ''
  if (!apiKey) throw new Error('LLAMA_API_KEY is required')
  return new LlamaProvider(http, { apiKey, baseUrl: process.env.LLAMA_BASE_URL, model: process.env.LLAMA_MODEL })
}
