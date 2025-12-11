// src/CustomerSupportChatWidget.tsx
// A minimal-but-complete customer service chat widget in React + TypeScript.
// - Floating launcher button
// - Expandable chat panel
// - Session persistence via localStorage + SameSite cookie for backend validation
// - Calls a configurable backend chat API endpoint
// - Simple message list with typing indicator and error handling

import React, { useEffect, useState, useRef, FormEvent, useMemo } from "react";
import "./CustomerSupportChatWidget.css";
import { PollingTransport, PollingTransportOptions } from "./transports/PollingTransport";
import {
  Transport,
  TransportFactory,
  TransportState,
  TransportOptions,
} from "./transports/Transport";
import { WebSocketTransport, WebSocketTransportOptions } from "./transports/WebSocketTransport";
import { BaconPlugin, PluginRunner } from "./plugins/BaconPlugin";
import { PluginProvider } from "./plugins/PluginProvider";
import {
  MessageComponentRegistry,
  defaultMessageRegistry,
  RichMessagePayload,
  RichMessageType,
} from "./messages/registry";
import {
  clientIdentityManager,
  CLIENT_ID_TTL_MS,
  createClientId,
} from "./auth/ClientIdentityManager";

/**
 * Represents who sent a given chat message.
 */
export type SenderType = "user" | "bot";

/**
 * A single chat message in the widget.
 */
