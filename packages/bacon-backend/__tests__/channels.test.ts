import { describe, expect, it } from 'vitest'
import { ChannelAdapter, ChannelRouter } from '../src/channels'
import { MemoryStorage } from '../src/storage-memory'
import { Pipeline } from '../src/pipeline'
import type { AiProvider } from '../src/types'

const echoProvider: AiProvider = {
  async chat({ prompt }) {
    return { text: `echo:${prompt}` }
  },
}

const buildTestAdapter = (): ChannelAdapter => ({
  id: 'test',
  capabilities: { inbound: true, outbound: true },
  normalizeInbound: (payload: any) => ({
    externalUserId: payload.userId,
    text: payload.text,
    providerMessageId: payload.providerMessageId,
  }),
  async send() {
    return { ok: true, providerMessageId: 'sent' }
  },
})

describe('ChannelRouter', () => {
  it('routes inbound messages and keeps mappings stable', async () => {
    const storage = new MemoryStorage()
    const pipeline = new Pipeline(storage, echoProvider, { settings: { ai: { provider: 'echo', systemPrompt: '' } } })
    const router = new ChannelRouter({ storage, pipeline, logger: console })
    router.register(buildTestAdapter())

    const first = await router.ingest('test', { userId: 'ext-1', text: 'hello', providerMessageId: 'm-1' })
    const duplicate = await router.ingest('test', { userId: 'ext-1', text: 'hello again', providerMessageId: 'm-1' })

    expect(first.sessionId).toBeDefined()
    expect(duplicate.sessionId).toEqual(first.sessionId)
    expect(duplicate.duplicate).toBe(true)

    const mapping = await storage.getChannelMapping('test', 'ext-1')
    expect(mapping?.sessionId).toEqual(first.sessionId)
    expect(mapping?.channel).toBe('test')
  })

  it('keeps existing session binding even when hints change', async () => {
    const storage = new MemoryStorage()
    const pipeline = new Pipeline(storage, echoProvider, { settings: { ai: { provider: 'echo', systemPrompt: '' } } })
    const router = new ChannelRouter({ storage, pipeline })
    router.register(buildTestAdapter())

    const first = await router.ingest('test', { userId: 'stable-user', text: 'hello' })
    const relink = await storage.linkChannelConversation({
      channel: 'test',
      externalUserId: 'stable-user',
      sessionIdHint: 'new-session',
      metadata: { forced: true },
    })

    expect(relink.mapping.sessionId).toEqual(first.sessionId)
    expect(relink.created).toBe(false)
  })

  it('falls back to storage logging when no outbound adapter is present', async () => {
    const storage = new MemoryStorage()
    const pipeline = new Pipeline(storage, echoProvider, { settings: { ai: { provider: 'echo', systemPrompt: '' } } })
    const router = new ChannelRouter({ storage, pipeline })
    const inboundOnly: ChannelAdapter = {
      id: 'inbound',
      capabilities: { inbound: true, outbound: false },
      normalizeInbound: (payload: any) => ({ externalUserId: payload.userId, text: payload.text }),
    }
    router.register(inboundOnly)

    const result = await router.dispatchToChannel('inbound', 'user-123', { text: 'hello outbound' })
    expect(result.ok).toBe(false)
    const history = await pipeline.list('user-123')
    expect(history.length).toBeGreaterThan(0)
  })
})
