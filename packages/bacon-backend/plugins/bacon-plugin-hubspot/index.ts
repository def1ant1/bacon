import { PluginDefinition } from '../../src/plugins/types'

const client = {
  ping(token: string) {
    return Boolean(token)
  },
  createContact(input: { email: string; name?: string }) {
    return { ...input, id: 'hubspot-contact-1' }
  },
}

const plugin: PluginDefinition = {
  id: 'bacon-plugin-hubspot',
  name: 'HubSpot',
  version: '1.0.0',
  description: 'HubSpot CRM integration',
  settings: {
    id: 'bacon-plugin-hubspot',
    title: 'HubSpot',
    version: '1.0.0',
    schema: {
      type: 'object',
      properties: {
        apiKey: { type: 'string', title: 'Private App Token' },
        baseUrl: { type: 'string', title: 'API Base URL', default: 'https://api.hubapi.com' },
      },
      required: ['apiKey'],
      default: { apiKey: '', baseUrl: 'https://api.hubapi.com' },
    },
  },
  actions: {
    test_connection: {
      name: 'test_connection',
      execute: async (_ctx, input) => ({ ok: client.ping(input.apiKey) }),
    },
    create_contact: {
      name: 'create_contact',
      description: 'Create CRM contact',
      execute: async (_ctx, input) => {
        if (!input.email) throw new Error('email required')
        return { ok: true, data: client.createContact(input) }
      },
    },
  },
  enrichContext: () => [{ source: 'hubspot', content: 'HubSpot contact metadata synced.', weight: 0.4 }],
}

export default plugin
