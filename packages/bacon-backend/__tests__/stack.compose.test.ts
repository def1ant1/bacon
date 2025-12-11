import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const composePath = path.resolve(__dirname, '../../../docker-compose.yml')
const compose = parse(readFileSync(composePath, 'utf8'))

describe('reference docker-compose stack', () => {
  it('defines backend, admin, db services with healthchecks', () => {
    expect(compose.services.backend).toBeDefined()
    expect(compose.services.admin).toBeDefined()
    expect(compose.services.db).toBeDefined()
    expect(compose.services.backend.healthcheck).toBeTruthy()
    expect(compose.services.admin.healthcheck).toBeTruthy()
    expect(compose.services.db.healthcheck).toBeTruthy()
  })

  it('threads env defaults for DATABASE_URL, REDIS_URL, and auth', () => {
    const env = compose.services.backend.environment
    expect(env.DATABASE_URL).toContain('bacon')
    expect(env.JWT_SECRET).toBeDefined()
    expect(env.BEARER_TOKEN).toBeDefined()
    expect(env.REDIS_URL).toBeDefined()
  })

  it('ships an optional redis profile for cache-heavy workflows', () => {
    expect(compose.services.redis).toBeDefined()
    expect(compose.services.redis.profiles).toContain('redis')
  })
})
