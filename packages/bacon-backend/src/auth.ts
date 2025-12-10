import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { Logger } from './types'

export interface JwtUserClaims {
  sub?: string
  role?: string
  [key: string]: any
}

export interface AuthIssueResult {
  token: string
  expiresAt: number
  jti: string
}

export interface AuthServiceConfig {
  accessSecret: string
  refreshSecret?: string
  accessTtlMs?: number
  refreshTtlMs?: number
  issuer?: string
  audience?: string
  roleClaim?: string
  defaultRole?: 'admin' | 'agent'
  onRevoke?: (jti: string) => void
  onRefresh?: (meta: { jti: string; sub?: string; role: string }) => void
  logger?: Logger
}

function epochMs(expSeconds: number | undefined) {
  if (!expSeconds) return Date.now()
  return expSeconds * 1000
}

export class AuthService {
  private readonly revoked = new Set<string>()

  constructor(private readonly config: AuthServiceConfig) {}

  issueAccessToken(payload: JwtUserClaims): AuthIssueResult {
    const jti = payload.jti || crypto.randomUUID()
    const options: jwt.SignOptions = {
      expiresIn: Math.max(60, Math.floor((this.config.accessTtlMs || 15 * 60 * 1000) / 1000)),
    }
    if (this.config.issuer) options.issuer = this.config.issuer
    if (this.config.audience) options.audience = this.config.audience
    const token = jwt.sign({ ...payload, jti }, this.config.accessSecret, options)
    const decoded: any = jwt.decode(token)
    return { token, jti, expiresAt: epochMs(decoded?.exp) }
  }

  issueRefreshToken(payload: JwtUserClaims): AuthIssueResult {
    if (!this.config.refreshSecret) throw new Error('refresh_not_enabled')
    const jti = payload.jti || crypto.randomUUID()
    const options: jwt.SignOptions = {
      expiresIn: Math.max(300, Math.floor((this.config.refreshTtlMs || 7 * 24 * 60 * 60 * 1000) / 1000)),
    }
    if (this.config.issuer) options.issuer = this.config.issuer
    if (this.config.audience) options.audience = this.config.audience
    const token = jwt.sign({ ...payload, jti }, this.config.refreshSecret, options)
    const decoded: any = jwt.decode(token)
    return { token, jti, expiresAt: epochMs(decoded?.exp) }
  }

  verifyAccess(token: string): { ok: boolean; claims?: JwtUserClaims; error?: string } {
    try {
      const claims = jwt.verify(token, this.config.accessSecret) as JwtUserClaims
      if (claims?.jti && this.revoked.has(String(claims.jti))) {
        return { ok: false, error: 'revoked' }
      }
      return { ok: true, claims }
    } catch (err: any) {
      return { ok: false, error: err?.message || 'invalid_token' }
    }
  }

  refresh(refreshToken: string): { ok: boolean; access?: AuthIssueResult; claims?: JwtUserClaims; error?: string } {
    if (!this.config.refreshSecret) return { ok: false, error: 'refresh_not_enabled' }
    try {
      const claims = jwt.verify(refreshToken, this.config.refreshSecret) as JwtUserClaims
      if (claims?.jti && this.revoked.has(String(claims.jti))) return { ok: false, error: 'revoked' }
      const { exp, iat, nbf, ...rest } = claims as any
      const issued = this.issueAccessToken({
        ...rest,
        role: (claims as any)?.[this.config.roleClaim || 'role'] || this.config.defaultRole || 'agent',
      })
      this.config.onRefresh?.({ jti: issued.jti, sub: claims.sub, role: (claims as any)?.role || 'agent' })
      return { ok: true, access: issued, claims }
    } catch (err: any) {
      this.config.logger?.warn?.('[auth] refresh failed', err)
      return { ok: false, error: err?.message || 'refresh_failed' }
    }
  }

  revoke(jti: string) {
    this.revoked.add(jti)
    this.config.onRevoke?.(jti)
  }

  isRevoked(jti?: string | null): boolean {
    if (!jti) return false
    return this.revoked.has(String(jti))
  }
}
