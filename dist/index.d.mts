import React from 'react';
import * as react_jsx_runtime from 'react/jsx-runtime';

/**
 * Core transport lifecycle states. The widget uses these to emit UX hints
 * (e.g., reconnecting banners) and to avoid sending messages while a
 * connection is offline.
 */
type TransportState = "idle" | "connecting" | "open" | "closed" | "error";
/**
 * Lightweight telemetry event emitted by transports for observability.
 * This intentionally stays generic so it can be forwarded to your preferred
 * logging/metrics system without pulling heavy dependencies into the widget
 * bundle.
 */
interface TransportTelemetryEvent {
    name: string;
    detail?: Record<string, unknown>;
    at: number;
}
/**
 * Event hooks that the widget provides to each transport implementation.
 * Implementations must call these hooks rather than touching UI state to
 * keep the transport layer framework-agnostic and easily testable.
 */
interface TransportEventHandlers {
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
interface TransportOptions {
    apiUrl: string;
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
interface Transport {
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
    sendFile?: (file: File, metadata?: Record<string, string>) => Promise<ChatMessage | undefined>;
}
/** Factory signature the widget can use to defer transport creation. */
type TransportFactory = (options: TransportOptions) => Transport;
/**
 * Helper for exponential backoff with jitter. Keeps transport implementations
 * lean and consistent.
 */
declare function computeBackoff(attempt: number, baseMs: number, maxMs: number): number;

interface PollingTransportOptions extends TransportOptions {
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
declare class PollingTransport implements Transport {
    private options;
    readonly name: "polling";
    state: TransportState;
    private handlers;
    private timer;
    private stopped;
    private attempt;
    constructor(options: PollingTransportOptions);
    setEventHandlers(handlers: TransportEventHandlers): void;
    connect(): Promise<void>;
    disconnect(reason?: string): Promise<void>;
    send(payload: ChatApiRequest): Promise<ChatApiResponse | void>;
    sendFile(file: File, metadata?: Record<string, string>): Promise<ChatMessage | undefined>;
    private schedulePoll;
    private poll;
    private buildHeaders;
}

interface WebSocketFactory {
    new (url: string, protocols?: string | string[]): WebSocket;
}
interface SocketIoLikeClient {
    on(event: string, callback: (...args: any[]) => void): this;
    off(event: string, callback?: (...args: any[]) => void): this;
    emit(event: string, payload: unknown): this;
    close(): void;
    disconnect(): void;
    connect(): void;
}
interface WebSocketTransportOptions extends TransportOptions {
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
declare class WebSocketTransport implements Transport {
    private options;
    readonly name: "websocket";
    state: TransportState;
    private handlers;
    private socket;
    private reconnectAttempt;
    private heartbeatTimer;
    private closedByUser;
    private messageQueue;
    constructor(options: WebSocketTransportOptions);
    setEventHandlers(handlers: TransportEventHandlers): void;
    connect(): Promise<void>;
    disconnect(reason?: string): Promise<void>;
    send(payload: ChatApiRequest): Promise<ChatApiResponse | void>;
    sendFile(file: File, metadata?: Record<string, string>): Promise<ChatMessage | undefined>;
    private computeUrl;
    private resolveImpl;
    private bindNativeSocket;
    private startHeartbeat;
    private stopHeartbeat;
    private scheduleReconnect;
    private flushQueue;
}

/**
 * Runtime context shared with every plugin invocation. Plugins must treat this
 * structure as immutable and should never mutate nested objects in place;
 * instead, return an updated copy when changes are required. The runner will
 * deep-clone payloads/messages between plugins to prevent accidental
 * cross-plugin mutation.
 */
interface PluginRuntimeContext {
    readonly apiUrl: string;
    readonly sessionId: string | null;
    readonly transportKind: string;
    readonly userIdentifier?: Record<string, string>;
    readonly isOpen: boolean;
}
interface BeforeSendResult {
    payload?: ChatApiRequest;
    /** Allows a plugin to short-circuit network IO entirely. */
    response?: ChatApiResponse | void;
    /** If true, the send operation is aborted without surfacing an error. */
    abort?: boolean;
}
interface SendErrorResult {
    /**
     * Request a retry. The runner caps retries to avoid infinite loops; callers
     * can optionally provide a delay or mutated payload for the retry attempt.
     */
    retry?: boolean;
    waitMs?: number;
    payload?: ChatApiRequest;
}
interface IncomingMessageResult {
    messages?: ChatMessage[];
}
interface ConnectionEventMeta {
    state: "idle" | "connecting" | "open" | "closed" | "error";
    reason?: string;
}
interface BaconPlugin {
    /** Stable identifier for debugging and telemetry. */
    name: string;
    onInit?(ctx: PluginRuntimeContext): void | Promise<void>;
    onWidgetMount?(ctx: PluginRuntimeContext): void | Promise<void>;
    onWidgetUnmount?(ctx: PluginRuntimeContext): void | Promise<void>;
    onWidgetOpen?(ctx: PluginRuntimeContext): void | Promise<void>;
    onWidgetClose?(ctx: PluginRuntimeContext): void | Promise<void>;
    onConnectionEvent?(meta: ConnectionEventMeta, ctx: PluginRuntimeContext): void | Promise<void>;
    onBeforeSend?(payload: ChatApiRequest, ctx: PluginRuntimeContext): void | BeforeSendResult | Promise<void | BeforeSendResult>;
    onAfterSend?(payload: ChatApiRequest, response: ChatApiResponse | void, ctx: PluginRuntimeContext): void | Promise<void>;
    onSendError?(error: unknown, payload: ChatApiRequest, ctx: PluginRuntimeContext): void | SendErrorResult | Promise<void | SendErrorResult>;
    onMessages?(messages: ChatMessage[], ctx: PluginRuntimeContext): void | IncomingMessageResult | Promise<void | IncomingMessageResult>;
    onTelemetry?(event: Record<string, unknown>, ctx: PluginRuntimeContext): void | Promise<void>;
}
/**
 * Deep clone helper that prefers structuredClone when available for safety. The
 * runner clones payloads before handing them to plugins to ensure no plugin can
 * mutate another plugin's view of the data.
 */
declare function cloneSafe<T>(value: T): T;
declare class AbortSendError extends Error {
    constructor();
}
/**
 * Central orchestrator for plugin execution. Each hook is executed serially to
 * preserve ordering guarantees, and every invocation is wrapped in a try/catch
 * so plugin failures are isolated and reported without impacting the caller.
 */
declare class PluginRunner {
    private plugins;
    private ctx;
    constructor(plugins: BaconPlugin[], ctx: PluginRuntimeContext);
    updateContext(partial: Partial<PluginRuntimeContext>): void;
    init(): Promise<void>;
    notifyMount(): Promise<void>;
    notifyUnmount(): Promise<void>;
    notifyOpen(isOpen: boolean): Promise<void>;
    notifyConnection(meta: ConnectionEventMeta): Promise<void>;
    notifyTelemetry(event: Record<string, unknown>): Promise<void>;
    processMessages(incoming: ChatMessage[]): Promise<ChatMessage[]>;
    /**
     * Executes the send pipeline with plugin hooks and retry semantics. The
     * caller provides the actual network send implementation so this runner stays
     * transport-agnostic.
     */
    send(payload: ChatApiRequest, dispatcher: (payload: ChatApiRequest) => Promise<ChatApiResponse | void>): Promise<ChatApiResponse | void>;
    private handleSendError;
    private run;
}

type RichMessageType = "text" | "card" | "product" | "survey" | "quick_replies" | (string & {});
interface RichMessagePayload {
    title?: string;
    body?: string;
    imageUrl?: string;
    actions?: {
        label: string;
        value: string;
        url?: string;
    }[];
    data?: Record<string, unknown>;
}
type MessageRenderer = (message: ChatMessage, helpers: {
    onQuickReply?: (value: string) => void;
}) => React.ReactNode;
declare class MessageComponentRegistry {
    private renderers;
    register(type: string, renderer: MessageRenderer): void;
    render(message: ChatMessage, helpers?: {
        onQuickReply?: (value: string) => void;
    }): string | number | boolean | Iterable<React.ReactNode> | react_jsx_runtime.JSX.Element | null | undefined;
    private renderFallback;
}

/**
 * Represents who sent a given chat message.
 */
type SenderType = "user" | "bot";
/**
 * A single chat message in the widget.
 */
interface ChatMessage {
    id: string;
    sender: SenderType;
    text: string;
    createdAt: string;
    fileUrl?: string;
    fileName?: string;
    metadata?: Record<string, unknown>;
    type?: RichMessageType;
    payload?: RichMessagePayload;
}
/**
 * Shape of the backend chat API request.
 * Adjust this to match your backend contract.
 */
interface ChatApiRequest {
    sessionId: string;
    message: string;
    metadata?: Record<string, unknown>;
    /**
     * Optional identifier to help backend look up CRM records.
     * Example: { email: "user@example.com" }.
     */
    userIdentifier?: Record<string, string>;
}
/**
 * Shape of the backend chat API response.
 * Adjust this to match your backend contract.
 */
interface ChatApiResponse {
    reply: string;
}
/**
 * Props for the CustomerSupportChatWidget component.
 */
interface CustomerSupportChatWidgetProps {
    /**
     * Base URL for the chat backend.
     * Example: "/api/chat" or "https://api.yourdomain.com/chat".
     */
    apiUrl: string;
    uploadUrl?: string;
    /**
     * Optional brand or client name to show in header.
     * Example: "ClientCo Support".
     */
    title?: string;
    /**
     * Optional object with known user identifiers (e.g., logged-in user).
     * This will be sent to the backend so it can search/review the CRM.
     * Example: { email: "user@example.com", phone: "+15551234567" }.
     */
    userIdentifier?: Record<string, string>;
    /**
     * Primary accent color for the widget (CSS color value).
     * Used for header background and launcher button.
     */
    primaryColor?: string;
    /**
     * Optional flag to start with the chat panel open.
     */
    defaultOpen?: boolean;
    /**
     * Optional welcome/intro message that appears when a session is first created
     * and no other history exists. Useful for surfacing admin-configured greetings
     * so users always see the expected onboarding copy.
     */
    welcomeMessage?: string;
    /**
     * Optional polling interval (ms) to sync messages from the server.
     * Defaults to 3000ms. Set to 0 to disable.
     */
    pollIntervalMs?: number;
    /**
     * Optional transport selector. Defaults to "polling" to preserve the
     * previous fetch-based behavior, but can be set to "websocket" or a custom
     * TransportFactory for enterprise deployments (e.g., mutual TLS gateways,
     * message buses, or proprietary network stacks).
     */
    transport?: "polling" | "websocket" | TransportFactory;
    /**
     * Extended configuration passed directly to transports. This supports
     * hardened defaults like TLS-only URLs, auth token injection, rate limits,
     * or socket.io factories without bloating the public API surface. Values
     * here override the top-level props where applicable.
     */
    transportOptions?: Partial<PollingTransportOptions & WebSocketTransportOptions>;
    /**
     * Optional plugins that can extend the widget lifecycle with observability,
     * retries, metadata injection, or UI analytics. Plugins are executed in
     * array order with isolation guarantees and never mutate upstream objects in
     * place.
     */
    plugins?: BaconPlugin[];
    /**
     * Optional registry to control how rich message types render inside the widget.
     */
    messageRegistry?: MessageComponentRegistry;
}
/**
 * Main customer support chat widget component.
 */
declare const CustomerSupportChatWidget: React.FC<CustomerSupportChatWidgetProps>;

interface PluginProviderProps {
    plugins?: BaconPlugin[];
    context: PluginRuntimeContext;
    runner?: PluginRunner;
    children: React.ReactNode;
}
declare const PluginProvider: React.FC<PluginProviderProps>;
declare function usePluginRunner(): PluginRunner | null;

interface LoggingPluginOptions {
    log?: (event: string, detail?: unknown) => void;
}
declare function createLoggingPlugin(options?: LoggingPluginOptions): BaconPlugin;
interface TracingPluginOptions {
    traceIdFactory?: () => string;
}
declare function createTracingPlugin(options?: TracingPluginOptions): BaconPlugin;
interface AuthTokenRefresherOptions {
    /** Acquire a new token when the plugin decides to refresh. */
    fetchToken: () => Promise<string>;
    /** Whether a given error warrants a retry. Defaults to 401 detection. */
    shouldRefresh?: (error: unknown) => boolean;
}
declare function createAuthTokenRefresherPlugin(options: AuthTokenRefresherOptions): BaconPlugin;

interface ConversationSummary {
    id: string;
    /** Human-readable label derived from conversation subject or participant name. */
    title: string;
    /** Optional participant string when title is system-generated. */
    participantLabel?: string;
    /** ISO timestamp of the last activity for ordering. */
    lastMessageAt: string;
    /** Short preview of the trailing message for quick scanning. */
    lastMessagePreview?: string;
    /** True when the conversation contains unread content for the current agent. */
    unread?: boolean;
}
interface ConversationPage {
    conversations: ConversationSummary[];
    /** Cursor provided by the server to fetch the next slice; undefined means the end. */
    nextCursor?: string;
}
interface ConversationServiceOptions {
    /** Base URL for the conversation API (e.g., "/api/conversations"). */
    baseUrl: string;
    /** Optional page size hint; the server remains the source of truth. */
    pageSize?: number;
    /**
     * Maximum retry attempts for transient failures. Defaults to 3 to keep API
     * load manageable while still handling noisy networks.
     */
    maxRetries?: number;
    /**
     * Minimum backoff delay in milliseconds between retries. Defaults to 300ms
     * and scales exponentially to avoid stampeding the API during outages.
     */
    retryBackoffMs?: number;
}

/**
 * Centralized, cache-aware data service that streams conversation pages with
 * cancellation and retry support. It is intentionally framework-agnostic so it
 * can be used inside React components, background sync workers, or Node
 * scripts. Extensive comments capture operational edge cases for future
 * maintainers.
 */
declare class ConversationDataService {
    private readonly baseUrl;
    private readonly pageSize?;
    private readonly maxRetries;
    private readonly retryBackoffMs;
    private readonly cache;
    private readonly inflight;
    constructor(options: ConversationServiceOptions);
    /**
     * Returns a cached page when available. We cache each cursor separately to
     * avoid pagination gaps when multiple UI elements request different slices.
     */
    getCachedPage(cursor?: string): ConversationPage | undefined;
    /**
     * Attempts to cancel any inflight request for the provided cursor. This is
     * especially helpful when the UI unmounts or when rapid scrolling triggers
     * superseded fetches.
     */
    cancel(cursor?: string): void;
    /**
     * Clears all cached pages. Useful when a user changes workspaces/tenants and
     * stale data must be flushed without reloading the page.
     */
    reset(): void;
    /**
     * Fetches a single page of conversations with retries and caching. Requests
     * for the same cursor are deduplicated so concurrent callers share the same
     * network response. Consumers receive a fresh object to avoid accidental
     * mutation of cache entries.
     */
    fetchPage(cursor?: string, signal?: AbortSignal): Promise<ConversationPage>;
    /**
     * Internal helper to compose multiple AbortSignals without requiring
     * AbortSignal.any (which is still experimental in some browsers). We also add
     * generous documentation so future refactors preserve cancellation behavior.
     */
    private mergeSignals;
    private fetchWithRetry;
    private delay;
}
declare function sortConversations(conversations: ConversationSummary[]): ConversationSummary[];

interface ConversationSidebarProps {
    service: ConversationDataService;
    selectedConversationId?: string;
    onSelectConversation?: (conversationId: string) => void;
    title?: string;
}
/**
 * ConversationSidebar presents an infinitely-scrollable list of conversations
 * with strong keyboard/a11y support and low-friction loading/error states. It
 * keeps the visual layer thin by deferring caching/retry/cancellation to the
 * ConversationDataService + useConversationFeed hook.
 */
declare const ConversationSidebar: React.FC<ConversationSidebarProps>;

/**
 * React hook that wraps the ConversationDataService with view-friendly state
 * (loading/error flags) plus incremental pagination helpers. The hook is
 * intentionally defensive: it cancels inflight requests on unmount and uses
 * stable callbacks so scroll listeners can be attached without churn.
 */
declare function useConversationFeed(service: ConversationDataService, initialCursor?: string): {
    conversations: ConversationSummary[];
    pages: ConversationPage[];
    loading: boolean;
    error: Error | undefined;
    hasMore: boolean;
    loadMore: () => void;
    retry: () => void;
};

export { AbortSendError, type AuthTokenRefresherOptions, type BaconPlugin, type BeforeSendResult, type ChatApiRequest, type ChatApiResponse, type ChatMessage, type ConnectionEventMeta, ConversationDataService, type ConversationPage, type ConversationServiceOptions, ConversationSidebar, type ConversationSidebarProps, type ConversationSummary, CustomerSupportChatWidget, type CustomerSupportChatWidgetProps, type IncomingMessageResult, type LoggingPluginOptions, PluginProvider, type PluginProviderProps, PluginRunner, type PluginRuntimeContext, PollingTransport, type PollingTransportOptions, type SendErrorResult, type SenderType, type SocketIoLikeClient, type TracingPluginOptions, type Transport, type TransportEventHandlers, type TransportFactory, type TransportOptions, type TransportState, type TransportTelemetryEvent, type WebSocketFactory, WebSocketTransport, type WebSocketTransportOptions, cloneSafe, computeBackoff, createAuthTokenRefresherPlugin, createLoggingPlugin, createTracingPlugin, sortConversations, useConversationFeed, usePluginRunner };
