import {
  ChatApiRequest,
  ChatApiResponse,
  ChatMessage,
} from "../CustomerSupportChatWidget";
import {
  Transport,
  TransportEventHandlers,
  TransportOptions,
  TransportState,
  computeBackoff,
} from "./Transport";

export interface WebSocketFactory {
  new (url: string, protocols?: string | string[]): WebSocket;
}

export interface SocketIoLikeClient {
  on(event: string, callback: (...args: any[]) => void): this;
  off(event: string, callback?: (...args: any[]) => void): this;
  emit(event: string, payload: unknown): this;
  close(): void;
  disconnect(): void;
  connect(): void;
}

export interface WebSocketTransportOptions extends TransportOptions {
  webSocketUrl?: string;
  heartbeatMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** Optional socket.io client factory to support older proxies. */
  socketIoFactory?: (url: string, opts?: Record<string, unknown>) => SocketIoLikeClient;
  /** Override the WebSocket constructor (useful for tests). */
  webSocketImpl?: WebSocketFactory;
}

/**
 * WebSocket transport leans on the browser-native WebSocket when available
 * and optionally a socket.io client for environments that need fallback.
 * It prioritizes ordered delivery and reconnect/backoff semantics.
 */
export class WebSocketTransport implements Transport {
  public readonly name = "websocket" as const;
  public state: TransportState = "idle";
  private handlers: TransportEventHandlers = {};
  private socket: WebSocket | SocketIoLikeClient | null = null;
  private reconnectAttempt = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private closedByUser = false;
  private messageQueue: string[] = [];

  constructor(private options: WebSocketTransportOptions) {}

  setEventHandlers(handlers: TransportEventHandlers): void {
    this.handlers = handlers;
  }

  async connect(): Promise<void> {
    if (this.state === "open" || this.state === "connecting") return;
    this.closedByUser = false;
    this.state = "connecting";
    const url = this.computeUrl();
    const wsImpl = this.resolveImpl();
    if (!wsImpl) {
      throw new Error("WebSocket is not available in this environment");
    }

    this.handlers.onTelemetry?.({ name: "ws_connect", at: Date.now(), detail: { url } });
    this.socket = new wsImpl(url);
    this.bindNativeSocket(this.socket as WebSocket);
  }

  async disconnect(reason?: string): Promise<void> {
    this.closedByUser = true;
    this.state = "closed";
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (!this.socket) return;
    if ("close" in this.socket) {
      (this.socket as any).close();
    }
    if ("disconnect" in this.socket) {
      (this.socket as SocketIoLikeClient).disconnect();
    }
    this.handlers.onClose?.(reason);
  }

  async send(payload: ChatApiRequest): Promise<ChatApiResponse | void> {
    const envelope = JSON.stringify({
      type: "message",
      sessionId: this.options.sessionId,
      clientId: this.options.clientId,
      userIdentifier: this.options.userIdentifier,
      payload,
    });
    if (this.socket && (this.socket as WebSocket).readyState === WebSocket.OPEN) {
      (this.socket as WebSocket).send(envelope);
      return;
    }
    if (this.socket && "emit" in this.socket) {
      (this.socket as SocketIoLikeClient).emit("message", envelope);
      return;
    }
    // Queue messages until the connection reopens to preserve ordering.
    this.messageQueue.push(envelope);
  }

  async sendFile(
    file: File,
    metadata?: Record<string, string>,
  ): Promise<ChatMessage | undefined> {
    const envelope = {
      type: "file",
      sessionId: this.options.sessionId,
      clientId: this.options.clientId,
      metadata,
      name: file.name,
      size: file.size,
    };
    const payload = JSON.stringify(envelope);
    if (this.socket && (this.socket as WebSocket).readyState === WebSocket.OPEN) {
      (this.socket as WebSocket).send(payload);
      (this.socket as WebSocket).send(file);
    } else if (this.socket && "emit" in this.socket) {
      (this.socket as SocketIoLikeClient).emit("file", { ...envelope, file });
    } else {
      this.messageQueue.push(payload);
    }
    return undefined;
  }

