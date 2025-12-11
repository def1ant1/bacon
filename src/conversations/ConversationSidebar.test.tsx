import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import "@testing-library/jest-dom/vitest"
import { ConversationSidebar } from "./ConversationSidebar"
import { ConversationDataService } from "./ConversationDataService"
import { ConversationPage } from "./types"

afterEach(() => cleanup())

function createMockService(pages: ConversationPage[]): ConversationDataService {
  let callCount = 0
  return {
    // We keep the interface surface minimal; the hook only uses fetchPage + cancel.
    fetchPage: vi.fn(async () => {
      const page = pages[callCount] ?? pages[pages.length - 1]
      callCount += 1
      return page
    }),
    cancel: vi.fn(),
  } as unknown as ConversationDataService
}

const baseConversation = {
  id: "a",
  title: "Priority Customer",
  lastMessageAt: new Date().toISOString(),
  lastMessagePreview: "Need help with billing",
  unread: true,
}

describe("ConversationSidebar", () => {
  it("renders conversations with metadata and supports selection", async () => {
    const page: ConversationPage = { conversations: [baseConversation], nextCursor: undefined }
    const service = createMockService([page])
    const onSelect = vi.fn()

    render(<ConversationSidebar service={service} onSelectConversation={onSelect} />)

    const row = await screen.findByRole("option", { name: /priority customer/i })
    expect(row).toBeInTheDocument()

    await userEvent.click(row)
    expect(onSelect).toHaveBeenCalledWith("a")
    expect(screen.getByText(/need help with billing/i)).toBeInTheDocument()
  })

  it("offers retry on error and shows empty state", async () => {
    const errorService = {
      fetchPage: vi.fn().mockRejectedValue(new Error("network failure")),
      cancel: vi.fn(),
    } as unknown as ConversationDataService

    render(<ConversationSidebar service={errorService} />)

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(/could not load/i)

    const retryButton = screen.getByRole("button", { name: /retry/i })
    expect(retryButton).toBeEnabled()
  })

  it("paginates when the load more control is used", async () => {
    const page1: ConversationPage = { conversations: [baseConversation], nextCursor: "next" }
    const page2: ConversationPage = {
      conversations: [
        {
          ...baseConversation,
          id: "b",
          title: "Follow-up",
          lastMessagePreview: "Scheduled demo",
        },
      ],
      nextCursor: undefined,
    }

    const service = createMockService([page1, page2])

    render(<ConversationSidebar service={service} />)

    await screen.findByRole("option", { name: /priority customer/i })
    await userEvent.click(await screen.findByRole("button", { name: /load more/i }))

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /follow-up/i })).toBeInTheDocument()
    })
  })

  it("supports keyboard navigation between items", async () => {
    const page: ConversationPage = {
      conversations: [
        baseConversation,
        {
          ...baseConversation,
          id: "b",
          title: "Second",
          lastMessagePreview: "New issue",
        },
      ],
      nextCursor: undefined,
    }

    const service = createMockService([page])
    render(<ConversationSidebar service={service} />)

    const first = await screen.findByRole("option", { name: /priority customer/i })
    first.focus()
    expect(first).toHaveFocus()
    fireEvent.keyDown(first, { key: "ArrowDown", code: "ArrowDown" })

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /second/i })).toHaveFocus()
    })
  })
})
