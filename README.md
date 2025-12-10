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
- pollIntervalMs?: number — Message poll interval for GET /api/chat?sessionId=... (default 3000, set 0 to disable).

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

