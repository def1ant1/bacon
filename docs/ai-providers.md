# AI Provider architecture

This service now standardizes AI connectivity behind a provider-neutral contract with explicit `chat`, `embed`, and `metadata` operations. The adapter is defensive by default and optimized for operational hygiene.

## Interface
- `packages/bacon-backend/src/ai/providers/types.ts` defines `AiProviderV2`, `ProviderMetadata`, and health contracts.
- `packages/bacon-backend/src/ai/providers/http.ts` supplies a pluggable HTTP client with retries, jittered backoff, and a circuit breaker.
- `packages/bacon-backend/src/ai/provider-router.ts` adapts the registry to the legacy pipeline and enforces fallback ordering.

## Supported providers
- **OpenAI** – configured via `OPENAI_API_KEY`, optional `OPENAI_BASE_URL`, `OPENAI_MODEL`, and `OPENAI_EMBEDDING_MODEL`.
- **xAI Grok** – configured via `GROK_API_KEY`, optional `GROK_BASE_URL`, `GROK_MODEL`.
- **Google Gemini** – configured via `GEMINI_API_KEY`, optional `GEMINI_BASE_URL`, `GEMINI_MODEL`.
- **Meta Llama** – configured via `LLAMA_API_KEY`, optional `LLAMA_BASE_URL`, `LLAMA_MODEL`.
- **Echo** – deterministic local provider used for smoke/fallback flows.

Providers register automatically when corresponding environment variables are present; failures are logged with debug-level detail to avoid noisy boot logs.

## Admin configuration
Provider selection is persisted in Postgres via `PostgresSettingsStore` (`app_settings` table). Admin APIs sanitize invalid provider names back to `echo` and expose discovery endpoints:
- `GET /api/admin/ai/providers` – advertised providers.
- `GET /api/admin/ai/providers/health` – per-provider health view.

## Observability and resiliency
- Circuit breaker protects shared HTTP client; retries use exponential backoff with jitter.
- `ProviderHooks` let you attach loggers/metrics/traces without modifying provider code.
- Request IDs from OpenAI are propagated into responses for correlation.

## Testing strategy
- Unit coverage for the provider router, OpenAI retry logic, and pipeline fallback behavior lives under `packages/bacon-backend/__tests__`.
- Smoke validation (`ai.smoke.test.ts`) ensures invalid provider config is normalized before runtime.
- Add `npm run smoke:ai` in CI to validate configuration guards without hitting real APIs. Integration tests stub HTTP clients rather than calling vendors.
