import { createServer as createHttpServer } from 'http'
import path from 'path'
import fs from 'fs'
import { WebSocketServer } from 'ws'
import Busboy from 'busboy'
import { EchoAiProvider, Pipeline } from './pipeline'
import { BaconServer, BaconServerConfig, ChatMessage, Logger } from './types'
import { MemoryStorage } from './storage-memory'
import { PostgresStorage } from './storage-postgres'

const defaultSettings = {
  general: {
    title: 'Support',
    defaultOpen: true,
    welcomeMessage: 'Hi! How can I help?',
    launcherPosition: 'bottom-right' as const,
  },
  branding: { primaryColor: '#2563eb', customCss: '' },
  behavior: { replyDelayMs: 0, maxHistory: 200, retentionDays: 30 },
  integrations: { apiUrl: '/api/chat', apiAuthHeader: '', webhookUrl: '' },
  security: { allowedOrigins: ['*'] },
  ai: { provider: 'echo' as const, systemPrompt: 'You are a helpful customer support assistant.' },
}

function getLogger(logger?: Logger): Logger {
  const base: Logger = console
  return { ...base, ...(logger || {}) }
}

function validateSettings(settings: any) {
  return { ...defaultSettings, ...(settings || {}) }
}

export function createBaconServer(config: BaconServerConfig = {}): BaconServer {
  const logger = getLogger(config.logger)
  const settings = validateSettings(config.settings)
  const storage = config.storage || new MemoryStorage()
  const ai = config.ai || new EchoAiProvider()
  const pipeline = new Pipeline(storage, ai, { ...config, settings })
  const uploadsDir = config.fileHandling?.uploadsDir || path.join(process.cwd(), 'uploads')
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })

  const authBearer = config.auth?.bearerToken
  function ensureAuth(req: any): boolean {
    if (!authBearer) return true
    const token = req.headers['authorization']?.replace('Bearer ', '')
    return token === authBearer
  }

  async function retentionSweep() {
    await storage.retentionSweep(config.behavior?.retentionDays ?? settings.behavior.retentionDays)
  }
  const timer = setInterval(() => retentionSweep().catch((e) => logger.warn('[retention] sweep failed', e)), 1000 * 60 * 30)

  function sendJson(res: any, payload: any, status = 200) {
    res.statusCode = status
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(payload))
  }

  async function handleChat(body: any, res: any) {
    const sessionId = String(body?.sessionId || 'dev-session')
    const message = String(body?.message || '')
    const reply = await pipeline.handleUserMessage(sessionId, message)
    sendJson(res, { reply: reply.text })
  }

  async function handleAdminSettings(req: any, res: any) {
    if (!ensureAuth(req)) return sendJson(res, { error: 'unauthorized' }, 401)
    if (req.method === 'GET') return sendJson(res, settings)
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    Object.assign(settings, body)
    sendJson(res, settings)
  }

  async function handleUpload(req: any, res: any) {
    const bb = Busboy({ headers: req.headers })
    let sessionId = 'dev-session'
    let pending = 0
    const saved: any[] = []
    bb.on('field', (name, val) => {
      if (name === 'sessionId') sessionId = String(val)
    })
    bb.on('file', (name, file, info) => {
      const filename = info.filename || 'upload'
      const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
      const dest = path.join(uploadsDir, `${Date.now()}_${safe}`)
      const writer = fs.createWriteStream(dest)
      let total = 0
      pending++
      file.on('data', (d: Buffer) => (total += d.length))
      file.pipe(writer)
      writer.on('close', async () => {
        const rec = await storage.saveFile(sessionId, {
          originalName: filename,
          mimeType: info.mimeType,
          sizeBytes: total,
          storagePath: '/uploads/' + path.basename(dest),
        })
        saved.push(rec)
        pending--
        if (pending === 0) sendJson(res, { ok: true, files: saved })
      })
    })
    bb.on('close', () => {
      if (pending === 0) sendJson(res, { ok: true, files: saved })
    })
    req.pipe(bb)
  }

  const handler: BaconServer['handler'] = async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost')
    if (req.method === 'GET' && url.pathname === '/healthz') return sendJson(res, { ok: true })
    if (req.method === 'GET' && url.pathname === '/readyz') return sendJson(res, { ready: true })

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      return handleChat(body, res)
    }

    if (url.pathname === '/api/admin/settings') return handleAdminSettings(req, res)

    if (url.pathname === '/api/admin/sessions') {
      if (!ensureAuth(req)) return sendJson(res, { error: 'unauthorized' }, 401)
      const list = await storage.listSessions()
      return sendJson(res, list)
    }

    if (url.pathname === '/api/admin/messages') {
      if (!ensureAuth(req)) return sendJson(res, { error: 'unauthorized' }, 401)
      const sessionId = url.searchParams.get('sessionId') || ''
      const msgs = await storage.listMessages(sessionId)
      return sendJson(res, msgs)
    }

    if (url.pathname === '/api/admin/clear' && req.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      await pipeline.clear(body.sessionId)
      return sendJson(res, { ok: true })
    }

    if (url.pathname === '/api/admin/send' && req.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      const bot = await pipeline.pushBotMessage(body.sessionId, body.text)
      return sendJson(res, bot)
    }

    if (url.pathname === '/api/upload' && req.method === 'POST') return handleUpload(req, res)

    if (url.pathname === '/api/admin/files') {
      const sessionId = url.searchParams.get('sessionId') || ''
      const files = await storage.listFiles(sessionId)
      return sendJson(res, files)
    }

    if (url.pathname === '/api/admin/file' && req.method === 'DELETE') {
      const id = url.searchParams.get('id') || ''
      await storage.deleteFile(id)
      return sendJson(res, { ok: true })
    }

    next?.()
  }

  const server: BaconServer = {
    handler,
    config: { ...config, settings },
    mountToExpress(app: any) {
      app.use(handler)
      if (config.transports?.enableWebSocket) {
        const http = createHttpServer(app)
        attachWs(http, pipeline, logger)
        return http
      }
    },
    mountToFastify(instance: any) {
      instance.use(handler)
      if (config.transports?.enableWebSocket) {
        const http = createHttpServer(instance)
        attachWs(http, pipeline, logger)
        return http
      }
    },
  }

  if (config.transports?.enableWebSocket) {
    const http = createHttpServer(handler as any)
    server.wss = attachWs(http, pipeline, logger)
    // Keep HTTP server open only when consumer wants it; tests can listen manually
    ;(server as any)._httpServer = http
  }

  ;(server as any)._retentionTimer = timer
  return server
}

function attachWs(http: any, pipeline: Pipeline, logger: Logger) {
  const wss = new WebSocketServer({ server: http })
  wss.on('connection', (ws) => {
    ws.on('message', async (raw) => {
      try {
        const payload = JSON.parse(String(raw))
        const sessionId = payload.sessionId || 'ws-session'
        const message = payload.message || ''
        const reply = await pipeline.handleUserMessage(sessionId, message)
        ws.send(JSON.stringify({ type: 'reply', message: reply }))
      } catch (e) {
        logger.error('ws error', e)
      }
    })
  })
  return wss
}

export { MemoryStorage, PostgresStorage }
export type { BaconServerConfig, BaconServer, ChatMessage } from './types'
