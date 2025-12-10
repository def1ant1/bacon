import { PluginDefinition } from '../../src/plugins/types'

const adapter = {
  send(opts: { from: string; to: string; body: string }) {
    if (!opts.from || !opts.to) return { ok: false, error: 'missing_numbers' }
    return { ok: true, sid: 'whatsapp-sid-1', body: opts.body }
  },
}

const plugin: PluginDefinition = {
  id: 'bacon-plugin-twilio-whatsapp',
  name: 'Twilio WhatsApp',
  version: '1.0.0',
  description: 'Twilio WhatsApp channel adapter',
  settings: {
    id: 'bacon-plugin-twilio-whatsapp',
    title: 'Twilio WhatsApp',
    version: '1.0.0',
    schema: {
      type: 'object',
      properties: {
        accountSid: { type: 'string', title: 'Account SID' },
        authToken: { type: 'string', title: 'Auth Token' },
        fromNumber: { type: 'string', title: 'Sender Number' },
      },
      required: ['accountSid', 'authToken', 'fromNumber'],
      default: { accountSid: '', authToken: '', fromNumber: '' },
    },
  },
  actions: {
    test_connection: {
      name: 'test_connection',
      execute: async (_ctx, input) => ({ ok: Boolean(input.accountSid && input.authToken) }),
    },
  },
  channels: {
    whatsapp: {
      channel: 'whatsapp',
      validatePayload: (payload) => {
        const issues: string[] = []
        if (!payload.to) issues.push('missing to')
        if (!payload.body) issues.push('missing body')
        return { ok: issues.length === 0, issues }
      },
      sendMessage: async (ctx, payload) => {
        const res = adapter.send({ from: ctx.settings.fromNumber, to: payload.to, body: payload.body })
        return { ok: res.ok, providerMessageId: res.sid, error: res.error }
      },
    },
  },
  enrichContext: () => [
    { source: 'twilio', content: 'Messages can be dispatched via WhatsApp.', weight: 0.3 },
  ],
}

export default plugin
