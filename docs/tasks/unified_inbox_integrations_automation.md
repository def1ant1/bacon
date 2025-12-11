# Unified Inbox, Integrations, Automation, and Deployment Tasks

These tasks are written for enterprise-grade, pre-production readiness. Emphasize automation over manual work, thorough testing, and documentation updates for developers and operators. Designs should scale horizontally and support plugin-driven extensibility.

## 4.2 Unified Inbox + Agent Roles
- **Auth & Roles**: Implement JWT-based Admin/Agent roles with token rotation, revocation hooks, and environment-driven secrets. Harden all admin/agent endpoints; add signed widget config or site key validation to prevent abuse. Include end-to-end auth tests and documentation updates for setup and troubleshooting.
- **Queue Model & Persistence**: Add migrations for queue states (New, Assigned, Snoozed, Closed), assignments, tags, notes, macros, and audit logs. Provide repository interfaces with retry/backoff and connection pooling for Postgres/Redis. Include data retention controls and PII redaction hooks.
- **Assignment Logic**: Implement round-robin and manual assignment endpoints with deterministic selection and race-condition safeguards (advisory locks/serializable transactions). Add metrics (assignment latency, reassignment counts) and unit/integration tests for edge cases.
- **Agent Console UI**: Extend `/webui.html` (or Admin app) to render queue columns, assignment controls, live transcripts, notes, macros/canned responses, and status transitions. Provide accessibility support and offline-friendly UX. Add Playwright/Cypress flows to validate UI behaviors.
- **AI Assist**: Add “Draft reply” endpoint invoking the AI provider with full conversation context, rate limits, and observability (trace IDs, token usage). Capture user acceptance/rejection signals for analytics. Include contract tests against provider stubs.
- **Notes, Macros, Transcripts**: CRUD endpoints for notes and macros; render transcript with pagination and streaming updates (WebSocket/polling fallback). Add optimistic UI updates and error handling. Document data model and API usage.
- **Security & Compliance**: Enforce role checks, IP allow/block lists, rate limiting, and CSRF protections where applicable. Provide GDPR export/delete routines for conversations and notes. Add structured logging with PII-masking middleware.
- **Documentation**: Update admin/agent onboarding, JWT configuration, queue workflows, AI-assist usage, and troubleshooting guides. Include diagrams for queue state transitions.

## 5. Integration Plugin Interface & Official Plugins
- **Plugin Interface**: Define backend integration plugin contract (settings schema, actions/triggers, channel adapters, AI-context enrichers) with isolation and deterministic ordering. Implement dynamic loader with caching, validation, and health checks.
- **Admin UI Schema Generator**: Auto-generate settings forms from JSON schema; support secrets handling, test-connection actions, and per-tenant overrides. Add UI and API tests to ensure schema changes do not break rendering.
- **Official Plugins**: Ship NPM packages `bacon-plugin-shopify`, `bacon-plugin-hubspot`, `bacon-plugin-salesforce`, `bacon-plugin-twilio-whatsapp`, and `bacon-plugin-zapier` (or webhook/OpenAPI). Each should expose sandboxed clients, retry/backoff, rate-limit handling, and observability hooks. Provide mocks/stubs for tests.
- **Flow & AI Context Hooks**: Allow flows to invoke plugin actions and inject plugin-derived context into AI calls. Add telemetry on plugin execution time/failures and circuit breaker defaults.
- **Testing & CI**: Add contract tests for plugin lifecycle, settings validation, channel adapter behaviors, and flow integrations. Include CI matrix to run plugin suites with mocked external services.
- **Documentation**: Publish plugin API reference, per-plugin setup guides, and security considerations (auth scopes, secret storage). Encourage automated provisioning where possible.

## 5.2 Multichannel
- **Channel Abstraction**: Create `ChannelAdapter` interface mapping external IDs to conversation IDs with idempotent ingestion and deduplication safeguards. Persist channel mappings with indexes for scale.
- **Starter Adapters**: Implement web widget default adapter and plugin-driven adapters for WhatsApp/Twilio and Facebook Messenger. Ensure transport compatibility (polling/WebSocket) and graceful fallback.
- **Routing Middleware**: Add middleware to route inbound messages to the correct conversation/channel while enforcing auth and rate limits. Capture per-channel metrics and backpressure signals.
- **Testing & Docs**: Add tests for mapping collisions, adapter fallbacks, and channel-specific behaviors. Document adapter lifecycle, configuration, and monitoring.

## 6. Customization, Automation, & Rich UX
- **Automation Rules Engine**: Add `automation_rules` model with triggers (keywords, inactivity timers, schedules, page metadata) and actions (send message, invoke flow, escalate, plugin action). Provide debouncing, rate limits, and audit logging.
- **Rich Message Types**: Define extensible schema supporting `card | product | survey | quick_replies` plus plugin-registered types via `MessageComponentRegistry`. Ensure accessibility and graceful degradation.
- **Widget & Backend Hooks**: Extend widget props/plugins to evaluate rules and render rich messages. Add backend evaluation pipeline with caching and tracing. Include sample rule presets (welcome message, abandoned cart via Shopify, keyword escalation).
- **Testing & Docs**: Add unit/integration/UI tests for rule evaluation, timers, and rendering. Document automation tab workflows, schema examples, and plugin renderer guidance.

## 7. Analytics, Security, Compliance
- **Analytics Core**: Implement aggregations for time-to-first-response, resolution rate, CSAT, and volume by hour/channel. Provide API endpoints with caching and pagination plus Admin UI charts (Recharts/SVG) and CSV export.
- **Security Hardening**: Enforce JWT/session on admin/agent endpoints, signed widget config/site API keys, IP blocklist, rate limiting, and PII masking at ingest/log write. Add configurable data retention jobs.
- **Compliance**: Provide GDPR export/delete APIs, EU-only storage flags with validation, and audit logging for admin actions. Include alerts for expired/weak secrets.
- **Testing & Docs**: Add tests for analytics correctness, auth guards, rate limiting, masking, retention jobs, and compliance endpoints. Document security model, env vars, and operational runbooks.

## 8. Deployment & <10 Minute Setup
- **One-Command Stack**: Create top-level `docker-compose.yml` covering backend, admin, Postgres, and optional Redis. Add Makefile/npm scripts (`stack:up`, `stack:down`) and health checks. Prefer slim images and env-driven config.
- **Create Bacon App CLI**: Build `create-bacon-app` to scaffold backend config, widget integration (React/Next.js example), and Docker stack. Include automated setup scripts and smoke tests.
- **CI/CD**: Add pipeline steps to build/test the stack, publish images/packages, and validate migrations. Include load-test hooks for scaling profiles.
- **Documentation**: Publish quickstart (<10 minutes) with troubleshooting, environment matrix, and scaling guidance. Encourage automated provisioning and managed services where available.
