import { AiProviderV2, ProviderHealth, ProviderHooks, ProviderMetadata, ProviderName } from './types'

export class ProviderRegistry {
  private readonly providers = new Map<ProviderName, AiProviderV2>()
  private readonly fallbacks: ProviderName[] = []

  register(provider: AiProviderV2) {
    this.providers.set(provider.metadata().name, provider)
  }

  setFallbackOrder(order: ProviderName[]) {
    this.fallbacks.splice(0, this.fallbacks.length, ...order)
  }

  get(name: ProviderName): AiProviderV2 | undefined {
    return this.providers.get(name)
  }

  resolve(name: ProviderName): AiProviderV2 {
    const primary = this.providers.get(name)
    if (primary) return primary
    for (const fallback of this.fallbacks) {
      const found = this.providers.get(fallback)
      if (found) return found
    }
    throw new Error(`No provider registered for ${name}`)
  }

  async health(hooks?: ProviderHooks): Promise<ProviderHealth[]> {
    const results: ProviderHealth[] = []
    for (const provider of this.providers.values()) {
      if (!provider.checkHealth) continue
      results.push(await provider.checkHealth(hooks))
    }
    return results
  }

  listMetadata(): ProviderMetadata[] {
    return Array.from(this.providers.values()).map((p) => p.metadata())
  }
}
