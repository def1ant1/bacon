import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PollingTransport } from "../PollingTransport";
import { TransportEventHandlers } from "../Transport";

describe("PollingTransport", () => {
  const handlers: TransportEventHandlers = {
    onMessage: vi.fn(),
    onOpen: vi.fn(),
    onError: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    (global as any).fetch = vi.fn();
    vi.resetAllMocks();
    handlers.onMessage = vi.fn();
    handlers.onOpen = vi.fn();
    handlers.onError = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls and emits messages on success", async () => {
    const messages = [{ id: "1", sender: "bot" as const, text: "hi", createdAt: "" }];
    (fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve(messages) });
    const transport = new PollingTransport({
      apiUrl: "https://api.example.com/chat",
      clientId: "client-123",
      sessionId: "s1",
      pollIntervalMs: 50,
    });
    transport.setEventHandlers(handlers);
    await transport.connect();
    await vi.advanceTimersByTimeAsync(55);

    expect(fetch).toHaveBeenCalled();
    expect(handlers.onMessage).toHaveBeenCalledWith(messages);
    await transport.disconnect();
  });

  it("retries with backoff on failure", async () => {
    (fetch as any).mockRejectedValueOnce(new Error("offline"));
    const transport = new PollingTransport({
      apiUrl: "https://api.example.com/chat",
      clientId: "client-123",
      sessionId: "s1",
      pollIntervalMs: 10,
      backoffBaseMs: 20,
      backoffMaxMs: 40,
    });
    transport.setEventHandlers(handlers);
    await transport.connect();
    await vi.advanceTimersToNextTimerAsync();

    expect(handlers.onError).toHaveBeenCalled();
    // Next timer should be scheduled using backoff (at least baseMs)
    const pending = vi.getTimerCount();
    expect(pending).toBeGreaterThan(0);
    await transport.disconnect();
  });

  it("sends payloads via fetch", async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({ reply: "ok" }) });
    const transport = new PollingTransport({
      apiUrl: "https://api.example.com/chat",
      clientId: "client-123",
      sessionId: "s1",
    });
    transport.setEventHandlers(handlers);
    const res = await transport.send({ clientId: "client-123", sessionId: "s1", message: "hello" });

    expect(fetch).toHaveBeenCalledWith("https://api.example.com/chat", expect.anything());
    expect(res).toEqual({ reply: "ok" });
  });
});
