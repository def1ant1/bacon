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
    provider: 'echo'
    systemPrompt: string
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
  complete(prompt: string, history: { role: 'user' | 'assistant' | 'system'; content: string }[]): Promise<string>
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

export interface BaconServerConfig {
  settings?: Partial<AdminSettings>
  storage?: StorageAdapter
  ai?: AiProvider
  transports?: {
    enableHttpPolling?: boolean
    enableWebSocket?: boolean
    attachSocketIo?: (server: any, pipeline: MessagePipeline) => void
  }
  logger?: Logger
  metrics?: MetricsHooks
  fileHandling?: Partial<FileHandler>
  behavior?: {
    maxHistory?: number
    retentionDays?: number
  }
  auth?: {
    bearerToken?: string
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
