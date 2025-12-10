import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'
import { Pool } from 'pg'
import { createBaconServer, MemoryStorage, PostgresStorage } from '../packages/bacon-backend/src'

// The dev server now proxies to the reusable backend library so local testing
// mirrors production wiring (Express/Fastify/serverless). We keep comments
// verbose to help ops teams drop this into Docker/edge workers with minimal
// changes.
export default defineConfig({
  plugins: [react(), {
    name: 'bacon-backend-dev',
    async configureServer(server) {
      const uploadsDir = path.join(__dirname, 'uploads')
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true })
      const useDb = !!process.env.DATABASE_URL
      const storage = useDb ? new PostgresStorage(new Pool({ connectionString: process.env.DATABASE_URL })) : new MemoryStorage()
      const backend = createBaconServer({
        storage,
        fileHandling: { uploadsDir },
        transports: { enableWebSocket: true },
        behavior: { maxHistory: 200, retentionDays: 30 },
      })
      server.middlewares.use(backend.handler)
      // Wire websocket server to Vite's HTTP listener for parity with prod
      server.httpServer?.on('upgrade', backend.wss?.handleUpgrade.bind(backend.wss))
      server.httpServer?.on('close', () => {
        if ((backend as any)._retentionTimer) clearInterval((backend as any)._retentionTimer)
      })
    },
  }],
  server: { open: true },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
