import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import "@testing-library/jest-dom/vitest"
import { ConversationWorkspace } from "./ConversationWorkspace"
import { ConversationDataService } from "./ConversationDataService"
import { ConversationMessage, ConversationMessageService } from "./ConversationMessageService"
import { ConversationPage, ConversationSummary } from "./types"

afterEach(() => cleanup())

function createConversationService(conversations: ConversationSummary[]): ConversationDataService {
  return {
    fetchPage: vi.fn(async () => ({ conversations, nextCursor: undefined } as ConversationPage)),
    cancel: vi.fn(),
  } as unknown as ConversationDataService
}

function createMessageService(histories: Record<string, ConversationMessage[]>): ConversationMessageService {
  return {
    loadHistory: vi.fn(async (conversationId: string) => histories[conversationId] || []),
    sendMessage: vi.fn(async (conversationId: string, text: string) => {
      const message: ConversationMessage = {
        id: `${conversationId}-${Date.now()}`,
        conversationId,
        sender: "agent",
        text,
        createdAt: new Date().toISOString(),
      }
      histories[conversationId] = [...(histories[conversationId] || []), message]
      return message
    }),
  } as unknown as ConversationMessageService
}

const baseConversation: ConversationSummary = {
  id: "c1",
  title: "Platinum Customer",
  lastMessageAt: new Date().toISOString(),
}

describe("ConversationWorkspace", () => {
  it("loads message history when a sidebar item is selected", async () => {
    const histories: Record<string, ConversationMessage[]> = {
      c1: [
        {
          id: "m1",
          conversationId: "c1",
          sender: "user",
          text: "hi",
          createdAt: new Date().toISOString(),
        },
      ],
    }
    const service = createConversationService([baseConversation])
    const messageService = createMessageService(histories)

    render(
      <ConversationWorkspace
        conversationService={service}
        messageService={messageService}
        title="Support"
        sidebarTitle="Inbox"
      />
    )

    await userEvent.click(await screen.findByRole("option", { name: /platinum customer/i }))

    await waitFor(() => {
      expect(screen.getByText("hi")).toBeInTheDocument()
    })
  })

  it("sends messages into the active conversation", async () => {
    const histories = { c1: [] as ConversationMessage[] }
    const service = createConversationService([baseConversation])
    const messageService = createMessageService(histories)

    render(<ConversationWorkspace conversationService={service} messageService={messageService} />)

    await userEvent.click(await screen.findByRole("option", { name: /platinum customer/i }))
    const input = await screen.findByLabelText(/message/i)
    await userEvent.type(input, "Thanks for reaching out")
    await userEvent.click(screen.getByRole("button", { name: /send/i }))

    await waitFor(() => {
      expect(screen.getByText(/thanks for reaching out/i)).toBeInTheDocument()
    })
    expect((messageService.sendMessage as any)).toHaveBeenCalled()
  })

  it("shows errors and allows retry", async () => {
    const service = createConversationService([baseConversation])
    const failingService: ConversationMessageService = {
      loadHistory: vi
        .fn()
        .mockRejectedValueOnce(new Error("network"))
        .mockResolvedValue([{ id: "m1", conversationId: "c1", sender: "user", text: "hello", createdAt: new Date().toISOString() }]),
      sendMessage: vi.fn(),
    } as unknown as ConversationMessageService

    render(<ConversationWorkspace conversationService={service} messageService={failingService} />)
    await userEvent.click(await screen.findByRole("option", { name: /platinum customer/i }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(/could not load messages/i)

    await userEvent.click(screen.getByRole("button", { name: /retry/i }))
    await waitFor(() => {
      expect(screen.getByText("hello")).toBeInTheDocument()
    })
  })

  it("switches history when reselecting conversations", async () => {
    const conversations: ConversationSummary[] = [
      baseConversation,
      { ...baseConversation, id: "c2", title: "Second" },
    ]
    const histories: Record<string, ConversationMessage[]> = {
      c1: [{ id: "m1", conversationId: "c1", sender: "user", text: "first", createdAt: new Date().toISOString() }],
      c2: [{ id: "m2", conversationId: "c2", sender: "user", text: "second", createdAt: new Date().toISOString() }],
    }
    const service = createConversationService(conversations)
    const messageService = createMessageService(histories)

    render(<ConversationWorkspace conversationService={service} messageService={messageService} />)

    await userEvent.click(await screen.findByRole("option", { name: /platinum customer/i }))
    await waitFor(() => expect(screen.getByText("first")).toBeInTheDocument())

    await userEvent.click(screen.getByRole("option", { name: /second/i }))
    await waitFor(() => expect(screen.getByText("second")).toBeInTheDocument())
  })
})
