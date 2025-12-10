-- pgvector knowledge base schema
create extension if not exists vector;

create table if not exists kb_documents (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null,
  bot_id text not null,
  name text not null,
  source_type text not null default 'upload',
  version int not null default 1,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists kb_documents_brand_bot_name_idx on kb_documents(brand_id, bot_id, name);

create table if not exists kb_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references kb_documents(id) on delete cascade,
  brand_id text not null,
  bot_id text not null,
  content text not null,
  embedding vector(1536),
  position int not null,
  token_estimate int not null default 0,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists kb_chunks_brand_bot_idx on kb_chunks(brand_id, bot_id);
create index if not exists kb_chunks_doc_idx on kb_chunks(document_id);
create index if not exists kb_chunks_metadata_idx on kb_chunks using gin (metadata);
create index if not exists kb_chunks_position_idx on kb_chunks(position);
