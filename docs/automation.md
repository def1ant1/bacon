# Automation rules and rich messaging

This release adds a lightweight automation runtime that can be bootstrapped with keyword, inactivity, scheduled, or page-metadata triggers. Each rule can dispatch multi-step actions such as sending a templated message (text, card, product, survey, quick replies), invoking a flow, or escalating into the inbox queue.

## Configuring rules

Pass rules via `BaconServerConfig.automation.rules` or supply a fully custom `AutomationRuleEngine` instance. Each rule supports:

- `triggers`: `keyword`, `inactivity`, `scheduled`, and `page_metadata` selectors with optional debouncing and rate limits.
- `actions`: `send_message`, `invoke_flow`, and `escalate` with tags/priority metadata.
- `debounceMs` and `rateLimit` to prevent over-automation.

Example welcome and abandoned-cart automations:

```ts
import { buildAutomationRule } from "bacon-backend/src/automation-rules";

const rules = [
  buildAutomationRule({
    name: "welcome",
    triggers: [{ type: "scheduled", intervalMs: 60_000 }],
    actions: [{ type: "send_message", text: "Need help getting started?", payload: { actions: [{ label: "Talk to us", value: "agent" }] } }],
  }),
  buildAutomationRule({
    name: "abandoned-cart",
    triggers: [{ type: "keyword", keywords: ["checkout", "cart"] }],
    debounceMs: 15 * 60 * 1000,
    actions: [
      {
        type: "send_message",
        text: "We noticed you were working on your cart. Want to finalize it?",
        payload: {
          title: "Shopify cart",
          actions: [
            { label: "Resume checkout", value: "resume_checkout" },
            { label: "Talk to support", value: "live_help" },
          ],
        },
      },
    ],
  }),
];
```

## Widget rich message schema

Widget messages now accept the `type` and `payload` fields. Built-in renderers cover `card`, `product`, `survey`, and `quick_replies`, and a `MessageComponentRegistry` allows plugins to register new renderers. Unknown types gracefully fall back to plaintext. Quick reply buttons are keyboard-focusable and send the configured value back to the backend.

## Plugin guidance

Plugins can swap the registry by passing `messageRegistry` into `CustomerSupportChatWidget` or by registering additional renderers on the default registry. Renderers receive the original message and a callback for dispatching quick replies to keep behavior consistent across transports.
