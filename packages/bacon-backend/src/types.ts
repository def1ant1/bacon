import type { IncomingMessage, ServerResponse } from 'http'
import type { WebSocketServer } from 'ws'

export type Sender = 'user' | 'bot'

export type RichMessageType = 'text' | 'card' | 'product' | 'survey' | 'quick_replies' | string

export interface RichMessagePayload {
  title?: string
  body?: string
  imageUrl?: string
  /**
   * Optional CTA buttons or quick replies. Each value is echoed back to the
   * backend when selected to keep parity across transports.
   */
  actions?: { label: string; value: string; url?: string }[]
  /**
   * Flexible key/value bag for extensibility. Plugin renderers can interpret
   * custom fields without requiring schema migrations.
   */
  data?: Record<string, any>
}

export interface ChatMessage {
  id: string
  sessionId: string
  sender: Sender
  text: string
  createdAt: string
  type?: RichMessageType
  payload?: RichMessagePayload
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

export interface ChannelMapping {
  id: string
  channel: string
  externalUserId: string
  sessionId: string
  metadata?: Record<string, any>
  createdAt: string
  updatedAt: string
}

export interface ChannelMessageReceipt {
  id: string
  channel: string
  externalUserId: string
  sessionId: string
  providerMessageId?: string
  createdAt: string
  duplicate?: boolean
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
  recordMessage(
    sessionId: string,
    sender: Sender,
    text: string,
    maxHistory: number,
    options?: { type?: RichMessageType; payload?: RichMessagePayload },
  ): Promise<ChatMessage>
  listMessages(sessionId: string): Promise<ChatMessage[]>
  listSessions(): Promise<{ sessionId: string; count: number; lastAt: string | null; fileCount: number }[]>
  clearSession(sessionId: string): Promise<void>
  saveFile(sessionId: string, info: { originalName: string; mimeType?: string; sizeBytes?: number; storagePath: string }): Promise<StoredFile>
  listFiles(sessionId: string): Promise<StoredFile[]>
  deleteFile(id: string): Promise<void>
  retentionSweep(retentionDays: number): Promise<void>
  linkChannelConversation(input: {
    channel: string
    externalUserId: string
    sessionIdHint?: string
    metadata?: Record<string, any>
  }): Promise<{ mapping: ChannelMapping; created: boolean }>
  getChannelMapping(channel: string, externalUserId: string): Promise<ChannelMapping | null>
  recordChannelMessageReceipt(entry: {
    channel: string
    externalUserId: string
    sessionId: string
    providerMessageId?: string
  }): Promise<ChannelMessageReceipt>
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
  channels?: {
    router?: import('./channels').ChannelRouter
    adapters?: import('./channels').ChannelAdapter[]
  }
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
  networkControls?: {
    /**
     * IP addresses that should always receive a 403. Entries are normalized to
     * plain IPv4 when possible so operators can paste the exact addresses
     * surfaced by their logs without worrying about IPv6-mapped formatting.
     */
    blocklist?: string[]
    /**
     * Whether to honor the first X-Forwarded-For hop when deriving the client
     * address. Leave enabled in most production deployments where a load
     * balancer or reverse proxy terminates TLS before forwarding traffic to
     * the Node process.
     */
    trustProxy?: boolean
  }
  plugins?: {
    registry?: import('./plugins/registry').PluginRegistry
  }
  automation?: import('./automation-rules').AutomationRuntimeConfig
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
  channels: import('./channels').ChannelRouter
}
