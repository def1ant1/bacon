import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { CustomerSupportChatWidget } from "../CustomerSupportChatWidget";
import { clientIdentityManager } from "../auth/ClientIdentityManager";
import { Transport, TransportOptions } from "../transports/Transport";

vi.mock("../CustomerSupportChatWidget.css", () => ({}));

describe("CustomerSupportChatWidget client identity", () => {
  beforeEach(() => {
    (window.HTMLElement.prototype as any).scrollIntoView = vi.fn();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("propagates the stable clientId to transports and payloads", async () => {
    const identity = { id: "client-test", createdAt: 0, expiresAt: 100_000 };
    vi.spyOn(clientIdentityManager, "getOrCreateIdentity").mockResolvedValue(identity);

    const sentPayloads: any[] = [];
    const seenOptions: TransportOptions[] = [];
    const fakeTransport: Transport = {
      name: "fake",
      state: "idle",
      setEventHandlers: vi.fn(),
      connect: vi.fn(async () => Promise.resolve()),
      disconnect: vi.fn(async () => Promise.resolve()),
      send: vi.fn(async (payload) => {
        sentPayloads.push(payload);
        return { reply: "ok" } as any;
      }),
    };

    render(
      <CustomerSupportChatWidget
        apiUrl="/chat"
        defaultOpen
        transport={(options) => {
          seenOptions.push(options);
          return fakeTransport;
        }}
      />,
    );

    const input = await screen.findByPlaceholderText(/type your message/i);
    const user = userEvent.setup();
    await user.type(input, "hello world");
    await user.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(sentPayloads.length).toBeGreaterThan(0));
    expect(seenOptions[0].clientId).toBe(identity.id);
    expect(sentPayloads[0].clientId).toBe(identity.id);
  });
});
