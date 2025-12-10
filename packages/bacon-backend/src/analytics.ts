import { InboxService } from './inbox'
import { StorageAdapter } from './types'

type TimeRange = { start?: Date; end?: Date }
type Cached<T> = { value: T; expiresAt: number }

export type AnalyticsQuery = {
  metric: 'ttr' | 'resolution_rate' | 'csat' | 'volume'
  page?: number
  pageSize?: number
  timeStart?: string
  timeEnd?: string
}

export class AnalyticsService {
  private cache = new Map<string, Cached<any>>()

  constructor(private readonly storage: StorageAdapter, private readonly inbox?: InboxService, private readonly ttlMs = 60_000) {}

  async query(params: AnalyticsQuery) {
    const key = JSON.stringify(params)
    const now = Date.now()
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > now) return cached.value

    const range: TimeRange = {
      start: params.timeStart ? new Date(params.timeStart) : undefined,
      end: params.timeEnd ? new Date(params.timeEnd) : undefined,
    }

    let result: any
    switch (params.metric) {
      case 'ttr':
        result = await this.computeTtr(range)
        break
      case 'resolution_rate':
        result = await this.computeResolutionRate(range)
        break
      case 'csat':
        result = await this.computeCsat(range)
        break
      default:
        result = await this.computeVolume(range, params.page, params.pageSize)
    }

    this.cache.set(key, { value: result, expiresAt: now + this.ttlMs })
    return result
  }

  private filterByRange<T extends { createdAt: string }>(items: T[], range: TimeRange): T[] {
    return items.filter((item) => {
      const ts = new Date(item.createdAt).getTime()
      if (range.start && ts < range.start.getTime()) return false
      if (range.end && ts > range.end.getTime()) return false
      return true
    })
  }

  private async computeVolume(range: TimeRange, page = 1, pageSize = 50) {
    const sessions = await this.storage.listSessions()
    const start = Math.max((page - 1) * pageSize, 0)
    const end = start + pageSize
    const slice = sessions.slice(start, end)
    const buckets: Record<string, number> = {}
    for (const session of slice) {
      const msgs = await this.storage.listMessages(session.sessionId)
      for (const msg of this.filterByRange(msgs, range)) {
        const day = msg.createdAt.slice(0, 10)
        buckets[day] = (buckets[day] || 0) + 1
      }
    }
    return {
      page,
      pageSize,
      totalSessions: sessions.length,
      points: Object.entries(buckets).map(([day, count]) => ({ day, count })),
    }
  }

  private async computeTtr(range: TimeRange) {
    const sessions = await this.storage.listSessions()
    const durations: number[] = []
    for (const session of sessions) {
      const msgs = this.filterByRange(await this.storage.listMessages(session.sessionId), range)
      const userFirst = msgs.find((m) => m.sender === 'user')
      if (!userFirst) continue
      const botReply = msgs.find((m) => m.sender === 'bot' && new Date(m.createdAt).getTime() >= new Date(userFirst.createdAt).getTime())
      if (!botReply) continue
      durations.push(new Date(botReply.createdAt).getTime() - new Date(userFirst.createdAt).getTime())
    }
    const avgMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0
    return { averageMs: avgMs, samples: durations.length }
  }

  private async computeResolutionRate(range: TimeRange) {
    if (!this.inbox) return { resolved: 0, total: 0, rate: 0 }
    const tickets = await this.inbox.list({})
    const filtered = tickets.filter((t) => {
      const updated = new Date(t.updatedAt).getTime()
      if (range.start && updated < range.start.getTime()) return false
      if (range.end && updated > range.end.getTime()) return false
      return true
    })
    const resolved = filtered.filter((t) => t.status === 'closed').length
    const total = filtered.length
    return { resolved, total, rate: total ? resolved / total : 0 }
  }

  private async computeCsat(range: TimeRange) {
    const sessions = await this.storage.listSessions()
    const scores: number[] = []
    for (const session of sessions) {
      const msgs = this.filterByRange(await this.storage.listMessages(session.sessionId), range)
      for (const msg of msgs) {
        if (msg.sender !== 'user') continue
        const fromPayload = Number((msg.payload as any)?.data?.csat)
        if (Number.isFinite(fromPayload)) {
          scores.push(fromPayload)
          continue
        }
        const textMatch = msg.text.match(/csat[:\s]+(\d+(?:\.\d+)?)/i)
        if (textMatch) scores.push(Number(textMatch[1]))
      }
    }
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
    return { average: avg, responses: scores.length }
  }
}
