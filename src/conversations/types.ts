export interface ConversationSummary {
  id: string
  /** Human-readable label derived from conversation subject or participant name. */
  title: string
  /** Optional participant string when title is system-generated. */
  participantLabel?: string
  /** ISO timestamp of the last activity for ordering. */
  lastMessageAt: string
  /** Short preview of the trailing message for quick scanning. */
  lastMessagePreview?: string
  /** True when the conversation contains unread content for the current agent. */
  unread?: boolean
}

export interface ConversationPage {
  conversations: ConversationSummary[]
  /** Cursor provided by the server to fetch the next slice; undefined means the end. */
  nextCursor?: string
}

export interface ConversationServiceOptions {
  /** Base URL for the conversation API (e.g., "/api/conversations"). */
  baseUrl: string
  /** Optional page size hint; the server remains the source of truth. */
  pageSize?: number
  /**
   * Maximum retry attempts for transient failures. Defaults to 3 to keep API
   * load manageable while still handling noisy networks.
   */
  maxRetries?: number
  /**
   * Minimum backoff delay in milliseconds between retries. Defaults to 300ms
   * and scales exponentially to avoid stampeding the API during outages.
   */
  retryBackoffMs?: number
}
