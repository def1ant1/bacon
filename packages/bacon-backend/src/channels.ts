import { v4 as uuidv4 } from 'uuid'
import {
  ChannelMessageReceipt,
  ChatMessage,
  Logger,
  MessagePipeline,
  StorageAdapter,
} from './types'

export interface ChannelCapabilities {
  inbound: boolean
  outbound: boolean
  attachments?: boolean
  templates?: boolean
}

export interface ChannelInboundMessage {
  externalUserId: string
  text: string
  providerMessageId?: string
  sessionIdHint?: string
  metadata?: Record<string, any>
}

export interface ChannelOutboundMessage {
  text: string
  metadata?: Record<string, any>
}

export interface ChannelSendContext {
  channel: string
  externalUserId: string
  sessionId: string
  logger?: Logger
  settings?: Record<string, any>
}

export interface ChannelAdapter {
  id: string
  displayName?: string
  capabilities: ChannelCapabilities
  normalizeInbound(payload: any): Promise<ChannelInboundMessage> | ChannelInboundMessage
  send?(ctx: ChannelSendContext, message: ChannelOutboundMessage): Promise<{ ok: boolean; providerMessageId?: string; error?: string }>
}

export interface ChannelRouterOptions {
  storage: StorageAdapter
  pipeline: MessagePipeline
  logger?: Logger
}

export class ChannelRouter {
  private adapters = new Map<string, ChannelAdapter>()

  constructor(private readonly opts: ChannelRouterOptions) {}

  register(adapter: ChannelAdapter) {
    this.adapters.set(adapter.id.toLowerCase(), adapter)
    this.opts.logger?.info?.(`[channels] registered adapter ${adapter.id}`)
  }

  has(channel: string) {
    return this.adapters.has(channel.toLowerCase())
  }

  get(channel: string): ChannelAdapter | undefined {
    return this.adapters.get(channel.toLowerCase())
  }

  async ingest(channel: string, payload: any): Promise<{ sessionId: string; duplicate?: boolean; botMessage?: ChatMessage }> {
    const adapter = this.get(channel)
    if (!adapter || !adapter.capabilities.inbound) throw new Error(`channel ${channel} not configured for inbound traffic`)
    const normalized = await adapter.normalizeInbound(payload)
    const mapping = await this.opts.storage.linkChannelConversation({
      channel,
      externalUserId: normalized.externalUserId,
      sessionIdHint: normalized.sessionIdHint,
      metadata: normalized.metadata,
    })
    const receipt: ChannelMessageReceipt | null = normalized.providerMessageId
      ? await this.opts.storage.recordChannelMessageReceipt({
          channel,
          externalUserId: normalized.externalUserId,
          sessionId: mapping.mapping.sessionId,
          providerMessageId: normalized.providerMessageId,
        })
      : null
    if (receipt?.duplicate) {
      this.opts.logger?.debug?.('[channels] duplicate payload ignored', { channel, providerMessageId: normalized.providerMessageId })
      return { sessionId: mapping.mapping.sessionId, duplicate: true }
    }
    const botMessage = await this.opts.pipeline.handleUserMessage(mapping.mapping.sessionId, normalized.text)
    if (adapter.capabilities.outbound && adapter.send) {
      await adapter
        .send(
          {
            channel,
            externalUserId: normalized.externalUserId,
            sessionId: mapping.mapping.sessionId,
            logger: this.opts.logger,
          },
          { text: botMessage.text },
        )
        .catch((err) => this.opts.logger?.warn?.('[channels] outbound delivery failed', err))
    }
    return { sessionId: mapping.mapping.sessionId, duplicate: false, botMessage }
  }

  async dispatchToChannel(channel: string, externalUserId: string, message: ChannelOutboundMessage, sessionIdHint?: string) {
    const adapter = this.get(channel)
    if (!adapter || !adapter.capabilities.outbound || !adapter.send) {
      await this.opts.pipeline.pushBotMessage(sessionIdHint || externalUserId, message.text)
      return { ok: false, error: 'adapter_missing_or_outbound_disabled' }
    }
    const mapping = await this.opts.storage.linkChannelConversation({
      channel,
      externalUserId,
      sessionIdHint: sessionIdHint || undefined,
    })
    return adapter.send(
      { channel, externalUserId, sessionId: mapping.mapping.sessionId, logger: this.opts.logger },
      message,
    )
  }
}

export function buildWebWidgetAdapter(): ChannelAdapter {
  return {
    id: 'web',
    displayName: 'Web widget',
    capabilities: { inbound: true, outbound: true, attachments: true },
    normalizeInbound(payload: any) {
      return {
        externalUserId: String(payload?.sessionId || 'anonymous'),
        text: String(payload?.message || payload?.text || ''),
        providerMessageId: payload?.providerMessageId || payload?.eventId,
        sessionIdHint: payload?.sessionId,
        metadata: payload?.metadata,
      }
    },
    async send(ctx, message) {
      await Promise.resolve()
      ctx.logger?.debug?.('[channels:web] outbound noop delivery', { sessionId: ctx.sessionId })
      return { ok: true, providerMessageId: uuidv4() }
    },
  }
}
