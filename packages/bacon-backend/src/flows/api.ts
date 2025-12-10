import { FlowEngine } from './engine'
import { FlowRepository } from './repository'
import { FlowDefinition, FlowExecutionContext } from './types'

export interface FlowApiOptions {
  repository: FlowRepository
  engine?: FlowEngine
  authenticate?: (req: any) => boolean
}

export function buildFlowApi({ repository, engine = new FlowEngine(), authenticate }: FlowApiOptions) {
  return async function handleFlow(req: any, res: any, url: URL) {
    if (!authenticate?.(req)) return sendJson(res, { error: 'unauthorized' }, 401)
    if (req.method === 'GET' && url.pathname === '/api/flows') {
      const botId = url.searchParams.get('botId') || undefined
      const flows = await repository.list(botId)
      return sendJson(res, { flows })
    }

    if (req.method === 'POST' && url.pathname === '/api/flows') {
      const body = await readJson(req)
      const created = await repository.create(body as any)
      return sendJson(res, created, 201)
    }

    const segments = url.pathname.split('/').filter(Boolean)
    if (segments[0] !== 'api' || segments[1] !== 'flows') return false
    const flowId = segments[2]
    const tail = segments.slice(3)

    if (req.method === 'GET' && tail.length === 0) {
      const flow = await repository.get(flowId)
      return flow ? sendJson(res, flow) : sendJson(res, { error: 'not_found' }, 404)
    }

    if (req.method === 'PUT' && tail.length === 0) {
      const body = (await readJson(req)) as FlowDefinition
      const updated = await repository.update(body)
      return sendJson(res, updated)
    }

    if (req.method === 'DELETE' && tail.length === 0) {
      await repository.delete(flowId)
      return sendJson(res, { ok: true })
    }

    if (req.method === 'POST' && tail[0] === 'preview') {
      const body = await readJson(req)
      const flow = await repository.get(flowId)
      if (!flow) return sendJson(res, { error: 'not_found' }, 404)
      const ctx: FlowExecutionContext = { input: body.input, vars: body.vars || {}, botId: flow.botId }
      const result = await engine.run(flow, ctx)
      return sendJson(res, result)
    }

    return false
  }
}

async function readJson(req: any) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

function sendJson(res: any, payload: any, status = 200) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(payload))
}
