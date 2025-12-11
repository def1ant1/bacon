import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import React from "react"
import "@testing-library/jest-dom/vitest"
import { CustomerSupportChatWidget } from "../CustomerSupportChatWidget"
import { clientIdentityManager } from "../auth/ClientIdentityManager"
import { Transport, TransportEventHandlers, TransportOptions } from "../transports/Transport"
import { seedMessages } from "../conversations/__fixtures__/chatSeeds"

vi.mock("../CustomerSupportChatWidget.css", () => ({}))

describe("CustomerSupportChatWidget chat flow", () => {
  beforeEach(() => {
    ;(window.HTMLElement.prototype as any).scrollIntoView = vi.fn()
    vi.restoreAllMocks()
  })

  it("replays seeded history and threads session IDs through transport sends", async () => {
    const identity = { id: "seed-client", createdAt: 0, expiresAt: 100_000 }
    vi.spyOn(clientIdentityManager, "getOrCreateIdentity").mockResolvedValue(identity)

    const handlers: TransportEventHandlers = {}
    const fakeTransport: Transport = {
      name: "fake",
      state: "idle",
      setEventHandlers: vi.fn((h) => Object.assign(handlers, h)),
      connect: vi.fn(async () => {
        // Surface a server-seeded transcript immediately after connect to mirror
        // the polling/websocket hydration path and guard against regressions
        // where new sessions would render empty feeds.
        handlers.onOpen?.()
        const chatHistory = seedMessages["c-seed-1"].map((message) => ({
          ...message,
          // Agent transcripts are downcast to bot/user to mirror the widget
          // surface while keeping the seed fixtures reusable across consoles.
          sender: message.sender === "agent" ? "bot" : message.sender,
        }))
        handlers.onMessage?.(chatHistory)
      }),
      disconnect: vi.fn(async () => Promise.resolve()),
      send: vi.fn(async (payload) => {
        handlers.onMessage?.({
          id: "bot-seed-ack",
          sender: "bot",
          text: "ack",
          createdAt: new Date().toISOString(),
        })
        return { reply: "ack" } as any
      }),
    }

    const transportFactory = (options: TransportOptions) => {
      // The options mirror the server contract, so asserting on them ensures
      // session churn does not silently break observability/CSRF checks.
      expect(options.clientId).toBe(identity.id)
      expect(options.sessionId).toBe(identity.id)
      return fakeTransport
    }

    render(
      <CustomerSupportChatWidget
        apiUrl="/chat"
        defaultOpen
        welcomeMessage="Welcome back"
        transport={transportFactory}
      />
    )

    await waitFor(() => expect(fakeTransport.connect).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText(/hi team/i)).toBeInTheDocument())

    const input = await screen.findByPlaceholderText(/type your message/i)
    const user = userEvent.setup()
    await user.type(input, "hello there")
    await user.click(screen.getByRole("button", { name: /send/i }))

    await waitFor(() => {
      expect(fakeTransport.send).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: identity.id, sessionId: identity.id })
      )
      expect(screen.getAllByText(/ack/i).length).toBeGreaterThan(0)
    })
  })
})