  private computeUrl() {
    const parsed = new URL(
      this.options.webSocketUrl || this.options.apiUrl,
      typeof window !== "undefined" ? window.location.href : undefined,
    );
    if (!this.options.webSocketUrl) {
      // Auto-derive from API URL: https://api.example.com/chat => wss://api.example.com/chat/ws
      parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
      parsed.pathname = parsed.pathname.replace(/\/$/, "") + "/ws";
    }
    parsed.searchParams.set("sessionId", this.options.sessionId);
    parsed.searchParams.set("clientId", this.options.clientId);
    return parsed.toString();
  }

  private resolveImpl(): WebSocketFactory | null {
    if (this.options.socketIoFactory) {
      // Defer binding until after connect().
      const factory = this.options.socketIoFactory;
      // Wrap socket.io client with a WebSocket-compatible shim so the rest of the
      // class can treat both shapes the same.
      const shim: WebSocketFactory = class {
        private client = factory!("");
        public readyState = WebSocket.CONNECTING;
        constructor(url: string) {
          this.client = factory!(url, { transports: ["websocket"], withCredentials: true });
        }
        close() {
          this.client.disconnect();
        }
        send(payload: string | Blob) {
          this.client.emit("message", payload);
        }
        addEventListener(event: string, cb: (ev: any) => void) {
          this.client.on(event, cb);
        }
        removeEventListener(event: string, cb: (ev: any) => void) {
          this.client.off(event, cb);
        }
        // The widget never relies on other members.
      } as unknown as WebSocketFactory;
      return shim;
    }
    if (this.options.webSocketImpl) return this.options.webSocketImpl;
    if (typeof WebSocket !== "undefined") return WebSocket;
    return null;
  }

  private bindNativeSocket(socket: WebSocket) {
    socket.addEventListener("open", () => {
      this.state = "open";
      this.reconnectAttempt = 0;
      this.handlers.onOpen?.();
      this.flushQueue();
      this.startHeartbeat(socket);
    });
    socket.addEventListener("message", (event) => {
      try {
        const parsed = JSON.parse(event.data as string);
        if (Array.isArray(parsed)) {
          this.handlers.onMessage?.(parsed as ChatMessage[]);
        } else if (parsed?.reply) {
          this.handlers.onMessage?.([
            {
              id: `bot_${Date.now()}`,
              sender: "bot",
              text: parsed.reply,
              createdAt: new Date().toISOString(),
            },
          ]);
        } else {
          this.handlers.onMessage?.(parsed as ChatMessage);
        }
      } catch (err) {
        this.handlers.onError?.(err as Error);
      }
    });
    socket.addEventListener("close", () => {
      this.state = "closed";
      this.handlers.onClose?.();
      this.stopHeartbeat();
      if (!this.closedByUser) {
        this.scheduleReconnect();
      }
    });
    socket.addEventListener("error", (event) => {
      this.state = "error";
      this.handlers.onError?.(
        event instanceof ErrorEvent
          ? new Error(event.message)
          : new Error("WebSocket error"),
      );
      this.scheduleReconnect();
    });
  }

  private startHeartbeat(socket: WebSocket) {
    const interval = this.options.heartbeatMs ?? 30000;
    if (interval <= 0) return;
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "ping", ts: Date.now() }));
      }
    }, interval);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.closedByUser) return;
    const delay = computeBackoff(
      this.reconnectAttempt++,
      this.options.backoffBaseMs ?? 500,
      this.options.backoffMaxMs ?? 15000,
    );
    this.handlers.onTelemetry?.({
      name: "ws_reconnect_scheduled",
      at: Date.now(),
      detail: { attempt: this.reconnectAttempt, delay },
    });
    setTimeout(() => {
      if (!this.closedByUser) {
        void this.connect();
      }
    }, delay);
  }

  private flushQueue() {
    if (!this.socket) return;
    const ws = this.socket as WebSocket;
    while (this.messageQueue.length && ws.readyState === WebSocket.OPEN) {
      const next = this.messageQueue.shift();
      if (next) ws.send(next);
    }
  }
}
