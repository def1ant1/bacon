# Operational playbook

## Runtime profiles
- **Docker**: builds the widget + backend into a single image and exposes port 3001 with baked-in `/healthz`/`/readyz` probes.
- **Serverless container**: use `ops/serverless.template.yml` to deploy the container image to AWS Lambda via HTTP API.

## Environment validation
Run `npm run env:check` locally and in CI. Required: `PORT`, `HOST`. Optional with defaults: `POSTGRES_URL` (falls back to in-memory), `BEARER_TOKEN` or `JWT_SECRET` for securing admin APIs, transport toggles for websocket/polling.

### Security controls
- `BLOCKLIST_IPS` (comma-separated) will reject listed client IPs before any routing logic.
- `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_MS` protect the admin/agent API surface with an in-memory token bucket. Pair with a CDN/WAF for production.
- PII masking is applied to inbound chat text to redact emails/phone numbers before storage; avoid logging raw chat payloads downstream.

### Retention + compliance
- Messages are trimmed by the retention sweep configured in settings (`behavior.retentionDays`) and run every 30 minutes by default.
- `/api/admin/compliance/export` and `/api/admin/compliance/delete` provide GDPR-style export and erasure per session ID; enforce JWT/bearer auth upstream.
- Region-locking is left to infrastructure (e.g., regional Postgres/S3). Keep `POSTGRES_URL` scoped to the target region.

## Observability
The default logger in `packages/bacon-backend/src/server.ts` stamps ISO timestamps and severity labels. Health endpoints surface readiness for probes and uptime checks.

## Deploy steps
1. `npm ci && npm run build`
2. `docker build -t <registry>/bacon-backend:latest .`
3. `docker push <registry>/bacon-backend:latest`
4. For serverless, update `ops/serverless.template.yml`'s `custom.ecrImage` and run `serverless deploy --param="ecrImage=<registry>/bacon-backend:latest"`.
