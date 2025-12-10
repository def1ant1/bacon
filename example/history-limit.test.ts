import { describe, expect, it } from 'vitest'
import { createBaconServer, MemoryStorage, PostgresStorage } from '../packages/bacon-backend/src'

async function callApi(server: any, method: string, url: string, body?: any) {
  const payload = body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined
  const req: any = payload ? require('stream').Readable.from([payload]) : require('stream').Readable.from([])
  req.method = method
  req.url = url
  req.headers = { 'content-type': 'application/json' }
  const res: any = { chunks: [] as Buffer[], statusCode: 200, setHeader() {}, end(chunk?: any) { if (chunk) this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))) } }
  await server.handler(req, res, () => {})
  const txt = Buffer.concat(res.chunks).toString('utf8')
  return txt ? JSON.parse(txt) : undefined
}

describe('maxHistory limits', () => {
  it('trims memory-backed conversations', async () => {
    const srv = createBaconServer({ storage: new MemoryStorage(), behavior: { maxHistory: 4 } })
    for (let i = 0; i < 3; i++) {
      await callApi(srv, 'POST', '/api/chat', { sessionId: 'mem-max', message: `hi ${i}` })
    }
    const msgs = await callApi(srv, 'GET', '/api/admin/messages?sessionId=mem-max')
    expect(msgs.map((m: any) => m.text)).toEqual(['hi 1', 'Echo: hi 1 [history:3]', 'hi 2', 'Echo: hi 2 [history:4]'])
  })

  it('supports postgres adapters', async () => {
    const messages: any[] = []
    const fakePool = {
      async query(sql: string, params: any[] = []) {
        const q = sql.toLowerCase().trim()
        if (q.startsWith('create table')) return { rows: [] }
        if (q.startsWith('insert into conversations')) {
          const sessionId = params[0]
          return { rows: [{ session_id: sessionId }] }
        }
        if (q.startsWith('insert into chat_messages')) {
          messages.push({ sessionId: params[0], sender: params[1], text: params[2], id: messages.length + 1, created_at: new Date() })
          return { rows: [{ id: messages.length, created_at: new Date() }] }
        }
        if (q.startsWith('delete from chat_messages where id in')) {
          if (messages.length > 4) messages.splice(0, messages.length - 4)
          return { rows: [] }
        }
        if (q.startsWith('select id, session_id')) {
          const sessionId = params[0]
          const msgs = messages.filter((r) => r.sessionId === sessionId)
          return { rows: msgs.map((m) => ({ id: m.id, sessionId: m.sessionId, sender: m.sender, text: m.text, createdAt: new Date().toISOString() })) }
        }
        if (q.startsWith('with file_counts')) {
          return { rows: [{ sessionId: 'db-max', count: 4, lastAt: new Date(), fileCount: 0 }] }
        }
        if (q.startsWith('delete from chat_files') || q.startsWith('delete from chat_messages') || q.startsWith('delete from conversations')) return { rows: [] }
        return { rows: [] }
      },
      async connect() { return { query: this.query.bind(this), release() {} } },
    }
    const srv = createBaconServer({ storage: new PostgresStorage(fakePool as any), behavior: { maxHistory: 4 } })
    for (let i = 0; i < 3; i++) {
      await callApi(srv, 'POST', '/api/chat', { sessionId: 'db-max', message: `db ${i}` })
    }
    const msgs = await callApi(srv, 'GET', '/api/admin/messages?sessionId=db-max')
    expect(msgs.length).toBe(4)
  })
})
