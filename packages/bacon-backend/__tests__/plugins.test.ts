import { describe, expect, it, vi } from 'vitest'
import path from 'path'
import { PluginLoader } from '../src/plugins/loader'
import { PluginRegistry } from '../src/plugins/registry'
import shopify from '../plugins/bacon-plugin-shopify'
import { FlowEngine } from '../src/flows/engine'
import { FlowDefinition } from '../src/flows/types'

const baseCtx = {
  tenantId: 'tenant-1',
  botId: 'bot-1',
  settings: {},
  secrets: { get: () => undefined },
  logger: console,
  aiContext: { enrichments: [] as any[], add(e: any) { this.enrichments.push(e) } },
}

describe('plugin loader', () => {
  it('loads and caches plugin definitions and validates schema defaults', async () => {
    const loader = new PluginLoader({ baseDir: path.join(__dirname, '..') })
    const first = await loader.load('./plugins/bacon-plugin-shopify/index.ts')
    const second = await loader.load('./plugins/bacon-plugin-shopify/index.ts')
    expect(first.definition.id).toBe('bacon-plugin-shopify')
    expect(first).toBe(second)
    expect(first.definition.settings.schema.default.shopDomain).toBe('')
  })
})

describe('plugin registry', () => {
  it('supports retries and audit logging for transient errors', async () => {
    const audit: any[] = []
    const registry = new PluginRegistry({ auditSink: (entry) => audit.push(entry), logger: console })
    let attempts = 0
    registry.register({
      id: 'retry-plugin',
      name: 'Retry Plugin',
      version: '1.0.0',
      settings: { id: 'retry-plugin', title: 'Retry', version: '1.0.0', schema: { type: 'object', default: {} } },
      actions: {
        unstable: {
          name: 'unstable',
          retry: { attempts: 2, backoffMs: 1 },
          execute: vi.fn(async () => {
            attempts += 1
            if (attempts === 1) throw new Error('flaky')
            return { ok: true, data: { attempts } }
          }),
        },
      },
    })

    const result = await registry.invokeAction('retry-plugin', 'unstable', baseCtx, {})
    expect(result.ok).toBe(true)
    expect(attempts).toBe(2)
    expect(audit.some((a) => a.status === 'error')).toBe(true)
  })

  it('retries and audits when an action returns ok=false without throwing', async () => {
    const audit: any[] = []
    const registry = new PluginRegistry({ auditSink: (entry) => audit.push(entry), logger: console })
    let attempts = 0
    registry.register({
      id: 'soft-fail-plugin',
      name: 'Soft Fail Plugin',
      version: '1.0.0',
      settings: { id: 'soft-fail-plugin', title: 'Soft Fail', version: '1.0.0', schema: { type: 'object', default: {} } },
      actions: {
        flaky: {
          name: 'flaky',
          retry: { attempts: 2, backoffMs: 1 },
          execute: vi.fn(async () => {
            attempts += 1
            // First call returns ok=false, second succeeds, simulating APIs that
            // signal failure via the response object instead of throwing.
            if (attempts === 1) return { ok: false, error: 'missing credentials' }
            return { ok: true, data: { attempts } }
          }),
        },
      },
    })

    const result = await registry.invokeAction('soft-fail-plugin', 'flaky', baseCtx, {})
    expect(result.ok).toBe(true)
    expect(attempts).toBe(2)
    expect(audit.some((a) => a.status === 'error' && a.error?.includes('missing credentials'))).toBe(true)
  })
})

describe('flow engine integration with plugins', () => {
  it('executes plugin_action nodes with audit + retries', async () => {
    const registry = new PluginRegistry({ logger: console })
    registry.register(shopify)

    const runtime = {
      invokeAction: (pluginId: string, action: string, input: any) =>
        registry.invokeAction(pluginId, action, { ...baseCtx, settings: shopify.settings.schema.default }, input),
    }

    const flow: FlowDefinition = {
      id: 'flow',
      botId: 'bot-1',
      name: 'plugin flow',
      nodes: [
        { id: 'start', type: 'start', config: {} },
        {
          id: 'plugin-node',
          type: 'plugin_action',
          config: { pluginId: 'bacon-plugin-shopify', actionName: 'fetch_order', payload: { orderId: '123' } },
        },
        { id: 'end', type: 'end', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'plugin-node' },
        { id: 'e2', source: 'plugin-node', target: 'end' },
      ],
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const engine = new FlowEngine({})
    const run = await engine.run(flow, { input: {}, vars: {}, botId: 'bot-1', plugins: runtime })
    const actionTrace = run.trace.find((t) => t.nodeId === 'plugin-node')
    expect(actionTrace?.outcome).toBe('success')
    expect(run.output).toBeDefined()
  })
})
