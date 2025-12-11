import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import {
  ClientIdentityManager,
  CLIENT_ID_COOKIE_NAME,
  CLIENT_ID_STORAGE_KEY,
  CLIENT_ID_TTL_MS,
} from "../ClientIdentityManager";

vi.mock("../../CustomerSupportChatWidget.css", () => ({}));

const formatUuid = (
  label: string,
  counter: number
): `${string}-${string}-${string}-${string}-${string}` =>
  `00000000-0000-0000-0000-${label}${String(counter).padStart(4, "0")}`;

const clearCookie = () => {
  document.cookie = `${CLIENT_ID_COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
};

describe("ClientIdentityManager", () => {
  beforeEach(() => {
    localStorage.clear();
    clearCookie();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates and persists a stable client id", async () => {
    let counter = 0;
    const randomSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockImplementation(() => formatUuid("uuid", ++counter));
    const manager = new ClientIdentityManager(() => Date.now());

    const record = await manager.getOrCreateIdentity();

    expect(record.id).toBe(formatUuid("uuid", 1));
    expect(record.expiresAt - record.createdAt).toBe(CLIENT_ID_TTL_MS);
    expect(localStorage.getItem(CLIENT_ID_STORAGE_KEY)).toContain(formatUuid("uuid", 1));
    expect(document.cookie).toContain(`${CLIENT_ID_COOKIE_NAME}=${formatUuid("uuid", 1)}`);
    randomSpy.mockRestore();
  });

  it("reuses an existing persisted identity", async () => {
    const persisted = {
      id: "persisted-id",
      createdAt: 100,
      expiresAt: Date.now() + 50_000,
    };
    localStorage.setItem(CLIENT_ID_STORAGE_KEY, JSON.stringify(persisted));
    const manager = new ClientIdentityManager(() => Date.now());

    const record = await manager.getOrCreateIdentity();

    expect(record.id).toBe("persisted-id");
    expect(localStorage.getItem(CLIENT_ID_STORAGE_KEY)).toContain("persisted-id");
  });

  it("rotates when an existing record is expired", async () => {
    const expired = { id: "expired", createdAt: 0, expiresAt: 1 };
    localStorage.setItem(CLIENT_ID_STORAGE_KEY, JSON.stringify(expired));
    let counter = 0;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => formatUuid("next", ++counter));
    const manager = new ClientIdentityManager(() => 10_000);

    const record = await manager.getOrCreateIdentity();

    expect(record.id).toBe(formatUuid("next", 1));
    expect(record.id).not.toBe("expired");
  });

  it("allows manual rotation for server-directed resets", async () => {
    let counter = 0;
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => formatUuid("manual", ++counter));
    const manager = new ClientIdentityManager(() => 5_000);
    const first = await manager.getOrCreateIdentity();

    const rotated = await manager.rotateIdentity("server_rejected");

    expect(rotated.id).toBe(formatUuid("manual", 2));
    expect(rotated.id).not.toBe(first.id);
    expect(localStorage.getItem(CLIENT_ID_STORAGE_KEY)).toContain(formatUuid("manual", 2));
  });

  it("rehydrates from cookie when storage is unavailable", async () => {
    clearCookie();
    document.cookie = `${CLIENT_ID_COOKIE_NAME}=cookie-only; Path=/`;
    // Simulate storage failure by throwing on setItem
    const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const manager = new ClientIdentityManager(() => 20_000);

    const record = await manager.getOrCreateIdentity();

    expect(record.id).toBe("cookie-only");
    // We still want to try to persist for future loads even if it fails.
    expect(setSpy).toHaveBeenCalled();
    setSpy.mockRestore();
  });
});
