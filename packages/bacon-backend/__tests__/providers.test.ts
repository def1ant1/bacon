import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { ProviderRegistry } from '../src/ai/providers/registry'
import { EchoProvider } from '../src/ai/providers/echo'
import { ProviderRouter } from '../src/ai/provider-router'
import { OpenAiProvider } from '../src/ai/providers/openai'
import type { HttpClient, HttpResponse } from '../src/ai/providers/http'

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

describe('ProviderRegistry + ProviderRouter', () => {
  it('falls back to echo when requested provider is missing', async () => {
    const registry = new ProviderRegistry()
    registry.register(new EchoProvider())
    registry.setFallbackOrder(['echo'])
    const router = new ProviderRouter(registry)
    const reply = await router.chat({ prompt: 'hi', provider: 'openai' })
    expect(reply.text).toContain('Echo: hi')
  })

  it('aggregates health checks for registered providers', async () => {
    const registry = new ProviderRegistry()
    registry.register(new EchoProvider())
    const health = await registry.health({ logger: noopLogger })
    expect(health[0]?.ok).toBe(true)
  })
})

describe('OpenAiProvider', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('retries after rate limiting and surfaces request ids', async () => {
    const responses: HttpResponse[] = [
      { status: 429, headers: { 'retry-after': '1' }, data: { choices: [] } },
      { status: 200, headers: { 'x-request-id': 'req-123' }, data: { choices: [{ message: { content: 'ok' } }] } },
    ]
    const http: HttpClient = {
      request: vi.fn(async () => {
        const next = responses.shift()
        if (!next) throw new Error('no response')
        return next
      }),
    }

    const provider = new OpenAiProvider(http, { apiKey: 'k' })
    const promise = provider.chat({ prompt: 'ping' })
    await vi.runAllTimersAsync()
    const res = await promise
    expect(res.text).toBe('ok')
    expect(res.requestId).toBe('req-123')
    expect((http.request as any).mock.calls.length).toBeGreaterThan(1)
  })
})
