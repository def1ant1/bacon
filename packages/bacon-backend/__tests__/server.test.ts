import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import WebSocket from 'ws'
import { createBaconServer, MemoryStorage } from '../src'

function makeReq(method: string, url: string, body?: any) {
  const payload = body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined
  const stream: any = payload ? Readable.from([payload]) : Readable.from([])
  stream.method = method
  stream.url = url
  stream.headers = { 'content-type': 'application/json' }
  return stream
}

function makeRes() {
  const chunks: Buffer[] = []
  return {
    statusCode: 200,
    headers: {} as Record<string, any>,
    setHeader(k: string, v: any) { this.headers[k] = v },
    end(chunk?: any) { if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))) },
    get body() { return Buffer.concat(chunks).toString('utf8') },
  }
}

async function callApi(server: any, method: string, url: string, body?: any) {
  const req = makeReq(method, url, body)
  const res: any = makeRes()
  await server.handler(req, res, () => {})
  const txt = res.body
  return txt ? JSON.parse(txt) : undefined
}

describe('createBaconServer', () => {
  it('handles http chat flow and admin endpoints', async () => {
    const srv = createBaconServer({ settings: { behavior: { maxHistory: 4, replyDelayMs: 0, retentionDays: 30 } } })
    await callApi(srv, 'POST', '/api/chat', { sessionId: 'demo', message: 'hello' })
    await callApi(srv, 'POST', '/api/chat', { sessionId: 'demo', message: 'hello again' })
    const msgs = await callApi(srv, 'GET', '/api/admin/messages?sessionId=demo')
    expect(msgs.map((m: any) => m.text)).toEqual(['hello', 'Echo: hello', 'hello again', 'Echo: hello again'])
    const sessions = await callApi(srv, 'GET', '/api/admin/sessions')
    expect(sessions.find((s: any) => s.sessionId === 'demo')?.count).toBe(4)
  })

  it('supports bearer auth for admin', async () => {
    const srv = createBaconServer({ auth: { bearerToken: 'secret' } })
    const denied = await callApi(srv, 'GET', '/api/admin/messages?sessionId=x')
    expect(denied).toEqual({ error: 'unauthorized' })
    const req = makeReq('GET', '/api/admin/messages?sessionId=x')
    req.headers['authorization'] = 'Bearer secret'
    const res: any = makeRes()
    await srv.handler(req, res, () => {})
    expect(res.statusCode).toBe(200)
  })

  it('supports websocket transport', async () => {
    const storage = new MemoryStorage()
    const srv = createBaconServer({ storage, transports: { enableWebSocket: true } }) as any
    const http = srv._httpServer
    http.listen(0)
    const port = (http.address() as any).port
    const ws = new WebSocket(`ws://127.0.0.1:${port}`)
    const reply = await new Promise<string>((resolve, reject) => {
      ws.on('open', () => ws.send(JSON.stringify({ sessionId: 'ws1', message: 'hi ws' })))
      ws.on('message', (data) => {
        const parsed = JSON.parse(String(data))
        if (Array.isArray(parsed)) {
          resolve(parsed.map((m: any) => m.text || '').join('\n'))
        }
      })
      ws.on('error', reject)
    })
    expect(reply).toContain('Echo')
    ws.close()
    http.close()
  })
})
