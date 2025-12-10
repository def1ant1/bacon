import { describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { Readable } from 'node:stream'
import { createBaconServer, MemoryStorage } from '../src'
import { AgentChannelNotifier, InboxService, MemoryInboxQueue } from '../src/inbox'
import { Pipeline } from '../src/pipeline'
import type { AiProvider } from '../src/types'

class LowConfidenceProvider implements AiProvider {
  async chat(): Promise<{ text: string; confidence?: number }> {
    return { text: 'Escalate me', confidence: 0.2 }
  }
}

class HighConfidenceProvider implements AiProvider {
  async chat(): Promise<{ text: string; confidence?: number }> {
    return { text: 'I can reply', confidence: 0.95 }
  }
}

const makeReq = (method: string, url: string, body?: any) => {
  const payload = body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined
  const stream: any = payload ? Readable.from([payload]) : Readable.from([])
  stream.method = method
  stream.url = url
  stream.headers = { 'content-type': 'application/json' }
  return stream
}

const makeRes = () => {
  const chunks: Buffer[] = []
  return {
    statusCode: 200,
    headers: {} as Record<string, any>,
    setHeader(k: string, v: any) {
      this.headers[k] = v
    },
    end(chunk?: any) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
    },
    get body() {
      return Buffer.concat(chunks).toString('utf8')
    },
  }
}

async function callApi(server: any, method: string, url: string, body?: any) {
  const req = makeReq(method, url, body)
  const res: any = makeRes()
  await server.handler(req, res, () => {})
  return res.body ? JSON.parse(res.body) : undefined
}

describe('Inbox workflows', () => {
  it('routes to human queue when confidence is too low', async () => {
    const storage = new MemoryStorage()
    const queue = new MemoryInboxQueue()
    const inbox = new InboxService({ queue, storage, defaultBrandId: 'acme' })
    const pipeline = new Pipeline(
      storage,
      new LowConfidenceProvider(),
      { settings: { ai: { provider: 'echo', systemPrompt: '' }, behavior: { handoffConfidenceThreshold: 0.8 } } },
      undefined,
      inbox,
    )

    const reply = await pipeline.handleUserMessage('s-escalate', 'please help')
    const tickets = await queue.list()

    expect(reply.text).toContain('Routing')
    expect(tickets).toHaveLength(1)
    expect(tickets[0].sessionId).toBe('s-escalate')
    expect(tickets[0].status).toBe('new')
  })

  it('auto replies when confidence is healthy', async () => {
    const storage = new MemoryStorage()
    const queue = new MemoryInboxQueue()
    const inbox = new InboxService({ queue, storage, defaultBrandId: 'acme' })
    const pipeline = new Pipeline(
      storage,
      new HighConfidenceProvider(),
      { settings: { ai: { provider: 'echo', systemPrompt: '' }, behavior: { handoffConfidenceThreshold: 0.5 } } },
      undefined,
      inbox,
    )

    const reply = await pipeline.handleUserMessage('s-auto', 'hello bot')
    expect(reply.text).toContain('I can reply')
    const tickets = await queue.list()
    expect(tickets).toHaveLength(0)
  })

  it('supports round-robin assignment and notes', async () => {
    const storage = new MemoryStorage()
    const queue = new MemoryInboxQueue()
    const inbox = new InboxService({ queue, storage, defaultBrandId: 'acme' })
    const ticket = await inbox.upsertFromUserMessage({ sessionId: 's-notes', text: 'need help' })
    const assigned = await inbox.roundRobinAssign(ticket.id, ['a1', 'a2'])
    const snoozed = await inbox.updateStatus(ticket.id, 'snoozed')
    const note = await inbox.addNote(ticket.id, 'investigating', 'a1')

    expect(assigned.assignedAgentId).toBe('a1')
    expect(snoozed.status).toBe('snoozed')
    expect(note.text).toBe('investigating')
  })

  it('preserves status when partial updates omit it', async () => {
    const storage = new MemoryStorage()
    const queue = new MemoryInboxQueue()

    const ticket = await queue.enqueue({ sessionId: 'repeat-session', brandId: 'acme' })
    const assigned = await queue.update(ticket.id, { status: 'assigned', assignedAgentId: 'agent-42' })
    expect(assigned?.status).toBe('assigned')

    // Tag-only updates should not reset the ticket to "new"
    const retagged = await queue.update(ticket.id, { tags: ['vip'] })
    expect(retagged?.status).toBe('assigned')

    // A repeat user message flows through enqueue() without clobbering status
    const snoozed = await queue.update(ticket.id, { status: 'snoozed' })
    expect(snoozed?.status).toBe('snoozed')

    const refreshed = await queue.enqueue({ sessionId: ticket.sessionId, brandId: 'acme', lastMessage: 'still waiting' })
    expect(refreshed.status).toBe('snoozed')
    expect(refreshed.lastMessage).toBe('still waiting')
  })

  it('emits websocket updates for agents', async () => {
    const notifier = new AgentChannelNotifier()
    const received: any[] = []
    // Minimal websocket-like stub to validate channel fan-out
    const fakeSocket: any = {
      send(payload: string) {
        received.push(JSON.parse(payload))
      },
      on() {},
    }

    notifier.subscribe('agent:all', fakeSocket)
    notifier.broadcast('agent-1', { type: 'ticket.updated', ticket: { id: 't1', sessionId: 'sess', status: 'new' } })

    expect(received.find((m) => m.type === 'ticket.updated')?.ticket?.sessionId).toBe('sess')
  })

  it('allows agent actions through inbox API', async () => {
    const storage = new MemoryStorage()
    const queue = new MemoryInboxQueue()
    const server: any = createBaconServer({ storage, ai: new LowConfidenceProvider(), inbox: { queue } })
    const inbox = new InboxService({ queue, storage })
    const ticket = await inbox.upsertFromUserMessage({ sessionId: 'api-ticket', text: 'help' })

    await callApi(server, 'POST', '/api/admin/inbox', { action: 'assign', ticketId: ticket.id, agentId: 'agent-1' })
    await callApi(server, 'POST', '/api/admin/inbox', { action: 'note', ticketId: ticket.id, text: 'working' })
    await callApi(server, 'POST', '/api/admin/inbox', { action: 'status', ticketId: ticket.id, status: 'closed' })

    const updated = await queue.get(ticket.id)
    expect(updated?.assignedAgentId).toBe('agent-1')
    expect(updated?.status).toBe('closed')
    const notes = (await queue.list({ includeNotes: true })).find((t) => t.id === ticket.id)?.notes || []
    expect(notes.some((n) => n.text === 'working')).toBe(true)
  })
})
