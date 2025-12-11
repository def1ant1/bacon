# customer-support-chat-widget

A simple, floating customer service chat widget for React + TypeScript.

- Floating launcher button
- Expandable chat panel
- Session persistence via localStorage plus a SameSite cookie so servers can
  validate the client ID across fetch/WebSocket transports
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

## Backend admin/API security

- Set `AUTH_BEARER_TOKEN` or `AUTH_JWT_SECRET` + `AUTH_REFRESH_SECRET` in the backend environment to secure `/api/admin/*` routes.
- Access tokens honor the JWT `role` (or configured `roleClaim`) to enforce **admin** vs **agent** permissions and can be refreshed via `POST /api/admin/auth/refresh`.
- Refresh and access tokens support optional issuer/audience claims; operators can register `onRefresh`/`onRevoke` callbacks to plug into centralized audit pipelines.
- Network controls: supply `security.blocklist` entries as IPv4/IPv6 strings; the server normalizes IPv6-mapped IPv4 addresses (e.g., `::ffff:10.0.0.9` → `10.0.0.9`) and honors the first `x-forwarded-for` hop so blocklists still apply when traffic arrives through load balancers.

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

## Agent conversation workspace

The inbox experience for support agents now ships as a pre-wired layout that links the `ConversationSidebar` to a central router + history view.

- `ConversationWorkspace` wraps the sidebar, router, and main message window. When an agent clicks a row, the shared router sets the active conversation ID and hydrates the message history via `ConversationMessageService`.
- `ConversationWindow` renders history with virtualization (powered by `@tanstack/react-virtual`) to keep 10k+ message threads smooth while preserving scroll position and unread tracking.
- Error handling is centralized: failed history loads surface an inline alert with a retry CTA, and retries are debounced to avoid API thrash.

### Minimal usage

```tsx
import { ConversationWorkspace, ConversationDataService, ConversationMessageService } from "customer-support-chat-widget"

const conversationService = new ConversationDataService({ baseUrl: "/api/admin/inbox" })
const messageService = new ConversationMessageService({ historyUrl: "/api/admin/messages", sendUrl: "/api/chat" })

export function AgentInbox() {
  return (
    <ConversationWorkspace
      conversationService={conversationService}
      messageService={messageService}
      sidebarTitle="Inbox"
      title="Conversation"
    />
  )
}
```

### Operator + developer flows

- User journey: select any conversation from the inbox → router records the active ID → history fetch fires → virtualized list renders, pinning scroll to the bottom when the user is reading the latest message → sending a reply appends optimistically and marks the message as seen when the view is at the bottom.
- Developer reproduction: run `npm test -- --runInBand src/conversations/ConversationWorkspace.test.tsx` to execute the full selection/send/reselect matrix; use `npm start` to launch the example app, then import `ConversationWorkspace` into any admin surface to validate end-to-end data flow.

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
  "clientId": "string",
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

## Client/session identity, rotation, and troubleshooting

- The widget mints a privacy-safe UUID once per browser profile and stores it
  in both `localStorage` and a SameSite=Lax cookie (`cs_client_id`). This keeps
  the ID stable across tabs and transport types so your backend can validate it
  with headers (`X-Client-Id`) or WebSocket query params.
- IDs expire after ~180 days. The widget refreshes proactively (every TTL/4)
  and will rotate immediately if the stored record is corrupted or removed.
- Operators can trigger a manual reset by clearing the cookie + localStorage
  entry or by responding with a 4xx that instructs the hosting app to call the
  `clientIdentityManager.rotateIdentity` helper.
- If you see mismatched IDs between fetch and WebSocket frames, check for
  third-party cookie blockers or strict CSP. The cookie path is `/` and
  intentionally avoids user data to stay privacy-compliant.

### Conversation sidebar + inbox API

Enterprise deployments often need an inbox view for triaging many sessions. The library now exports:

