import { describe, expect, it, vi } from "vitest";
import { PluginRunner, BaconPlugin } from "../BaconPlugin";

const baseContext = {
  apiUrl: "/chat",
  clientId: "client-1",
  sessionId: "session-1",
  transportKind: "polling",
  userIdentifier: { email: "user@example.com" },
  isOpen: true,
};

describe("PluginRunner", () => {
  it("chains beforeSend hooks without mutating the source payload", async () => {
    const initialPayload = { clientId: "client-1", sessionId: "session-1", message: "hi" };

    const plugins: BaconPlugin[] = [
      {
        name: "metadata-adder",
        onBeforeSend: (payload) => {
          expect(payload).not.toBe(initialPayload);
          return { payload: { ...payload, metadata: { source: "widget" } } };
        },
      },
      {
        name: "enricher",
        onBeforeSend: (payload) => ({
          payload: {
            ...payload,
            metadata: { ...(payload.metadata || {}), correlationId: "abc" },
          },
        }),
      },
    ];

    const dispatcher = vi.fn(async (payload) => {
      expect(payload.metadata).toMatchObject({ source: "widget", correlationId: "abc" });
      return { reply: "ok" };
    });

    const runner = new PluginRunner(plugins, baseContext);
    const response = await runner.send(initialPayload, dispatcher);

    expect(response).toMatchObject({ reply: "ok" });
    expect(initialPayload).toEqual({ clientId: "client-1", sessionId: "session-1", message: "hi" });
  });

  it("isolates errors so later plugins still run", async () => {
    const payload = { clientId: "client-1", sessionId: "s", message: "fail" };
    const safeHook = vi.fn((p) => ({ payload: p }));
    const plugins: BaconPlugin[] = [
      { name: "boom", onBeforeSend: () => { throw new Error("boom"); } },
      { name: "next", onBeforeSend: safeHook },
    ];

    const runner = new PluginRunner(plugins, baseContext);
    await runner.send(payload, async () => undefined);
    expect(safeHook).toHaveBeenCalled();
  });

  it("retries when plugins signal a recoverable send error", async () => {
    const payload = { clientId: "client-1", sessionId: "s", message: "retry" };
    const dispatcher = vi.fn().mockImplementationOnce(() => {
      throw new Error("transient");
    });
    dispatcher.mockImplementationOnce(async () => ({ reply: "ok" }));

    const plugins: BaconPlugin[] = [
      {
        name: "retryer",
        onSendError: () => ({ retry: true }),
      },
    ];

    const runner = new PluginRunner(plugins, baseContext);
    const response = await runner.send(payload, dispatcher as any);
    expect(response).toMatchObject({ reply: "ok" });
    expect(dispatcher).toHaveBeenCalledTimes(2);
  });

  it("supports short-circuiting sends for cached responses", async () => {
    const payload = { clientId: "client-1", sessionId: "s", message: "cached" };
    const dispatcher = vi.fn();
    const runner = new PluginRunner(
      [
        {
          name: "cache",
          onBeforeSend: () => ({ response: { reply: "from-cache" } }),
        },
      ],
      baseContext,
    );

    const response = await runner.send(payload, dispatcher as any);
    expect(response).toMatchObject({ reply: "from-cache" });
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it("allows async message transforms for observability", async () => {
    const runner = new PluginRunner(
      [
        {
          name: "tagger",
          onMessages: async (messages) => ({
            messages: messages.map((m) => ({ ...m, metadata: { tagged: true } })),
          }),
        },
      ],
      { ...baseContext, transportKind: "websocket" },
    );

    const processed = await runner.processMessages([
      { id: "1", sender: "bot", text: "hello", createdAt: new Date().toISOString() },
    ]);

    expect(processed[0].metadata).toMatchObject({ tagged: true });
  });
});
