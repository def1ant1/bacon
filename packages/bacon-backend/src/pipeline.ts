import { v4 as uuidv4 } from 'uuid'
import { AiProvider, BaconServerConfig, ChatMessage, MessagePipeline, StorageAdapter } from './types'

export class EchoAiProvider implements AiProvider {
  async complete(prompt: string): Promise<string> {
    return `Echo: ${prompt}`
  }
}

export class Pipeline implements MessagePipeline {
  constructor(private storage: StorageAdapter, private ai: AiProvider, private config: BaconServerConfig) {}

  private maxHistory() {
    return Number(this.config.behavior?.maxHistory ?? this.config.settings?.behavior?.maxHistory ?? 200)
  }

  async handleUserMessage(sessionId: string, text: string): Promise<ChatMessage> {
    const msg = await this.storage.recordMessage(sessionId, 'user', text, this.maxHistory())
    const history = await this.storage.listMessages(sessionId)
    const assistantReply = await this.ai.complete(text, history.map((h) => ({ role: h.sender === 'user' ? 'user' : 'assistant', content: h.text })))
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
