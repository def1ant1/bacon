import React from 'react'
import {
  CustomerSupportChatWidget,
  type BaconPlugin,
  createAuthTokenRefresherPlugin,
  createLoggingPlugin,
  createTracingPlugin,
} from 'customer-support-chat-widget'
import 'customer-support-chat-widget/dist/index.css'

type TransportChoice = 'polling' | 'websocket'

type AdminSettings = any

function deriveWebSocketUrl(apiUrl: string, wsPath?: string) {
  const base = apiUrl || '/api/chat'
  const path = wsPath || '/api/chat/ws'
  const url = new URL(base, window.location.origin)
  if (path.startsWith('ws://') || path.startsWith('wss://')) return path
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = path.startsWith('/') ? path : `${url.pathname.replace(/\/chat$/, '')}/${path}`
  return url.toString()
}

export default function App() {
  const [settings, setSettings] = React.useState<AdminSettings | null>(null)
  const [transport, setTransport] = React.useState<TransportChoice>('polling')
  const [connectionState, setConnectionState] = React.useState('idle')
  const [lastEvent, setLastEvent] = React.useState('')

  React.useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((s) => setSettings(s))
      .catch(() => setSettings(null))
  }, [])

  React.useEffect(() => {
    if (settings?.transports?.default) {
      setTransport(settings.transports.default)
    }
  }, [settings?.transports?.default])

  React.useEffect(() => {
    const id = 'chat-admin-custom-css'
    let css = settings?.branding?.customCss || ''
    const pos = settings?.general?.launcherPosition || 'bottom-right'
    if (pos === 'bottom-left') {
      css += `\n.cs-chat-launcher{right:auto !important;left:24px !important}\n.cs-chat-panel{right:auto !important;left:24px !important}`
    }
    let tag = document.getElementById(id)
    if (!tag) {
      tag = document.createElement('style')
      tag.id = id
      document.head.appendChild(tag)
    }
    tag.textContent = css
  }, [settings])

  const rawApi = settings?.integrations?.apiUrl
  const normalizeApi = (v: any) => {
    const s = typeof v === 'string' ? v.trim() : ''
    if (!s) return '/api/chat'
    const isAbs = /^https?:\/\//i.test(s)
    const isRel = s.startsWith('/')
    if (!isAbs && !isRel) return '/api/chat'
    try {
      if (isAbs) {
        const u = new URL(s)
        const sameOrigin = typeof window !== 'undefined' && u.origin === window.location.origin
        if (!sameOrigin && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
          return '/api/chat'
        }
      }
    } catch {}
    return s
  }
  const apiUrl = normalizeApi(rawApi)
  const wsUrl = deriveWebSocketUrl(apiUrl, settings?.transports?.webSocketPath)
  const title = settings?.general?.title ?? 'Support'
  const defaultOpen = !!(settings?.general?.defaultOpen ?? true)
  const primaryColor = settings?.branding?.primaryColor ?? '#2563eb'
  const welcomeMessage = settings?.general?.welcomeMessage ?? 'Hi! How can we help today?'
  const pollIntervalMs = settings?.transports?.pollIntervalMs ?? 1500

  const observabilityPlugin = React.useMemo<BaconPlugin>(() => ({
    name: 'example-observer',
    onConnectionEvent: (meta) => {
      setConnectionState(meta.state)
      setLastEvent(`connection:${meta.state}${meta.reason ? ` (${meta.reason})` : ''}`)
    },
    onTelemetry: (event) => setLastEvent(String((event as any).name || (event as any).type || 'telemetry')),
    onMessages: (messages) => {
      setLastEvent(`messages:${messages.length}`)
      return { messages }
    },
  }), [])

  const plugins = React.useMemo<BaconPlugin[]>(() => {
    const enabled: BaconPlugin[] = [observabilityPlugin]
    if (settings?.plugins?.logging) {
      enabled.push(
        createLoggingPlugin({
          log: (event, detail) => {
            setLastEvent(event)
            console.info('[example:plugin]', event, detail)
          },
        }),
      )
    }
    if (settings?.plugins?.tracing) enabled.push(createTracingPlugin())
    if (settings?.plugins?.authTokenRefresher) {
      enabled.push(
        createAuthTokenRefresherPlugin({
          fetchToken: async () => 'demo-token',
        }),
      )
    }
    return enabled
  }, [observabilityPlugin, settings?.plugins?.authTokenRefresher, settings?.plugins?.logging, settings?.plugins?.tracing])

  const transportOptions = React.useMemo(
    () => ({ pollIntervalMs, webSocketUrl: wsUrl, apiUrl }),
    [apiUrl, pollIntervalMs, wsUrl],
  )

  return (
    <div style={{ fontFamily: 'ui-sans-serif, system-ui, Arial', padding: 24 }}>
      <h1 style={{ margin: 0 }}>Chatbot1 Example</h1>
      <p style={{ color: '#555' }}>
        The floating chat launcher is in the bottom-right corner (configurable in Admin). Click it to open the customer support
        chat widget.
      </p>

      <p style={{ marginTop: 8, display: 'flex', gap: 12 }}>
        <a href="/webui.html" target="_blank" rel="noreferrer">
          Open Backend WebUI
        </a>
        <a href="/admin.html" target="_blank" rel="noreferrer">
          Open Admin
        </a>
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
          alignItems: 'flex-start',
          marginTop: 12,
        }}
      >
        <section style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 10 }}>
          <h3 style={{ marginTop: 0 }}>Runtime controls</h3>
          <label style={{ display: 'block', marginBottom: 8, color: '#374151' }}>Transport mode</label>
          <select
            value={transport}
            onChange={(e) => setTransport(e.target.value as TransportChoice)}
            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', width: '100%', marginBottom: 8 }}
          >
            <option value="polling">HTTP polling</option>
            <option value="websocket" disabled={settings?.transports?.allowWebSocket === false}>
              WebSocket
            </option>
          </select>
          <div style={{ fontSize: 13, color: '#4b5563' }}>
            Defaults come from Admin settings. Poll interval: {pollIntervalMs}ms. WebSocket: {settings?.transports?.allowWebSocket
              ? 'enabled'
              : 'disabled'}
          </div>
          <div style={{ marginTop: 12, fontSize: 13, color: '#111' }}>
            Connection status: <strong>{connectionState}</strong> {lastEvent && `· ${lastEvent}`}
          </div>
          <div style={{ marginTop: 8, fontSize: 13, color: '#4b5563' }}>
            Plugins enabled: {plugins.map((p) => p.name).join(', ')}
          </div>
        </section>

        <section style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 10 }}>
          <h3 style={{ marginTop: 0 }}>Operational defaults</h3>
          <ul style={{ marginTop: 0, color: '#374151', paddingLeft: 18 }}>
            <li>API URL: {apiUrl}</li>
            <li>WebSocket URL: {wsUrl}</li>
            <li>Admin-configured max history: {settings?.behavior?.maxHistory ?? 200}</li>
            <li>Retention: {settings?.behavior?.retentionDays ?? 30} days</li>
            <li>Allowed origins: {(settings?.security?.allowedOrigins || ['*']).join(', ')}</li>
          </ul>
        </section>
      </div>

      <CustomerSupportChatWidget
        apiUrl={apiUrl}
        uploadUrl={apiUrl.replace(/\/chat$/, '/upload')}
        title={title}
        defaultOpen={defaultOpen}
        primaryColor={primaryColor}
        welcomeMessage={welcomeMessage}
        pollIntervalMs={pollIntervalMs}
        userIdentifier={{ email: 'demo@example.com' }}
        transport={transport}
        transportOptions={transportOptions as any}
        plugins={plugins}
      />
    </div>
  )
}
