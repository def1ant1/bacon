import { HttpClient } from './http'
import { AiProviderV2, ChatRequest, ChatResponse, EmbedRequest, EmbedResponse, ProviderHealth, ProviderMetadata, ProviderHooks } from './types'

export interface GeminiConfig {
  apiKey: string
  baseUrl?: string
  model?: string
}

export class GeminiProvider implements AiProviderV2 {
  constructor(private readonly http: HttpClient, private readonly config: GeminiConfig) {}

  metadata(): ProviderMetadata {
    return { name: 'gemini', models: [this.config.model || 'gemini-1.5-pro'], supportsEmbeddings: true, supportsSystemPrompt: true }
  }

  private endpoint(path: string) {
    return `${this.config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'}${path}?key=${this.config.apiKey}`
  }

  async chat(request: ChatRequest, hooks?: ProviderHooks): Promise<ChatResponse> {
    const res = await this.http.request<{ candidates: { content?: { parts?: { text?: string }[] } }[] }>(
      {
        url: this.endpoint(`/models/${request.model || this.config.model || 'gemini-1.5-pro'}:generateContent`),
        body: { contents: [{ role: 'user', parts: [{ text: request.prompt }] }] },
        retries: 1,
      },
      hooks,
    )
    const text = res.data.candidates?.[0]?.content?.parts?.[0]?.text || ''
    return { text, raw: res.data }
  }

  async embed(request: EmbedRequest, hooks?: ProviderHooks): Promise<EmbedResponse> {
    const res = await this.http.request<{ embedding: { values: number[] } }>(
      {
        url: this.endpoint('/models/text-embedding-004:embedText'),
        body: { text: request.text },
      },
      hooks,
    )
    return { vector: res.data.embedding?.values || [], raw: res.data }
  }

  async checkHealth(hooks?: ProviderHooks): Promise<ProviderHealth> {
    try {
      await this.http.request({ url: this.endpoint('/models'), method: 'GET' }, hooks)
      return { name: 'gemini', ok: true, lastCheckedAt: new Date().toISOString() }
    } catch (err: any) {
      return { name: 'gemini', ok: false, details: err?.message, lastCheckedAt: new Date().toISOString() }
    }
  }
}

export function buildGeminiFromEnv(http: HttpClient): GeminiProvider {
  const apiKey = process.env.GEMINI_API_KEY || ''
  if (!apiKey) throw new Error('GEMINI_API_KEY is required')
  return new GeminiProvider(http, { apiKey, baseUrl: process.env.GEMINI_BASE_URL, model: process.env.GEMINI_MODEL })
}
