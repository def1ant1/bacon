import React from "react";
import { ChatMessage } from "../CustomerSupportChatWidget";

export type RichMessageType =
  | "text"
  | "card"
  | "product"
  | "survey"
  | "quick_replies"
  | (string & {});

export interface RichMessagePayload {
  title?: string;
  body?: string;
  imageUrl?: string;
  actions?: { label: string; value: string; url?: string }[];
  data?: Record<string, unknown>;
}

export type MessageRenderer = (
  message: ChatMessage,
  helpers: { onQuickReply?: (value: string) => void },
) => React.ReactNode;

export class MessageComponentRegistry {
  private renderers = new Map<string, MessageRenderer>();

  register(type: string, renderer: MessageRenderer) {
    this.renderers.set(type, renderer);
  }

  render(message: ChatMessage, helpers: { onQuickReply?: (value: string) => void } = {}) {
    const renderer = message.type ? this.renderers.get(message.type) : undefined;
    if (renderer) return renderer(message, helpers);
    return this.renderFallback(message);
  }

  private renderFallback(message: ChatMessage) {
    if (message.fileUrl) {
      return (
        <a href={message.fileUrl} target="_blank" rel="noreferrer">
          {message.text || message.fileName}
        </a>
      );
    }
    return <span>{message.text}</span>;
  }
}

const QuickReplies: MessageRenderer = (message, helpers) => {
  return (
    <div className="cs-quick-replies" role="group" aria-label="Suggested replies">
      {message.text && <div className="cs-chat-message-text">{message.text}</div>}
      <div className="cs-quick-replies-list">
        {(message.payload?.actions || []).map((action) => (
          <button
            key={`${message.id}_${action.value}`}
            className="cs-quick-reply"
            type="button"
            onClick={() => helpers.onQuickReply?.(action.value)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
};

const CardRenderer: MessageRenderer = (message) => {
  const payload = message.payload || {};
  return (
    <article className="cs-card" aria-label={payload.title || message.text}>
      {payload.imageUrl && (
        <div className="cs-card-media">
          <img src={payload.imageUrl} alt={payload.title || "Card image"} />
        </div>
      )}
      <div className="cs-card-content">
        <h4>{payload.title || message.text}</h4>
        {payload.body && <p>{payload.body}</p>}
        {payload.actions && (
          <div className="cs-card-actions">
            {payload.actions.map((action) => (
              <a key={action.value} href={action.url || "#"} className="cs-card-link">
                {action.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </article>
  );
};

const ProductRenderer: MessageRenderer = (message) => {
  const payload = message.payload || {};
  return (
    <article className="cs-card" aria-label={payload.title || "Product"}>
      {payload.imageUrl && (
        <div className="cs-card-media">
          <img src={payload.imageUrl} alt={payload.title || "Product image"} />
        </div>
      )}
      <div className="cs-card-content">
        <h4>{payload.title || message.text}</h4>
        {payload.body && <p>{payload.body}</p>}
        {payload.actions && payload.actions.length > 0 && (
          <div className="cs-card-actions">
            {payload.actions.map((action) => (
              <a key={action.value} href={action.url || "#"} className="cs-card-link">
                {action.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </article>
  );
};

const SurveyRenderer: MessageRenderer = (message, helpers) => {
  const payload = message.payload || {};
  return (
    <div className="cs-survey" role="form" aria-label={payload.title || "Survey"}>
      <div className="cs-survey-header">
        <strong>{payload.title || message.text}</strong>
        {payload.body && <p>{payload.body}</p>}
      </div>
      <div className="cs-survey-actions" role="group" aria-label="Survey responses">
        {(payload.actions || []).map((action) => (
          <button
            key={action.value}
            type="button"
            className="cs-quick-reply"
            onClick={() => helpers.onQuickReply?.(action.value)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export const defaultMessageRegistry = new MessageComponentRegistry();
defaultMessageRegistry.register("quick_replies", QuickReplies);
defaultMessageRegistry.register("card", CardRenderer);
defaultMessageRegistry.register("product", ProductRenderer);
defaultMessageRegistry.register("survey", SurveyRenderer);
defaultMessageRegistry.register("text", (msg) => <span>{msg.text}</span>);
