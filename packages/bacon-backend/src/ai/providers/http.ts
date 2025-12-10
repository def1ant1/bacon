import { CircuitBreaker, withRetry } from './resilience'
import { ProviderHooks } from './types'

export interface HttpRequestOptions {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: any
  expectedStatus?: number | number[]
  retries?: number
  retryDelayMs?: number
}

export interface HttpResponse<T = any> {
  status: number
  headers: Record<string, string>
  data: T
}

export interface HttpClient {
  request<T = any>(options: HttpRequestOptions, hooks?: ProviderHooks): Promise<HttpResponse<T>>
}

export class FetchHttpClient implements HttpClient {
  constructor(private breaker = new CircuitBreaker()) {}

  async request<T = any>(options: HttpRequestOptions, hooks?: ProviderHooks): Promise<HttpResponse<T>> {
    const {
      url,
      method = 'POST',
      headers = {},
      body,
      expectedStatus = [200],
      retries = 2,
      retryDelayMs = 200,
    } = options

    const exec = async () => {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
      const data = (await res.json().catch(() => undefined)) as T
      const okStatuses = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus]
      if (!okStatuses.includes(res.status)) {
        const err: any = new Error(`Unexpected status ${res.status}`)
        err.response = { status: res.status, data }
        throw err
      }
      return { status: res.status, headers: Object.fromEntries(res.headers.entries()), data }
    }

    return this.breaker.exec(
      () =>
        withRetry(exec, { retries, baseDelayMs: retryDelayMs }, hooks).catch((err) => {
          hooks?.logger?.error?.('[http] request failed', err)
          throw err
        }),
      hooks,
    )
  }
}
