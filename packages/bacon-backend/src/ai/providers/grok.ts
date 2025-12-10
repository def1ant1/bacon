import { HttpClient } from './http'
import { AiProviderV2, ChatRequest, ChatResponse, EmbedRequest, EmbedResponse, ProviderHealth, ProviderMetadata, ProviderHooks } from './types'

export interface GrokConfig {
  apiKey: string
  baseUrl?: string
  model?: string
}

export class GrokProvider implements AiProviderV2 {
  constructor(private readonly http: HttpClient, private readonly config: GrokConfig) {}

  metadata(): ProviderMetadata {
    return { name: 'grok', models: [this.config.model || 'grok-beta'], supportsEmbeddings: false, supportsSystemPrompt: true }
  }

  private endpoint(path: string) {
    return `${this.config.baseUrl || 'https://api.x.ai/v1'}${path}`
  }

  async chat(request: ChatRequest, hooks?: ProviderHooks): Promise<ChatResponse> {
    const res = await this.http.request<{ output: { text: string } }>(
      {
        url: this.endpoint('/chat/completions'),
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        body: { model: request.model || this.config.model || 'grok-beta', messages: [{ role: 'user', content: request.prompt }] },
        retries: 1,
      },
      hooks,
    )
    return { text: res.data.output?.text || '', raw: res.data, requestId: res.headers['x-request-id'] }
  }

  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    return { vector: [], raw: { disabled: true } }
  }

  async checkHealth(hooks?: ProviderHooks): Promise<ProviderHealth> {
    try {
      await this.http.request({ url: this.endpoint('/models'), method: 'GET', headers: { Authorization: `Bearer ${this.config.apiKey}` } }, hooks)
      return { name: 'grok', ok: true, lastCheckedAt: new Date().toISOString() }
    } catch (err: any) {
      return { name: 'grok', ok: false, details: err?.message, lastCheckedAt: new Date().toISOString() }
    }
  }
}

export function buildGrokFromEnv(http: HttpClient): GrokProvider {
  const apiKey = process.env.GROK_API_KEY || ''
  if (!apiKey) throw new Error('GROK_API_KEY is required')
  return new GrokProvider(http, { apiKey, baseUrl: process.env.GROK_BASE_URL, model: process.env.GROK_MODEL })
}
