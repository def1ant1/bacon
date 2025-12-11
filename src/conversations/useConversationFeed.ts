import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ConversationDataService } from "./ConversationDataService"
import { ConversationPage, ConversationSummary } from "./types"

interface ConversationFeedState {
  pages: ConversationPage[]
  loading: boolean
  error?: Error
  hasMore: boolean
}

/**
 * React hook that wraps the ConversationDataService with view-friendly state
 * (loading/error flags) plus incremental pagination helpers. The hook is
 * intentionally defensive: it cancels inflight requests on unmount and uses
 * stable callbacks so scroll listeners can be attached without churn.
 */
export function useConversationFeed(
  service: ConversationDataService,
  initialCursor: string = "start"
) {
  const [state, setState] = useState<ConversationFeedState>({
    pages: [],
    loading: false,
    hasMore: true,
  })

  const cursorRef = useRef<string | undefined>(initialCursor)
  const abortRef = useRef<AbortController | null>(null)
  const loadingRef = useRef(false)

  const conversations = useMemo<ConversationSummary[]>(
    () => state.pages.flatMap((page) => page.conversations),
    [state.pages]
  )

  const loadPage = useCallback(
    async (cursor?: string) => {
      // Prevent duplicate loads while a fetch is running.
      if (loadingRef.current) return

      const controller = new AbortController()
      abortRef.current = controller

      loadingRef.current = true

      setState((prev) => ({ ...prev, loading: true, error: undefined }))

      try {
        const page = await service.fetchPage(cursor, controller.signal)
        setState((prev) => {
          const pages = cursor === initialCursor ? [page] : [...prev.pages, page]
          return {
            pages,
            loading: false,
            error: undefined,
            hasMore: Boolean(page.nextCursor),
          }
        })
        cursorRef.current = page.nextCursor
      } catch (err) {
        if ((err as Error).message.includes("cancelled")) {
          // Cancellation is an expected control-flow path (e.g., unmount). Keep
          // the previous state intact to avoid flashing errors to the user.
          return
        }
        setState((prev) => ({ ...prev, loading: false, error: err as Error }))
      } finally {
        loadingRef.current = false
      }
    },
    [initialCursor, service]
  )

  useEffect(() => {
    loadPage(initialCursor)

    return () => {
      abortRef.current?.abort()
      service.cancel(cursorRef.current)
    }
  }, [initialCursor, loadPage, service])

  const loadMore = useCallback(() => {
    if (!state.hasMore || state.loading) return
    loadPage(cursorRef.current)
  }, [loadPage, state.hasMore, state.loading])

  const retry = useCallback(() => {
    loadPage(cursorRef.current ?? initialCursor)
  }, [initialCursor, loadPage])

  return {
    conversations,
    pages: state.pages,
    loading: state.loading,
    error: state.error,
    hasMore: state.hasMore,
    loadMore,
    retry,
  }
}
