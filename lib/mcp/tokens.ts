import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * §88. Signed, stateless tokens for the MCP OAuth flow.
 *
 * Every artefact OAuth needs — the registered client, the authorisation code,
 * the access and refresh tokens, the consent form's CSRF token — is a small
 * JSON payload signed with HMAC-SHA256 under MCP_OAUTH_SECRET. Nothing is
 * stored, so the feature needs no table, and no migration beyond the login role.
 *
 * What that costs, and why it is acceptable here:
 *
 *   - A token cannot be revoked one at a time. Instead every MCP request
 *     re-reads the user's profile, so deactivating the account in Settings →
 *     Users, or demoting it below manager, cuts access on the next call.
 *     Rotating MCP_OAUTH_SECRET revokes everything at once.
 *   - An authorisation code can be replayed within its five minutes. PKCE makes
 *     that worthless: only the client holding the verifier can redeem it.
 *
 * The `k` field is the token's kind and is checked on every verify, so an
 * access token can never be presented where a refresh token is expected, a
 * client id can never be presented as a token, and so on.
 */

export type TokenKind = "client" | "code" | "access" | "refresh" | "csrf";

type Base = { k: TokenKind; iat: number; exp?: number };

export type ClientPayload = Base & {
  k: "client";
  name: string;
  redirect_uris: string[];
};

export type CodePayload = Base & {
  k: "code";
  sub: string;
  cid: string;
  ruri: string;
  cc: string;
  res: string;
  n: string;
};

export type AccessPayload = Base & { k: "access"; sub: string; cid: string; res: string };
export type RefreshPayload = Base & { k: "refresh"; sub: string; cid: string; res: string; n: string };
export type CsrfPayload = Base & { k: "csrf"; sub: string; h: string };

type PayloadFor = {
  client: ClientPayload;
  code: CodePayload;
  access: AccessPayload;
  refresh: RefreshPayload;
  csrf: CsrfPayload;
};

export const ACCESS_TTL_S = 60 * 60;
export const REFRESH_TTL_S = 30 * 24 * 60 * 60;
export const CODE_TTL_S = 5 * 60;
export const CSRF_TTL_S = 15 * 60;

function secret(): Buffer {
  const s = process.env.MCP_OAUTH_SECRET;
  // Refusing a short secret is the point: a guessable one makes every token
  // forgeable, and that is a worse failure than the feature being off.
  if (!s || s.length < 32) {
    throw new Error("MCP_OAUTH_SECRET is missing or shorter than 32 characters.");
  }
  return Buffer.from(s, "utf8");
}

export function mcpConfigured(): boolean {
  const s = process.env.MCP_OAUTH_SECRET;
  return Boolean(s && s.length >= 32 && process.env.CALMAN_MCP_DATABASE_URL);
}

const b64 = (b: Buffer) => b.toString("base64url");

function mac(body: string): Buffer {
  return createHmac("sha256", secret()).update(body).digest();
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

export function nonce(): string {
  return b64(randomBytes(12));
}

/** Prefix by kind so a token's job is visible in a log without decoding it. */
const PREFIX: Record<TokenKind, string> = {
  client: "cmc",
  code: "cmk",
  access: "cma",
  refresh: "cmr",
  csrf: "cmx",
};

export function sign<K extends TokenKind>(
  payload: Omit<PayloadFor[K], "iat"> & { k: K },
): string {
  const full = { ...payload, iat: now() };
  const body = b64(Buffer.from(JSON.stringify(full), "utf8"));
  return `${PREFIX[payload.k]}_${body}.${b64(mac(body))}`;
}

export function verify<K extends TokenKind>(token: unknown, kind: K): PayloadFor[K] | null {
  if (typeof token !== "string" || token.length > 8192) return null;
  const prefix = `${PREFIX[kind]}_`;
  if (!token.startsWith(prefix)) return null;
  const rest = token.slice(prefix.length);
  const dot = rest.indexOf(".");
  if (dot <= 0) return null;
  const body = rest.slice(0, dot);
  const sig = Buffer.from(rest.slice(dot + 1), "base64url");
  const expected = mac(body);
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;

  let payload: Base;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || payload.k !== kind) return null;
  if (typeof payload.exp === "number" && payload.exp < now()) return null;
  return payload as PayloadFor[K];
}

/** PKCE S256: base64url(sha256(verifier)) must equal the challenge. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const computed = b64(createHash("sha256").update(verifier).digest());
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A digest of the consent parameters, so a CSRF token cannot be reused for a different request. */
export function digest(parts: string[]): string {
  return b64(createHash("sha256").update(parts.join("\u0000")).digest()).slice(0, 22);
}