- `ConversationDataService` — cache + retry + cancellation aware client for `GET /api/conversations?cursor={cursor}&limit={pageSize}`.
- `useConversationFeed` — React hook that wraps the service with `loading`, `error`, `hasMore`, `loadMore`, and `retry` flags.
- `ConversationSidebar` — accessible listbox that shows title/participant, preview text, unread badge, timestamps, and infinite scroll with a fallback "Load more" CTA for deterministic testing.

Server response contract:
```json
{
  "conversations": [
    {
      "id": "string",
      "title": "string",
      "participantLabel": "optional string",
      "lastMessageAt": "ISO timestamp",
      "lastMessagePreview": "optional preview",
      "unread": true
    }
  ],
  "nextCursor": "opaque cursor or null"
}
```

The service deduplicates requests per cursor, retries transient `5xx/429` errors with exponential backoff, and returns cached pages to keep sidebar rendering snappy even when multiple components load simultaneously. AbortControllers are wired through so leaving the page or switching tenants cancels inflight calls without manual cleanup.

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

## Stack quickstart (Docker Compose)

1. Copy the env contract: `cp .env.example .env` and tune secrets (JWT_SECRET, DATABASE_URL, REDIS_URL, ALLOWED_ORIGINS).
2. Build + boot the full stack: `npm run stack:up` (or `make stack-up`). Healthchecks cover `/readyz` on the backend and the admin preview server.
3. Optional Redis: `STACK_PROFILES=redis make stack-up` enables the cache service without touching the rest of the stack.
4. Inspect: `npm run stack:ps` for container status, `npm run stack:logs` for tailing all logs, and `npm run stack:down` to reset volumes between CI runs.

The compose file builds the backend from `Dockerfile` and the admin/frontend from `ops/Dockerfile.admin`, wiring Postgres with a persistent volume. Ports default to `3001` (API) and `4173` (admin/frontend preview).

## Scaffold with the create-bacon-app CLI

The package now exposes a `create-bacon-app` binary for cloning the stack into a new workspace with minimal manual steps:

```bash
npm run build && npx create-bacon-app --dir ./deployments/my-stack --name myco
# Flags: --no-redis to skip the Redis profile, --force to overwrite existing files
```

Generated assets include:
- `.env.example` with DATABASE_URL, REDIS_URL, JWT_SECRET, GROK_API_KEY, BASE_URL, ALLOWED_ORIGINS defaults
- `docker-compose.yml` mirroring the reference stack
- `frontend/next-app` with a Next.js widget host example and scripts/bootstrap.sh to install/build/compose up
- `backend/config.ts` wiring Postgres/memory storage, auth tokens, and file uploads

## Troubleshooting & scaling

- If the admin UI fails healthchecks, run `docker compose logs admin` to surface Vite preview errors; rebuild with `npm run stack:up` after fixing.
- Database authentication errors usually mean `DATABASE_URL` and `POSTGRES_PASSWORD` diverged; align them in `.env` before restarting.
- Tighten CORS by setting `ALLOWED_ORIGINS` to hostnames only (no schemes) to avoid wildcard defaults in production.
- Scale horizontally by adding replicas behind a load balancer; keep sticky sessions on when using WebSockets and enable the Redis profile for shared rate limits.

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


## Operations & automation quickstart

- **Container**: `docker build -t bacon-backend .` then `docker run -p 3001:3001 --env-file .env.example bacon-backend`. The container runs the bundled backend via `packages/bacon-backend/dist/server.cjs` with `/healthz` baked in.
- **Serverless**: Copy `ops/serverless.template.yml`, swap in your ECR image URI, and deploy with `serverless deploy --param="ecrImage=$ECR_IMAGE"` after building/pushing the Docker image.
- **Environment validation**: `npm run env:check` fails fast in CI when `PORT`/`HOST` or optional secrets are missing. See `.env.example` for sane defaults.
- **Quality gates**: CI runs lint + coverage via `npm run test:coverage` and fails if coverage dips below thresholds defined in `vitest.config.ts`.
- **Health/observability**: `/healthz` and `/readyz` are served by the backend and the default logger emits structured timestamped entries suitable for log aggregation.
