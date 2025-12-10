import React from 'react'
import { CustomerSupportChatWidget } from 'customer-support-chat-widget'
import 'customer-support-chat-widget/dist/index.css'

export default function App() {
  const [settings, setSettings] = React.useState<any | null>(null)

  React.useEffect(() => {
    fetch('/api/admin/settings')
      .then((r) => r.json())
      .then((s) => setSettings(s))
      .catch(() => setSettings(null))
  }, [])

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

  // Normalize API URL so the widget points at the local mock backend during dev
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
        // In dev, prefer local origin so WebUI/Admin reflect the same store
        if (!sameOrigin && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
          return '/api/chat'
        }
      }
    } catch {}
    return s
  }
  const apiUrl = normalizeApi(rawApi)
  const title = settings?.general?.title ?? 'Support'
  const defaultOpen = !!(settings?.general?.defaultOpen ?? true)
  const primaryColor = settings?.branding?.primaryColor ?? '#2563eb'

  return (
    <div style={{ fontFamily: 'ui-sans-serif, system-ui, Arial', padding: 24 }}>
      <h1 style={{ margin: 0 }}>Chatbot1 Example</h1>
      <p style={{ color: '#555' }}>
        The floating chat launcher is in the bottom-right corner (configurable in Admin). Click it to
        open the customer support chat widget.
      </p>

      <p style={{ marginTop: 8, display:'flex', gap:12 }}>
        <a href="/webui.html" target="_blank" rel="noreferrer">Open Backend WebUI</a>
        <a href="/admin.html" target="_blank" rel="noreferrer">Open Admin</a>
      </p>

      <CustomerSupportChatWidget
        apiUrl={apiUrl}
        title={title}
        defaultOpen={defaultOpen}
        primaryColor={primaryColor}
        userIdentifier={{ email: 'demo@example.com' }}
      />
    </div>
  )
}
