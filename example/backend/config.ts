import fs from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import { BaconServerConfig, AdminSettings, MemoryStorage, PostgresStorage, createBaconServer } from 'bacon-backend'

dotenv.config({ path: path.join(process.cwd(), 'example/.env') })

export type TransportMode = 'polling' | 'websocket'

const SETTINGS_FILE = process.env.BACON_SETTINGS_FILE || path.join(process.cwd(), 'example/.data/admin-settings.json')

const baseDefaults: AdminSettings = {
  general: {
    title: 'Support',
    defaultOpen: true,
    welcomeMessage: 'Hi! How can I help?'
      + ' We automatically wire transports, plugins, and storage based on your environment.',
    launcherPosition: 'bottom-right',
  },
  branding: { primaryColor: '#2563eb', customCss: '' },
  behavior: { replyDelayMs: 0, maxHistory: 200, retentionDays: 30 },
  transports: {
    default: 'polling',
    allowPolling: true,
    allowWebSocket: true,
    pollIntervalMs: 1500,
    webSocketPath: '/api/chat/ws',
  },
  plugins: { logging: true, tracing: false, authTokenRefresher: false },
  integrations: { apiUrl: '/api/chat', apiAuthHeader: '', webhookUrl: '' },
  security: { allowedOrigins: ['*'] },
  ai: {
    provider: 'echo',
    systemPrompt: 'You are a helpful customer support assistant.',
  },
}

function loadSettingsFromFile(): Partial<AdminSettings> | undefined {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return undefined
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    console.warn('[config] failed to load settings file', err)
    return undefined
  }
}

function persistSettings(settings: AdminSettings) {
  try {
    const dir = path.dirname(SETTINGS_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2))
  } catch (err) {
    console.warn('[config] failed to persist settings', err)
  }
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

export function loadExampleServerConfig() {
  const defaultTransport = (process.env.BACON_TRANSPORT_MODE as TransportMode) || baseDefaults.transports.default
  const allowWs = parseBoolean(process.env.BACON_ENABLE_WEBSOCKET, baseDefaults.transports.allowWebSocket)
  const allowPolling = parseBoolean(process.env.BACON_ENABLE_HTTP_POLLING, baseDefaults.transports.allowPolling)
  const pollInterval = Number(process.env.BACON_POLL_INTERVAL_MS || baseDefaults.transports.pollIntervalMs)
  const loaded = loadSettingsFromFile()
  const defaulted: AdminSettings = {
    ...baseDefaults,
    ...(loaded || {}),
    transports: {
      ...baseDefaults.transports,
      ...(loaded?.transports || {}),
      default: allowWs && defaultTransport === 'websocket' ? 'websocket' : 'polling',
      allowWebSocket: allowWs,
      allowPolling,
      pollIntervalMs: Number.isFinite(pollInterval) ? pollInterval : baseDefaults.transports.pollIntervalMs,
    },
    plugins: {
      ...baseDefaults.plugins,
      ...(loaded?.plugins || {}),
      logging: parseBoolean(process.env.BACON_PLUGIN_LOGGING, loaded?.plugins?.logging ?? baseDefaults.plugins.logging),
      tracing: parseBoolean(process.env.BACON_PLUGIN_TRACING, loaded?.plugins?.tracing ?? baseDefaults.plugins.tracing),
      authTokenRefresher: parseBoolean(
        process.env.BACON_PLUGIN_AUTH_REFRESHER,
        loaded?.plugins?.authTokenRefresher ?? baseDefaults.plugins.authTokenRefresher,
      ),
    },
  }

  const storage = process.env.DATABASE_URL
    ? new PostgresStorage({ connectionString: process.env.DATABASE_URL } as any)
    : new MemoryStorage()

  const backendConfig: BaconServerConfig = {
    storage,
    behavior: { retentionDays: defaulted.behavior.retentionDays, maxHistory: defaulted.behavior.maxHistory },
    transports: { enableWebSocket: defaulted.transports.allowWebSocket, enableHttpPolling: defaulted.transports.allowPolling },
    settings: defaulted,
    settingsStore: {
      load: () => loadSettingsFromFile() || defaulted,
      save: (s) => persistSettings(s),
      reset: () => baseDefaults,
    },
    fileHandling: { uploadsDir: path.join(process.cwd(), 'example/uploads') },
    auth: process.env.BACON_ADMIN_TOKEN ? { bearerToken: process.env.BACON_ADMIN_TOKEN } : undefined,
  }

  const server = createBaconServer(backendConfig)

  return { config: backendConfig, settings: defaulted, server }
}

export type ExampleServer = ReturnType<typeof loadExampleServerConfig>['server']
