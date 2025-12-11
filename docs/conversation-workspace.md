# Conversation workspace (agent console)

This module stitches together the inbox sidebar, a centralized router, and a virtualized message window so agents can work large queues without bespoke glue code.

## Data flow

1. `ConversationSidebar` emits a selected conversation ID when a user clicks or presses Enter.
2. `ConversationRouter` stores that ID, kicks off a history fetch via `ConversationMessageService`, and caches the result per conversation.
3. `ConversationWindow` reads the active history from the router, renders it with `@tanstack/react-virtual`, and pins scroll to the latest message when the user is at the bottom of the list.
4. Sending a message calls `ConversationMessageService.sendMessage`, appends the response to the cached history, and marks the last message as seen when the viewport is near the bottom.
5. Incoming (push) messages can be injected via `ConversationRouter.receiveMessage` to keep the UI in sync with WebSocket/webhook events.

## Error handling

- History fetches retry with exponential backoff inside `ConversationMessageService` and surface inline alerts in the window with a Retry CTA.
- `ConversationRouter` guards against race conditions by ignoring stale responses when a user rapidly reselects conversations.
- Send failures capture the error on the active history, keeping the message composer disabled only when a send is inflight.

## Performance + UX strategies

- Virtualization keeps DOM nodes bounded even on 10k-message threads while preserving scroll position.
- Seen-state updates are debounced to avoid churn when users scroll aggressively; this can be extended to call backend read-receipt APIs.
- Retry/backoff defaults avoid hammering admin APIs under load; both history and send operations expose knobs for enterprises that need stricter limits.

## Developer reproduction steps

1. Install dependencies: `npm install`.
2. Run the focused UI suite: `npm test -- --runInBand src/conversations/ConversationWorkspace.test.tsx`.
3. Render the exported `ConversationWorkspace` inside any admin surface, pointing `ConversationDataService` at `/api/admin/inbox` and `ConversationMessageService` at `/api/admin/messages` (history) plus `/api/chat` (send). The router + window will light up automatically when sidebar rows are clicked.
