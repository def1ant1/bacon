import { ChatApiRequest, ChatApiResponse, ChatMessage } from "../CustomerSupportChatWidget";

/**
 * Core transport lifecycle states. The widget uses these to emit UX hints
 * (e.g., reconnecting banners) and to avoid sending messages while a
 * connection is offline.
 */
export type TransportState = "idle" | "connecting" | "open" | "closed" | "error";

/**
 * Lightweight telemetry event emitted by transports for observability.
 * This intentionally stays generic so it can be forwarded to your preferred
 * logging/metrics system without pulling heavy dependencies into the widget
 * bundle.
 */
export interface TransportTelemetryEvent {
  name: string;
  detail?: Record<string, unknown>;
  at: number;
}

/**
 * Event hooks that the widget provides to each transport implementation.
 * Implementations must call these hooks rather than touching UI state to
 * keep the transport layer framework-agnostic and easily testable.
 */
export interface TransportEventHandlers {
  onOpen?: () => void;
  onClose?: (reason?: string) => void;
  onError?: (error: Error) => void;
  /**
   * Called when the transport receives new messages from the server. Most
   * transports will emit the server's canonical list for simplicity, but
   * they may also emit single deltas (e.g., WebSocket push messages). The
   * widget merges appropriately.
   */
  onMessage?: (message: ChatMessage | ChatMessage[]) => void;
  onTelemetry?: (event: TransportTelemetryEvent) => void;
}

/**
 * Common options available to all transports. Individual transports can
 * extend this with additional knobs (e.g., polling interval or socket
 * configuration), but keeping a single shared shape makes it easier for the
 * widget to swap transports transparently.
 */
export interface TransportOptions {
  apiUrl: string;
  clientId: string;
  sessionId: string;
  userIdentifier?: Record<string, string>;
  /** Optional upload endpoint for file-based channels. */
  uploadUrl?: string;
  /** Optional bearer token or other credential material. */
  authToken?: string;
  /** Static headers to add to every request. */
  headers?: Record<string, string>;
  /** Optional logger for production hardening. */
  log?: (message: string, detail?: Record<string, unknown>) => void;
}

/**
 * Contract for all widget transports. Implementations should be resilient
 * (retry/backoff), side-effect free outside of provided hooks, and able to
 * cleanly tear down timers/sockets on disconnect to avoid leaks.
 */
export interface Transport {
  readonly name: string;
  readonly state: TransportState;
  setEventHandlers(handlers: TransportEventHandlers): void;
  connect(): Promise<void>;
  disconnect(reason?: string): Promise<void>;
  /**
   * Send a user text payload to the server. The transport returns whatever
   * the backend responds with so the caller can surface optimistic updates.
   */
  send(payload: ChatApiRequest): Promise<ChatApiResponse | void>;
  /** Optional binary upload pathway for richer channels. */
  sendFile?: (
    file: File,
    metadata?: Record<string, string>,
  ) => Promise<ChatMessage | undefined>;
}

/** Factory signature the widget can use to defer transport creation. */
export type TransportFactory = (options: TransportOptions) => Transport;

/**
 * Helper for exponential backoff with jitter. Keeps transport implementations
 * lean and consistent.
 */
export function computeBackoff(
  attempt: number,
  baseMs: number,
  maxMs: number,
): number {
  const capped = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  const jitter = Math.random() * 0.25 * capped;
  return Math.round(capped * 0.75 + jitter);
}
