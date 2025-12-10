import { afterEach, describe, expect, it } from 'vitest'
import { AddressInfo } from 'net'
import { createServer } from 'http'
import { WebSocket } from 'ws'
import { createBaconServer, MemoryStorage } from '../packages/bacon-backend/src'
import { PollingTransport, WebSocketTransport } from '../src'

;(global as any).WebSocket = WebSocket

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(check: () => boolean, timeout = 2000, step = 50) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (check()) return
    await wait(step)
  }
  throw new Error('condition not met in time')
}

type RunningServer = {
  baseUrl: string
  close: () => Promise<void>
  backend: ReturnType<typeof createBaconServer>
}

async function startServer(enableWebSocket: boolean): Promise<RunningServer> {
  const backend = createBaconServer({
    storage: new MemoryStorage(),
    transports: { enableWebSocket, enableHttpPolling: true },
    settings: {
      transports: {
        default: enableWebSocket ? 'websocket' : 'polling',
        allowWebSocket: enableWebSocket,
        allowPolling: true,
        pollIntervalMs: 100,
        webSocketPath: '/api/chat/ws',
      },
    },
  })

  const http = (backend as any)._httpServer || createServer(backend.handler as any)
  await new Promise<void>((resolve) => http.listen(0, resolve))
  const address = http.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`

  return {
    backend,
    baseUrl,
    close: async () => {
      await new Promise<void>((resolve) => http.close(() => resolve()))
      backend.wss?.clients.forEach((client) => client.close())
      backend.wss?.close()
      if ((backend as any)._retentionTimer) clearInterval((backend as any)._retentionTimer)
    },
  }
}

describe('example end-to-end transports', () => {
  let server: RunningServer | null = null

  afterEach(async () => {
    if (server) {
      await server.close()
      server = null
    }
  })

  it('honors polling transport from admin settings', async () => {
    server = await startServer(true)
    const sessionId = 'polling-e2e'
    await fetch(`${server.baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transports: { default: 'polling', allowPolling: true, pollIntervalMs: 120 } }),
    })

    const received: any[] = []
    const transport = new PollingTransport({
      apiUrl: `${server.baseUrl}/api/chat`,
      sessionId,
      pollIntervalMs: 120,
    })
    transport.setEventHandlers({
      onMessage: (msgs) => received.push(...(Array.isArray(msgs) ? msgs : [msgs])),
    })
    await transport.connect()
    await transport.send({ sessionId, message: 'hello via polling' })
    await waitFor(() => received.some((m) => m.sender === 'bot'), 2000)
    await transport.disconnect()

    const adminMessages = await fetch(`${server.baseUrl}/api/admin/messages?sessionId=${sessionId}`).then((r) => r.json())
    expect(adminMessages.some((m: any) => m.text?.includes('Echo: hello via polling'))).toBe(true)
  })

  it('streams over WebSocket when enabled', async () => {
    server = await startServer(true)
    const sessionId = 'ws-e2e'
    await fetch(`${server.baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transports: { default: 'websocket', allowWebSocket: true } }),
    })

    const received: any[] = []
    let opened: (() => void) | null = null
    const waitOpen = new Promise<void>((resolve) => {
      opened = resolve
    })

    const transport = new WebSocketTransport({
      apiUrl: `${server.baseUrl}/api/chat`,
      sessionId,
      webSocketImpl: WebSocket as any,
      webSocketUrl: `${server.baseUrl.replace('http', 'ws')}/api/chat/ws`,
    })
    transport.setEventHandlers({
      onOpen: () => opened?.(),
      onMessage: (msgs) => received.push(...(Array.isArray(msgs) ? msgs : [msgs])),
      onError: (err) => {
        throw err
      },
    })
    await transport.connect()
    await waitOpen
    await transport.send({ sessionId, message: 'hello via ws' })
    await waitFor(() => received.some((m) => m.sender === 'bot'), 2000)
    await transport.disconnect()

    expect(received.some((m) => m.text?.includes('Echo: hello via ws'))).toBe(true)
  })
})
