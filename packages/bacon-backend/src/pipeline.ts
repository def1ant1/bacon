import { AiProvider, BaconServerConfig, ChatMessage, MessagePipeline, StorageAdapter } from './types'
import { AutomationRuleEngine } from './automation-rules'
import { KnowledgeBaseService } from './kb/service'
import { InboxService } from './inbox'

export class Pipeline implements MessagePipeline {
  constructor(
    private storage: StorageAdapter,
    private ai: AiProvider,
    private config: BaconServerConfig,
    private kb?: KnowledgeBaseService,
    private inbox?: InboxService,
    private automation?: AutomationRuleEngine,
  ) {}

  attachAutomation(engine?: AutomationRuleEngine) {
    this.automation = engine
  }

  private maxHistory() {
    return Number(this.config.behavior?.maxHistory ?? this.config.settings?.behavior?.maxHistory ?? 200)
  }

  async handleUserMessage(sessionId: string, text: string): Promise<ChatMessage> {
    await this.storage.recordMessage(sessionId, 'user', text, this.maxHistory())
    await this.automation?.handleMessageReceived({ sessionId, text, source: 'message' })
    const history = await this.storage.listMessages(sessionId)
    let assistantReply = 'temporarily unavailable'
    let confidence = 1
    let kbContext: string | null = null
    try {
      if (this.kb) {
        const retrieval = await this.kb.retrieve(text, {
          brandId: this.config.brandId || 'default',
          botId: this.config.botId || 'default',
          topK: this.config.kb?.topK ?? 5,
        })
        if (retrieval.chunks.length) {
          kbContext = retrieval.chunks
            .map((c, idx) => `(#${idx + 1}) ${c.content}`)
            .join('\n\n')
        }
      }
    } catch (err) {
      this.config.logger?.warn?.('[kb] retrieval failed', err)
    }
    try {
      const result = await this.ai.chat({
        prompt: kbContext ? `${text}\n\nContext:\n${kbContext}` : text,
        history: history.map((h) => ({ role: h.sender === 'user' ? 'user' : 'assistant', content: h.text })),
        provider: this.config.settings?.ai?.provider,
      })
      assistantReply = result.text
      confidence = result.confidence ?? 1
    } catch (err) {
      assistantReply = 'Our assistants are busy. Please try again shortly.'
      confidence = 0
      this.config.logger?.error?.('[ai] provider failure', err)
    }

    const threshold = Number(
      this.config.behavior?.handoffConfidenceThreshold ??
        this.config.settings?.behavior?.handoffConfidenceThreshold ??
        0.65,
    )

    if (confidence < threshold) {
      await this.inbox?.upsertFromUserMessage({
        sessionId,
        text,
        brandId: this.config.brandId,
        confidence,
      })
      const handoffMessage =
        this.config.behavior?.handoffMessage ||
        this.config.settings?.behavior?.handoffMessage ||
        'Routing you to a human agent. Please hold while we connect you.'
      return this.pushBotMessage(sessionId, handoffMessage)
    }

    const bot = await this.pushBotMessage(sessionId, assistantReply)
    return bot
  }

  async pushBotMessage(
    sessionId: string,
    text: string,
    options?: { type?: import('./types').RichMessageType; payload?: import('./types').RichMessagePayload },
  ): Promise<ChatMessage> {
    return this.storage.recordMessage(sessionId, 'bot', text, this.maxHistory(), options)
  }

  async list(sessionId: string): Promise<ChatMessage[]> {
    return this.storage.listMessages(sessionId)
  }

  async clear(sessionId: string): Promise<void> {
    await this.storage.clearSession(sessionId)
  }
}
