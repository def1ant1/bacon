import { BaconPlugin, BeforeSendResult, SendErrorResult, cloneSafe } from "./BaconPlugin";

function nowIso() {
  return new Date().toISOString();
}

export interface LoggingPluginOptions {
  log?: (event: string, detail?: unknown) => void;
}

export function createLoggingPlugin(options: LoggingPluginOptions = {}): BaconPlugin {
  const logger = options.log ?? ((event, detail) => console.info(`[bacon:${event}]`, detail));
  return {
    name: "logging",
    onInit: (ctx) => logger("init", { ctx }),
    onWidgetOpen: () => logger("ui_open"),
    onWidgetClose: () => logger("ui_close"),
    onConnectionEvent: (meta) => logger("connection", meta),
    onBeforeSend: (payload) => {
      logger("before_send", { payload });
    },
    onAfterSend: (_payload, response) => logger("after_send", { response }),
    onMessages: (messages) => {
      logger("messages", { count: messages.length });
    },
    onTelemetry: (event) => logger("transport_telemetry", event),
    onSendError: (error) => {
      logger("send_error", { error: error instanceof Error ? error.message : String(error) });
    },
  };
}

export interface TracingPluginOptions {
  traceIdFactory?: () => string;
}

export function createTracingPlugin(options: TracingPluginOptions = {}): BaconPlugin {
  const makeTraceId = options.traceIdFactory ?? (() => crypto.randomUUID?.() ?? `trace_${Date.now()}`);
  return {
    name: "tracing",
    onBeforeSend: (payload, ctx): BeforeSendResult => {
      const traceId = makeTraceId();
      const enriched = cloneSafe(payload);
      enriched.metadata = { ...(enriched.metadata ?? {}), traceId, sentAt: nowIso() };
      return { payload: enriched };
    },
    onAfterSend: (_payload, _response, ctx) => {
      console.debug(`[trace] completed send for ${ctx.sessionId}`);
    },
    onMessages: (messages): { messages: typeof messages } => {
      return { messages: messages.map((m) => ({ ...m, metadata: { ...(m as any).metadata } })) };
    },
  };
}

export interface AuthTokenRefresherOptions {
  /** Acquire a new token when the plugin decides to refresh. */
  fetchToken: () => Promise<string>;
  /** Whether a given error warrants a retry. Defaults to 401 detection. */
  shouldRefresh?: (error: unknown) => boolean;
}

export function createAuthTokenRefresherPlugin(
  options: AuthTokenRefresherOptions,
): BaconPlugin {
  const shouldRefresh =
    options.shouldRefresh ?? ((error: unknown) => (error as Error)?.message?.includes("401"));
  let cachedToken: string | null = null;

  const injectToken = async (payload: any): Promise<BeforeSendResult> => {
    if (!cachedToken) {
      cachedToken = await options.fetchToken();
    }
    const next = cloneSafe(payload);
    next.metadata = { ...(next.metadata ?? {}), authToken: cachedToken };
    return { payload: next };
  };

  return {
    name: "auth_token_refresher",
    onBeforeSend: (payload) => injectToken(payload),
    onSendError: async (error, payload): Promise<SendErrorResult> => {
      if (!shouldRefresh(error)) return {};
      cachedToken = await options.fetchToken();
      const next = cloneSafe(payload);
      next.metadata = { ...(next.metadata ?? {}), authToken: cachedToken, refreshedAt: nowIso() };
      return { retry: true, payload: next, waitMs: 50 };
    },
  };
}