export interface ChatMessage {
  id: string;
  sender: SenderType;
  text: string;
  createdAt: string; // ISO string for potential analytics / sorting
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
export interface ChatApiRequest {
  /**
   * Stable, privacy-safe identifier persisted across tabs and sessions. The
   * backend can validate this value via the accompanying cookie/header for
   * additional CSRF/abuse protections.
   */
  clientId: string;
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
export interface ChatApiResponse {
  reply: string;
  // You can add more fields here (e.g., topic, suggestedActions, etc.)
}

/**
 * Props for the CustomerSupportChatWidget component.
 */
export interface CustomerSupportChatWidgetProps {
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
export const CustomerSupportChatWidget: React.FC<
  CustomerSupportChatWidgetProps
> = ({
  apiUrl,
  title = "Support",
  userIdentifier,
  primaryColor = "#2563eb", // Tailwind-ish blue-600
  defaultOpen = false,
  uploadUrl,
  pollIntervalMs = 3000,
  welcomeMessage,
  transport = "polling",
  transportOptions,
  plugins = [],
  messageRegistry,
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(defaultOpen);
  const [clientId, setClientId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [transportInstance, setTransportInstance] = useState<Transport | null>(null);
  const [connectionState, setConnectionState] = useState<TransportState>("idle");
  const transportOverrides = useMemo(
    () => transportOptions || {},
    [transportOptions],
  );
  const registry = useMemo(
    () => messageRegistry || defaultMessageRegistry,
    [messageRegistry],
  );
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pluginRunner = useMemo(
    () =>
      new PluginRunner(plugins, {
        apiUrl,
        clientId: clientId ?? null,
        sessionId: sessionId ?? null,
        transportKind: typeof transport === "string" ? transport : "custom",
        userIdentifier,
        isOpen,
      }),
    [plugins],
  );
  const pluginContext = useMemo(
    () => ({
      apiUrl,
      clientId,
      sessionId,
      transportKind: typeof transport === "string" ? transport : "custom",
      userIdentifier,
      isOpen,
    }),
    [apiUrl, clientId, sessionId, transport, userIdentifier, isOpen],
  );

  useEffect(() => {
    pluginRunner.updateContext({
      apiUrl,
      clientId,
      sessionId,
      transportKind: typeof transport === "string" ? transport : "custom",
      userIdentifier,
      isOpen,
    });
  }, [pluginRunner, apiUrl, clientId, sessionId, transport, userIdentifier, isOpen]);

  useEffect(() => {
    void pluginRunner.init();
    void pluginRunner.notifyMount();
    return () => {
      void pluginRunner.notifyUnmount();
    };
  }, [pluginRunner]);

  useEffect(() => {
    void pluginRunner.notifyOpen(isOpen);
  }, [pluginRunner, isOpen]);

  /**
   * Hydrate a durable, privacy-safe client identifier. The manager writes to
   * both localStorage and SameSite cookies so the backend can validate the
   * caller even when fetch and WebSocket upgrade paths differ. The interval
   * proactively refreshes stale records (TTL/4) to avoid mid-conversation
   * expiration without creating excessive churn.
   */
  useEffect(() => {
    let canceled = false;

    const hydrateIdentity = async () => {
      try {
        const record = await clientIdentityManager.getOrCreateIdentity();
        if (canceled) return;
        setClientId(record.id);
        setSessionId(record.id);
      } catch (err) {
        console.warn("client identity bootstrap failed; falling back", err);
        if (canceled) return;
        const fallback = createClientId();
        setClientId(fallback);
        setSessionId(fallback);
      }
    };

    void hydrateIdentity();
    const refreshPeriod = Math.min(CLIENT_ID_TTL_MS / 4, 2147483647);
    const interval =
      typeof window !== "undefined"
        ? window.setInterval(() => void hydrateIdentity(), refreshPeriod)
        : undefined;

    return () => {
      canceled = true;
      if (interval) window.clearInterval(interval);
    };
  }, []);

  /**
   * Add a one-time welcome message when the session is initialized and no
   * history exists. This stays purely client-side so it never competes with
   * server-sent messages and mirrors the admin-configured greeting.
   */
  useEffect(() => {
    if (!welcomeMessage) return;
    if (!sessionId || !clientId) return;
    if (messages.length > 0) return;
    addMessage("bot", welcomeMessage);
  }, [welcomeMessage, sessionId, clientId, messages.length]);

  /**
   * Automatically scroll to the bottom when messages change.
   */
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  /**
   * Hydrate the transport layer and keep it pinned to the component lifecycle.
   * WebSocket transports will automatically reconnect with backoff; polling
   * transports keep the legacy behavior of periodic fetches. If WebSockets
   * are unavailable (CSP, proxies, or old browsers), the widget gracefully
   * falls back to polling with the same defaults as before.
   */
  useEffect(() => {
    if (!sessionId || !clientId) return;
    const baseOptions: TransportOptions = {
      apiUrl,
      clientId,
      sessionId,
      userIdentifier,
      uploadUrl,
      authToken: transportOverrides?.authToken,
      headers: transportOverrides?.headers,
      log: transportOverrides?.log,
    };

    const buildTransport = (): Transport => {
      if (typeof transport === "function") {
        return transport(baseOptions);
      }
      if (transport === "websocket") {
        try {
          return new WebSocketTransport({
            ...baseOptions,
            ...transportOverrides,
          } as WebSocketTransportOptions);
        } catch (err) {
          console.warn("WebSocket unavailable, falling back to polling", err);
        }
      }
      return new PollingTransport({
        ...baseOptions,
        ...transportOverrides,
        pollIntervalMs: transportOverrides?.pollIntervalMs ?? pollIntervalMs,
      } as PollingTransportOptions);
    };

    const instance = buildTransport();
    instance.setEventHandlers({
      onOpen: () => {
        setConnectionState("open");
        void pluginRunner.notifyConnection({ state: "open" });
      },
      onClose: (reason) => {
        setConnectionState("closed");
        void pluginRunner.notifyConnection({ state: "closed", reason });
        if (reason) setError(`Connection closed: ${reason}`);
      },
      onError: (err) => {
        setConnectionState("error");
        void pluginRunner.notifyConnection({ state: "error", reason: err.message });
        setError(err.message);
      },
      onMessage: async (incoming) => {
        const list = Array.isArray(incoming) ? incoming : [incoming];
        const processed = await pluginRunner.processMessages(list);
        setMessages((prev) => {
          if (Array.isArray(incoming)) return processed;
          return [...prev, ...processed];
        });
      },
      onTelemetry: (event) => {
        transportOverrides?.log?.("transport_event", event as any);
        void pluginRunner.notifyTelemetry(event as any);
      },
    });
    void instance.connect();
    void pluginRunner.notifyConnection({ state: "connecting" });
    setTransportInstance(instance);

    return () => {
      void instance.disconnect("component_unmounted");
    };
  }, [sessionId, clientId, apiUrl, userIdentifier, uploadUrl, pollIntervalMs, transport, transportOverrides]);

  /**
   * Adds a message to local state.
   */
  const addMessage = (sender: SenderType, text: string, extra?: Partial<ChatMessage>) => {
    const newMessage: ChatMessage = {
      id: `${sender}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      sender,
      text,
      createdAt: new Date().toISOString(),
      ...extra,
    };
    setMessages((prev) => [...prev, newMessage]);
  };

  const sendText = async (raw: string) => {
    if (!raw.trim() || !sessionId || !clientId || isLoading) return;

    const trimmed = raw.trim();

    // Optimistically add the user message.
    addMessage("user", trimmed, { type: "text" });
    setInputText("");
    setIsLoading(true);
    setError(null);

    try {
      const payload: ChatApiRequest = {
        clientId,
        sessionId,
        message: trimmed,
        userIdentifier,
      };

      const data = await pluginRunner.send(payload, dispatchPayload);

      if (data?.reply) {
        addMessage("bot", data.reply || "I’m sorry, I didn’t receive a response.", { type: "text" });
      }
    } catch (err) {
      console.error("Chat send error:", err);
      setError(
        "I ran into a problem reaching our servers. Please try again in a moment.",
      );
      addMessage(
        "bot",
        "I’m having trouble reaching the support system right now. Please try again shortly or contact us via another channel.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const dispatchPayload = async (payload: ChatApiRequest): Promise<ChatApiResponse | void> => {
    if (!clientId || !sessionId) {
      throw new Error("client identity not initialized");
    }
    const effectivePayload: ChatApiRequest = {
      clientId,
      sessionId,
      ...payload,
    };
    if (transportInstance) {
      return transportInstance.send(effectivePayload);
    }
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": clientId,
      },
      body: JSON.stringify(effectivePayload),
    });

    if (!response.ok) {
      throw new Error(`Chat API responded with status ${response.status}: ${response.statusText}`);
    }

    return (await response.json()) as ChatApiResponse;
  };

  /**
   * Handles form submission (user sends a message).
   */
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!inputText.trim() || !sessionId || !clientId || isLoading) return;
    const pending = inputText;
    await sendText(pending);
  };

  const handleFileSelected = async (file: File | null) => {
    if (!file || !sessionId || !clientId) return;
    setIsLoading(true);
    setError(null);
    try {
      if (transportInstance?.sendFile) {
        const response = await transportInstance.sendFile(file, {
          ...(userIdentifier || {}),
        });
        if (response) {
          setMessages((prev) => [...prev, response]);
          return;
        }
      }

      const form = new FormData();
      form.append("clientId", clientId);
      form.append("sessionId", sessionId);
      if (userIdentifier) {
        for (const [k, v] of Object.entries(userIdentifier)) {
          form.append(`user_${k}`, String(v));
        }
      }
      form.append("file", file, file.name);

      let target = uploadUrl;
      if (!target) {
        target = apiUrl.endsWith("/chat")
          ? apiUrl.replace(/\/chat$/, "/upload")
          : apiUrl.replace(/\/$/, "") + "/upload";
      }

      const resp = await fetch(target!, { method: "POST", body: form });
      if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
      let fileUrl: string | undefined;
      try {
        const data = await resp.json();
        fileUrl = data?.files?.[0]?.url;
      } catch {}
      const label = `Uploaded file: ${file.name}`;
      if (fileUrl) {
        const message: ChatMessage = {
          id: `user_${Date.now()}_${Math.random().toString(16).slice(2)}`,
          sender: "user",
          text: label,
          createdAt: new Date().toISOString(),
          fileUrl,
          fileName: file.name,
        };
        setMessages((prev) => [...prev, message]);
      } else {
        addMessage("user", label);
      }
    } catch (e) {
      console.error("upload error", e);
      setError("We couldn't upload your file. Please try again.");
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleQuickReply = async (value: string) => {
    await sendText(value);
  };

  /**
   * Basic header subtitle showing user identifier if available.
   */
  const renderSubtitle = () => {
    if (!userIdentifier)
      return "Ask us anything about your account or our services.";
    if (userIdentifier.email) return `Signed in as ${userIdentifier.email}`;
    if (userIdentifier.phone) return `Signed in with ${userIdentifier.phone}`;
    return "Ask us anything about your account or our services.";
  };

  return (
    <PluginProvider plugins={plugins} context={pluginContext} runner={pluginRunner}>
      <div
        className="cs-chat-root"
        style={{ ["--cs-primary" as any]: primaryColor } as React.CSSProperties}
      >
        {/* Floating launcher button */}
        <button
          type="button"
          className="cs-chat-launcher"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-label={isOpen ? "Close support chat" : "Open support chat"}
        >
          {/* Simple icon: chat bubble */}
          <span className="cs-chat-launcher-icon" aria-hidden="true">
            💬
          </span>
        </button>

        {/* Chat panel */}
        {isOpen && (
          <div className="cs-chat-panel">
            <div className="cs-chat-header">
              <div className="cs-chat-header-main">
                <div className="cs-chat-title">{title}</div>
                <div className="cs-chat-subtitle">{renderSubtitle()}</div>
              </div>
              <button
                type="button"
                className="cs-chat-header-close"
                onClick={() => setIsOpen(false)}
                aria-label="Close chat"
              >
                ✕
              </button>
            </div>

            <div className="cs-chat-body">
              {/* Optional error banner */}
              {error && <div className="cs-chat-error">{error}</div>}

              {/* Messages list */}
              <div className="cs-chat-messages">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`cs-chat-message cs-chat-message--${msg.sender}`}
                  >
                    <div className="cs-chat-message-bubble">
                      {registry.render(msg, { onQuickReply: handleQuickReply })}
                    </div>
                  </div>
                ))}

                {/* Typing indicator */}
                {isLoading && (
                  <div className="cs-chat-message cs-chat-message--bot">
                    <div className="cs-chat-message-bubble cs-chat-typing-indicator">
                      <span className="cs-dot" />
                      <span className="cs-dot" />
                      <span className="cs-dot" />
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </div>

            <form className="cs-chat-input-row" onSubmit={handleSubmit}>
              <input
                ref={fileInputRef}
                type="file"
                className="cs-chat-file-input"
                aria-label="Attach file"
                onChange={(e) => handleFileSelected(e.target.files?.[0] || null)}
                style={{ display: "none" }}
              />
              <button
                type="button"
                className="cs-chat-attach-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || !sessionId || !clientId}
                aria-label="Attach a file"
                title="Attach a file"
              >
                📎
              </button>
              <input
                type="text"
                className="cs-chat-input"
                placeholder="Type your message..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={isLoading || !sessionId || !clientId}
              />
              <button
                type="submit"
                className="cs-chat-send-button"
                disabled={isLoading || !sessionId || !clientId || !inputText.trim()}
              >
                Send
              </button>
            </form>
          </div>
        )}
      </div>
    </PluginProvider>
  );
};
