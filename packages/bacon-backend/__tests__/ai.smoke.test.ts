import { describe, expect, it } from 'vitest'
import { createBaconServer } from '../src'
import { Readable } from 'node:stream'

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

describe('AI provider configuration smoke', () => {
  it('normalizes invalid providers back to echo', async () => {
    const srv = createBaconServer({ settings: { ai: { provider: 'invalid' as any, systemPrompt: '' } } })
    const settings = await callApi(srv, 'GET', '/api/admin/settings')
    expect(settings.ai.provider).toBe('echo')
  })
})
