import type { IncomingMessage, ServerResponse } from 'http'

/**
 * Centralized, comment-rich security helpers intended for enterprise-oriented
 * deployments. The helpers avoid external deps to keep cold-starts low while
 * remaining easy to swap for managed offerings later.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; expiresAt: number }>()
  constructor(private readonly windowMs: number, private readonly maxHits: number) {}

  allow(ip: string): boolean {
    const now = Date.now()
    const entry = this.hits.get(ip)
    if (entry && entry.expiresAt > now) {
      if (entry.count >= this.maxHits) return false
      entry.count += 1
      return true
    }
    this.hits.set(ip, { count: 1, expiresAt: now + this.windowMs })
    return true
  }

  reset() {
    this.hits.clear()
  }
}

export type RequestFirewall = {
  blocklist?: Set<string>
  rateLimiter?: RateLimiter
}

export function enforceNetworkControls(req: IncomingMessage, res: ServerResponse, firewall: RequestFirewall | null) {
  if (!firewall) return true
  const { normalizedIp } = resolveClientIp(req)
  if (firewall.blocklist && firewall.blocklist.has(normalizedIp)) {
    res.statusCode = 403
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'blocked_ip' }))
    return false
  }
  if (firewall.rateLimiter && !firewall.rateLimiter.allow(normalizedIp)) {
    res.statusCode = 429
    res.setHeader('retry-after', '60')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'rate_limited' }))
    return false
  }
  return true
}

/**
 * Extract and normalize the caller IP so blocklists can match across IPv4,
 * IPv6, and proxy headers. Node surfaces IPv4 clients as IPv6-mapped strings
 * (e.g. `::ffff:10.0.0.9`) when the listener binds to IPv6; without this
 * normalization a blocklist entry of `10.0.0.9` would miss. We also honor the
 * first `x-forwarded-for` hop so operators can enforce policies at the true
 * client edge when fronted by load balancers or API gateways.
 */
function resolveClientIp(req: IncomingMessage): { rawIp: string; normalizedIp: string } {
  const forwarded = req.headers?.['x-forwarded-for']
  const forwardedIp = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
    ?.toString()
    ?.split(',')[0]
    ?.trim()
  const socketIp = (req.socket as any)?.remoteAddress as string | undefined
  const rawIp = forwardedIp || socketIp || 'unknown'
  return { rawIp, normalizedIp: normalizeIp(rawIp) }
}

function normalizeIp(ip: string): string {
  if (!ip) return 'unknown'
  const trimmed = ip.trim()
  const ipv4Mapped = trimmed.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (ipv4Mapped) return ipv4Mapped[1]
  return trimmed
}

/**
 * Mask emails and phone numbers on ingest to limit accidental log/DB leakage.
 */
export function maskPii(input: string): string {
  if (!input) return input
  const emailRedacted = input.replace(/([a-zA-Z0-9_.+-]+)@([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/g, '[redacted-email]')
  const phoneRedacted = emailRedacted.replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted-phone]')
  return phoneRedacted
}
