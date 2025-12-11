import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { WebSocketTransport } from "../WebSocketTransport";
import { TransportEventHandlers } from "../Transport";

class FakeWebSocket extends EventTarget {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;
  public readyState = FakeWebSocket.CONNECTING;
  public sent: Array<string | Blob> = [];
  constructor(public url: string) {
    super();
  }
  send(payload: string | Blob) {
    this.sent.push(payload);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }
  triggerOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }
  triggerMessage(data: any) {
    const MessageEventCtor =
      (global as any).MessageEvent ||
      class extends Event {
        public data: unknown;
        constructor(type: string, init?: { data?: unknown }) {
          super(type);
          this.data = init?.data;
        }
      };
    this.dispatchEvent(new MessageEventCtor("message", { data: JSON.stringify(data) }));
  }
}

describe("WebSocketTransport", () => {
  const handlers: TransportEventHandlers = {
    onMessage: vi.fn(),
    onOpen: vi.fn(),
    onError: vi.fn(),
    onClose: vi.fn(),
    onTelemetry: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    (global as any).WebSocket = FakeWebSocket as any;
    handlers.onMessage = vi.fn();
    handlers.onOpen = vi.fn();
    handlers.onError = vi.fn();
    handlers.onClose = vi.fn();
    handlers.onTelemetry = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes queued messages once the socket opens", async () => {
    const transport = new WebSocketTransport({
      apiUrl: "https://api.example.com/chat",
      clientId: "client-123",
      sessionId: "s1",
      webSocketImpl: FakeWebSocket as any,
    });
    transport.setEventHandlers(handlers);
    await transport.connect();
    const socket = (transport as any).socket as FakeWebSocket;
    await transport.send({ clientId: "client-123", sessionId: "s1", message: "hello" });
    expect(socket.sent).toHaveLength(0);
    socket.triggerOpen();
    expect(handlers.onOpen).toHaveBeenCalled();
    expect(socket.sent).not.toHaveLength(0);
  });

  it("emits messages and schedules reconnects", async () => {
    const transport = new WebSocketTransport({
      apiUrl: "https://api.example.com/chat",
      clientId: "client-123",
      sessionId: "s1",
      heartbeatMs: 0,
      webSocketImpl: FakeWebSocket as any,
      backoffBaseMs: 10,
      backoffMaxMs: 20,
    });
    transport.setEventHandlers(handlers);
    await transport.connect();
    const socket = (transport as any).socket as FakeWebSocket;
    socket.triggerOpen();
    socket.triggerMessage({ reply: "pong" });
    expect(handlers.onMessage).toHaveBeenCalled();

    socket.close();
    expect(handlers.onClose).toHaveBeenCalled();
    await vi.advanceTimersToNextTimerAsync();
    expect(handlers.onTelemetry).toHaveBeenCalled();
  });
});
