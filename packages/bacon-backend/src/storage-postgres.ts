import { Pool, PoolClient } from 'pg'
import { v4 as uuidv4 } from 'uuid'
import { ChannelMapping, ChannelMessageReceipt, ChatMessage, Sender, StorageAdapter, StoredFile } from './types'

function nowIso() {
  return new Date().toISOString()
}

async function trimHistory(client: PoolClient, sessionId: string, maxHistory: number) {
  await client.query(
    `delete from chat_messages where id in (
      select id from chat_messages where session_id = $1 order by id asc
      offset greatest(0, (select count(*) from chat_messages where session_id = $1) - $2)
    )`,
    [sessionId, maxHistory],
  )
}

export class PostgresStorage implements StorageAdapter {
  constructor(private pool: Pool) {}

  async init() {
    await this.pool.query(`
      create table if not exists conversations (
        id bigserial primary key,
        session_id text unique not null,
        created_at timestamptz not null default now(),
        last_activity_at timestamptz not null default now()
      );
      create table if not exists chat_messages (
        id bigserial primary key,
        session_id text not null references conversations(session_id) on delete cascade,
        sender text not null check (sender in ('user','bot')),
        text text not null,
        created_at timestamptz not null default now()
      );
      create table if not exists chat_files (
        id bigserial primary key,
        session_id text not null references conversations(session_id) on delete cascade,
        original_name text not null,
        mime_type text,
        size_bytes bigint,
        storage_path text not null,
        created_at timestamptz not null default now()
      );
      create table if not exists channel_mappings (
        id bigserial primary key,
        channel text not null,
        external_user_id text not null,
        session_id text not null references conversations(session_id) on delete cascade,
        metadata jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(channel, external_user_id)
      );
      create table if not exists channel_message_receipts (
        id bigserial primary key,
        channel text not null,
        external_user_id text not null,
        session_id text not null references conversations(session_id) on delete cascade,
        provider_message_id text,
        created_at timestamptz not null default now(),
        unique(channel, provider_message_id)
      );
    `)
  }

  private async ensureConversation(sessionId: string) {
    const { rows } = await this.pool.query(
      `insert into conversations(session_id) values ($1)
       on conflict (session_id) do update set last_activity_at = now()
       returning session_id`,
      [sessionId],
    )
    return rows[0]?.session_id
  }

  private mapChannelRow(row: any): ChannelMapping {
    return {
      id: String(row.id),
      channel: row.channel,
      externalUserId: row.external_user_id,
      sessionId: row.session_id,
      metadata: row.metadata || undefined,
      createdAt: row.created_at?.toISOString?.() || row.created_at,
      updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
    }
  }

