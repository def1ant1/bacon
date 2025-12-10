import { FlowDefinition, FlowExecutionContext, FlowExecutionResult, FlowNode, FlowTraceEntry, NodeExecutionResult } from './types'

export type NodeExecutor = (
  node: FlowNode,
  ctx: FlowExecutionContext
) => Promise<NodeExecutionResult> | NodeExecutionResult

export interface FlowEngineOptions {
  executors?: Partial<Record<string, NodeExecutor>>
  defaultTimeoutMs?: number
  logger?: Pick<Console, 'info' | 'warn' | 'error' | 'debug'>
}

export class FlowEngine {
  private executors: Record<string, NodeExecutor>
  private logger: Pick<Console, 'info' | 'warn' | 'error' | 'debug'>
  private defaultTimeout: number

  constructor(opts: FlowEngineOptions = {}) {
    this.executors = { ...defaultExecutors, ...(opts.executors || {}) }
    this.defaultTimeout = opts.defaultTimeoutMs ?? 15000
    this.logger = opts.logger || console
  }

  async run(flow: FlowDefinition, ctx: FlowExecutionContext): Promise<FlowExecutionResult> {
    const trace: FlowTraceEntry[] = []
    const visited = new Set<string>()
    let current = findStartNode(flow)
    let output: any

    while (current) {
      if (visited.has(current.id)) {
        trace.push(traceEntry(current, 'error', { errorMessage: 'cycle_detected' }))
        break
      }
      visited.add(current.id)

      const exec = this.executors[current.type]
      const startedAt = new Date().toISOString()
      try {
        const result = await withTimeout(exec(current, ctx), this.defaultTimeout)
        const completedAt = new Date().toISOString()
        trace.push({
          nodeId: current.id,
          nodeType: current.type,
          startedAt,
          completedAt,
          outcome: result.status === 'ok' ? 'success' : result.status === 'skip' ? 'skipped' : 'error',
          details: result.data,
          errorMessage: result.error?.message,
        })
        if (result.status === 'error') break
        output = result.data ?? output
        const nextId = result.nextNodeId || pickNext(flow, current.id, ctx, result)
        current = nextId ? flow.nodes.find((n) => n.id === nextId) || null : null
      } catch (err: any) {
        const completedAt = new Date().toISOString()
        trace.push({
          nodeId: current.id,
          nodeType: current.type,
          startedAt,
          completedAt,
          outcome: 'error',
          errorMessage: err?.message || 'execution_failed',
        })
        this.logger.error?.('[flow] node failed', current.id, err)
        break
      }
    }

    return { flowId: flow.id, version: flow.version, trace, output }
  }
}

function traceEntry(node: FlowNode, outcome: FlowTraceEntry['outcome'], extra?: Partial<FlowTraceEntry>): FlowTraceEntry {
  const now = new Date().toISOString()
  return {
    nodeId: node.id,
    nodeType: node.type,
    startedAt: now,
    completedAt: now,
    outcome,
    ...extra,
  }
}

function pickNext(flow: FlowDefinition, nodeId: string, ctx: FlowExecutionContext, result: NodeExecutionResult) {
  const outgoing = flow.edges.filter((e) => e.source === nodeId)
  if (outgoing.length === 0) return undefined
  if (outgoing.length === 1) return outgoing[0].target
  const firstMatch = outgoing.find((e) => evaluateCondition(e.condition, ctx, result))
  return firstMatch?.target
}

function evaluateCondition(condition: string | undefined, ctx: FlowExecutionContext, result: NodeExecutionResult) {
  if (!condition) return true
  if (condition.startsWith('flag:')) {
    const key = condition.replace('flag:', '')
    return Boolean(ctx.vars[key])
  }
  if (condition.startsWith('equals:')) {
    const [, path, expected] = condition.split(':')
    const actual = ctx.vars[path] ?? (result.data as any)?.[path]
    return String(actual) === expected
  }
  return false
}

const defaultExecutors: Record<string, NodeExecutor> = {
  start: (node) => ({ status: 'ok', nextNodeId: node.config?.nextNodeId }),
  end: () => ({ status: 'ok' }),
  delay: async (node) => {
    const ms = Number(node.config?.ms || 0)
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms))
    return { status: 'ok' }
  },
  condition: (node, ctx) => {
    const shouldBranch = evaluateCondition(node.config?.when, ctx, { status: 'ok' })
    return { status: 'ok', nextNodeId: shouldBranch ? node.config?.trueTarget : node.config?.falseTarget }
  },
  llm: async (node) => {
    const text = node.config?.mockResponse || 'llm-response'
    return { status: 'ok', data: { text } }
  },
  http_request: async (node) => {
    const response = { status: 200, body: node.config?.mockBody ?? { ok: true } }
    return { status: 'ok', data: response }
  },
  escalate_to_agent: () => ({ status: 'ok', data: { escalated: true } }),
  crm_lookup: () => ({ status: 'ok', data: { crm: { id: 'stubbed-crm' } } }),
  shopify_order_lookup: () => ({ status: 'ok', data: { shopify: { status: 'stubbed' } } }),
}

function findStartNode(flow: FlowDefinition): FlowNode | null {
  return flow.nodes.find((n) => n.type === 'start') || flow.nodes[0] || null
}

async function withTimeout<T>(promise: Promise<T> | T, timeoutMs: number): Promise<T> {
  if (!(promise instanceof Promise)) return promise
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('node_timeout')), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!))
}
