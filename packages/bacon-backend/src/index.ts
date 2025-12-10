import { createServer as createHttpServer } from 'http'
import path from 'path'
import fs from 'fs'
import { WebSocketServer } from 'ws'
import Busboy from 'busboy'
import { Pipeline } from './pipeline'
import { AuthContext, BaconServer, BaconServerConfig, ChatMessage, Logger } from './types'
import { MemoryStorage } from './storage-memory'
import { PostgresStorage } from './storage-postgres'
import { AgentChannelNotifier, InboxService, MemoryInboxQueue, PostgresInboxQueue } from './inbox'
import { ProviderRegistry } from './ai/providers/registry'
import { FetchHttpClient } from './ai/providers/http'
import { EchoProvider } from './ai/providers/echo'
import { buildOpenAiFromEnv } from './ai/providers/openai'
import { buildGrokFromEnv } from './ai/providers/grok'
import { buildGeminiFromEnv } from './ai/providers/gemini'
import { buildLlamaFromEnv } from './ai/providers/llama'
import { ProviderRouter } from './ai/provider-router'
import { ProviderName } from './ai/providers/types'
import { createKnowledgeBase, KnowledgeBaseService } from './kb/service'
import { MemoryFlowRepository, PostgresFlowRepository } from './flows/repository'
import { FlowEngine } from './flows/engine'
import { buildFlowApi } from './flows/api'
import jwt from 'jsonwebtoken'

const defaultSettings = {
  general: {
    title: 'Support',
    defaultOpen: true,
    welcomeMessage: 'Hi! How can I help?',
    launcherPosition: 'bottom-right' as const,
  },
  branding: { primaryColor: '#2563eb', customCss: '' },
  behavior: { replyDelayMs: 0, maxHistory: 200, retentionDays: 30, handoffConfidenceThreshold: 0.65, handoffMessage: 'Routing you to a human agent. Please hold while we connect you.' },
  transports: {
    default: 'polling' as const,
    allowPolling: true,
    allowWebSocket: true,
    pollIntervalMs: 3000,
    webSocketPath: '/api/chat/ws',
  },
  plugins: { logging: true, tracing: false, authTokenRefresher: false },
  integrations: { apiUrl: '/api/chat', apiAuthHeader: '', webhookUrl: '' },
  security: { allowedOrigins: ['*'] },
  ai: { provider: 'echo' as const, systemPrompt: 'You are a helpful customer support assistant.' },
}

function getLogger(logger?: Logger): Logger {
  const base: Logger = console
  return { ...base, ...(logger || {}) }
}

function buildProviderRegistry(logger: Logger) {
  const registry = new ProviderRegistry()
  registry.register(new EchoProvider())
  const http = new FetchHttpClient()

  const tryRegister = (name: string, fn: () => void) => {
    try {
      fn()
      logger.info(`[ai] registered provider ${name}`)
    } catch (err) {
      logger.debug?.(`[ai] skipped provider ${name}`, err)
    }
  }

  tryRegister('openai', () => registry.register(buildOpenAiFromEnv(http)))
  tryRegister('grok', () => registry.register(buildGrokFromEnv(http)))
  tryRegister('gemini', () => registry.register(buildGeminiFromEnv(http)))
  tryRegister('llama', () => registry.register(buildLlamaFromEnv(http)))
  registry.setFallbackOrder(['openai', 'grok', 'gemini', 'llama', 'echo'])
  return registry
}

