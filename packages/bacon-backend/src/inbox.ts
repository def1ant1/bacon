import { Pool } from 'pg'
import { v4 as uuidv4 } from 'uuid'
import { AiProvider, InboxFilters, InboxQueueAdapter, InboxTicket, Logger, StorageAdapter, TicketNote, TicketStatus } from './types'

const nowIso = () => new Date().toISOString()

function ensureStatus(status?: TicketStatus): TicketStatus {
  return status && ['new', 'assigned', 'snoozed', 'closed'].includes(status) ? status : 'new'
}

export class MemoryInboxQueue implements InboxQueueAdapter {
  private tickets = new Map<string, InboxTicket>()
  private notes = new Map<string, TicketNote[]>()

  async enqueue(ticket: { sessionId: string; brandId: string; tags?: string[]; confidence?: number; lastMessage?: string }): Promise<InboxTicket> {
    const existing = await this.getBySession(ticket.sessionId)
    if (existing && existing.status !== 'closed') {
      return this.update(existing.id, {
        lastMessage: ticket.lastMessage ?? existing.lastMessage,
        confidence: ticket.confidence ?? existing.confidence,
        tags: ticket.tags ?? existing.tags,
      }) as Promise<InboxTicket>
    }
    const rec: InboxTicket = {
      id: uuidv4(),
      sessionId: ticket.sessionId,
      brandId: ticket.brandId,
      status: 'new',
      tags: ticket.tags || [],
      lastMessage: ticket.lastMessage,
      confidence: ticket.confidence,
      assignedAgentId: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    this.tickets.set(rec.id, rec)
    return rec
  }

  async update(ticketId: string, patch: Partial<Omit<InboxTicket, 'id' | 'createdAt'>>): Promise<InboxTicket | null> {
    const existing = this.tickets.get(ticketId)
    if (!existing) return null
    const next: InboxTicket = {
      ...existing,
      ...patch,
      // Preserve the current status when callers intentionally omit it (e.g. tag edits or repeat user messages)
      status: patch.status !== undefined ? ensureStatus((patch as any)?.status) : existing.status,
      tags: patch.tags ?? existing.tags,
      updatedAt: nowIso(),
    }
    this.tickets.set(ticketId, next)
    return next
  }

  async addNote(ticketId: string, note: Omit<TicketNote, 'id' | 'createdAt' | 'ticketId'>): Promise<TicketNote> {
    const rec: TicketNote = {
      ...note,
      id: uuidv4(),
      ticketId,
      createdAt: nowIso(),
    }
    const notes = this.notes.get(ticketId) || []
    notes.push(rec)
    this.notes.set(ticketId, notes)
    return rec
  }

  async list(filters?: InboxFilters): Promise<InboxTicket[]> {
    let data = Array.from(this.tickets.values())
    if (filters?.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status]
      data = data.filter((t) => statuses.includes(t.status))
    }
    if (filters?.tag) data = data.filter((t) => (t.tags || []).includes(filters.tag as string))
    if (filters?.assignedAgentId) data = data.filter((t) => t.assignedAgentId === filters.assignedAgentId)
    if (filters?.brandId) data = data.filter((t) => t.brandId === filters.brandId)
    if (filters?.search) {
      const needle = filters.search.toLowerCase()
      data = data.filter((t) =>
        t.sessionId.toLowerCase().includes(needle) ||
        (t.lastMessage || '').toLowerCase().includes(needle) ||
        (t.tags || []).some((tag) => tag.toLowerCase().includes(needle)),
      )
    }
    data.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    if (filters?.includeNotes) {
      return data.map((t) => ({ ...t, notes: this.notes.get(t.id) || [] }))
    }
    return data
  }

  async getBySession(sessionId: string): Promise<InboxTicket | null> {
    for (const ticket of this.tickets.values()) {
      if (ticket.sessionId === sessionId && ticket.status !== 'closed') return ticket
    }
    return null
  }

  async get(ticketId: string): Promise<InboxTicket | null> {
    const ticket = this.tickets.get(ticketId)
    if (!ticket) return null
    return ticket
  }
}

