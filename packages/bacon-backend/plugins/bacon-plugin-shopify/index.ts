import { PluginDefinition } from '../../src/plugins/types'

const mockShopifyClient = {
  testConnection(config: { apiKey: string; shopDomain: string }) {
    return !!config.apiKey && !!config.shopDomain
  },
  fetchOrder(orderId: string) {
    return { id: orderId, status: 'paid', total: '100.00' }
  },
}

const plugin: PluginDefinition = {
  id: 'bacon-plugin-shopify',
  name: 'Shopify',
  version: '1.0.0',
  description: 'Shopify commerce adapter',
  settings: {
    id: 'bacon-plugin-shopify',
    title: 'Shopify',
    version: '1.0.0',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        apiKey: { type: 'string', title: 'API Key' },
        shopDomain: { type: 'string', title: 'Shop Domain' },
      },
      required: ['apiKey', 'shopDomain'],
      default: { apiKey: '', shopDomain: '' },
    },
  },
  actions: {
    test_connection: {
      name: 'test_connection',
      description: 'Validate Shopify credentials',
      execute: async (_ctx, input) => {
        const ok = mockShopifyClient.testConnection({
          apiKey: input.apiKey,
          shopDomain: input.shopDomain,
        })
        return { ok, data: { reachable: ok } }
      },
    },
    fetch_order: {
      name: 'fetch_order',
      description: 'Lookup an order by ID',
      retry: { attempts: 2, backoffMs: 50 },
      execute: async (_ctx, input) => {
        if (!input.orderId) throw new Error('orderId required')
        return { ok: true, data: mockShopifyClient.fetchOrder(input.orderId) }
      },
    },
  },
  enrichContext: async (_ctx) => [
    { source: 'shopify', content: 'Latest Shopify order status available.', weight: 0.6 },
  ],
}

export default plugin
