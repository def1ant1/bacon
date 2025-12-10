import { createServer as createHttpServer } from 'http'
import { buildPostgresPool, loadEnvConfig } from './env'
import { createBaconServer } from './index'
import { PostgresStorage } from './storage-postgres'
import { Logger } from './types'

/**
 * Minimal bootstrap file intended for container/serverless entrypoints. It
 * wires together env parsing, durable storage selection, and healthful
 * defaults so operators can drop this into a Docker CMD without custom glue.
 */
async function main() {
  const logger: Logger = {
    info: (...args) => console.log('[info]', new Date().toISOString(), ...args),
    warn: (...args) => console.warn('[warn]', new Date().toISOString(), ...args),
    error: (...args) => console.error('[error]', new Date().toISOString(), ...args),
    debug: (...args) => console.debug('[debug]', new Date().toISOString(), ...args),
  }

  const env = loadEnvConfig(process.env, logger)
  const pool = buildPostgresPool(env.postgresUrl || '')
  const storage = pool ? new PostgresStorage(pool) : undefined

  const backend = createBaconServer({
    storage,
    logger,
    transports: {
      enableWebSocket: env.enableWebSocket,
      enableHttpPolling: env.enableHttpPolling,
    },
    auth: {
      bearerToken: env.bearerToken,
      jwtSecret: env.jwtSecret,
    },
  })

  const httpServer = (backend as any)._httpServer || createHttpServer(backend.handler as any)
  await new Promise<void>((resolve) => httpServer.listen(env.port, env.host, resolve))

  logger.info('[startup] bacon backend listening', { host: env.host, port: env.port })
}

main().catch((err) => {
  console.error('[fatal] backend failed to start', err)
  process.exit(1)
})
