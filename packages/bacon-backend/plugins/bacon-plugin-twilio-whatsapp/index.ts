import { PluginDefinition } from '../../src/plugins/types'

const normalizeInbound = (payload: any) => ({
  externalUserId: String(payload.From || payload.from || payload.sender || 'unknown'),
  text: String(payload.Body || payload.body || payload.text || ''),
  providerMessageId: payload.MessageSid || payload.SmsMessageSid || payload.Sid || payload.sid,
  metadata: { to: payload.To || payload.to, profileName: payload.ProfileName || payload.profileName },
})

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
      displayName: 'Twilio WhatsApp',
      capabilities: { inbound: true, outbound: true },
      normalizeInbound,
      sendMessage: async (ctx, payload) => {
        const res = adapter.send({ from: ctx.settings.fromNumber, to: payload.metadata?.to || (payload as any).to, body: payload.text })
        return { ok: res.ok, providerMessageId: res.sid, error: res.error }
      },
    },
  },
  enrichContext: () => [
    { source: 'twilio', content: 'Messages can be dispatched via WhatsApp.', weight: 0.3 },
  ],
}

export default plugin
