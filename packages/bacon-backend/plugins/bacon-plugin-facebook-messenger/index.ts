import { PluginDefinition } from '../../src/plugins/types'

const plugin: PluginDefinition = {
  id: 'bacon-plugin-facebook-messenger',
  name: 'Facebook Messenger (placeholder)',
  version: '0.1.0',
  description: 'Starter adapter scaffold for Facebook Messenger integrations.',
  settings: {
    id: 'bacon-plugin-facebook-messenger',
    title: 'Facebook Messenger',
    version: '0.1.0',
    schema: {
      type: 'object',
      properties: {
        pageToken: { type: 'string', title: 'Page Access Token' },
        verifyToken: { type: 'string', title: 'Webhook Verify Token' },
      },
      required: ['pageToken', 'verifyToken'],
      default: { pageToken: '', verifyToken: '' },
    },
  },
  channels: {
    messenger: {
      channel: 'messenger',
      displayName: 'Facebook Messenger',
      capabilities: { inbound: true, outbound: true, attachments: true },
      normalizeInbound: (payload: any) => ({
        externalUserId: String(payload?.sender?.id || payload?.sender || 'unknown'),
        text: String(payload?.message?.text || payload?.text || ''),
        providerMessageId: payload?.message?.mid,
        metadata: { page: payload?.recipient?.id },
      }),
      async sendMessage(_ctx, payload) {
        // Placeholder: In production this would call the Messenger Send API.
        return { ok: true, providerMessageId: `fb-${Date.now()}` }
      },
    },
  },
}

export default plugin