function validateSettings(settings: any) {
  const merged = { ...defaultSettings, ...(settings || {}) }
  merged.behavior.maxHistory = clampInt(merged.behavior.maxHistory, 10, 1000, 200)
  merged.behavior.retentionDays = clampInt(merged.behavior.retentionDays, 1, 365, 30)
  merged.behavior.handoffConfidenceThreshold = clampNumber(merged.behavior.handoffConfidenceThreshold, 0, 1, 0.65)
  merged.behavior.handoffMessage = merged.behavior.handoffMessage || defaultSettings.behavior.handoffMessage
  merged.transports.pollIntervalMs = clampInt(merged.transports.pollIntervalMs, 100, 60000, 3000)
  merged.transports.default = merged.transports.default === 'websocket' ? 'websocket' : 'polling'
  merged.transports.allowPolling = !!merged.transports.allowPolling
  merged.transports.allowWebSocket = !!merged.transports.allowWebSocket
  merged.plugins.logging = !!merged.plugins.logging
  merged.plugins.tracing = !!merged.plugins.tracing
  merged.plugins.authTokenRefresher = !!merged.plugins.authTokenRefresher
  const allowedProviders: ProviderName[] = ['echo', 'openai', 'grok', 'gemini', 'llama']
  merged.ai.provider = allowedProviders.includes(merged.ai.provider as ProviderName) ? merged.ai.provider : 'echo'
  return merged
}

function clampInt(value: any, min: number, max: number, fallback: number) {
  const num = Number.isFinite(value) ? Number(value) : Number.parseInt(value, 10)
  if (Number.isNaN(num)) return fallback
  return Math.min(Math.max(num, min), max)
}

function clampNumber(value: any, min: number, max: number, fallback: number) {
  const num = Number(value)
  if (Number.isNaN(num)) return fallback
  return Math.min(Math.max(num, min), max)
}

