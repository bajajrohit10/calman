import "server-only";

import { verify, type ClientPayload } from "@/lib/mcp/tokens";

/**
 * §88. The OAuth half of the MCP server: URLs, the redirect policy, and the one
 * validator the consent page and the approve route both run, so the two can
 * never disagree about what a valid request is.
 */

/**
 * The public origin. Taken from the request rather than configured, so the
 * preview deployments and calman.zeroinfy.in each describe themselves
 * correctly. MCP_PUBLIC_ORIGIN overrides it when a proxy in front rewrites the
 * host.
 */
export function originOf(request: Request): string {
  // From the Host headers rather than request.url: `next start` builds
  // request.url from its own bind address, not the host the client asked for,
  // and the issuer, the resource and the token's audience must all agree.
  return originFromHeaders(request.headers);
}

/** The same, for a page, which has headers but no Request. */
export function originFromHeaders(h: Headers): string {
  const configured = process.env.MCP_PUBLIC_ORIGIN?.replace(/\/+$/, "");
  if (configured) return configured;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

export function resourceUrl(origin: string): string {
  return `${origin}/api/mcp`;
}

export function authServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["calman"],
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: resourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: ["calman"],
    bearer_methods_supported: ["header"],
    resource_name: "Calman",
  };
}

/**
 * Where a code may be sent.
 *
 * Registration is open — that is what lets claude.ai connect without anyone
 * pasting a client id — so the redirect is the thing that has to be closed.
 * Without this list, anyone could register a client pointing at their own
 * server and send a manager a convincing "Allow" link. With it, a code can only
 * ever land at Claude's own callback, or on the user's own machine (Claude
 * Code and the MCP inspector listen on localhost).
 *
 * MCP_EXTRA_REDIRECT_URIS (comma-separated, exact match) adds to it.
 */
const CLAUDE_CALLBACKS = new Set([
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
]);

export function redirectAllowed(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (CLAUDE_CALLBACKS.has(`${u.origin}${u.pathname}`) && !u.search) return true;
  if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) {
    return true;
  }
  const extra = (process.env.MCP_EXTRA_REDIRECT_URIS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return extra.includes(uri);
}

export type AuthorizeParams = {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  resource: string;
};

export type ValidatedAuthorize =
  | { ok: true; params: AuthorizeParams; client: ClientPayload }
  /** Safe to report to the client by redirect. */
  | { ok: false; redirect: true; params: AuthorizeParams; error: string; description: string }
  /** Not safe to redirect: the redirect itself is the problem. Show it on the page. */
  | { ok: false; redirect: false; description: string };

export function validateAuthorize(
  get: (name: string) => string | null,
  origin: string,
): ValidatedAuthorize {
  const clientId = get("client_id") ?? "";
  const redirectUri = get("redirect_uri") ?? "";
  const client = verify(clientId, "client");
  if (!client) {
    return {
      ok: false,
      redirect: false,
      description: "This connection request has an unknown client. Remove the connector in Claude and add it again.",
    };
  }
  if (!redirectUri || !client.redirect_uris.includes(redirectUri) || !redirectAllowed(redirectUri)) {
    return {
      ok: false,
      redirect: false,
      description: "This connection request asks to send you somewhere Calman does not trust.",
    };
  }

  const params: AuthorizeParams = {
    clientId,
    redirectUri,
    state: get("state") ?? "",
    codeChallenge: get("code_challenge") ?? "",
    resource: get("resource") || resourceUrl(origin),
  };

  if (get("response_type") !== "code") {
    return { ok: false, redirect: true, params, error: "unsupported_response_type", description: "Only the code flow is supported." };
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge) || get("code_challenge_method") !== "S256") {
    return { ok: false, redirect: true, params, error: "invalid_request", description: "PKCE with S256 is required." };
  }
  // RFC 8707: a token is only ever for this server.
  if (params.resource.replace(/\/+$/, "") !== resourceUrl(origin)) {
    return { ok: false, redirect: true, params, error: "invalid_target", description: "Unknown resource." };
  }
  return { ok: true, params, client };
}

export function redirectWith(uri: string, query: Record<string, string>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(query)) if (v) u.searchParams.set(k, v);
  return u.toString();
}

/** CORS for the endpoints a browser-based client may call directly. */
export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-protocol-version",
  "Access-Control-Max-Age": "86400",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { ...CORS_HEADERS, "Cache-Control": "no-store", ...extra },
  });
}

/** Roles allowed to connect Claude. Same test as the Assignment Desk and Offers. */
export const MCP_ROLES = new Set(["super_admin", "manager"]);
