# Channel adapters and routing lifecycle

This package now exposes a dedicated channel routing layer for connecting external transports (web widgets, WhatsApp, Messenger, etc.) to the core conversation pipeline.

## Concepts

- **ChannelAdapter**: declares inbound/outbound capabilities, normalizes incoming payloads, and delivers outbound messages.
- **ChannelRouter**: orchestrates adapter registration, maps external user identifiers to internal sessions, performs idempotent ingestion using provider message IDs, and relays messages to the `Pipeline`.
- **Channel mappings**: persisted records that bind `{channel, externalUserId}` to a single `sessionId` to keep conversations stable across retries or webhook storms.

## Persistence

Both the in-memory and Postgres storage adapters now implement:

- `linkChannelConversation(...)` – creates or reuses a mapping and ensures the session exists.
- `getChannelMapping(...)` – fetches the current binding.
- `recordChannelMessageReceipt(...)` – idempotency helper that ignores duplicate provider message IDs.

Postgres migrations add `channel_mappings` and `channel_message_receipts` tables so these bindings survive restarts.

## Routing middleware

A new endpoint accepts inbound traffic for any registered adapter:

```
POST /api/channels/:channel/inbound
```

Provide the raw provider payload and the router will normalize it via the adapter, create or reuse a mapping, and return the session ID plus any generated bot reply. Duplicate payloads are short-circuited when a `providerMessageId` is supplied.

The legacy `/api/chat` endpoint now delegates to the `web` adapter so browser clients share the same mapping and idempotency behavior as webhook-driven transports.

## Starter adapters

- **Web widget** (built-in): default channel used by `/api/chat`.
- **Twilio WhatsApp** (plugin): now exposes normalization for inbound payloads and outbound delivery via the plugin channel contract.
- **Facebook Messenger** (plugin placeholder): documents configuration keys and provides a stub outbound implementation ready to be wired to the Send API.

## Usage example

```ts
import { ChannelRouter, buildWebWidgetAdapter, MemoryStorage, Pipeline } from 'bacon-backend'
import { PluginRegistry } from 'bacon-backend/src/plugins/registry'

const storage = new MemoryStorage()
const pipeline = new Pipeline(storage, myAiProvider, { settings: { ai: { provider: 'echo', systemPrompt: '' } } })
const router = new ChannelRouter({ storage, pipeline })
router.register(buildWebWidgetAdapter())

// Register plugin-provided adapters
const registry = new PluginRegistry()
// registry.register(...)
registry.listChannelAdapters().forEach((adapter) => router.register(adapter))
```

With this wiring, inbound webhooks simply hit `/api/channels/{channel}/inbound` and the router ensures consistent conversation linking and deduplication.
