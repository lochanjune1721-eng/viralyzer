import { createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/env";
import type { Platform } from "@/lib/types";
import { upsertConnection, type ConnectionRecord } from "@/lib/db/repo";
import type { PlatformAdapter, TokenSet } from "./types";

export function redirectUri(platform: Platform): string {
  return `${env.publicBaseUrl}/api/connections/${platform}/callback`;
}

export function randomState(): string {
  return randomBytes(24).toString("base64url");
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function expiresAtFrom(expiresInSec: number | undefined | null): string | null {
  if (!expiresInSec) return null;
  return new Date(Date.now() + expiresInSec * 1000).toISOString();
}

export async function postForm(url: string, form: Record<string, string>, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", ...headers },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}: ${text.slice(0, 400)}`);
  return data;
}

export async function fetchJson<T = Record<string, unknown>>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}: ${text.slice(0, 500)}`);
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    return {} as T;
  }
}

/** Return a connection with a fresh access token, refreshing and persisting if it is about to expire. */
export async function ensureFreshToken(adapter: PlatformAdapter, conn: ConnectionRecord): Promise<ConnectionRecord> {
  if (!conn.expiresAt || !adapter.refresh || !conn.refreshToken) return conn;
  const msLeft = new Date(conn.expiresAt).getTime() - Date.now();
  if (msLeft > 5 * 60 * 1000) return conn;
  const tokens: TokenSet = await adapter.refresh(conn);
  return upsertConnection({
    userId: conn.userId,
    platform: conn.platform,
    accountName: tokens.accountName ?? conn.accountName,
    accountId: tokens.accountId ?? conn.accountId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? conn.refreshToken,
    expiresAt: tokens.expiresAt ?? null,
    meta: tokens.meta,
  });
}

export function basicAuth(id: string, secret: string): string {
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
