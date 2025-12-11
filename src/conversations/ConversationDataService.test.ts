import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { ConversationDataService } from "./ConversationDataService"
import { ConversationPage } from "./types"

const samplePage: ConversationPage = {
  conversations: [
    {
      id: "1",
      title: "Example",
      lastMessageAt: new Date().toISOString(),
      lastMessagePreview: "Hello world",
      unread: true,
    },
  ],
  nextCursor: "next",
}

function createResponse(body: ConversationPage, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

describe("ConversationDataService", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("deduplicates inflight requests and caches results", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createResponse(samplePage))
    ;(globalThis as any).fetch = fetchMock

    const service = new ConversationDataService({ baseUrl: "/api/conversations" })

    const [first, second] = await Promise.all([service.fetchPage(), service.fetchPage()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first.conversations[0].id).toBe("1")
    expect(second.conversations[0].id).toBe("1")

    fetchMock.mockClear()
    const cached = await service.fetchPage()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(cached.conversations[0].id).toBe("1")
  })

  it("retries transient errors and eventually succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createResponse(samplePage, false, 500))
      .mockResolvedValueOnce(createResponse(samplePage))
    ;(globalThis as any).fetch = fetchMock

    const service = new ConversationDataService({ baseUrl: "/api/conversations", retryBackoffMs: 1 })
    const resultPromise = service.fetchPage()

    await resultPromise
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("supports cancellation via AbortController", async () => {
    const fetchMock = vi.fn((_: string, init?: RequestInit) => {
      const { signal } = init ?? {}
      return new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("Aborted")))
      }) as Promise<Response>
    })
    ;(globalThis as any).fetch = fetchMock

    const service = new ConversationDataService({ baseUrl: "/api/conversations" })
    const controller = new AbortController()
    const promise = service.fetchPage("start", controller.signal)
    controller.abort()

    await expect(promise).rejects.toThrow(/cancelled/i)
  })
})
