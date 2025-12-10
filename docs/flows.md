# Flow builder and runtime

This document captures the admin builder and runtime execution model for configurable flows. The goal is to provide an auditable, versioned canvas for orchestrating AI + integration steps without bespoke code.

## Concepts

- **Flow**: A directed graph of nodes (LLM, condition, HTTP request, delay, escalate to agent, CRM lookup, Shopify order lookup, end) connected by edges. Each save increments a version and records audit metadata.
- **Node**: Typed unit of work with configuration stored as JSON. Nodes emit data that can be consumed by downstream steps via `vars` in the execution context.
- **Edge**: Connects nodes and can express optional predicates (`flag:foo`, `equals:path:value`) to drive branching.
- **Bot binding**: Flows are always stored with a `botId` to support multi-tenant widgets/sites.

## Persistence

- A Postgres table `flows` stores serialized graphs, audit fields, and optimistic locking via `version`.
- Memory storage is available for development and tests.
- Repository contract lives in `packages/bacon-backend/src/flows/repository.ts` and is injected into the server through `BaconServerConfig.flows.repository` when customization is required.

### Example migration

```sql
create table if not exists flows (
  id uuid primary key default gen_random_uuid(),
  bot_id text not null,
  name text not null,
  description text,
  nodes jsonb not null,
  edges jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text
);
create index if not exists flows_bot_id_idx on flows (bot_id);
```

## HTTP API

The chat server mounts REST-style endpoints for CRUD, version-safe updates, and preview execution.

- `GET /api/flows?botId=...` — List flows for a bot.
- `POST /api/flows` — Create a new flow. Body must include `botId`, `name`, `nodes`, and `edges`.
- `GET /api/flows/:id` — Fetch a flow definition.
- `PUT /api/flows/:id` — Update a flow. Requires matching `version`; server increments on success.
- `DELETE /api/flows/:id` — Remove a flow.
- `POST /api/flows/:id/preview` — Execute the flow against test input and return a trace.

All endpoints require the same bearer token used for admin settings when authentication is configured.

## Runtime engine

- Implemented in `packages/bacon-backend/src/flows/engine.ts`.
- Executes from the `start` node (or first node), following edges sequentially and honoring conditional branches.
- Each node type has a default executor with generous comments and timeouts; executors can be overridden via `BaconServerConfig.flows.engine`.
- A full execution trace is returned, recording timestamps, status, and error messages for observability.

## Admin builder notes

- The admin UI (under `/apps/admin`) should compose a React Flow canvas, schema validation for node inputs, and optimistic locking using the `version` field.
- Preview mode should call `POST /api/flows/:id/preview` and render the trace with timestamps to mirror runtime behavior.
- Use the shared `flows` API to save/load graphs per bot ID and keep UX resilient to network errors.

## Testing guidance

- Unit test the repository contract for optimistic locking and the engine for branching semantics (`packages/bacon-backend/__tests__/flows.test.ts`).
- End-to-end tests can stub Shopify/HubSpot calls by overriding node executors on the `FlowEngine` used in preview.
