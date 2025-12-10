import { describe, expect, it } from 'vitest'
import { Pipeline } from '../src/pipeline'
import { MemoryStorage } from '../src'
import type { AiProvider } from '../src/types'

class FailingProvider implements AiProvider {
  async chat(): Promise<{ text: string }> {
    throw new Error('boom')
  }
}

describe('Pipeline fallback behavior', () => {
  it('returns a defensive message when provider fails', async () => {
    const storage = new MemoryStorage()
    const pipeline = new Pipeline(storage, new FailingProvider(), { settings: { ai: { provider: 'echo', systemPrompt: '' } } })
    const reply = await pipeline.handleUserMessage('s1', 'hello')
    expect(reply.text.toLowerCase()).toContain('routing')
  })
})
