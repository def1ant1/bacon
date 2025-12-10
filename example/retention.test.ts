import { describe, expect, it, vi } from 'vitest'
import { createRetentionJob, type FileRec, type Msg } from './vite.config'

function makeMsg(createdAt: string): Msg {
  return { id: `m-${createdAt}`, sender: 'user', text: 'hello', createdAt }
}

function makeFile(createdAt: string): FileRec {
  return {
    id: `f-${createdAt}`,
    sessionId: 's1',
    originalName: 'file.txt',
    storagePath: '/tmp/file.txt',
    createdAt,
  }
}

describe('retention job', () => {
  it('prunes stale memory sessions without crashing', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-02-01T00:00:00.000Z'))

    const memStore = new Map<string, Msg[]>([
      ['old', [makeMsg('2023-12-01T00:00:00.000Z')]],
      ['fresh', [makeMsg('2024-01-31T12:00:00.000Z')]],
    ])
    const memFiles = new Map<string, FileRec[]>([
      ['old', [makeFile('2023-11-30T00:00:00.000Z')]],
      ['fresh', [makeFile('2024-01-31T12:00:00.000Z')]],
    ])
    const logger = { error: vi.fn(), warn: vi.fn() }

    const { runSweep, timer } = createRetentionJob({
      memStore,
      memFiles,
      getRetentionDays: () => 30,
      logger,
    })

    await runSweep()
    clearInterval(timer)

    expect(memStore.has('old')).toBe(false)
    expect(memFiles.has('old')).toBe(false)
    expect(memStore.has('fresh')).toBe(true)
    expect(logger.error).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('issues DB cleanup queries safely', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-06-01T00:00:00.000Z'))

    const queries: any[] = []
    const pool = {
      query: vi.fn(async (...args: any[]) => {
        queries.push(args)
        return { rows: [] }
      }),
    }
    const ensureSchema = vi.fn(async () => {})
    const logger = { error: vi.fn(), warn: vi.fn() }

    const { runSweep, timer } = createRetentionJob({
      memStore: new Map(),
      memFiles: new Map(),
      pool,
      ensureSchema,
      getRetentionDays: () => 30,
      logger,
    })

    await runSweep()
    clearInterval(timer)

    expect(ensureSchema).toHaveBeenCalled()
    expect(pool.query).toHaveBeenCalledTimes(3)
    const cutoff = queries[0][1][0] as Date
    expect(cutoff).toBeInstanceOf(Date)
    expect(cutoff.toISOString()).toBe('2024-05-02T00:00:00.000Z')
    expect(logger.error).not.toHaveBeenCalled()

    vi.useRealTimers()
  })
})