export function createBaconServer(config: BaconServerConfig = {}): BaconServer {
  const logger = getLogger(config.logger)
  const persisted = config.settingsStore?.load?.()
  const baseSettings = persisted && typeof (persisted as any).then !== 'function' ? persisted : config.settings
  const settings = validateSettings(baseSettings)
  if (persisted && typeof (persisted as any).then === 'function') {
    ;(persisted as Promise<any>)
      .then((snapshot) => Object.assign(settings, validateSettings({ ...settings, ...(snapshot || {}) })))
      .catch((err) => logger.warn('[settings] async load failed', err))
  }
  const storage = config.storage || new MemoryStorage()
  const flowRepository =
    config.flows?.repository ||
    (config.storage instanceof PostgresStorage
      ? new PostgresFlowRepository((config.storage as any).pool)
      : new MemoryFlowRepository())
  const flowApi = buildFlowApi({
    repository: flowRepository,
    engine: config.flows?.engine || new FlowEngine({ logger }),
    authenticate: (req) => ensureAuth(req, 'admin').ok,
  })
  const kb: KnowledgeBaseService | undefined = config.kb === null ? undefined : createKnowledgeBase(logger)
  const registry = config.providerRegistry || buildProviderRegistry(logger)
  const ai = config.ai || new ProviderRouter(registry, settings.ai.provider as ProviderName)
  const inboxQueue =
    config.inbox?.queue ||
    (config.storage instanceof PostgresStorage
      ? new PostgresInboxQueue((config.storage as any).pool)
      : new MemoryInboxQueue())
  const notifier = config.inbox?.notifier || new AgentChannelNotifier(logger)
  const inbox = new InboxService({
    queue: inboxQueue,
    storage,
    notifier,
    logger,
    ai,
    defaultBrandId: config.brandId || 'default',
  })
  const pipeline = new Pipeline(storage, ai, { ...config, settings }, kb, inbox)
  const uploadsDir = config.fileHandling?.uploadsDir || path.join(process.cwd(), 'uploads')
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })

  const authBearer = config.auth?.bearerToken
  const jwtSecret = config.auth?.jwtSecret
  function ensureAuth(req: any, required: 'admin' | 'agent' = 'agent'): AuthContext {
    const header = req.headers?.['authorization'] || ''
    const token = (Array.isArray(header) ? header[0] : header)?.toString?.().replace('Bearer ', '')
    if (authBearer && token === authBearer) return { ok: true, role: 'admin', userId: 'bearer-admin' }
    if (jwtSecret && token) {
      try {
        const payload: any = jwt.verify(token, jwtSecret)
        const claim = config.auth?.roleClaim || 'role'
        const roleVal = String(payload?.[claim] || config.auth?.defaultRole || 'agent').toLowerCase()
        const normalized: 'admin' | 'agent' = roleVal === 'admin' ? 'admin' : 'agent'
        const ctx: AuthContext = { ok: true, role: normalized, userId: payload?.sub || payload?.userId || payload?.id, raw: payload }
        if (required === 'admin' && ctx.role !== 'admin') return { ok: false, role: ctx.role, raw: payload, userId: ctx.userId }
        return ctx
      } catch (err) {
        logger.warn('[auth] invalid jwt', err)
        return { ok: false, role: 'anonymous' }
      }
    }
    if (!authBearer && !jwtSecret) return { ok: true, role: 'admin' }
    return { ok: false, role: 'anonymous' }
  }

  function requireRole(req: any, res: any, role: 'admin' | 'agent' = 'agent'): AuthContext | null {
    const ctx = ensureAuth(req, role)
    if (!ctx.ok) {
      sendJson(res, { error: 'unauthorized' }, 401)
      return null
    }
    return ctx
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
    if (!ensureAuth(req, 'admin').ok) return sendJson(res, { error: 'unauthorized' }, 401)
    if (req.method === 'GET') return sendJson(res, settings)
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    const next = validateSettings({ ...settings, ...body })
    Object.assign(settings, next)
    config.settingsStore?.save?.(settings)
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

  const pollingEnabled = () => (config.transports?.enableHttpPolling ?? true) && settings.transports.allowPolling !== false
  const websocketEnabled = () => (config.transports?.enableWebSocket ?? false) && settings.transports.allowWebSocket !== false

  const handler: BaconServer['handler'] = async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost')
    if (req.method === 'GET' && url.pathname === '/healthz') return sendJson(res, { ok: true })
    if (req.method === 'GET' && url.pathname === '/readyz') return sendJson(res, { ready: true })

    const maybeFlowHandled = await flowApi(req, res, url)
    if (maybeFlowHandled !== false) return

    if (req.method === 'GET' && url.pathname === '/api/chat') {
      if (!pollingEnabled()) return sendJson(res, { error: 'http_polling_disabled' }, 404)
      const sessionId = url.searchParams.get('sessionId') || 'dev-session'
      const msgs = await pipeline.list(sessionId)
      return sendJson(res, msgs)
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      if (!pollingEnabled()) return sendJson(res, { error: 'http_polling_disabled' }, 404)
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      return handleChat(body, res)
    }

    if (url.pathname === '/api/admin/settings') return handleAdminSettings(req, res)

    if (url.pathname === '/api/admin/settings/reset') {
      if (!ensureAuth(req, 'admin').ok) return sendJson(res, { error: 'unauthorized' }, 401)
      const resetTo = validateSettings(config.settingsStore?.reset?.() || config.settings)
      Object.assign(settings, resetTo)
      config.settingsStore?.save?.(settings)
      return sendJson(res, settings)
    }

    if (url.pathname === '/api/admin/sessions') {
      if (!ensureAuth(req, 'admin').ok) return sendJson(res, { error: 'unauthorized' }, 401)
      const list = await storage.listSessions()
      return sendJson(res, list)
    }

    if (url.pathname === '/api/admin/messages') {
      if (!ensureAuth(req, 'agent').ok) return sendJson(res, { error: 'unauthorized' }, 401)
      const sessionId = url.searchParams.get('sessionId') || ''
      if (req.method === 'DELETE') {
        await storage.clearSession(sessionId)
        return sendJson(res, { ok: true })
      }
      const msgs = await storage.listMessages(sessionId)
      return sendJson(res, msgs)
    }

    if (url.pathname === '/api/admin/inbox' && req.method === 'GET') {
      if (!ensureAuth(req, 'agent').ok) return sendJson(res, { error: 'unauthorized' }, 401)
      const filters: any = {
        status: url.searchParams.getAll('status')?.filter(Boolean) || undefined,
        tag: url.searchParams.get('tag') || undefined,
        assignedAgentId: url.searchParams.get('agentId') || undefined,
        brandId: url.searchParams.get('brandId') || undefined,
        search: url.searchParams.get('q') || undefined,
        includeNotes: url.searchParams.get('includeNotes') === 'true',
        includeMessages: url.searchParams.get('includeMessages') === 'true',
      }
      if (Array.isArray(filters.status) && filters.status.length === 0) delete filters.status
      const tickets = await inbox.list(filters)
      return sendJson(res, tickets)
    }

    if (url.pathname === '/api/admin/inbox' && req.method === 'POST') {
      const actor = requireRole(req, res, 'agent')
      if (!actor) return
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      let payload: any = { ok: true }
      try {
        switch (body.action) {
          case 'assign':
            payload = await inbox.assign(body.ticketId, body.agentId)
            logger.info('[audit] assign', { actor: actor.userId || actor.role, ticketId: body.ticketId, agentId: body.agentId })
            break
          case 'roundRobinAssign':
            payload = await inbox.roundRobinAssign(body.ticketId, body.agents || [])
            logger.info('[audit] round_robin_assign', {
              actor: actor.userId || actor.role,
              ticketId: body.ticketId,
              agents: body.agents,
            })
            break
          case 'status':
            payload = await inbox.updateStatus(body.ticketId, body.status)
            logger.info('[audit] status_update', { actor: actor.userId || actor.role, ticketId: body.ticketId, status: body.status })
            break
          case 'note':
            payload = await inbox.addNote(body.ticketId, body.text, actor.userId)
            logger.info('[audit] note', { actor: actor.userId || actor.role, ticketId: body.ticketId })
            break
          case 'tags':
            payload = await inbox.addTags(body.ticketId, body.tags || [])
            logger.info('[audit] tags', { actor: actor.userId || actor.role, ticketId: body.ticketId, tags: body.tags })
            break
          default:
            payload = { error: 'unknown_action' }
        }
      } catch (err: any) {
        payload = { error: err?.message || 'inbox_error' }
      }
      return sendJson(res, payload, payload.error ? 400 : 200)
    }

    if (url.pathname === '/api/admin/inbox/assist' && req.method === 'POST') {
      if (!ensureAuth(req, 'agent').ok) return sendJson(res, { error: 'unauthorized' }, 401)
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      try {
        const suggestion = await inbox.draftReply(body.ticketId, body.prompt)
        return sendJson(res, suggestion)
      } catch (err: any) {
        return sendJson(res, { error: err?.message || 'draft_failed' }, 400)
      }
    }

    if (url.pathname === '/api/admin/ai/providers' && req.method === 'GET') {
      if (!ensureAuth(req, 'admin').ok) return sendJson(res, { error: 'unauthorized' }, 401)
      return sendJson(res, registry.listMetadata())
    }

    if (url.pathname === '/api/admin/ai/providers/health' && req.method === 'GET') {
      if (!ensureAuth(req, 'admin').ok) return sendJson(res, { error: 'unauthorized' }, 401)
      const health = await registry.health({ logger, metrics: config.metrics })
      const ok = health.every((h) => h.ok)
      config.metrics?.onHealthcheck?.(ok ? 'ok' : 'fail', { component: 'ai', health })
      return sendJson(res, { ok, health })
    }

    if (url.pathname === '/api/admin/kb/upload' && req.method === 'POST') {
      if (!ensureAuth(req, 'admin').ok) return sendJson(res, { error: 'unauthorized' }, 401)
      if (!kb) return sendJson(res, { error: 'kb_unavailable' }, 503)
      const bb = Busboy({ headers: req.headers })
      let brandId = url.searchParams.get('brandId') || config.brandId || 'default'
      let botId = url.searchParams.get('botId') || config.botId || 'default'
      bb.on('field', (name, val) => {
        if (name === 'brandId') brandId = val
        if (name === 'botId') botId = val
      })
      let pending = 0
      const results: any[] = []
      bb.on('file', (name, file, info) => {
        const buffers: Buffer[] = []
        pending++
        file.on('data', (d: Buffer) => buffers.push(d))
        file.on('end', async () => {
          try {
            const response = await kb.ingestUpload({
              brandId,
              botId,
              buffer: Buffer.concat(buffers),
              filename: info.filename || name,
              mimeType: info.mimeType,
            })
            results.push(response)
          } catch (err) {
            logger.error('[kb] ingest failed', err)
            results.push({ error: (err as any)?.message || 'ingest_failed', filename: info.filename })
          } finally {
            pending--
            if (pending === 0) sendJson(res, { ok: true, results })
          }
        })
      })
      bb.on('close', () => {
        if (pending === 0) sendJson(res, { ok: true, results })
      })
      req.pipe(bb)
      return
    }

    if (url.pathname === '/api/admin/clear' && req.method === 'POST') {
      if (!ensureAuth(req, 'admin').ok) return sendJson(res, { error: 'unauthorized' }, 401)
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      await pipeline.clear(body.sessionId)
      return sendJson(res, { ok: true })
    }

    if (url.pathname === '/api/admin/send' && req.method === 'POST') {
      if (!ensureAuth(req, 'agent').ok) return sendJson(res, { error: 'unauthorized' }, 401)
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      const bot = await pipeline.pushBotMessage(body.sessionId, body.text)
      return sendJson(res, bot)
    }

    if (url.pathname === '/api/upload' && req.method === 'POST') return handleUpload(req, res)

    if (url.pathname === '/api/admin/files') {
      if (!ensureAuth(req, 'agent').ok) return sendJson(res, { error: 'unauthorized' }, 401)
      const sessionId = url.searchParams.get('sessionId') || ''
      const files = await storage.listFiles(sessionId)
      return sendJson(res, files)
    }

    if (url.pathname === '/api/admin/file' && req.method === 'DELETE') {
      if (!ensureAuth(req, 'agent').ok) return sendJson(res, { error: 'unauthorized' }, 401)
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
      if (websocketEnabled()) {
        const http = createHttpServer(app)
        attachWs(http, pipeline, logger, websocketEnabled, notifier)
        return http
      }
    },
    mountToFastify(instance: any) {
      instance.use(handler)
      if (websocketEnabled()) {
        const http = createHttpServer(instance)
        attachWs(http, pipeline, logger, websocketEnabled, notifier)
        return http
      }
    },
  }

  if (websocketEnabled()) {
    const http = createHttpServer(handler as any)
    server.wss = attachWs(http, pipeline, logger, websocketEnabled, notifier)
    // Keep HTTP server open only when consumer wants it; tests can listen manually
    ;(server as any)._httpServer = http
  }

  ;(server as any)._retentionTimer = timer
  return server
}

