# Testing and quality gates for chat flows

## Commands

- `npm run lint` — baseline lint pass for widget + admin surfaces.
- `npm run typecheck` — `tsc --noEmit` scoped to `src/**/*` to catch drift between widget/admin types and runtime contracts without pulling in backend fixtures.
- `npm run test:chat` — focused chat-flow UI suite (widget session replay + agent inbox selection/pagination).
- `npm run test:e2e` — alias to the chat flow suite so CI and humans share a single entrypoint.
- `npm run test:coverage` — full coverage run across packages.
- `npm run build && npm run perf:budget` — asserts bundle + stylesheet sizes stay under published thresholds.

## Repeatable fixtures

Deterministic chat data lives in `src/conversations/__fixtures__/chatSeeds.ts`. Both the widget and agent-workspace tests use the same timestamps, conversation IDs, and message shapes to avoid copy/paste drift and to keep reruns stable across CI agents.

## CI wiring

The GitHub Actions workflow runs lint → typecheck → chat-flow tests → coverage → build → perf budget. Local runs mirror the same order so failures surface identically before opening a PR.
