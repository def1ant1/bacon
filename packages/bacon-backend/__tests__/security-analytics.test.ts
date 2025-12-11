import { describe, expect, it } from 'vitest'
import { createBaconServer, MemoryStorage } from '../src'
import { Readable } from 'node:stream'

function makeReq(
  method: string,
  url: string,
  body?: any,
  ip = '10.0.0.1',
  headers: Record<string, string> = { 'content-type': 'application/json' }
) {
  const payload = body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined
  const stream: any = payload ? Readable.from([payload]) : Readable.from([])
  stream.method = method
  stream.url = url
  stream.headers = headers
  stream.socket = { remoteAddress: ip }
  return stream
}

function makeRes() {
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

async function call(
  server: any,
  method: string,
  url: string,
  body?: any,
  opts?: { ip?: string; headers?: Record<string, string> }
) {
  const req = makeReq(method, url, body, opts?.ip, opts?.headers)
  const res: any = makeRes()
  await server.handler(req, res, () => {})
  const txt = res.body
  return { res, data: txt ? JSON.parse(txt) : undefined }
}

describe('security + analytics hardening', () => {
  it('enforces rate limiting and blocklists', async () => {
    const srv = createBaconServer({
      security: { rateLimit: { windowMs: 10_000, max: 1 }, blocklist: ['10.0.0.9', '203.0.113.8'] },
    })
    const first = await call(srv, 'GET', '/healthz')
    expect(first.res.statusCode).toBe(200)
    const second = await call(srv, 'GET', '/healthz')
    expect(second.res.statusCode).toBe(429)
    const blockedIpv4 = await call(srv, 'GET', '/healthz', undefined, { ip: '10.0.0.9' })
    expect(blockedIpv4.res.statusCode).toBe(403)
    const blockedMapped = await call(srv, 'GET', '/healthz', undefined, { ip: '::ffff:10.0.0.9' })
    expect(blockedMapped.res.statusCode).toBe(403)
    const forwardedBlocked = await call(srv, 'GET', '/healthz', undefined, {
      ip: '::1',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.8, 70.0.0.2' },
    })
    expect(forwardedBlocked.res.statusCode).toBe(403)
  })

  it('masks PII and exposes analytics aggregates', async () => {
    const storage = new MemoryStorage()
    const srv = createBaconServer({ storage })
    await call(srv, 'POST', '/api/chat', { sessionId: 'pii', message: 'Email me at jane@example.com' })
    const messages = await call(srv, 'GET', '/api/admin/messages?sessionId=pii')
    expect(messages.data?.[0]?.text).toContain('[redacted-email]')

    const analytics = await call(srv, 'GET', '/api/admin/analytics?metric=ttr')
    expect(analytics.data).toHaveProperty('averageMs')
  })

  it('supports compliance export/delete', async () => {
    const storage = new MemoryStorage()
    const srv = createBaconServer({ storage })
    await call(srv, 'POST', '/api/chat', { sessionId: 'comp', message: 'hello team' })
    const exported = await call(srv, 'GET', '/api/admin/compliance/export?sessionId=comp')
    expect(exported.data?.messages?.length).toBeGreaterThan(0)
    await call(srv, 'DELETE', '/api/admin/compliance/delete?sessionId=comp')
    const afterDelete = await call(srv, 'GET', '/api/admin/messages?sessionId=comp')
    expect(afterDelete.data?.length).toBe(0)
  })
})
