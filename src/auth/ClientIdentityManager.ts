import { v4 as uuidv4 } from "uuid";

/**
 * Client identity manager responsible for minting and persisting the stable
 * identifier we attach to every chat API call. The ID intentionally avoids
 * embedding any PII, rotates on expiry, and is replicated to both
 * localStorage and a SameSite cookie so that the backend can validate the
 * caller regardless of transport choice (XHR/fetch vs. WebSocket upgrade).
 */
export interface ClientIdentityRecord {
  id: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Storage keys + defaults. The TTL is intentionally long-lived to keep the
 * user anchored across sessions while remaining finite so deployments can
 * enforce retention/rotation rules.
 */
export const CLIENT_ID_STORAGE_KEY = "cs_client_identity_v1";
export const CLIENT_ID_COOKIE_NAME = "cs_client_id";
export const CLIENT_ID_TTL_MS = 1000 * 60 * 60 * 24 * 180; // 180 days

/**
 * Generates a privacy-safe random identifier. We prefer the Web Crypto API
 * when available for extra entropy, but fall back to uuid (which bundles a
 * crypto-grade RNG) to stay deterministic in tests.
 */
export function createClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return uuidv4();
}

/**
 * Small helper to safely parse a persisted JSON record without leaking errors
 * upstream (e.g., malformed localStorage from a previous build).
 */
function parseRecord(raw: string | null): ClientIdentityRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ClientIdentityRecord;
    if (!parsed.id || !parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function nowMs(): number {
  return Date.now();
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const cookies = document.cookie.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    if (!cookie) continue;
    const [k, ...rest] = cookie.split("=");
    if (k === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

function writeCookie(name: string, value: string, expiresAt: number) {
  if (typeof document === "undefined") return;
  const expires = new Date(expiresAt).toUTCString();
  const secureFlag =
    typeof window !== "undefined" && window.location?.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Expires=${expires}${secureFlag}`;
}

function persistToLocalStorage(record: ClientIdentityRecord) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // If storage is unavailable (blocked/capacity), we still rely on the cookie path.
  }
}

function readFromLocalStorage(): ClientIdentityRecord | null {
  if (typeof window === "undefined") return null;
  try {
    return parseRecord(window.localStorage.getItem(CLIENT_ID_STORAGE_KEY));
  } catch {
    return null;
  }
}

function purgeLocalStorage() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CLIENT_ID_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function readCookieRecord(): ClientIdentityRecord | null {
  const id = readCookie(CLIENT_ID_COOKIE_NAME);
  if (!id) return null;
  // We cannot encode expiry in cookies without custom values, so we hydrate it
  // with a default TTL when only the cookie exists.
  return { id, createdAt: nowMs(), expiresAt: nowMs() + CLIENT_ID_TTL_MS };
}

/**
 * Single, memoized manager instance to avoid multiple tabs racing to create
 * divergent IDs. The Locks API provides a best-effort atomic guard where
 * supported; elsewhere we fall back to a quick re-read after persistence so
 * the first writer wins.
 */
export class ClientIdentityManager {
  private cached: ClientIdentityRecord | null = null;

  constructor(private clock: () => number = nowMs) {}

  /** Retrieve the stable identifier, minting it only once. */
  async getOrCreateIdentity(): Promise<ClientIdentityRecord> {
    if (this.cached && !this.isExpired(this.cached)) return this.cached;

    const run = async () => {
      const existing = this.readExisting();
      if (existing) {
        this.cached = existing;
        return existing;
      }
      const fresh = this.buildRecord();
      this.persist(fresh);
      // Re-read to honor first-writer wins if another tab beat us.
      const final = this.readExisting() ?? fresh;
      this.cached = final;
      return final;
    };

    const lockApi = (typeof navigator !== "undefined" && (navigator as any).locks?.request)
      ? (navigator as any).locks
      : null;
    if (lockApi) {
      return lockApi.request("cs-client-id", run);
    }
    return run();
  }

  /** Force a rotation, useful when the backend rejects/blacklists an ID. */
  async rotateIdentity(reason: string = "manual_rotation"): Promise<ClientIdentityRecord> {
    const fresh = this.buildRecord();
    this.persist(fresh, reason);
    this.cached = fresh;
    return fresh;
  }

  /** Check whether the stored record is past expiry. */
  private isExpired(record: ClientIdentityRecord): boolean {
    return this.clock() >= record.expiresAt;
  }

  private buildRecord(): ClientIdentityRecord {
    const createdAt = this.clock();
    return {
      id: createClientId(),
      createdAt,
      expiresAt: createdAt + CLIENT_ID_TTL_MS,
    };
  }

  private readExisting(): ClientIdentityRecord | null {
    const storageRecord = readFromLocalStorage();
    const cookieRecord = readCookieRecord();

    const chosen = storageRecord || cookieRecord;
    if (!chosen) return null;

    if (this.isExpired(chosen)) {
      this.clear();
      return null;
    }

    // Backfill missing copies to keep both storage mediums aligned.
    this.persist(chosen, "cache_rehydrate");
    return chosen;
  }

  private persist(record: ClientIdentityRecord, reason: string = "create") {
    persistToLocalStorage(record);
    writeCookie(CLIENT_ID_COOKIE_NAME, record.id, record.expiresAt);
    this.cached = record;
    if (typeof window !== "undefined" && (window as any).__CS_DEBUG__) {
      console.debug(`[client-id] persisted (${reason})`, record);
    }
  }

  private clear() {
    purgeLocalStorage();
    writeCookie(CLIENT_ID_COOKIE_NAME, "", this.clock() - 1000);
    this.cached = null;
  }
}

export const clientIdentityManager = new ClientIdentityManager();