  async recordMessage(sessionId: string, sender: Sender, text: string, maxHistory: number): Promise<ChatMessage> {
    await this.init()
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await this.ensureConversation(sessionId)
      const { rows } = await client.query(
        `insert into chat_messages(session_id, sender, text) values ($1,$2,$3) returning id, created_at`,
        [sessionId, sender, text],
      )
      await trimHistory(client, sessionId, maxHistory)
      await client.query('commit')
      const row = rows[0]
      return { id: String(row.id), sessionId, sender, text, createdAt: row.created_at.toISOString() }
    } catch (e) {
      await client.query('rollback')
      throw e
    } finally {
      client.release()
    }
  }

  async listMessages(sessionId: string): Promise<ChatMessage[]> {
    await this.init()
    const { rows } = await this.pool.query(
      `select id, session_id as "sessionId", sender, text, to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt"
         from chat_messages where session_id = $1 order by id asc`,
      [sessionId],
    )
    return rows
  }

  async listSessions() {
    await this.init()
    const { rows } = await this.pool.query(
      `with file_counts as (
         select session_id, count(*) as c from chat_files group by session_id
       )
       select c.session_id as "sessionId",
              coalesce(max(m.created_at), c.last_activity_at) as "lastAt",
              count(m.id) as count,
              coalesce(fc.c,0) as "fileCount"
         from conversations c
         left join chat_messages m on m.session_id = c.session_id
         left join file_counts fc on fc.session_id = c.session_id
     group by c.session_id, c.last_activity_at, fc.c
     order by "lastAt" desc nulls last`
    )
    return rows.map((r) => ({ sessionId: r.sessionId, count: Number(r.count), lastAt: r.lastAt?.toISOString?.() || r.lastAt, fileCount: Number(r.fileCount || 0) }))
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.init()
    await this.pool.query('delete from chat_files where session_id = $1', [sessionId])
    await this.pool.query('delete from chat_messages where session_id = $1', [sessionId])
    await this.pool.query('delete from conversations where session_id = $1', [sessionId])
  }

  async saveFile(sessionId: string, info: { originalName: string; mimeType?: string; sizeBytes?: number; storagePath: string }): Promise<StoredFile> {
    await this.init()
    await this.ensureConversation(sessionId)
    const { rows } = await this.pool.query(
      `insert into chat_files(session_id, original_name, mime_type, size_bytes, storage_path) values ($1,$2,$3,$4,$5) returning id, created_at`,
      [sessionId, info.originalName, info.mimeType || null, info.sizeBytes || null, info.storagePath],
    )
    return {
      id: String(rows[0].id),
      sessionId,
      originalName: info.originalName,
      mimeType: info.mimeType,
      sizeBytes: info.sizeBytes,
      storagePath: info.storagePath,
      createdAt: rows[0].created_at.toISOString?.() || rows[0].created_at,
      url: info.storagePath,
    }
  }

  async listFiles(sessionId: string): Promise<StoredFile[]> {
    await this.init()
    const { rows } = await this.pool.query(
      `select id, session_id as "sessionId", original_name as "originalName", mime_type as "mimeType", size_bytes as "sizeBytes", storage_path as "storagePath", to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt" from chat_files where session_id = $1 order by id asc`,
      [sessionId],
    )
    return rows.map((r) => ({ ...r, url: r.storagePath }))
  }

  async deleteFile(id: string): Promise<void> {
    await this.init()
    await this.pool.query('delete from chat_files where id = $1', [id])
  }

  async retentionSweep(retentionDays: number): Promise<void> {
    await this.init()
    if (retentionDays <= 0) return
    await this.pool.query('delete from chat_messages where created_at < now() - ($1 || \" days\")::interval', [retentionDays])
    await this.pool.query('delete from chat_files where created_at < now() - ($1 || \" days\")::interval', [retentionDays])
  }

  async linkChannelConversation(input: {
    channel: string
    externalUserId: string
    sessionIdHint?: string
    metadata?: Record<string, any>
  }): Promise<{ mapping: ChannelMapping; created: boolean }> {
    await this.init()
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      const existing = await client.query(
        'select * from channel_mappings where channel=$1 and external_user_id=$2',
        [input.channel, input.externalUserId],
      )
      if (existing.rows.length) {
        const mergedMeta = { ...(existing.rows[0].metadata || {}), ...(input.metadata || {}) }
        const { rows } = await client.query(
          `update channel_mappings set session_id=$3, metadata=$4, updated_at=now() where channel=$1 and external_user_id=$2 returning *`,
          [input.channel, input.externalUserId, existing.rows[0].session_id, mergedMeta],
        )
        await client.query('commit')
        const fallback =
          rows[0] ||
          ({
            id: uuidv4(),
            channel: input.channel,
            external_user_id: input.externalUserId,
            session_id: existing.rows[0].session_id,
            metadata: mergedMeta,
            created_at: nowIso(),
            updated_at: nowIso(),
          } as any)
        return { mapping: this.mapChannelRow(fallback), created: false }
      }
      const sessionId = input.sessionIdHint || uuidv4()
      await this.ensureConversation(sessionId)
      const { rows } = await client.query(
        `insert into channel_mappings(channel, external_user_id, session_id, metadata)
         values ($1,$2,$3,$4) returning *`,
        [input.channel, input.externalUserId, sessionId, input.metadata || null],
      )
      await client.query('commit')
      const inserted =
        rows[0] ||
        ({
          id: uuidv4(),
          channel: input.channel,
          external_user_id: input.externalUserId,
          session_id: sessionId,
          metadata: input.metadata,
          created_at: nowIso(),
          updated_at: nowIso(),
        } as any)
      return { mapping: this.mapChannelRow(inserted), created: true }
    } catch (e) {
      await client.query('rollback')
      throw e
    } finally {
      client.release()
    }
  }

  async getChannelMapping(channel: string, externalUserId: string): Promise<ChannelMapping | null> {
    await this.init()
    const { rows } = await this.pool.query('select * from channel_mappings where channel=$1 and external_user_id=$2', [
      channel,
      externalUserId,
    ])
    return rows[0] ? this.mapChannelRow(rows[0]) : null
  }

  async recordChannelMessageReceipt(entry: {
    channel: string
    externalUserId: string
    sessionId: string
    providerMessageId?: string
  }): Promise<ChannelMessageReceipt> {
    await this.init()
    const { rows } = await this.pool.query(
      `insert into channel_message_receipts(channel, external_user_id, session_id, provider_message_id)
       values ($1,$2,$3,$4)
       on conflict (channel, provider_message_id) do nothing
       returning *`,
      [entry.channel, entry.externalUserId, entry.sessionId, entry.providerMessageId || null],
    )
    const duplicate = rows.length === 0 && !!entry.providerMessageId
    const receiptRow =
      rows[0] ||
      ({
        id: uuidv4(),
        channel: entry.channel,
        external_user_id: entry.externalUserId,
        session_id: entry.sessionId,
        provider_message_id: entry.providerMessageId || null,
        created_at: nowIso(),
      } as any)
    return {
      id: String(receiptRow?.id || uuidv4()),
      channel: entry.channel,
      externalUserId: entry.externalUserId,
      sessionId: entry.sessionId,
      providerMessageId: entry.providerMessageId || undefined,
      createdAt: receiptRow?.created_at?.toISOString?.() || receiptRow?.created_at || nowIso(),
      duplicate,
    }
  }
}
