# Conversation sidebar data + UI contract

This sidebar is intentionally designed for enterprise support teams that need predictable pagination, retryable fetches, and deterministic tests.

## API contract (server-driven pagination)

- **Endpoint:** `GET /api/conversations?cursor={cursor}&limit={pageSize}`
- **Response shape:**
  ```json
  {
    "conversations": [
      {
        "id": "string",
        "title": "string",
        "participantLabel": "optional string",
        "lastMessageAt": "ISO-8601 timestamp",
        "lastMessagePreview": "optional short preview",
        "unread": true
      }
    ],
    "nextCursor": "opaque string | null"
  }
  ```
- The server owns pagination; the client simply passes `nextCursor` back. When `nextCursor` is missing/`null`, the UI stops asking for more.
- Prefer ordering by `lastMessageAt` descending to keep inbox sorting deterministic across retries.

## State management + data flow

- `ConversationDataService` is a framework-agnostic cache/retry/cancel layer. It deduplicates concurrent requests per cursor, memoizes pages, and aborts inflight calls on unmounts to avoid leaking network traffic.
- `useConversationFeed` wraps the service for React: it exposes `loading`, `error`, `hasMore`, `loadMore`, and `retry` to drive spinners and CTA buttons. It cancels inflight requests when the component unmounts and guards against duplicate loads during rapid scrolls.
- `ConversationSidebar` composes the hook + service, adds keyboard navigation (ArrowUp/ArrowDown), unread indicators, and optimistic spinners. Infinite scroll triggers when the list is within ~96px of the bottom; a "Load more" button remains for deterministic testing.

## Testing + automation

- Unit + UI suites live beside the components under `src/conversations/*.test.ts(x)`. They use deterministic fixtures/mocks instead of live API calls.
- Commands:
  - `npm test` or `npm run test` — runs all Vitest suites (jsdom) with coverage enabled by default.
  - `npm run test:coverage` — writes full coverage reports to `./coverage` for CI review.
- Tests assert pagination, retry/backoff, cancellation, empty/error states, and keyboard navigation to prevent regressions from manual QA churn.