function attachWs(http: any, pipeline: Pipeline, logger: Logger, enabled: () => boolean, notifier?: AgentChannelNotifier) {
  const wss = new WebSocketServer({ server: http })
  wss.on('connection', (ws) => {
    if (!enabled()) {
      ws.close(1013, 'websocket_disabled')
      return
    }
    ws.send(JSON.stringify({ type: 'welcome', transports: { websocket: true } }))
    ws.on('message', async (raw) => {
      try {
        const payload = JSON.parse(String(raw) || '{}')
        if (payload?.type === 'subscribe' && payload.channel) {
          notifier?.subscribe(String(payload.channel), ws)
          ws.send(JSON.stringify({ type: 'subscribed', channel: payload.channel }))
          return
        }
        const messagePayload = payload.payload || payload
        const sessionId = String(messagePayload.sessionId || payload.sessionId || 'ws-session')
        const message = String(messagePayload.message || messagePayload.text || payload.message || '')
        if (!message) {
          ws.send(JSON.stringify({ type: 'error', error: 'missing_message' }))
          return
        }
        await pipeline.handleUserMessage(sessionId, message)
        const history = await pipeline.list(sessionId)
        ws.send(JSON.stringify(history))
      } catch (e) {
        logger.error('ws error', e)
      }
    })
  })
  return wss
}

export { MemoryStorage, PostgresStorage }
export { PostgresSettingsStore } from './settings-postgres'
export { ProviderRegistry } from './ai/providers/registry'
export { ProviderRouter } from './ai/provider-router'
export { AgentChannelNotifier, InboxService, MemoryInboxQueue, PostgresInboxQueue, RedisInboxQueue } from './inbox'
export type { BaconServerConfig, BaconServer, ChatMessage } from './types'
