import { describe, expect, it, vi } from 'vitest'
import { MemoryStorage } from '../packages/bacon-backend/src'

function iso(date: string) {
  return new Date(date).toISOString()
}

describe('retention sweep', () => {
  it('drops stale messages from memory adapter', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-02-01T00:00:00.000Z'))
    const storage = new MemoryStorage()
    ;(storage as any).messages = new Map([
      ['old', [{ id: '1', sessionId: 'old', sender: 'user', text: 'x', createdAt: iso('2023-12-01') }]],
      ['fresh', [{ id: '2', sessionId: 'fresh', sender: 'user', text: 'y', createdAt: iso('2024-01-31') }]],
    ])
    await storage.retentionSweep(30)
    vi.useRealTimers()
    expect((storage as any).messages.has('old')).toBe(false)
    expect((storage as any).messages.has('fresh')).toBe(true)
  })
})
