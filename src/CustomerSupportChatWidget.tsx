// src/CustomerSupportChatWidget.tsx
// A minimal-but-complete customer service chat widget in React + TypeScript.
// - Floating launcher button
// - Expandable chat panel
// - Session persistence via localStorage
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
}

/**
 * Shape of the backend chat API request.
 * Adjust this to match your backend contract.
 */
export interface ChatApiRequest {
  sessionId: string;
  message: string;
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
}

/**
 * Local storage key to persist the chat session ID across page loads.
 */
const SESSION_STORAGE_KEY = "cs_chat_session_id_v1";

/**
 * Simple helper to create a session ID.
 * Uses crypto.randomUUID when available, falls back to a timestamp-based ID.
 */
function createSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `session_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/**
 * Retrieves or creates a persistent session ID stored in localStorage.
 */
function getOrCreateSessionId(): string {
  try {
    const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;

    const newId = createSessionId();
    window.localStorage.setItem(SESSION_STORAGE_KEY, newId);
    return newId;
  } catch {
    // If localStorage fails (e.g., disabled), just return a fresh ID each time.
    return createSessionId();
  }
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
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(defaultOpen);
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
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * On mount, ensure we have a stable sessionId.
   */
  useEffect(() => {
    const id = getOrCreateSessionId();
    setSessionId(id);
  }, []);

  /**
   * Add a one-time welcome message when the session is initialized and no
   * history exists. This stays purely client-side so it never competes with
   * server-sent messages and mirrors the admin-configured greeting.
   */
  useEffect(() => {
    if (!welcomeMessage) return;
    if (!sessionId) return;
    if (messages.length > 0) return;
    addMessage("bot", welcomeMessage);
  }, [welcomeMessage, sessionId, messages.length]);

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
    if (!sessionId) return;
    const baseOptions: TransportOptions = {
      apiUrl,
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
      onOpen: () => setConnectionState("open"),
      onClose: (reason) => {
        setConnectionState("closed");
        if (reason) setError(`Connection closed: ${reason}`);
      },
      onError: (err) => {
        setConnectionState("error");
        setError(err.message);
      },
      onMessage: (incoming) => {
        if (Array.isArray(incoming)) {
          setMessages(incoming);
        } else {
          setMessages((prev) => [...prev, incoming]);
        }
      },
      onTelemetry: (event) => {
        transportOverrides?.log?.("transport_event", event as any);
      },
    });
    void instance.connect();
    setTransportInstance(instance);

    return () => {
      void instance.disconnect("component_unmounted");
    };
  }, [sessionId, apiUrl, userIdentifier, uploadUrl, pollIntervalMs, transport, transportOverrides]);

  /**
   * Adds a message to local state.
   */
  const addMessage = (sender: SenderType, text: string) => {
    const newMessage: ChatMessage = {
      id: `${sender}_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      sender,
      text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, newMessage]);
  };

  /**
   * Handles form submission (user sends a message).
   */
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!inputText.trim() || !sessionId || isLoading) return;

    const trimmed = inputText.trim();

    // Optimistically add the user message.
    addMessage("user", trimmed);
    setInputText("");
    setIsLoading(true);
    setError(null);

    try {
      const payload: ChatApiRequest = {
        sessionId,
        message: trimmed,
        userIdentifier,
      };

      let data: ChatApiResponse | void;
      if (transportInstance) {
        data = await transportInstance.send(payload);
      } else {
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(
            `Chat API responded with status ${response.status}: ${response.statusText}`,
          );
        }

        data = (await response.json()) as ChatApiResponse;
      }

      if (data?.reply) {
        // Add the bot's reply message when the transport returns it (polling).
        addMessage("bot", data.reply || "I’m sorry, I didn’t receive a response.");
      }
    } catch (err) {
      console.error("Chat send error:", err);
      setError(
        "I ran into a problem reaching our servers. Please try again in a moment.",
      );
      // Optionally add a bot message for user feedback.
      addMessage(
        "bot",
        "I’m having trouble reaching the support system right now. Please try again shortly or contact us via another channel.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileSelected = async (file: File | null) => {
    if (!file || !sessionId) return;
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
                    {msg.fileUrl ? (
                      <a href={msg.fileUrl} target="_blank" rel="noreferrer">
                        {msg.text || msg.fileName}
                      </a>
                    ) : (
                      msg.text
                    )}
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
              disabled={isLoading || !sessionId}
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
              disabled={isLoading || !sessionId}
            />
            <button
              type="submit"
              className="cs-chat-send-button"
              disabled={isLoading || !sessionId || !inputText.trim()}
            >
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
