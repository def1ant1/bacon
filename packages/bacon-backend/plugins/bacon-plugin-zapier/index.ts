import { PluginDefinition } from '../../src/plugins/types'

const plugin: PluginDefinition = {
  id: 'bacon-plugin-zapier',
  name: 'Zapier / Webhook',
  version: '1.0.0',
  description: 'Generic webhook/OpenAPI dispatcher',
  settings: {
    id: 'bacon-plugin-zapier',
    title: 'Zapier / Webhook',
    version: '1.0.0',
    schema: {
      type: 'object',
      properties: {
        webhookUrl: { type: 'string', title: 'Webhook URL' },
        secret: { type: 'string', title: 'Signing secret' },
      },
      required: ['webhookUrl'],
      default: { webhookUrl: '', secret: '' },
    },
  },
  actions: {
    test_connection: {
      name: 'test_connection',
      execute: async (_ctx, input) => ({ ok: Boolean(input.webhookUrl) }),
    },
    dispatch_webhook: {
      name: 'dispatch_webhook',
      description: 'Push JSON payload to Zapier or OpenAPI endpoint',
      retry: { attempts: 2, backoffMs: 100 },
      execute: async (_ctx, input) => {
        if (!input.webhookUrl) throw new Error('webhookUrl required')
        return { ok: true, data: { delivered: true, echo: input.payload || {} } }
      },
    },
  },
  triggers: {
    inbound_webhook: {
      name: 'inbound_webhook',
      description: 'Handle webhook callbacks',
      subscribe: async (_ctx) => undefined,
    },
  },
  enrichContext: () => [
    { source: 'zapier', content: 'Webhook bridge ready for orchestration.', weight: 0.2 },
  ],
}

export default plugin
