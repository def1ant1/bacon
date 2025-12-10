# Chatbot1 Example with Configurable Transports and Plugins

This example app runs the `customer-support-chat-widget` front end against the reusable `bacon-backend` package. It ships with
file-backed admin settings, environment-driven transport toggles, and automation-focused defaults so you can lift the stack into
containers or managed platforms with minimal edits.

## Architecture

- **Frontend** – Vite + React app using the widget's built-in transport layer (polling or WebSocket) and plugin system. Admin
  settings drive defaults such as poll intervals, WebSocket URLs, and plugin flags.
- **Backend** – `bacon-backend` exported server factory with optional Postgres persistence. The example wraps it in
  `backend/config.ts` to merge `.env`, `./.data/admin-settings.json`, and safe defaults. Admin changes persist to disk so reloads
  keep state consistent.
- **Admin & WebUI** – Static pages served by Vite. Admin writes to `/api/admin/settings`, and the backend enforces retention,
  transport gating, and optional bearer authentication.

```
example/
  backend/config.ts   # Central runtime config loader
  public/admin.html   # Admin UI exposing transports + plugin toggles
  src/App.tsx         # Widget demo with live transport selection + telemetry
  .data/admin-settings.json # Persisted admin state for dev/CI
```

## Quick start

```bash
cd example
cp .env.example .env   # Set DATABASE_URL, BACON_* overrides, admin bearer token if desired
npm install
npm run dev            # Vite dev server + backend mounted under /api
```

To force Postgres persistence locally, set `DATABASE_URL` in `.env` before running `npm run dev`.

## Configuration reference

The config loader reads environment variables first, then `.data/admin-settings.json`:

- **BACON_TRANSPORT_MODE**: `polling` | `websocket` (default polling).
- **BACON_ENABLE_WEBSOCKET / BACON_ENABLE_HTTP_POLLING**: Boolean toggles to hard-disable transports at runtime.
- **BACON_POLL_INTERVAL_MS**: Default poll cadence for the widget.
- **BACON_PLUGIN_LOGGING / BACON_PLUGIN_TRACING / BACON_PLUGIN_AUTH_REFRESHER**: Default plugin flags surfaced in Admin.
- **BACON_ADMIN_TOKEN**: Optional bearer token to protect `/api/admin/*`.
- **BACON_SETTINGS_FILE**: Override for the persisted settings path (defaults to `./.data/admin-settings.json`).

Admin updates are saved back to the settings file automatically; resetting from the UI restores base defaults from
`backend/config.ts`.

## Transports and plugins

- Admin exposes **Transports** (default mode, allow/deny HTTP polling, WebSocket path, poll interval) and **Plugins** (logging,
  tracing, auth refresher).
- The example UI surfaces runtime controls so operators can switch between polling and WebSockets, inspect connection status, and
  verify which plugins are active without redeploying.
- The backend now supports both `POST /api/chat` and `GET /api/chat?sessionId=...` for polling, plus `/api/chat/ws` for widget
  WebSocket sessions.

## Production hardening checklist

- **TLS**: Terminate TLS at your ingress or enable TLS on your runtime (e.g., `https` listener) before exposing `/api/chat` and
  `/api/chat/ws`.
- **Authentication**: Set `BACON_ADMIN_TOKEN` to lock down admin routes. For chat API calls, inject auth headers via the widget
  plugins (e.g., tracing/auth refresher) or upstream middleware.
- **Rate limiting**: Place a reverse proxy (NGINX/Envoy/API gateway) in front of the backend to enforce per-IP/session rate
  limits for `/api/chat` and `/api/upload`.
- **Scaling**: The backend is stateless when using Postgres storage; run multiple replicas behind a load balancer. For WebSockets,
  enable sticky sessions or use a shared gateway (socket.io adapter, AWS ALB, Cloudflare Workers) to keep connections pinned.
- **Retention**: `behavior.retentionDays` drives sweeps across memory and Postgres adapters; tune it in Admin/SRE configs for
  compliance.

## Automated tasks

- **Run tests**: `npm test` (covers backend adapters and the example end-to-end polling/WebSocket flows).
- **Start everything with DB**: `npm run start:db` from repo root will spin up Postgres via Docker and launch the widget example.
- **Rebuild backend package**: `npm --prefix packages/bacon-backend run build` (used by CI before publishing).

## Example snippets

Mounting the backend in another app:

```ts
import { loadExampleServerConfig } from './example/backend/config'
const { server } = loadExampleServerConfig()
app.use(server.handler)
app.httpServer?.on('upgrade', server.wss?.handleUpgrade)
```

Switching transports at runtime inside a React host:

```tsx
<CustomerSupportChatWidget
  apiUrl={settings.integrations.apiUrl}
  transport={settings.transports.default}
  transportOptions={{ pollIntervalMs: settings.transports.pollIntervalMs, webSocketUrl: settings.transports.webSocketPath }}
  plugins={[]}
/>
```

The goal is to minimize manual steps: a single config file drives storage, transports, plugins, and admin defaults while the
example UI and tests validate end-to-end behavior.
