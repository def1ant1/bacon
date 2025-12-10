import type { IncomingMessage, ServerResponse } from 'http'
import type { WebSocketServer } from 'ws'

export type Sender = 'user' | 'bot'

export interface ChatMessage {
  id: string
  sessionId: string
  sender: Sender
  text: string
  createdAt: string
}

export interface StoredFile {
  id: string
  sessionId: string
  originalName: string
  mimeType?: string
  sizeBytes?: number
  storagePath: string
  createdAt: string
  url?: string
}

export interface AdminSettings {
  general: {
    title: string
    defaultOpen: boolean
    welcomeMessage: string
    launcherPosition: 'bottom-right' | 'bottom-left'
  }
  branding: {
    primaryColor: string
    customCss: string
  }
  behavior: {
    replyDelayMs: number
    maxHistory: number
    retentionDays: number
    handoffConfidenceThreshold?: number
    handoffMessage?: string
  }
  transports: {
    default: 'polling' | 'websocket'
    allowPolling: boolean
    allowWebSocket: boolean
    pollIntervalMs: number
    webSocketPath?: string
  }
  plugins: {
    logging: boolean
    tracing: boolean
    authTokenRefresher: boolean
  }
  integrations: {
    apiUrl: string
    apiAuthHeader: string
    webhookUrl: string
  }
  security: {
    allowedOrigins: string[]
  }
  ai: {
    provider: 'echo' | 'openai' | 'grok' | 'gemini' | 'llama'
    systemPrompt: string
    model?: string
    embeddingModel?: string
  }
}

export interface StorageAdapter {
  init?(): Promise<void>
  recordMessage(sessionId: string, sender: Sender, text: string, maxHistory: number): Promise<ChatMessage>
  listMessages(sessionId: string): Promise<ChatMessage[]>
  listSessions(): Promise<{ sessionId: string; count: number; lastAt: string | null; fileCount: number }[]>
  clearSession(sessionId: string): Promise<void>
  saveFile(sessionId: string, info: { originalName: string; mimeType?: string; sizeBytes?: number; storagePath: string }): Promise<StoredFile>
  listFiles(sessionId: string): Promise<StoredFile[]>
  deleteFile(id: string): Promise<void>
  retentionSweep(retentionDays: number): Promise<void>
}

export interface AiProvider {
  chat(
    request: {
      prompt: string
      history?: { role: 'user' | 'assistant' | 'system'; content: string }[]
      model?: string
      provider?: string
      requestId?: string
    },
  ): Promise<{ text: string; requestId?: string; confidence?: number }>
  embed?(request: { text: string; model?: string }): Promise<{ vector: number[] }>
  metadata?(): { name: string; models?: string[] }
  checkHealth?(): Promise<{ ok: boolean; name: string }>
}

export interface MetricsHooks {
  onMessageStored?(msg: ChatMessage): void
  onTransportEvent?(name: string, payload?: Record<string, any>): void
  onHealthcheck?(status: 'ok' | 'fail', meta?: Record<string, any>): void
}

export interface Logger {
  info(...args: any[]): void
  warn(...args: any[]): void
  error(...args: any[]): void
  debug?(...args: any[]): void
}

export interface FileHandler {
  uploadsDir: string
  allowUploads: boolean
}

export type TicketStatus = 'new' | 'assigned' | 'snoozed' | 'closed'

export interface TicketNote {
  id: string
  ticketId: string
  authorId?: string
  text: string
  createdAt: string
}

export interface InboxTicket {
  id: string
  sessionId: string
  brandId: string
  status: TicketStatus
  tags: string[]
  assignedAgentId?: string | null
  lastMessage?: string
  confidence?: number
  createdAt: string
  updatedAt: string
  notes?: TicketNote[]
}

export interface InboxFilters {
  status?: TicketStatus | TicketStatus[]
  tag?: string
  assignedAgentId?: string
  brandId?: string
  search?: string
  includeNotes?: boolean
}

export interface InboxQueueAdapter {
  init?(): Promise<void>
  enqueue(ticket: {
    sessionId: string
    brandId: string
    tags?: string[]
    confidence?: number
    lastMessage?: string
  }): Promise<InboxTicket>
  update(ticketId: string, patch: Partial<Omit<InboxTicket, 'id' | 'createdAt'>>): Promise<InboxTicket | null>
  addNote(ticketId: string, note: Omit<TicketNote, 'id' | 'createdAt' | 'ticketId'>): Promise<TicketNote>
  list(filters?: InboxFilters): Promise<InboxTicket[]>
  getBySession(sessionId: string): Promise<InboxTicket | null>
  get(ticketId: string): Promise<InboxTicket | null>
}

export interface AuthContext {
  ok: boolean
  role: 'admin' | 'agent' | 'anonymous'
  userId?: string
  raw?: any
}

export interface BaconServerConfig {
  settings?: Partial<AdminSettings>
  storage?: StorageAdapter
  ai?: AiProvider
  kb?: { topK?: number }
  brandId?: string
  botId?: string
  flows?: {
    repository?: import('./flows/repository').FlowRepository
    engine?: import('./flows/engine').FlowEngine
  }
  transports?: {
    enableHttpPolling?: boolean
    enableWebSocket?: boolean
    attachSocketIo?: (server: any, pipeline: MessagePipeline) => void
  }
  settingsStore?: {
    load?(): Partial<AdminSettings>
    save?(settings: AdminSettings): void
    reset?(): Partial<AdminSettings>
  }
  logger?: Logger
  metrics?: MetricsHooks
  fileHandling?: Partial<FileHandler>
  behavior?: {
    maxHistory?: number
    retentionDays?: number
    handoffConfidenceThreshold?: number
    handoffMessage?: string
  }
  auth?: {
    bearerToken?: string
    jwtSecret?: string
    refreshSecret?: string
    accessTtlMs?: number
    refreshTtlMs?: number
    roleClaim?: string
    defaultRole?: 'admin' | 'agent'
    issuer?: string
    audience?: string
    onRevoke?: (jti: string) => void
    onRefresh?: (meta: { jti: string; sub?: string; role: string }) => void
  }
  providerRegistry?: any
  inbox?: {
    queue?: InboxQueueAdapter
    notifier?: any
  }
}

export interface MessagePipeline {
  handleUserMessage(sessionId: string, text: string): Promise<ChatMessage>
  pushBotMessage(sessionId: string, text: string): Promise<ChatMessage>
  list(sessionId: string): Promise<ChatMessage[]>
  clear(sessionId: string): Promise<void>
}

export interface BaconServer {
  handler: (req: IncomingMessage, res: ServerResponse, next?: () => void) => void
  mountToFastify?: (instance: any) => void
  mountToExpress?: (app: any) => void
  wss?: WebSocketServer
  config: Required<BaconServerConfig>
}
