import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { createBaconApp } from './create-bacon-app'

describe('create-bacon-app generator', () => {
  it('scaffolds a redis-enabled stack by default', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bacon-stack-'))
    const result = await createBaconApp({ targetDir: dir, appName: 'acme', force: true })
    expect(result.files).toContain('docker-compose.yml')

    const compose = parse(await readFile(path.join(dir, 'docker-compose.yml'), 'utf8'))
    expect(compose.services.backend.environment.DATABASE_URL).toContain('acme')
    expect(compose.services.redis).toBeDefined()
    expect(compose.services.admin).toBeDefined()

    const bootstrap = await readFile(path.join(dir, 'scripts/bootstrap.sh'), 'utf8')
    expect(bootstrap).toContain('docker compose up -d')
  })

  it('omits redis when requested', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bacon-stack-no-redis-'))
    const composePath = path.join(dir, 'docker-compose.yml')
    await createBaconApp({ targetDir: dir, appName: 'nor', withRedis: false, force: true })
    const compose = parse(await readFile(composePath, 'utf8'))
    expect(compose.services.redis).toBeUndefined()
  })
})
