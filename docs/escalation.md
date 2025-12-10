# Escalation and Inbox Workflow

This document captures the end-to-end flow for routing conversations between automation and human agents.

## Confidence thresholds and routing
- Incoming user messages are recorded in storage and evaluated by the configured AI provider. Providers return `{ reply, confidence }`.
- The confidence score is compared against `behavior.handoffConfidenceThreshold` (defaults to `0.65`).
- If confidence is **below the threshold**, the conversation is placed into the inbox queue with status `new` and the user receives the configurable handoff message (`behavior.handoffMessage`).
- If confidence is **at/above the threshold**, the AI reply is sent immediately.
- Brand/bot identifiers flow through the pipeline to keep per-brand thresholds and KB context intact.

## Queue storage and schemas
- The queue is pluggable via `InboxQueueAdapter` with implementations for:
  - **Memory** (`MemoryInboxQueue`) – useful for local dev and unit tests.
  - **Postgres** (`PostgresInboxQueue`) – uses `inbox_tickets` and `inbox_notes` tables to store status, tags, assignment, confidence, and notes.
  - A Redis-compatible adapter can be added by implementing the adapter contract without changing the pipeline.
- Ticket statuses: `new`, `assigned`, `snoozed`, `closed`.
- Tags and notes are persisted for fast filtering and auditing.

### Postgres DDL (reference)
```
create table inbox_tickets (
  id bigserial primary key,
  session_id text not null,
  brand_id text not null,
  status text not null default 'new',
  tags text[] not null default '{}',
  assigned_agent_id text,
  last_message text,
  confidence numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table inbox_notes (
  id bigserial primary key,
  ticket_id bigint not null references inbox_tickets(id) on delete cascade,
  author_id text,
  text text not null,
  created_at timestamptz not null default now()
);
```

## API surface
- `GET /api/admin/inbox`: list tickets with optional `status`, `tag`, `agentId`, `brandId`, `q`, `includeNotes`, `includeMessages` filters.
- `POST /api/admin/inbox`: actions `{assign, roundRobinAssign, status, note, tags}`.
- `POST /api/admin/inbox/assist`: AI-assisted draft using transcript history.
- `GET/DELETE /api/admin/messages?sessionId=...`: fetch or clear transcripts.

## WebSocket fan-out
- Agents subscribe to the `agent:<agentId>` channel (or `agent:all`) via the chat websocket (`/api/chat/ws`).
- Events emitted: `ticket.updated`, `ticket.assigned`, `ticket.note`.
- The Agent Console subscribes to both personal and broadcast channels for live updates and assignments.

## Authentication and authorization
- Admin settings are restricted to `Admin` role; inbox/actions require at least `Agent` role.
- Supports bearer token (admin) and JWT (`auth.jwtSecret`) with role claim (`auth.roleClaim`, default `role`).
- Audit logs are emitted via the server logger for assignments, status updates, tags, and notes.

## Agent Console workflow
- Columns: `New`, `Assigned`, `Snoozed`, `Closed` with live websocket refresh.
- Actions: assign to self/manual, round-robin assignment, status transitions, tag edits, add notes, AI "Draft reply", canned macros, and send reply back to the customer.
- Notes and transcripts stay synchronized with the inbox service to minimize context switching for agents.

## Testing guidance
- Unit tests cover: low-confidence escalation, auto-reply pass-through, round-robin and note handling, websocket updates, and agent inbox actions.
- Run `npm test` (Vitest) to execute the integration suite.
