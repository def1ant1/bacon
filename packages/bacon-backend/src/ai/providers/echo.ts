import { AiProviderV2, ChatRequest, ChatResponse, EmbedRequest, EmbedResponse, ProviderHealth, ProviderMetadata } from './types'

/**
 * Purely deterministic provider used for development and as a safe fallback.
 */
export class EchoProvider implements AiProviderV2 {
  metadata(): ProviderMetadata {
    return { name: 'echo', models: ['echo'], supportsEmbeddings: true, supportsSystemPrompt: false }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const historySuffix = request.history?.length ? ` [history:${request.history.length}]` : ''
    return { text: `Echo: ${request.prompt}${historySuffix}`, requestId: request.requestId }
  }

  async embed(request: EmbedRequest): Promise<EmbedResponse> {
    // Use deterministic character codes to keep tests reproducible.
    const vector = Array.from(request.text).map((c) => c.charCodeAt(0) / 255)
    return { vector }
  }

  async checkHealth(): Promise<ProviderHealth> {
    return { name: 'echo', ok: true, details: 'always-on in-memory provider', lastCheckedAt: new Date().toISOString() }
  }
}
