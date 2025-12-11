import { SenderType } from "../CustomerSupportChatWidget"

export interface ConversationMessage {
  id: string
  conversationId: string
  sender: SenderType | "agent"
  text: string
  createdAt: string
  metadata?: Record<string, unknown>
  type?: string
  payload?: Record<string, unknown>
}

export interface ConversationMessageServiceOptions {
  /** Base URL for history retrieval, e.g. "/api/admin/messages". */
  historyUrl: string
  /** Endpoint for sending new replies; defaults to historyUrl to avoid config drift. */
  sendUrl?: string
  /** Optional auth header factory to avoid duplicating token plumbing per call. */
  requestInit?: () => Promise<RequestInit> | RequestInit
  /** Maximum retries for transient failures. */
  maxRetries?: number
  /** Initial backoff window in ms; doubles each retry. */
  retryBackoffMs?: number
}

/**
 * Data service dedicated to message history and outbound sends. It mirrors the
 * defensive/cancellable style of ConversationDataService so UIs can coordinate
 * fetches without race conditions or duplicate network chatter.
 */
export class ConversationMessageService {
  private readonly historyUrl: string
  private readonly sendUrl: string
  private readonly requestInit?: ConversationMessageServiceOptions["requestInit"]
  private readonly maxRetries: number
  private readonly retryBackoffMs: number

  constructor(options: ConversationMessageServiceOptions) {
    this.historyUrl = options.historyUrl
    this.sendUrl = options.sendUrl ?? options.historyUrl
    this.requestInit = options.requestInit
    this.maxRetries = options.maxRetries ?? 2
    this.retryBackoffMs = options.retryBackoffMs ?? 250
  }

  async loadHistory(conversationId: string, signal?: AbortSignal): Promise<ConversationMessage[]> {
    return this.withRetry(async () => {
      const url = new URL(this.historyUrl, window.location.origin)
      url.searchParams.set("sessionId", conversationId)
      const baseInit = await this.resolveInit()
      const response = await fetch(url.toString(), {
        ...baseInit,
        signal,
      })
      if (!response.ok) {
        throw new Error(`Failed to load messages (${response.status})`)
      }
      const messages = (await response.json()) as ConversationMessage[]
      return messages.map((m) => ({ ...m, conversationId }))
    }, signal)
  }

  async sendMessage(
    conversationId: string,
    text: string,
    signal?: AbortSignal
  ): Promise<ConversationMessage> {
    return this.withRetry(async () => {
      const baseInit = await this.resolveInit()
      const response = await fetch(this.sendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(baseInit?.headers || {}) },
        body: JSON.stringify({ sessionId: conversationId, message: text }),
        ...baseInit,
        signal,
      })
      if (!response.ok) {
        throw new Error(`Failed to send message (${response.status})`)
      }
      const payload = (await response.json()) as { id?: string; reply?: string; createdAt?: string }
      return {
        id: payload.id ?? `${conversationId}_${Date.now()}`,
        conversationId,
        sender: "agent",
        text: payload.reply || text,
        createdAt: payload.createdAt ?? new Date().toISOString(),
      }
    }, signal)
  }

  private async resolveInit(): Promise<RequestInit | undefined> {
    const init = this.requestInit ? await this.requestInit() : undefined
    return init
  }

  private async withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    let attempt = 0
    let lastError: unknown

    while (attempt <= this.maxRetries) {
      try {
        return await fn()
      } catch (err) {
        if (signal?.aborted) {
          throw new Error("message_request_cancelled")
        }
        lastError = err
        if (attempt === this.maxRetries) break
        const backoff = this.retryBackoffMs * 2 ** attempt
        await this.delay(backoff, signal)
        attempt += 1
      }
    }

    throw lastError ?? new Error("message_request_failed")
  }

  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(resolve, ms)
      if (signal) {
        const onAbort = () => {
          window.clearTimeout(timeout)
          reject(new Error("message_request_cancelled"))
        }
        signal.addEventListener("abort", onAbort, { once: true })
      }
    })
  }
}
