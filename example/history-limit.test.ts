import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

class MockRes {
  statusCode = 200
  headers: Record<string, any> = {}
  chunks: Buffer[] = []
  setHeader(k: string, v: any) {
    this.headers[k] = v
  }
  end(chunk?: any) {
    if (chunk) this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
}

function makeReq(method: string, url: string, body?: any) {
  const payload = body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined
  const stream = Readable.from(payload ? [payload] : []) as any
  stream.method = method
  stream.url = url
  stream.headers = { 'content-type': 'application/json' }
  return stream
}

async function callApi(server: any, method: string, url: string, body?: any) {
  const req = makeReq(method, url, body)
  const res = new MockRes()
  await server.handler(req, res, () => {})
  const raw = Buffer.concat(res.chunks).toString('utf8')
  return raw ? JSON.parse(raw) : undefined
}

type FakeMsgRow = { id: number; session_id: string; sender: 'user' | 'bot'; text: string; created_at: Date }
type FakeSessionRow = { session_id: string; created_at: Date; last_activity_at: Date; id: number }

type FakeFileRow = {
  id: number
  session_id: string
  original_name: string
  mime_type?: string
  size_bytes?: number
  storage_path: string
  created_at: Date
}

class FakePool {
  private msgId = 1
  private fileId = 1
  private convId = 1
  messages: FakeMsgRow[] = []
  sessions = new Map<string, FakeSessionRow>()
  conversations = new Map<string, FakeSessionRow>()
  files: FakeFileRow[] = []

  async query(sql: string, params: any[] = []) {
    const q = sql.trim().toLowerCase()
    if (q.includes('create table if not exists')) return { rows: [] }
    if (q.startsWith('begin') || q.startsWith('commit') || q.startsWith('rollback')) return { rows: [] }

    if (q.startsWith('insert into conversations')) {
      const sessionId = params[0]
      const existing = this.conversations.get(sessionId)
      if (existing) {
        existing.last_activity_at = new Date()
        return { rows: [{ id: existing.id }] }
      }
      const row = {
        id: this.convId++,
        session_id: sessionId,
        created_at: new Date(),
        last_activity_at: new Date(),
      }
      this.conversations.set(sessionId, row)
      return { rows: [{ id: row.id }] }
    }

    if (q.startsWith('insert into chat_sessions')) {
      const sessionId = params[0]
      const existing = this.sessions.get(sessionId)
      if (existing) {
        existing.last_activity_at = new Date()
      } else {
        this.sessions.set(sessionId, {
          id: this.convId++,
          session_id: sessionId,
          created_at: new Date(),
          last_activity_at: new Date(),
        })
      }
      return { rows: [] }
    }

    if (q.startsWith('insert into chat_messages')) {
      const [sessionId, sender, text] = params
      this.messages.push({
        id: this.msgId++,
        session_id: sessionId,
        sender,
        text,
        created_at: new Date(),
      })
      return { rows: [] }
    }

    if (q.startsWith('insert into chat_files')) {
      const [session_id, original_name, mime_type, size_bytes, storage_path] = params
      this.files.push({
        id: this.fileId++,
        session_id,
        original_name,
        mime_type: mime_type || undefined,
        size_bytes: size_bytes || undefined,
        storage_path,
        created_at: new Date(),
      })
      return { rows: [] }
    }

    if (q.startsWith('update chat_sessions set last_activity_at')) {
      const sessionId = params[0]
      const row = this.sessions.get(sessionId)
      if (row) row.last_activity_at = new Date()
      return { rows: [] }
    }

    if (q.startsWith('update conversations set last_activity_at')) {
      const id = params[0]
      for (const conv of this.conversations.values()) {
        if (conv.id === id) conv.last_activity_at = new Date()
      }
      return { rows: [] }
    }

    if (q.startsWith('with ordered as') && q.includes('delete from chat_messages')) {
      const sessionId = params[0]
      const limit = Number(params[1])
      const ordered = this.messages
        .filter((m) => m.session_id === sessionId)
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id - b.id)
      while (ordered.length > limit) {
        const target = ordered.shift()!
        this.messages = this.messages.filter((m) => m.id !== target.id)
      }
      return { rows: [] }
    }

    if (q.startsWith('delete from chat_messages where created_at')) {
      const cutoff = params[0] as Date
      this.messages = this.messages.filter((m) => m.created_at >= cutoff)
      return { rows: [] }
    }

    if (q.startsWith('delete from chat_messages where session_id')) {
      const sessionId = params[0]
      this.messages = this.messages.filter((m) => m.session_id !== sessionId)
      return { rows: [] }
    }

    if (q.startsWith('delete from chat_files where session_id')) {
      const sessionId = params[0]
      this.files = this.files.filter((f) => f.session_id !== sessionId)
      return { rows: [] }
    }

