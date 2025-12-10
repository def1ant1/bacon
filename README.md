# customer-support-chat-widget

A simple, floating customer service chat widget for React + TypeScript.

- Floating launcher button
- Expandable chat panel
- Session persistence via localStorage
- Sends messages to a configurable backend /chat endpoint
- System light/dark theme via CSS variables

## Installation

```bash
npm install customer-support-chat-widget
# or
yarn add customer-support-chat-widget
```

## Usage

```tsx
import React from "react";
import { CustomerSupportChatWidget } from "customer-support-chat-widget";
import "customer-support-chat-widget/dist/index.css"; // required styles

const App: React.FC = () => (
  <>
    {/* Your app content */}
    <main>...</main>

    <CustomerSupportChatWidget
      apiUrl="/api/chat"
      title="ClientCo Support"
      primaryColor="#0f766e"
      userIdentifier={{ email: "jane.doe@example.com" }}
    />
  </>
);

export default App;
```

## Props

- apiUrl: string — URL of your chat backend endpoint (e.g., /api/chat).
- uploadUrl?: string — Optional upload endpoint (defaults to `${apiUrl}/upload`).
- title?: string — Header title.
- userIdentifier?: Record<string, string> — Identifiers for CRM lookup (e.g., { email, phone }).
- primaryColor?: string — Accent color for header, launcher, and user bubble (sets --cs-primary).
- defaultOpen?: boolean — If true, the chat panel starts open.
- pollIntervalMs?: number — Message poll interval for GET /api/chat?sessionId=... (default 3000, set 0 to disable). Kept for backward compatibility; see transport below.
- transport?: "polling" | "websocket" | TransportFactory — Choose the transport implementation. Defaults to polling so existing installs continue working.
- transportOptions?: Partial<PollingTransportOptions & WebSocketTransportOptions> — Advanced knobs (auth token injection, headers, heartbeat/ping-pong timing, backoff controls, socket.io factory, TLS-only websocket URL overrides).
- plugins?: BaconPlugin[] — Optional lifecycle extensions for observability, auth refresh, message enrichment, or custom analytics.

## Transport configuration

The widget now ships with a pluggable transport layer so you can opt into long-lived WebSocket connections or supply your own enterprise transport. Defaults remain polling to avoid extra dependencies.

- **PollingTransport (default)**: zero-dependency long/short polling over HTTPS. Resilient with retry/backoff, configurable intervals, and auth header injection. Ideal for strict firewalls or CSP-limited environments.
- **WebSocketTransport**: uses native `WebSocket` when available and can optionally accept a lightweight `socket.io-client` factory via `transportOptions.socketIoFactory` for legacy proxies. Supports heartbeat (ping/pong), reconnection with jittered backoff, ordered message flushing, and binary/file payloads where supported.
- **Custom**: provide `transport={(opts) => new MyTransport(opts)}` to plug in proprietary gateways or message buses. Implement the `Transport` interface exported from `src/transports/Transport`.

Example WebSocket-first configuration with graceful fallback:

```tsx
<CustomerSupportChatWidget
  apiUrl="https://api.example.com/chat"
  transport="websocket"
  transportOptions={{
    webSocketUrl: "wss://api.example.com/chat/ws",
    heartbeatMs: 15000,
    authToken: myToken, // injected as Authorization: Bearer ...
    headers: { "X-Org": "enterprise" },
    backoffBaseMs: 500,
  }}
  // When WebSockets are blocked, the widget automatically falls back to polling
  // using the same apiUrl and headers.
/>
```

Production hardening tips baked into the transports:

- Timeouts: `PollingTransport` supports `longPollTimeoutMs` and will abort hung requests before retrying.
- Heartbeats: `WebSocketTransport` pings periodically via JSON `{ type: "ping" }` to detect dead connections.
- Auth: `transportOptions.authToken` and `transportOptions.headers` apply to all requests/frames.
- Backoff: both transports expose `backoffBaseMs`/`backoffMaxMs` to smooth reconnect storms.
- Hooks: transports surface telemetry and lifecycle events into the plugin runner so observability plugins can stream connection health without coupling to UI state.

## Plugins & enterprise extensibility

`CustomerSupportChatWidget` accepts a `plugins` prop and exports a `BaconPlugin` interface plus a React-based `PluginProvider` for consumers who want to host plugins outside the widget tree. The runner enforces:

