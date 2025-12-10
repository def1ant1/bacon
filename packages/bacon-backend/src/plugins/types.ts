import type { Logger } from '../types'

export interface PluginSettingsSchema {
  id: string
  title: string
  description?: string
  version: string
  schema: any
}

export interface PluginActionContext {
  tenantId: string
  botId: string
  settings: Record<string, any>
  secrets: SecretsManager
  logger: Logger
  audit: (entry: PluginAuditLog) => void
  aiContext: PluginAiContext
  channel?: string
}

export interface PluginTriggerContext extends PluginActionContext {
  triggerPayload: Record<string, any>
}

export interface PluginAuditLog {
  pluginId: string
  action: string
  status: 'ok' | 'error'
  requestId?: string
  startedAt: string
  completedAt: string
  message?: string
  meta?: Record<string, any>
  error?: string
}

export interface PluginAiContext {
  enrichments: PluginContextEnrichment[]
  add(enrichment: PluginContextEnrichment): void
}

export interface PluginContextEnrichment {
  source: string
  content: string
  weight?: number
}

export interface PluginActionDefinition {
  name: string
  description?: string
  retry?: { attempts: number; backoffMs: number }
  execute(ctx: PluginActionContext, input: Record<string, any>): Promise<PluginActionResult> | PluginActionResult
}

export interface PluginTriggerDefinition {
  name: string
  description?: string
  subscribe(ctx: PluginTriggerContext): Promise<void> | void
}

export interface ChannelAdapterDefinition {
  channel: string
  validatePayload?(payload: any): { ok: boolean; issues?: string[] }
  sendMessage(
    ctx: PluginActionContext,
    payload: Record<string, any>
  ): Promise<{ ok: boolean; providerMessageId?: string; error?: string }>
}

export interface PluginActionResult {
  ok: boolean
  data?: any
  error?: string
}

export interface PluginDefinition {
  id: string
  name: string
  version: string
  description?: string
  settings: PluginSettingsSchema
  actions?: Record<string, PluginActionDefinition>
  triggers?: Record<string, PluginTriggerDefinition>
  channels?: Record<string, ChannelAdapterDefinition>
  enrichContext?: (ctx: PluginActionContext) => Promise<PluginContextEnrichment[]> | PluginContextEnrichment[]
}

export interface SecretsManager {
  get(key: string): string | undefined
  set?(key: string, value: string): void
  describe?(): string[]
}

export interface PluginResolution {
  definition: PluginDefinition
  moduleId: string
}

export interface PluginLoaderOptions {
  cache?: Map<string, PluginResolution>
  logger?: Logger
  baseDir?: string
  overrides?: Record<string, Partial<PluginDefinition> & { secrets?: Record<string, string> }>
  secrets?: SecretsManager
}

export interface PluginRuntimeOptions {
  logger?: Logger
  secrets?: SecretsManager
  auditSink?: (entry: PluginAuditLog) => void
}
