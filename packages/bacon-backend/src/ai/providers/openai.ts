import { HttpClient, HttpRequestOptions } from './http'
import { withRetry } from './resilience'
import { AiProviderV2, ChatRequest, ChatResponse, EmbedRequest, EmbedResponse, ProviderHealth, ProviderMetadata, ProviderHooks } from './types'

export interface OpenAiConfig {
  apiKey: string
  baseUrl?: string
  defaultModel?: string
  embeddingModel?: string
  maxRetries?: number
}

export class OpenAiProvider implements AiProviderV2 {
  constructor(private readonly http: HttpClient, private readonly config: OpenAiConfig) {}

  metadata(): ProviderMetadata {
    return {
      name: 'openai',
      models: [this.config.defaultModel || 'gpt-4o-mini', this.config.embeddingModel || 'text-embedding-3-small'],
      supportsEmbeddings: true,
      supportsSystemPrompt: true,
    }
  }

  private endpoint(path: string) {
    const base = this.config.baseUrl || 'https://api.openai.com/v1'
    return `${base}${path}`
  }

  async chat(request: ChatRequest, hooks?: ProviderHooks): Promise<ChatResponse> {
    const payload = {
      model: request.model || this.config.defaultModel || 'gpt-4o-mini',
      messages: [
        ...(request.history || []).map((h) => ({ role: h.role, content: h.content })),
        { role: 'user', content: request.prompt },
      ],
    }

    const perform = async () => {
      const res = await this.http.request<{ choices: { message: { content: string } }[] }>(
        {
          url: this.endpoint('/chat/completions'),
          headers: { Authorization: `Bearer ${this.config.apiKey}` },
          body: payload,
          retries: this.config.maxRetries ?? 2,
          retryDelayMs: 300,
          expectedStatus: [200, 201, 429],
        },
        hooks,
      )

      if (res.status === 429) {
        const err: any = new Error('openai_rate_limited')
        err.retryAfter = res.headers['retry-after']
        throw err
      }

      const text = res.data.choices?.[0]?.message?.content || ''
      return { text, raw: res.data, requestId: res.headers['x-request-id'] || request.requestId }
    }

    return withRetry(perform, { retries: this.config.maxRetries ?? 3, baseDelayMs: 400, maxDelayMs: 3000 }, hooks)
  }

  async embed(request: EmbedRequest, hooks?: ProviderHooks): Promise<EmbedResponse> {
    const res = await this.http.request<{ data: { embedding: number[] }[] }>(
      {
        url: this.endpoint('/embeddings'),
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        body: { model: request.model || this.config.embeddingModel || 'text-embedding-3-small', input: request.text },
        retries: this.config.maxRetries ?? 1,
      },
      hooks,
    )
    return { vector: res.data.data?.[0]?.embedding || [], raw: res.data }
  }

  async checkHealth(hooks?: ProviderHooks): Promise<ProviderHealth> {
    try {
      const res = await this.http.request<any>(
        {
          url: this.endpoint('/models'),
          method: 'GET',
          headers: { Authorization: `Bearer ${this.config.apiKey}` },
          retries: 1,
          expectedStatus: [200, 429],
        },
        hooks,
      )
      const ok = res.status === 200
      return { name: 'openai', ok, details: ok ? 'model list reachable' : 'rate limited', lastCheckedAt: new Date().toISOString() }
    } catch (err: any) {
      return { name: 'openai', ok: false, details: err?.message, lastCheckedAt: new Date().toISOString() }
    }
  }
}

export function buildOpenAiFromEnv(http: HttpClient): OpenAiProvider {
  const apiKey = process.env.OPENAI_API_KEY || ''
  if (!apiKey) throw new Error('OPENAI_API_KEY is required')
  return new OpenAiProvider(http, {
    apiKey,
    baseUrl: process.env.OPENAI_BASE_URL,
    defaultModel: process.env.OPENAI_MODEL,
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL,
  })
}
