import { execSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('example admin/frontend build', () => {
  it('builds the Vite example without errors', () => {
    execSync('npm run build --prefix packages/bacon-backend -- --no-dts', { cwd: process.cwd(), stdio: 'pipe' })
    const cmd = 'npm run build -- --outDir ./dist-ci'
    const output = execSync(cmd, {
      cwd: path.join(process.cwd(), 'example'),
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096' },
      stdio: 'pipe',
    }).toString()
    expect(output).toMatch(/vite v/)
  })
})