    if (q.startsWith('delete from chat_sessions where session_id')) {
      const sessionId = params[0]
      this.sessions.delete(sessionId)
      this.conversations.delete(sessionId)
      return { rows: [] }
    }

    if (q.startsWith('delete from conversations where session_id')) {
      const sessionId = params[0]
      this.conversations.delete(sessionId)
      return { rows: [] }
    }

    if (q.startsWith('select storage_path from chat_files where id = $1')) {
      const id = Number(params[0])
      const found = this.files.find((f) => f.id === id)
      return { rows: found ? [{ storage_path: found.storage_path }] : [] }
    }

    if (q.startsWith('select id, session_id as "sessionid"')) {
      const sessionId = params[0]
      const rows = this.messages
        .filter((m) => m.session_id === sessionId)
        .sort((a, b) => a.id - b.id)
        .map((m) => ({
          id: m.id,
          sessionId: m.session_id,
          sender: m.sender,
          text: m.text,
          createdAt: m.created_at.toISOString(),
        }))
      return { rows }
    }

    if (q.startsWith('select id,')) {
      // catch-all for other selects not used in these tests
      return { rows: [] }
    }

    if (q.startsWith('with file_counts as')) {
      const rows = Array.from(this.conversations.values()).map((conv) => {
        const msgs = this.messages.filter((m) => m.session_id === conv.session_id)
        const lastAt = msgs.length ? msgs[msgs.length - 1].created_at : conv.last_activity_at
        const fileCount = this.files.filter((f) => f.session_id === conv.session_id).length
        return {
          id: conv.id,
          sessionId: conv.session_id,
          count: msgs.length,
          lastAt,
          fileCount,
        }
      })
      return { rows }
    }

    return { rows: [] }
  }

  async connect() {
    return { query: this.query.bind(this), release() {} }
  }
}

async function setupServer(opts?: { useDb?: boolean }) {
  vi.resetModules()
  let fakePool: FakePool | null = null
  if (opts?.useDb) {
    fakePool = new FakePool()
    process.env.DATABASE_URL = 'postgres://fake'
    vi.doMock('pg', () => ({
      Pool: class {
        constructor() {
          return fakePool as unknown as any
        }
      },
    }))
  } else {
    process.env.DATABASE_URL = ''
    vi.doUnmock('pg')
  }

  const config = (await import('./vite.config')).default as any
  const plugin = config.plugins.find((p: any) => p.name === 'mock-chat-api-and-admin-webui')
  const server: any = { middlewares: { use(fn: any) { server.handler = fn } } }
  await plugin.configureServer(server)
  return { server, pool: fakePool }
}

describe('maxHistory limits', () => {
  it('trims memory-backed conversations and admin counts', async () => {
    const { server } = await setupServer()
    const timer = (server as any).__retentionTimer
    try {
      await callApi(server, 'PUT', '/api/admin/settings', { behavior: { maxHistory: 4, replyDelayMs: 0 } })

      for (let i = 0; i < 3; i++) {
        await callApi(server, 'POST', '/api/chat', { sessionId: 'mem-max', message: `hi ${i}` })
      }

      const msgs = await callApi(server, 'GET', '/api/admin/messages?sessionId=mem-max')
      if (!Array.isArray(msgs)) throw new Error(`unexpected response: ${JSON.stringify(msgs)}`)
      expect(msgs.map((m: any) => m.text)).toEqual([
        'hi 1',
        'Echo: hi 1',
        'hi 2',
        'Echo: hi 2',
      ])

      const sessions = await callApi(server, 'GET', '/api/admin/sessions')
      const target = sessions.find((s: any) => s.sessionId === 'mem-max')
      expect(target?.count).toBe(4)
    } finally {
      if (timer) clearInterval(timer)
    }
  })

  it('trims Postgres-backed conversations and reports accurate counts', async () => {
    const { server } = await setupServer({ useDb: true })
    const timer = (server as any).__retentionTimer
    try {
      await callApi(server, 'PUT', '/api/admin/settings', { behavior: { maxHistory: 4, replyDelayMs: 0 } })

      for (let i = 0; i < 3; i++) {
        await callApi(server, 'POST', '/api/chat', { sessionId: 'db-max', message: `db ${i}` })
      }

      const msgs = await callApi(server, 'GET', '/api/admin/messages?sessionId=db-max')
      expect(msgs.map((m: any) => m.text)).toEqual([
        'db 1',
        'Echo: db 1',
        'db 2',
        'Echo: db 2',
      ])

      const sessions = await callApi(server, 'GET', '/api/admin/sessions')
      const target = sessions.find((s: any) => s.sessionId === 'db-max')
      expect(target?.count).toBe(4)
    } finally {
      if (timer) clearInterval(timer)
    }
  })
})
