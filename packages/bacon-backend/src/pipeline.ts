import { AiProvider, BaconServerConfig, ChatMessage, MessagePipeline, StorageAdapter } from './types'

export class Pipeline implements MessagePipeline {
  constructor(private storage: StorageAdapter, private ai: AiProvider, private config: BaconServerConfig) {}

  private maxHistory() {
    return Number(this.config.behavior?.maxHistory ?? this.config.settings?.behavior?.maxHistory ?? 200)
  }

  async handleUserMessage(sessionId: string, text: string): Promise<ChatMessage> {
    const msg = await this.storage.recordMessage(sessionId, 'user', text, this.maxHistory())
    const history = await this.storage.listMessages(sessionId)
    let assistantReply = 'temporarily unavailable'
    try {
      const result = await this.ai.chat({
        prompt: text,
        history: history.map((h) => ({ role: h.sender === 'user' ? 'user' : 'assistant', content: h.text })),
        provider: this.config.settings?.ai?.provider,
      })
      assistantReply = result.text
    } catch (err) {
      assistantReply = 'Our assistants are busy. Please try again shortly.'
      this.config.logger?.error?.('[ai] provider failure', err)
    }
    const bot = await this.pushBotMessage(sessionId, assistantReply)
    return bot
  }

  async pushBotMessage(sessionId: string, text: string): Promise<ChatMessage> {
    return this.storage.recordMessage(sessionId, 'bot', text, this.maxHistory())
  }

  async list(sessionId: string): Promise<ChatMessage[]> {
    return this.storage.listMessages(sessionId)
  }

  async clear(sessionId: string): Promise<void> {
    await this.storage.clearSession(sessionId)
  }
}
