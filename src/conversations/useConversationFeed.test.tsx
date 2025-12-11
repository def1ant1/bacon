import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useConversationFeed } from "./useConversationFeed"
import { ConversationDataService } from "./ConversationDataService"
import { ConversationPage } from "./types"
import { createSeedPage } from "./__fixtures__/chatSeeds"

afterEach(() => {
  vi.restoreAllMocks()
})

function createServiceSequence(pages: ConversationPage[]): ConversationDataService {
  const cursorMap = new Map<string | undefined, ConversationPage>()
  cursorMap.set("start", pages[0])
  cursorMap.set(pages[0].nextCursor, pages[1] ?? pages[0])

  const fetchPage = vi.fn(async (cursor?: string, signal?: AbortSignal) => {
    // Abort controllers are respected by the hook to avoid leaking inflight
    // requests during unmount/rapid scrolling.
    if (signal?.aborted) {
      throw new Error("cancelled")
    }
    return cursorMap.get(cursor || "start") ?? pages[0]
  })

  const cancel = vi.fn()

  return { fetchPage, cancel } as unknown as ConversationDataService
}

describe("useConversationFeed", () => {
  it("hydrates the initial page and loads more on demand", async () => {
    const pages: ConversationPage[] = [
      createSeedPage("page-2"),
      { ...createSeedPage(undefined), conversations: createSeedPage().conversations.map((c) => ({ ...c, id: `${c.id}-p2` })) },
    ]
    const service = createServiceSequence(pages)

    const { result } = renderHook(() => useConversationFeed(service))

    await waitFor(() => {
      expect(result.current.conversations).toHaveLength(pages[0].conversations.length)
      expect(result.current.loading).toBe(false)
    })

    result.current.loadMore()

    await waitFor(() => {
      expect(result.current.conversations).toHaveLength(
        pages[0].conversations.length + pages[1].conversations.length
      )
      expect(result.current.hasMore).toBe(false)
    })
  })

  it("surfaces errors and retries with the last cursor", async () => {
    const pages: ConversationPage[] = [createSeedPage("page-2"), createSeedPage()]
    const service = createServiceSequence(pages)

    // Simulate a transient network failure after the first successful fetch.
    ;(service.fetchPage as any)
      .mockResolvedValueOnce(pages[0])
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(pages[1])

    const { result } = renderHook(() => useConversationFeed(service))

    await waitFor(() => expect(result.current.loading).toBe(false))

    result.current.loadMore()
    await waitFor(() => expect(result.current.error?.message).toBe("transient"))

    result.current.retry()
    await waitFor(() => expect(result.current.error).toBeUndefined())
    expect(result.current.conversations).toHaveLength(pages[0].conversations.length + pages[1].conversations.length)
  })

  it("cancels inflight fetches on unmount", async () => {
    const pages: ConversationPage[] = [createSeedPage("page-2"), createSeedPage()]
    const service = createServiceSequence(pages)
    const { unmount } = renderHook(() => useConversationFeed(service))

    unmount()
    expect((service.cancel as any)).toHaveBeenCalled()
  })
})
