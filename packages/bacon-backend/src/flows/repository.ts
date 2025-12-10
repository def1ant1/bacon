import { randomUUID } from 'crypto'
import { Pool } from 'pg'
import { FlowDefinition } from './types'

export interface FlowRepository {
  list(botId?: string): Promise<FlowDefinition[]>
  get(flowId: string): Promise<FlowDefinition | null>
  create(flow: Omit<FlowDefinition, 'id' | 'version' | 'createdAt' | 'updatedAt'>): Promise<FlowDefinition>
  update(flow: FlowDefinition): Promise<FlowDefinition>
  delete(flowId: string): Promise<void>
}

export class MemoryFlowRepository implements FlowRepository {
  private flows = new Map<string, FlowDefinition>()

  async list(botId?: string): Promise<FlowDefinition[]> {
    const all = Array.from(this.flows.values())
    return botId ? all.filter((f) => f.botId === botId) : all
  }

  async get(flowId: string): Promise<FlowDefinition | null> {
    return this.flows.get(flowId) || null
  }

  async create(flow: Omit<FlowDefinition, 'id' | 'version' | 'createdAt' | 'updatedAt'>): Promise<FlowDefinition> {
    const id = randomUUID()
    const now = new Date().toISOString()
    const created: FlowDefinition = { ...flow, id, version: 1, createdAt: now, updatedAt: now }
    this.flows.set(id, created)
    return created
  }

  async update(flow: FlowDefinition): Promise<FlowDefinition> {
    const existing = this.flows.get(flow.id)
    if (!existing) throw new Error('flow_not_found')
    if (existing.version !== flow.version) throw new Error('version_conflict')
    const next = { ...flow, version: flow.version + 1, updatedAt: new Date().toISOString() }
    this.flows.set(flow.id, next)
    return next
  }

  async delete(flowId: string): Promise<void> {
    this.flows.delete(flowId)
  }
}

export class PostgresFlowRepository implements FlowRepository {
  constructor(private pool: Pool) {}

  async list(botId?: string): Promise<FlowDefinition[]> {
    const res = await this.pool.query(
      'select * from flows where ($1::text is null or bot_id = $1) order by updated_at desc',
      [botId || null]
    )
    return res.rows.map(mapRowToFlow)
  }

  async get(flowId: string): Promise<FlowDefinition | null> {
    const res = await this.pool.query('select * from flows where id = $1', [flowId])
    return res.rows[0] ? mapRowToFlow(res.rows[0]) : null
  }

  async create(flow: Omit<FlowDefinition, 'id' | 'version' | 'createdAt' | 'updatedAt'>): Promise<FlowDefinition> {
    const res = await this.pool.query(
      'insert into flows (bot_id, name, description, nodes, edges, version, created_at, updated_at, created_by, updated_by) values ($1,$2,$3,$4,$5,1,now(),now(),$6,$7) returning *',
      [flow.botId, flow.name, flow.description, JSON.stringify(flow.nodes), JSON.stringify(flow.edges), flow.createdBy, flow.updatedBy]
    )
    return mapRowToFlow(res.rows[0])
  }

  async update(flow: FlowDefinition): Promise<FlowDefinition> {
    const res = await this.pool.query(
      'update flows set name=$2, description=$3, nodes=$4, edges=$5, version=version+1, updated_at=now(), updated_by=$6 where id=$1 and version=$7 returning *',
      [flow.id, flow.name, flow.description, JSON.stringify(flow.nodes), JSON.stringify(flow.edges), flow.updatedBy, flow.version]
    )
    if (res.rowCount === 0) throw new Error('version_conflict')
    return mapRowToFlow(res.rows[0])
  }

  async delete(flowId: string): Promise<void> {
    await this.pool.query('delete from flows where id = $1', [flowId])
  }
}

function mapRowToFlow(row: any): FlowDefinition {
  return {
    id: row.id,
    botId: row.bot_id,
    name: row.name,
    description: row.description || undefined,
    nodes: row.nodes,
    edges: row.edges,
    version: Number(row.version),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    createdBy: row.created_by || undefined,
    updatedBy: row.updated_by || undefined,
  }
}
