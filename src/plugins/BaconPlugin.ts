import { ChatApiRequest, ChatApiResponse, ChatMessage } from "../CustomerSupportChatWidget";

/**
 * Runtime context shared with every plugin invocation. Plugins must treat this
 * structure as immutable and should never mutate nested objects in place;
 * instead, return an updated copy when changes are required. The runner will
 * deep-clone payloads/messages between plugins to prevent accidental
 * cross-plugin mutation.
 */
export interface PluginRuntimeContext {
  readonly apiUrl: string;
  readonly sessionId: string | null;
  readonly transportKind: string;
  readonly userIdentifier?: Record<string, string>;
  readonly isOpen: boolean;
}

export interface BeforeSendResult {
  payload?: ChatApiRequest;
  /** Allows a plugin to short-circuit network IO entirely. */
  response?: ChatApiResponse | void;
  /** If true, the send operation is aborted without surfacing an error. */
  abort?: boolean;
}

export interface SendErrorResult {
  /**
   * Request a retry. The runner caps retries to avoid infinite loops; callers
   * can optionally provide a delay or mutated payload for the retry attempt.
   */
  retry?: boolean;
  waitMs?: number;
  payload?: ChatApiRequest;
}

export interface IncomingMessageResult {
  messages?: ChatMessage[];
}

export interface ConnectionEventMeta {
  state: "idle" | "connecting" | "open" | "closed" | "error";
  reason?: string;
}

export interface BaconPlugin {
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
export function cloneSafe<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

const MAX_RETRIES = 2;

export class AbortSendError extends Error {
  constructor() {
    super("send_aborted_by_plugin");
  }
}

/**
 * Central orchestrator for plugin execution. Each hook is executed serially to
 * preserve ordering guarantees, and every invocation is wrapped in a try/catch
 * so plugin failures are isolated and reported without impacting the caller.
 */
export class PluginRunner {
  constructor(private plugins: BaconPlugin[], private ctx: PluginRuntimeContext) {}

  updateContext(partial: Partial<PluginRuntimeContext>) {
    this.ctx = { ...this.ctx, ...partial };
  }

  async init() {
    await this.run("onInit");
  }

  async notifyMount() {
    await this.run("onWidgetMount");
  }

  async notifyUnmount() {
    await this.run("onWidgetUnmount");
  }

  async notifyOpen(isOpen: boolean) {
    await this.run(isOpen ? "onWidgetOpen" : "onWidgetClose");
  }

  async notifyConnection(meta: ConnectionEventMeta) {
    await this.run("onConnectionEvent", meta);
  }

  async notifyTelemetry(event: Record<string, unknown>) {
    await this.run("onTelemetry", cloneSafe(event));
  }

  async processMessages(incoming: ChatMessage[]): Promise<ChatMessage[]> {
    let current = cloneSafe(incoming);
    for (const plugin of this.plugins) {
      if (!plugin.onMessages) continue;
      try {
        const next = await plugin.onMessages(cloneSafe(current), this.ctx);
        if (next?.messages) current = cloneSafe(next.messages);
      } catch (err) {
        console.warn(`[plugin:${plugin.name}] onMessages failed`, err);
      }
    }
    return current;
  }

  /**
   * Executes the send pipeline with plugin hooks and retry semantics. The
   * caller provides the actual network send implementation so this runner stays
   * transport-agnostic.
   */
  async send(
    payload: ChatApiRequest,
    dispatcher: (payload: ChatApiRequest) => Promise<ChatApiResponse | void>,
  ): Promise<ChatApiResponse | void> {
    let currentPayload = cloneSafe(payload);
    let retries = 0;

    const applyBeforeSend = async () => {
      let working = currentPayload;
      for (const plugin of this.plugins) {
        if (!plugin.onBeforeSend) continue;
        try {
          const result = await plugin.onBeforeSend(cloneSafe(working), this.ctx);
          if (result?.abort) throw new AbortSendError();
          if (result?.payload) working = cloneSafe(result.payload);
          if (result?.response !== undefined) return { shortCircuit: result.response };
        } catch (err) {
          if (err instanceof AbortSendError) throw err;
          console.warn(`[plugin:${plugin.name}] onBeforeSend failed`, err);
        }
      }
      currentPayload = working;
      return { shortCircuit: undefined as ChatApiResponse | void | undefined };
    };

    while (retries <= MAX_RETRIES) {
      let before;
      try {
        before = await applyBeforeSend();
      } catch (err) {
        if (err instanceof AbortSendError) {
          await this.run("onAfterSend", currentPayload, undefined);
          return;
        }
        throw err;
      }
      if (before.shortCircuit !== undefined) {
        await this.run("onAfterSend", currentPayload, before.shortCircuit);
        return before.shortCircuit;
      }

      try {
        const response = await dispatcher(currentPayload);
        await this.run("onAfterSend", currentPayload, response);
        return response;
      } catch (err) {
        if (err instanceof AbortSendError) throw err;
        const retryDirective = await this.handleSendError(err, currentPayload);
        if (retryDirective.retry && retries < MAX_RETRIES) {
          retries += 1;
          if (retryDirective.payload) currentPayload = cloneSafe(retryDirective.payload);
          if (retryDirective.waitMs && retryDirective.waitMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, retryDirective.waitMs));
          }
          continue;
        }
        throw err;
      }
    }
    throw new Error("Max retries exceeded");
  }

  private async handleSendError(error: unknown, payload: ChatApiRequest): Promise<SendErrorResult> {
    let directive: SendErrorResult = {};
    for (const plugin of this.plugins) {
      if (!plugin.onSendError) continue;
      try {
        const next = await plugin.onSendError(cloneSafe(payload), error, this.ctx);
        if (next?.retry) directive = { ...directive, ...next };
      } catch (err) {
        console.warn(`[plugin:${plugin.name}] onSendError failed`, err);
      }
    }
    return directive;
  }

  private async run(
    hook: keyof BaconPlugin,
    ...args: Array<unknown>
  ): Promise<void> {
    for (const plugin of this.plugins) {
      const fn = plugin[hook] as ((...a: unknown[]) => unknown) | undefined;
      if (!fn) continue;
      try {
        await fn.apply(plugin, [...args, this.ctx]);
      } catch (err) {
        console.warn(`[plugin:${plugin.name}] ${String(hook)} failed`, err);
      }
    }
  }
}
