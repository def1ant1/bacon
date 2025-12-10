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

export interface PollingTransportOptions extends TransportOptions {
  pollIntervalMs?: number;
  /** Optional long-poll timeout to keep connections hot. */
  longPollTimeoutMs?: number;
  /** Backoff settings for retry-after-failure. */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

/**
 * Polling transport preserves the previous fetch-based behavior while adding
 * structured lifecycle hooks, retry/backoff semantics, and telemetry points.
 * The widget treats this as the default, zero-dependency transport.
 */
export class PollingTransport implements Transport {
  public readonly name = "polling" as const;
  public state: TransportState = "idle";
  private handlers: TransportEventHandlers = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private attempt = 0;

  constructor(private options: PollingTransportOptions) {}

  setEventHandlers(handlers: TransportEventHandlers): void {
    this.handlers = handlers;
  }

  async connect(): Promise<void> {
    if (this.state === "open" || this.state === "connecting") return;
    this.stopped = false;
    this.state = "connecting";
    this.handlers.onTelemetry?.({
      name: "polling_connect",
      at: Date.now(),
      detail: { apiUrl: this.options.apiUrl },
    });
    this.schedulePoll(0);
  }

  async disconnect(reason?: string): Promise<void> {
    this.stopped = true;
    this.state = "closed";
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.handlers.onClose?.(reason);
  }

  async send(payload: ChatApiRequest): Promise<ChatApiResponse | void> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.options.headers,
    };
    if (this.options.authToken) {
      headers["Authorization"] = `Bearer ${this.options.authToken}`;
    }
    const response = await fetch(this.options.apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const error = new Error(
        `Chat API responded with status ${response.status}: ${response.statusText}`,
      );
      this.handlers.onError?.(error);
      throw error;
    }
    const data = (await response.json()) as ChatApiResponse;
    this.handlers.onTelemetry?.({ name: "polling_send", at: Date.now() });
    return data;
  }

  async sendFile(
    file: File,
    metadata?: Record<string, string>,
  ): Promise<ChatMessage | undefined> {
    const form = new FormData();
    form.append("sessionId", this.options.sessionId);
    if (metadata) {
      for (const [k, v] of Object.entries(metadata)) {
        form.append(k, v);
      }
    }
    form.append("file", file, file.name);
    const uploadUrl =
      this.options.uploadUrl || this.options.apiUrl.replace(/\/chat$/, "/upload");
    const response = await fetch(uploadUrl, { method: "POST", body: form });
    if (!response.ok) {
      const error = new Error(`Upload failed: ${response.status}`);
      this.handlers.onError?.(error);
      throw error;
    }
    try {
      const parsed = await response.json();
      const url = parsed?.files?.[0]?.url;
      if (url) {
        return {
          id: `user_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          sender: "user",
          text: `Uploaded file: ${file.name}`,
          createdAt: new Date().toISOString(),
          fileUrl: url,
          fileName: file.name,
        };
      }
    } catch (e) {
      this.handlers.onTelemetry?.({
        name: "polling_upload_parse_failure",
        at: Date.now(),
        detail: { error: (e as Error).message },
      });
    }
    return undefined;
  }

  private schedulePoll(delay: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.poll();
    }, delay);
  }

  private async poll() {
    if (this.stopped) return;
    const interval = this.options.pollIntervalMs ?? 3000;
    const abort = new AbortController();
    const timeout = this.options.longPollTimeoutMs ?? interval;
    const timer = setTimeout(() => abort.abort(), timeout);
    const messagesUrl = this.options.apiUrl.endsWith("/chat")
      ? this.options.apiUrl
      : this.options.apiUrl.replace(/\/$/, "") + "/chat";
    try {
      const res = await fetch(
        `${messagesUrl}?sessionId=${encodeURIComponent(this.options.sessionId)}`,
        {
          signal: abort.signal,
          headers: this.buildHeaders(),
        },
      );
      clearTimeout(timer);
      if (!res.ok) throw new Error(`Polling failed: ${res.status}`);
      const list = (await res.json()) as ChatMessage[];
      this.state = "open";
      this.attempt = 0;
      this.handlers.onOpen?.();
      this.handlers.onMessage?.(Array.isArray(list) ? list : []);
      this.handlers.onTelemetry?.({ name: "polling_tick", at: Date.now() });
      this.schedulePoll(interval);
    } catch (err) {
      clearTimeout(timer);
      this.state = "error";
      const detail = err instanceof Error ? err.message : String(err);
      this.handlers.onError?.(err as Error);
      this.handlers.onTelemetry?.({
        name: "polling_retry_scheduled",
        at: Date.now(),
        detail: { attempt: this.attempt + 1, error: detail },
      });
      const delay = computeBackoff(
        this.attempt++,
        this.options.backoffBaseMs ?? 1000,
        this.options.backoffMaxMs ?? 30000,
      );
      this.schedulePoll(delay);
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...(this.options.headers || {}) };
    if (this.options.authToken) {
      headers["Authorization"] = `Bearer ${this.options.authToken}`;
    }
    return headers;
  }
}
