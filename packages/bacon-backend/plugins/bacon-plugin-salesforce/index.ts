import { PluginDefinition } from '../../src/plugins/types'

const client = {
  authenticate(username: string, password: string) {
    return Boolean(username && password)
  },
  upsertLead(payload: { email: string; account?: string }) {
    return { id: 'sf-lead-1', ...payload }
  },
}

const plugin: PluginDefinition = {
  id: 'bacon-plugin-salesforce',
  name: 'Salesforce',
  version: '1.0.0',
  description: 'Salesforce CRM adapter',
  settings: {
    id: 'bacon-plugin-salesforce',
    title: 'Salesforce',
    version: '1.0.0',
    schema: {
      type: 'object',
      properties: {
        username: { type: 'string', title: 'Username' },
        password: { type: 'string', title: 'Password' },
      },
      required: ['username', 'password'],
      default: { username: '', password: '' },
    },
  },
  actions: {
    test_connection: {
      name: 'test_connection',
      execute: async (_ctx, input) => ({ ok: client.authenticate(input.username, input.password) }),
    },
    upsert_lead: {
      name: 'upsert_lead',
      retry: { attempts: 3, backoffMs: 100 },
      execute: async (_ctx, input) => {
        if (!input.email) throw new Error('email required')
        return { ok: true, data: client.upsertLead(input) }
      },
    },
  },
  enrichContext: () => [{ source: 'salesforce', content: 'Salesforce CRM data available.', weight: 0.5 }],
}

export default plugin