export class PostgresInboxQueue implements InboxQueueAdapter {
  constructor(private readonly pool: Pool) {}

  async init() {
    await this.pool.query(`
      create table if not exists inbox_tickets (
        id bigserial primary key,
        session_id text not null,
        brand_id text not null,
        status text not null default 'new',
        tags text[] not null default '{}',
        assigned_agent_id text,
        last_message text,
        confidence numeric,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table if not exists inbox_notes (
        id bigserial primary key,
        ticket_id bigint not null references inbox_tickets(id) on delete cascade,
        author_id text,
        text text not null,
        created_at timestamptz not null default now()
      );
      create index if not exists idx_inbox_ticket_session on inbox_tickets(session_id);
      create index if not exists idx_inbox_ticket_status on inbox_tickets(status);
    `)
  }

  private mapRow(row: any): InboxTicket {
    return {
      id: String(row.id),
      sessionId: row.session_id,
      brandId: row.brand_id,
      status: ensureStatus(row.status),
      tags: row.tags || [],
      assignedAgentId: row.assigned_agent_id,
      lastMessage: row.last_message || undefined,
      confidence: row.confidence !== null && row.confidence !== undefined ? Number(row.confidence) : undefined,
      createdAt: row.created_at?.toISOString?.() || row.created_at,
      updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
    }
  }

  async enqueue(ticket: { sessionId: string; brandId: string; tags?: string[]; confidence?: number; lastMessage?: string }): Promise<InboxTicket> {
    await this.init()
    const existing = await this.getBySession(ticket.sessionId)
    if (existing && existing.status !== 'closed') {
      return (await this.update(existing.id, {
        lastMessage: ticket.lastMessage ?? existing.lastMessage,
        confidence: ticket.confidence ?? existing.confidence,
        tags: ticket.tags ?? existing.tags,
      })) as InboxTicket
    }
    const { rows } = await this.pool.query(
      `insert into inbox_tickets (session_id, brand_id, status, tags, last_message, confidence)
       values ($1,$2,'new',$3,$4,$5) returning *`,
      [ticket.sessionId, ticket.brandId, ticket.tags || [], ticket.lastMessage || null, ticket.confidence ?? null],
    )
    return this.mapRow(rows[0])
  }

  async update(ticketId: string, patch: Partial<Omit<InboxTicket, 'id' | 'createdAt'>>): Promise<InboxTicket | null> {
    await this.init()
    const existing = await this.get(ticketId)
    if (!existing) return null
    const next = {
      ...existing,
      ...patch,
      // Respect the existing status unless an explicit, valid update is provided
      status: patch.status !== undefined ? ensureStatus((patch as any)?.status) : existing.status,
      tags: patch.tags ?? existing.tags,
      updatedAt: nowIso(),
    }
    const { rows } = await this.pool.query(
      `update inbox_tickets set status=$2, tags=$3, assigned_agent_id=$4, last_message=$5, confidence=$6, updated_at=$7
         where id=$1 returning *`,
      [
        ticketId,
        next.status,
        next.tags,
        next.assignedAgentId,
        next.lastMessage || null,
        next.confidence ?? null,
        next.updatedAt,
      ],
    )
    return this.mapRow(rows[0])
  }

  async addNote(ticketId: string, note: Omit<TicketNote, 'id' | 'createdAt' | 'ticketId'>): Promise<TicketNote> {
    await this.init()
    const { rows } = await this.pool.query(
      `insert into inbox_notes (ticket_id, author_id, text) values ($1,$2,$3) returning id, ticket_id, author_id, text, created_at`,
      [ticketId, note.authorId || null, note.text],
    )
    const row = rows[0]
    return {
      id: String(row.id),
      ticketId: String(row.ticket_id),
      authorId: row.author_id || undefined,
      text: row.text,
      createdAt: row.created_at?.toISOString?.() || row.created_at,
    }
  }