- **Ordering:** hooks execute in array order so you can layer tracing → auth → logging consistently.
- **Isolation:** each hook is wrapped in try/catch; failures are logged and never block the widget or other plugins.
- **Immutability:** payloads and messages are deep-cloned between plugins. To modify data, return a new payload/message list instead of mutating arguments.
- **Safety:** send hooks can short-circuit (cached response), retry on recoverable errors, or abort a send entirely. Retries are capped to prevent infinite loops.

Core hooks:

- `onBeforeSend(payload)` → optionally return `{ payload, response?, abort? }`.
- `onAfterSend(payload, response)`.
- `onSendError(error, payload)` → optionally `{ retry: true, waitMs?, payload? }`.
- `onMessages(messages)` → optionally `{ messages }` for enrichment or analytics tagging.
- `onConnectionEvent({ state, reason? })` and `onTelemetry(event)` for transport observability.
- `onWidgetOpen/Close`, `onWidgetMount/Unmount`, and `onInit` for UI lifecycle instrumentation.

Built-in examples live in `src/plugins/examples.ts`:

- **Logging**: emits structured lifecycle and telemetry events to your logger.
- **Tracing**: injects trace IDs + timestamps into outbound payload metadata and echos them back on messages.
- **Auth token refresher**: fetches tokens lazily and retries sends after refresh when a 401-like error is detected.

Example usage:

```tsx
import { CustomerSupportChatWidget, createLoggingPlugin, createTracingPlugin } from "customer-support-chat-widget";

<CustomerSupportChatWidget
  apiUrl="/api/chat"
  plugins={[
    createTracingPlugin(),
    createLoggingPlugin({ log: (event, detail) => myAnalytics.emit(event, detail) }),
  ]}
/>;
```
- Rate limits: keep `pollIntervalMs` reasonable (>= 1-3s) and adjust backoff for surge control.

## Theming

- System-aware: honors prefers-color-scheme automatically.
- Uses CSS variables so you can override in your app’s CSS.
- Key variables:
  - --cs-primary, --cs-on-primary, --cs-focus-ring
  - Surfaces/text: --cs-bg, --cs-surface, --cs-text, --cs-border
  - Bubbles: --cs-user-bubble-bg, --cs-user-bubble-text, --cs-bot-bubble-bg, --cs-bot-bubble-text
  - Inputs/controls: --cs-input-*, --cs-control-*
  - Status: --cs-error-*, --cs-typing-dot

## Backend Contract

The widget sends:
```json
{
  "sessionId": "string",
  "message": "string",
  "metadata": { "optional": "observability + custom fields" },
  "userIdentifier": {
    "email": "optional",
    "phone": "optional"
  }
}
```

The backend should respond with:
```json
{
  "reply": "string"
}
```

## Example App + Mock Backend

- Dev server exposes a mock backend via Vite middleware.
- Pages:
  - App: /
  - Admin: /admin.html — tweak branding (primary color, custom CSS), behavior, AI settings, and run Init DB.
  - Monitor WebUI: /webui.html — inspect sessions/messages/files, send admin messages.
- Endpoints (dev only):
  - POST /api/chat — chat with persistence.
  - GET /api/chat?sessionId=... — list messages.
  - POST /api/upload — multipart file upload; files served from /uploads/*.
  - Admin: /api/admin/* (settings, sessions, messages, files, db/init).
- Postgres (optional): set DATABASE_URL to use a real DB. With DB enabled, the app persists:
  - Conversations (table: conversations, numeric id and session_id)
  - Messages (table: chat_messages)
  - Files (table: chat_files)

## Building

```bash
npm run build
```

This emits ESM + CJS bundles and type declarations into dist/ using tsup.

## Start (Dev)\n\nRuns the example app with the mock backend on a fixed port.\n\n`ash\nnpm start\n# opens dev server on http://localhost:5173\n`\n\nOr run both DB and web in the same shell (Ctrl+C stops both):\n\n`ash\nnpm run dev:all\n`\n\n## Start (Preview)

Builds the library and example, then serves the built example on a fixed port.

```bash
npm run start:preview
# serves http://localhost:4173
```

## Database (Docker)

- Create/start Postgres in Docker on port 5432 with a persistent container named chatbot1-pg:

```bash
npm run db:up
```

- Manage the DB container:
  - Start: npm run db:start
  - Stop: npm run db:stop
  - Logs: npm run db:logs
  - Remove: npm run db:rm

- Default connection (used by the example via .env or Admin):
  - postgresql://postgres:chatpass@localhost:5432/chatbot1

- Initialize/repair schema from the app (preferred): open Admin and click "Init DB", or call the endpoint:

```bash
curl -X POST http://localhost:5173/api/admin/db/init
```

## License

MIT

