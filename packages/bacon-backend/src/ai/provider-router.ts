import { ProviderRegistry } from './providers/registry'
import { AiProvider } from '../types'
import { ProviderName } from './providers/types'

/**
 * Adapter to allow the legacy pipeline to call into the richer provider registry.
 * This keeps the pipeline small while we evolve provider capabilities.
 */
export class ProviderRouter implements AiProvider {
  constructor(private readonly registry: ProviderRegistry, private readonly defaultProvider: ProviderName = 'echo') {}

  async chat(request: { prompt: string; history?: { role: 'user' | 'assistant' | 'system'; content: string }[]; model?: string; requestId?: string }): Promise<{ text: string; requestId?: string }> {
    const provider = this.registry.resolve((request.provider as ProviderName) || (request.model as ProviderName) || this.defaultProvider)
    const response = await provider.chat({ prompt: request.prompt, history: request.history, model: request.model, requestId: request.requestId })
    return { text: response.text, requestId: response.requestId }
  }

  async embed(request: { text: string; model?: string }): Promise<{ vector: number[] }> {
    const provider = this.registry.resolve((request.model as ProviderName) || this.defaultProvider)
    if (!provider.embed) return { vector: [] }
    const res = await provider.embed({ text: request.text, model: request.model })
    return { vector: res.vector }
  }

  async checkHealth() {
    const statuses = await this.registry.health()
    return { ok: statuses.every((s) => s.ok), name: 'composite' }
  }

  metadata() {
    return { name: 'composite', models: this.registry.listMetadata().flatMap((m) => m.models || []) }
  }
}
