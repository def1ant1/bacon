# Knowledge Base Plugin (pgvector-ready)

This experimental knowledge base flow adds deterministic chunking, embedding, and retrieval that can run without vendor SDKs while remaining pgvector/Supabase friendly.

## Migrations

`packages/bacon-backend/plugins/bacon-plugin-pgvector-kb/migrations/001_init.sql` provisions:

- `kb_documents` keyed by brand/bot with versioning metadata
- `kb_chunks` storing chunk text, embeddings (pgvector), and metadata JSON for filtering
- GIN/BTREE indexes for metadata lookups and updated_at ordering

Run in CI or locally:

```bash
npm run db:up # optional Postgres for local
psql $DATABASE_URL -f packages/bacon-backend/plugins/bacon-plugin-pgvector-kb/migrations/001_init.sql
```

## API surface

- `POST /api/admin/kb/upload`: accepts multipart markdown/PDF/FAQ files. Query/body fields: `brandId`, `botId`. Returns document + chunks. Requires admin auth token when configured.
- Background rebuild: call `KnowledgeBaseService.rebuildIndex` (e.g., cron) to re-embed stored chunks.

## Retrieval middleware

`Pipeline` now hydrates AI prompts with the top-k retrieved chunks scoped to brand/bot before calling the configured AI provider. Caching and a small rate-limit guard reduce provider calls.

## Testing

```
npm test -- --runInBand --filter kb
```

Vitest coverage validates chunking determinism and retrieval behavior.
