import { setTimeout as delay } from 'node:timers/promises'
import { ProviderHooks } from './types'

export interface RetryOptions {
  retries: number
  baseDelayMs: number
  factor?: number
  maxDelayMs?: number
  jitter?: boolean
}

export class CircuitBreaker {
  private failureCount = 0
  private openUntil = 0

  constructor(private readonly failureThreshold = 5, private readonly cooldownMs = 15000) {}

  async exec<T>(fn: () => Promise<T>, hooks?: ProviderHooks): Promise<T> {
    const now = Date.now()
    if (this.openUntil > now) {
      hooks?.logger?.warn?.('[circuit-breaker] short-circuiting call')
      throw new Error('circuit_open')
    }
    try {
      const result = await fn()
      this.failureCount = 0
      return result
    } catch (err) {
      this.failureCount += 1
      hooks?.logger?.warn?.('[circuit-breaker] failure count', this.failureCount, err)
      if (this.failureCount >= this.failureThreshold) {
        this.openUntil = now + this.cooldownMs
        hooks?.onTrace?.({ name: 'circuit_open', meta: { until: this.openUntil } })
      }
      throw err
    }
  }
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions, hooks?: ProviderHooks): Promise<T> {
  const { retries, baseDelayMs, factor = 2, jitter = true, maxDelayMs = 5000 } = options
  let attempt = 0
  while (true) {
    try {
      const start = Date.now()
      const result = await fn()
      hooks?.onTrace?.({ name: 'retry_success', meta: { attempt, duration: Date.now() - start } })
      return result
    } catch (err) {
      if (attempt >= retries) throw err
      const expo = baseDelayMs * Math.pow(factor, attempt)
      const sleep = Math.min(maxDelayMs, jitter ? expo * (0.5 + Math.random()) : expo)
      hooks?.logger?.warn?.('[retry] transient failure', { attempt, sleep, error: (err as Error)?.message })
      hooks?.onTrace?.({ name: 'retry_backoff', meta: { attempt, sleep } })
      await delay(sleep)
      attempt += 1
    }
  }
}