  async list(filters?: InboxFilters): Promise<InboxTicket[]> {
    await this.init()
    const where: string[] = []
    const params: any[] = []
    if (filters?.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status]
      where.push(`status = ANY($${params.length + 1})`)
      params.push(statuses)
    }
    if (filters?.tag) {
      where.push(`$${params.length + 1} = ANY(tags)`)
      params.push(filters.tag)
    }
    if (filters?.assignedAgentId) {
      where.push(`assigned_agent_id = $${params.length + 1}`)
      params.push(filters.assignedAgentId)
    }
    if (filters?.brandId) {
      where.push(`brand_id = $${params.length + 1}`)
      params.push(filters.brandId)
    }
    if (filters?.search) {
      where.push(`(session_id ilike $${params.length + 1} or last_message ilike $${params.length + 1})`)
      params.push(`%${filters.search}%`)
    }
    const clause = where.length ? `where ${where.join(' and ')}` : ''
    const { rows } = await this.pool.query(`select * from inbox_tickets ${clause} order by updated_at desc`, params)
    const tickets = rows.map((r) => this.mapRow(r))

    if (filters?.includeNotes && tickets.length) {
      const noteRows = await this.pool.query(
        `select id, ticket_id, author_id, text, created_at from inbox_notes where ticket_id = any($1) order by created_at asc`,
        [tickets.map((t) => Number(t.id))],
      )
      const grouped = new Map<string, TicketNote[]>()
      for (const row of noteRows.rows) {
        const note: TicketNote = {
          id: String(row.id),
          ticketId: String(row.ticket_id),
          authorId: row.author_id || undefined,
          text: row.text,
          createdAt: row.created_at?.toISOString?.() || row.created_at,
        }
        const bucket = grouped.get(note.ticketId) || []
        bucket.push(note)
        grouped.set(note.ticketId, bucket)
      }
      return tickets.map((t) => ({ ...t, notes: grouped.get(t.id) || [] }))
    }

    return tickets
  }

  async getBySession(sessionId: string): Promise<InboxTicket | null> {
    await this.init()
    const { rows } = await this.pool.query(`select * from inbox_tickets where session_id = $1 and status <> 'closed' order by id desc limit 1`, [sessionId])
    return rows[0] ? this.mapRow(rows[0]) : null
  }

  async get(ticketId: string): Promise<InboxTicket | null> {
    await this.init()
    const { rows } = await this.pool.query(`select * from inbox_tickets where id = $1`, [ticketId])
    return rows[0] ? this.mapRow(rows[0]) : null
  }
}

/**
 * Lightweight Redis-backed queue adapter. If a Redis client is not provided
 * the adapter transparently falls back to the in-memory implementation so
 * downstream code can stay the same in tests and local dev.
 */
export class RedisInboxQueue implements InboxQueueAdapter {
  private fallback = new MemoryInboxQueue()
  constructor(private readonly redis?: any, private readonly prefix = 'inbox') {}

  private ready() {
    return !!this.redis?.hGet && !!this.redis?.hSet && !!this.redis?.hGetAll
  }

  private ticketKey() {
    return `${this.prefix}:tickets`
  }

  private noteKey(ticketId: string) {
    return `${this.prefix}:notes:${ticketId}`
  }

