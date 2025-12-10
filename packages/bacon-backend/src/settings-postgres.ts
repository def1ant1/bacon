import { Pool } from 'pg'
import { AdminSettings } from './types'

/**
 * Centralized persistence for admin settings (including AI provider choice) in Postgres.
 * This keeps the service ready for multi-instance deployments without local state drift.
 */
export class PostgresSettingsStore {
  constructor(private readonly pool: Pool, private readonly key = 'admin_settings') {}

  private async ensureTable() {
    await this.pool.query(`create table if not exists app_settings (key text primary key, payload jsonb not null, updated_at timestamptz not null default now())`)
  }

  async load(): Promise<Partial<AdminSettings>> {
    await this.ensureTable()
    const { rows } = await this.pool.query('select payload from app_settings where key = $1', [this.key])
    return (rows[0]?.payload as Partial<AdminSettings>) || {}
  }

  async save(settings: AdminSettings): Promise<void> {
    await this.ensureTable()
    await this.pool.query(
      `insert into app_settings(key, payload) values ($1,$2)
       on conflict (key) do update set payload = excluded.payload, updated_at = now()`,
      [this.key, settings],
    )
  }

  async reset(): Promise<Partial<AdminSettings>> {
    await this.ensureTable()
    await this.pool.query('delete from app_settings where key = $1', [this.key])
    return {}
  }
}
