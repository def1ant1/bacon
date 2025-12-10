import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageComponentRegistry, defaultMessageRegistry } from "./registry";
import { ChatMessage } from "../CustomerSupportChatWidget";

const baseMessage: ChatMessage = {
  id: "m1",
  sender: "bot",
  text: "Hello",
  createdAt: new Date().toISOString(),
};

describe("MessageComponentRegistry", () => {
  it("falls back gracefully for unknown types", () => {
    const registry = new MessageComponentRegistry();
    const html = renderToStaticMarkup(
      registry.render({ ...baseMessage, type: "unknown" }) as React.ReactElement,
    );
    expect(html).toContain("Hello");
  });

  it("renders quick replies and wires callbacks", () => {
    const html = renderToStaticMarkup(
      defaultMessageRegistry.render(
        {
          ...baseMessage,
          type: "quick_replies",
          payload: { actions: [{ label: "Yes", value: "yes" }] },
        },
        { onQuickReply: vi.fn() },
      ) as React.ReactElement,
    );
    expect(html).toContain("Yes");
  });

  it("supports plugin provided renderers", () => {
    const registry = new MessageComponentRegistry();
    registry.register("card", (message) => <strong>{message.text}</strong>);
    const html = renderToStaticMarkup(
      registry.render({ ...baseMessage, type: "card" }) as React.ReactElement,
    );
    expect(html).toContain("<strong>");
  });
});
