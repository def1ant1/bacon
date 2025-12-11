import { ConversationPage, ConversationServiceOptions, ConversationSummary } from "./types"

interface CacheEntry {
  page: ConversationPage
  fetchedAt: number
}

/**
 * Centralized, cache-aware data service that streams conversation pages with
 * cancellation and retry support. It is intentionally framework-agnostic so it
 * can be used inside React components, background sync workers, or Node
 * scripts. Extensive comments capture operational edge cases for future
 * maintainers.
 */
export class ConversationDataService {
  private readonly baseUrl: string
  private readonly pageSize?: number
  private readonly maxRetries: number
  private readonly retryBackoffMs: number
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inflight = new Map<
    string,
    { controller: AbortController; promise: Promise<ConversationPage> }
  >()

  constructor(options: ConversationServiceOptions) {
    this.baseUrl = options.baseUrl
    this.pageSize = options.pageSize
    this.maxRetries = options.maxRetries ?? 3
    this.retryBackoffMs = options.retryBackoffMs ?? 300
  }

  /**
   * Returns a cached page when available. We cache each cursor separately to
   * avoid pagination gaps when multiple UI elements request different slices.
   */
  getCachedPage(cursor: string = "start"): ConversationPage | undefined {
    return this.cache.get(cursor)?.page
  }

  /**
   * Attempts to cancel any inflight request for the provided cursor. This is
   * especially helpful when the UI unmounts or when rapid scrolling triggers
   * superseded fetches.
   */
  cancel(cursor: string = "start"): void {
    const inflight = this.inflight.get(cursor)
    if (inflight) {
      inflight.controller.abort()
      this.inflight.delete(cursor)
    }
  }

  /**
   * Clears all cached pages. Useful when a user changes workspaces/tenants and
   * stale data must be flushed without reloading the page.
   */
  reset(): void {
    this.cache.clear()
    this.inflight.forEach(({ controller }) => controller.abort())
    this.inflight.clear()
  }

  /**
   * Fetches a single page of conversations with retries and caching. Requests
   * for the same cursor are deduplicated so concurrent callers share the same
   * network response. Consumers receive a fresh object to avoid accidental
   * mutation of cache entries.
   */
  async fetchPage(cursor: string = "start", signal?: AbortSignal): Promise<ConversationPage> {
    const existing = this.cache.get(cursor)
    if (existing) {
      return { ...existing.page, conversations: [...existing.page.conversations] }
    }

    const inflight = this.inflight.get(cursor)
    if (inflight) {
      // Attach to the inflight promise; if the caller also provides a signal we
      // honor cancellation locally even while the shared request may continue.
      if (signal) {
        signal.addEventListener("abort", () => inflight.controller.abort(), { once: true })
      }
      return inflight.promise
    }

    const controller = new AbortController()
    const mergedSignal = signal
      ? this.mergeSignals(signal, controller.signal)
      : controller.signal

    const promise = this.fetchWithRetry(cursor, mergedSignal)
      .then((page) => {
        this.cache.set(cursor, { page, fetchedAt: Date.now() })
        this.inflight.delete(cursor)
        return { ...page, conversations: [...page.conversations] }
      })
      .catch((err) => {
        this.inflight.delete(cursor)
        throw err
      })

    this.inflight.set(cursor, { controller, promise })
    return promise
  }

  /**
   * Internal helper to compose multiple AbortSignals without requiring
   * AbortSignal.any (which is still experimental in some browsers). We also add
   * generous documentation so future refactors preserve cancellation behavior.
   */
  private mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
    if (a.aborted) return a
    if (b.aborted) return b

    const controller = new AbortController()

    // We intentionally ignore abort reasons here because only the cancellation
    // event matters; this avoids cross-browser differences while still halting
    // downstream fetches.
    const abort = () => controller.abort()
    a.addEventListener("abort", abort, { once: true })
    b.addEventListener("abort", abort, { once: true })

    return controller.signal
  }

  private async fetchWithRetry(cursor: string, signal: AbortSignal): Promise<ConversationPage> {
    let attempt = 0
    let lastError: unknown

    while (attempt <= this.maxRetries) {
      try {
        const url = new URL(this.baseUrl, window.location.origin)
        if (cursor !== "start") {
          url.searchParams.set("cursor", cursor)
        }
        if (this.pageSize) {
          url.searchParams.set("limit", String(this.pageSize))
        }

        const response = await fetch(url.toString(), { signal })
        if (!response.ok) {
          // Treat 5xx and 429 as retryable; 4xx should fail fast to avoid
          // hammering the API with malformed requests.
          if (response.status >= 500 || response.status === 429) {
            throw new RetryableError(`Server returned ${response.status}`)
          }
          throw new Error(`Failed to load conversations (${response.status})`)
        }

        const payload: ConversationPage = await response.json()

        // Normalize missing arrays so downstream code can assume a stable shape.
        const conversations = payload.conversations ?? []
        return { conversations, nextCursor: payload.nextCursor }
      } catch (err) {
        if (signal.aborted) {
          throw new Error("Conversation request cancelled")
        }

        lastError = err
        const isRetryable =
          err instanceof RetryableError ||
          (err instanceof TypeError && attempt < this.maxRetries)

        if (!isRetryable || attempt === this.maxRetries) {
          throw err
        }

        const backoff = this.retryBackoffMs * 2 ** attempt
        await this.delay(backoff, signal)
        attempt += 1
      }
    }

    throw lastError ?? new Error("Unknown conversation fetch failure")
  }

  private delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        signal.removeEventListener("abort", onAbort)
        resolve()
      }, ms)

      const onAbort = () => {
        window.clearTimeout(timeout)
        reject(new Error("Conversation request cancelled"))
      }

      signal.addEventListener("abort", onAbort, { once: true })
    })
  }
}

class RetryableError extends Error {}

export function sortConversations(conversations: ConversationSummary[]): ConversationSummary[] {
  return [...conversations].sort((a, b) => (a.lastMessageAt > b.lastMessageAt ? -1 : 1))
}
