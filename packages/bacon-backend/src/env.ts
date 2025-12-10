import { Pool } from 'pg'
import { Logger } from './types'

export type EnvConfig = {
  port: number
  host: string
  postgresUrl?: string
  bearerToken?: string
  jwtSecret?: string
  allowedOrigins: string[]
  enableWebSocket: boolean
  enableHttpPolling: boolean
}

/**
 * Lightweight, dependency-free environment loader with opinionated defaults
 * that errs on the side of resiliency for pre-production setups. The goal is to
 * catch misconfiguration early and emit structured, machine-parsable logs for
 * CI/CD and platform agents.
 */
export function loadEnvConfig(env: NodeJS.ProcessEnv = process.env, logger: Logger = console): EnvConfig {
  const toBool = (value: string | undefined, fallback = false) => {
    if (value === undefined) return fallback
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
  }

  const parsed: EnvConfig = {
    port: Number.parseInt(env.PORT || '3001', 10),
    host: env.HOST || '0.0.0.0',
    postgresUrl: env.POSTGRES_URL || env.DATABASE_URL,
    bearerToken: env.BEARER_TOKEN,
    jwtSecret: env.JWT_SECRET,
    allowedOrigins: env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) || ['*'],
    enableWebSocket: toBool(env.ENABLE_WEBSOCKET, true),
    enableHttpPolling: toBool(env.ENABLE_HTTP_POLLING, true),
  }

  if (Number.isNaN(parsed.port)) parsed.port = 3001

  if (!parsed.postgresUrl) {
    logger.warn('[env] POSTGRES_URL not set; falling back to in-memory storage (not durable).')
  }

  if (!parsed.bearerToken && !parsed.jwtSecret) {
    logger.warn('[env] No auth configured; /api/admin endpoints will run open unless upstream auth is enforced.')
  }

  if (parsed.allowedOrigins.includes('*')) {
    logger.info('[env] CORS wide open; set ALLOWED_ORIGINS=app.example.com to restrict in production.')
  }

  logger.info('[env] loaded', {
    port: parsed.port,
    host: parsed.host,
    postgres: !!parsed.postgresUrl,
    ws: parsed.enableWebSocket,
    polling: parsed.enableHttpPolling,
  })

  return parsed
}

export function buildPostgresPool(connectionString?: string): Pool | null {
  if (!connectionString) return null
  return new Pool({ connectionString })
}