  async enqueue(ticket: { sessionId: string; brandId: string; tags?: string[]; confidence?: number; lastMessage?: string }): Promise<InboxTicket> {
    if (!this.ready()) return this.fallback.enqueue(ticket)
    const existing = await this.getBySession(ticket.sessionId)
    if (existing && existing.status !== 'closed') {
      return (await this.update(existing.id, {
        lastMessage: ticket.lastMessage ?? existing.lastMessage,
        confidence: ticket.confidence ?? existing.confidence,
        tags: ticket.tags ?? existing.tags,
      })) as InboxTicket
    }
    const rec: InboxTicket = {
      id: uuidv4(),
      sessionId: ticket.sessionId,
      brandId: ticket.brandId,
      status: 'new',
      tags: ticket.tags || [],
      lastMessage: ticket.lastMessage,
      confidence: ticket.confidence,
      assignedAgentId: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    await this.redis.hSet(this.ticketKey(), rec.id, JSON.stringify(rec))
    return rec
  }

  async update(ticketId: string, patch: Partial<Omit<InboxTicket, 'id' | 'createdAt'>>): Promise<InboxTicket | null> {
    if (!this.ready()) return this.fallback.update(ticketId, patch)
    const existing = await this.get(ticketId)
    if (!existing) return null
    const next: InboxTicket = {
      ...existing,
      ...patch,
      // Preserve the prior status for partial updates that do not include a status change
      status: patch.status !== undefined ? ensureStatus((patch as any)?.status) : existing.status,
      tags: patch.tags ?? existing.tags,
      updatedAt: nowIso(),
    }
    await this.redis.hSet(this.ticketKey(), ticketId, JSON.stringify(next))
    return next
  }

  async addNote(ticketId: string, note: Omit<TicketNote, 'id' | 'createdAt' | 'ticketId'>): Promise<TicketNote> {
    if (!this.ready()) return this.fallback.addNote(ticketId, note)
    const rec: TicketNote = { id: uuidv4(), ticketId, authorId: note.authorId, text: note.text, createdAt: nowIso() }
    await this.redis.rPush?.(this.noteKey(ticketId), JSON.stringify(rec))
    return rec
  }

  async list(filters?: InboxFilters): Promise<InboxTicket[]> {
    if (!this.ready()) return this.fallback.list(filters)
    const raw = await this.redis.hGetAll(this.ticketKey())
    const tickets: InboxTicket[] = Object.values(raw || {})
      .map((json: any) => {
        try {
          const parsed = typeof json === 'string' ? JSON.parse(json) : json
          return { ...parsed, status: ensureStatus(parsed.status) }
        } catch {
          return null
        }
      })
      .filter(Boolean) as InboxTicket[]
    const filtered = tickets.filter((t) => {
      if (filters?.status) {
        const statuses = Array.isArray(filters.status) ? filters.status : [filters.status]
        if (!statuses.includes(t.status)) return false
      }
      if (filters?.tag && !(t.tags || []).includes(filters.tag)) return false
      if (filters?.assignedAgentId && t.assignedAgentId !== filters.assignedAgentId) return false
      if (filters?.brandId && t.brandId !== filters.brandId) return false
      if (filters?.search) {
        const needle = filters.search.toLowerCase()
        if (
          !t.sessionId.toLowerCase().includes(needle) &&
          !(t.lastMessage || '').toLowerCase().includes(needle) &&
          !(t.tags || []).some((tag) => tag.toLowerCase().includes(needle))
        )
          return false
      }
      return true
    })
    filtered.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    if (filters?.includeNotes) {
      for (const t of filtered) {
        const notes = await this.redis.lRange?.(this.noteKey(t.id), 0, -1)
        t.notes = (notes || []).map((n: string) => {
          try {
            const parsed = JSON.parse(n)
            return { ...parsed, createdAt: parsed.createdAt || nowIso() }
          } catch {
            return null
          }
        }).filter(Boolean) as TicketNote[]
      }
    }
    return filtered
  }

  async getBySession(sessionId: string): Promise<InboxTicket | null> {
    const tickets = await this.list()
    return tickets.find((t) => t.sessionId === sessionId && t.status !== 'closed') || null
  }

  async get(ticketId: string): Promise<InboxTicket | null> {
    if (!this.ready()) return this.fallback.get(ticketId)
    const val = await this.redis.hGet(this.ticketKey(), ticketId)
    if (!val) return null
    try {
      const parsed = JSON.parse(val)
      return { ...parsed, status: ensureStatus(parsed.status) }
    } catch {
      return null
    }
  }
}

export class AgentChannelNotifier {
  private channels = new Map<string, Set<any>>()
  constructor(private readonly logger?: Logger) {}

  subscribe(channel: string, ws: any) {
    const normalized = channel.toLowerCase()
    const bucket = this.channels.get(normalized) || new Set<any>()
    bucket.add(ws)
    this.channels.set(normalized, bucket)
    ws.on?.('close', () => bucket.delete(ws))
  }

