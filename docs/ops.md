# Operational playbook

## Runtime profiles
- **Docker**: builds the widget + backend into a single image and exposes port 3001 with baked-in `/healthz`/`/readyz` probes.
- **Serverless container**: use `ops/serverless.template.yml` to deploy the container image to AWS Lambda via HTTP API.

## Environment validation
Run `npm run env:check` locally and in CI. Required: `PORT`, `HOST`. Optional with defaults: `POSTGRES_URL` (falls back to in-memory), `BEARER_TOKEN` or `JWT_SECRET` for securing admin APIs, transport toggles for websocket/polling.

## Observability
The default logger in `packages/bacon-backend/src/server.ts` stamps ISO timestamps and severity labels. Health endpoints surface readiness for probes and uptime checks.

## Deploy steps
1. `npm ci && npm run build`
2. `docker build -t <registry>/bacon-backend:latest .`
3. `docker push <registry>/bacon-backend:latest`
4. For serverless, update `ops/serverless.template.yml`'s `custom.ecrImage` and run `serverless deploy --param="ecrImage=<registry>/bacon-backend:latest"`.