  broadcast(agentId: string | null | undefined, payload: any) {
    const sendTo = (channel: string) => {
      const listeners = this.channels.get(channel.toLowerCase())
      if (!listeners || listeners.size === 0) return
      for (const ws of listeners) {
        try {
          ws.send(JSON.stringify(payload))
        } catch (err) {
          this.logger?.warn?.('[ws] failed to notify channel', channel, err)
        }
      }
    }
    if (agentId) sendTo(`agent:${agentId}`)
    sendTo('agent:all')
  }
}

export class InboxService {
  private roundRobinCursor = 0
  constructor(
    private readonly deps: {
      queue: InboxQueueAdapter
      storage: StorageAdapter
      notifier?: AgentChannelNotifier
      logger?: Logger
      ai?: AiProvider
      defaultBrandId?: string
    },
  ) {}

  async upsertFromUserMessage(input: { sessionId: string; text: string; brandId?: string; confidence?: number; tags?: string[] }) {
    const ticket = await this.deps.queue.enqueue({
      sessionId: input.sessionId,
      brandId: input.brandId || this.deps.defaultBrandId || 'default',
      tags: input.tags || [],
      confidence: input.confidence,
      lastMessage: input.text,
    })
    this.deps.notifier?.broadcast(ticket.assignedAgentId, { type: 'ticket.updated', ticket })
    return ticket
  }

  async assign(ticketId: string, agentId: string) {
    const updated = await this.deps.queue.update(ticketId, { assignedAgentId: agentId, status: 'assigned' })
    if (!updated) throw new Error('ticket_not_found')
    this.deps.notifier?.broadcast(agentId, { type: 'ticket.assigned', ticket: updated })
    return updated
  }

  async roundRobinAssign(ticketId: string, agents: string[]) {
    if (!agents.length) throw new Error('no_agents')
    const agent = agents[this.roundRobinCursor % agents.length]
    this.roundRobinCursor = (this.roundRobinCursor + 1) % agents.length
    return this.assign(ticketId, agent)
  }

  async updateStatus(ticketId: string, status: TicketStatus) {
    const updated = await this.deps.queue.update(ticketId, { status })
    if (!updated) throw new Error('ticket_not_found')
    this.deps.notifier?.broadcast(updated.assignedAgentId, { type: 'ticket.updated', ticket: updated })
    return updated
  }

  async unassign(ticketId: string) {
    const updated = await this.deps.queue.update(ticketId, { assignedAgentId: null, status: 'new' })
    if (!updated) throw new Error('ticket_not_found')
    this.deps.notifier?.broadcast(null, { type: 'ticket.unassigned', ticket: updated })
    return updated
  }

  async addTags(ticketId: string, tags: string[]) {
    const unique = Array.from(new Set(tags))
    const updated = await this.deps.queue.update(ticketId, { tags: unique })
    if (!updated) throw new Error('ticket_not_found')
    return updated
  }

  async addNote(ticketId: string, text: string, authorId?: string) {
    const note = await this.deps.queue.addNote(ticketId, { authorId, text })
    const ticket = await this.deps.queue.get(ticketId)
    this.deps.notifier?.broadcast(ticket?.assignedAgentId || null, { type: 'ticket.note', note, ticket })
    return note
  }

  async list(filters?: InboxFilters & { includeMessages?: boolean }) {
    const { includeMessages, ...rest } = filters || {}
    const tickets = await this.deps.queue.list(rest)
    if (!includeMessages) return tickets
    const enriched: (InboxTicket & { messages: any[] })[] = []
    for (const t of tickets) {
      const messages = await this.deps.storage.listMessages(t.sessionId)
      enriched.push({ ...t, messages })
    }
    return enriched
  }

  async draftReply(ticketId: string, prompt?: string) {
    if (!this.deps.ai) throw new Error('ai_unavailable')
    const ticket = await this.deps.queue.get(ticketId)
    if (!ticket) throw new Error('ticket_not_found')
    const history = await this.deps.storage.listMessages(ticket.sessionId)
    const reply = await this.deps.ai.chat({
      prompt:
        prompt ||
        'You are an on-duty human support agent. Draft a concise, empathetic reply using the conversation history.',
      history: history.map((h) => ({ role: h.sender === 'user' ? 'user' : 'assistant', content: h.text })),
    })
    return { text: reply.text, confidence: reply.confidence ?? 1 }
  }
}
