import { roleOf } from "@/lib/mcp/db";
import { CORS_HEADERS, json, MCP_ROLES } from "@/lib/mcp/oauth";
import {
  ACCESS_TTL_S,
  mcpConfigured,
  nonce,
  now,
  pkceMatches,
  REFRESH_TTL_S,
  sign,
  verify,
} from "@/lib/mcp/tokens";

/**
 * §88. The token endpoint: authorization_code (with PKCE) and refresh_token.
 *
 * Both grants re-check the account before issuing anything, so a manager who
 * was deactivated after connecting Claude stops getting tokens at the next
 * refresh, not in thirty days.
 */

async function readForm(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(body).filter(([, v]) => typeof v === "string") as [string, string][],
    );
  }
  const form = new URLSearchParams(await request.text());
  return Object.fromEntries(form.entries());
}

function oauthError(error: string, description: string, status = 400) {
  return json({ error, error_description: description }, status);
}

async function issue(sub: string, cid: string, res: string) {
  const t = now();
  return json({
    access_token: sign({ k: "access", sub, cid, res, exp: t + ACCESS_TTL_S }),
    token_type: "Bearer",
    expires_in: ACCESS_TTL_S,
    refresh_token: sign({ k: "refresh", sub, cid, res, n: nonce(), exp: t + REFRESH_TTL_S }),
    scope: "calman",
  });
}

async function stillAllowed(sub: string): Promise<boolean> {
  const who = await roleOf(sub);
  return Boolean(who && MCP_ROLES.has(who.role));
}

export async function POST(request: Request) {
  if (!mcpConfigured()) return oauthError("temporarily_unavailable", "MCP is not configured.", 503);

  const form = await readForm(request);
  const grant = form.grant_type;

  if (grant === "authorization_code") {
    const code = verify(form.code, "code");
    if (!code) return oauthError("invalid_grant", "The code is invalid or has expired.");
    if (form.client_id && form.client_id !== code.cid) {
      return oauthError("invalid_grant", "The code was issued to a different client.");
    }
    if (form.redirect_uri !== code.ruri) {
      return oauthError("invalid_grant", "redirect_uri does not match the authorisation request.");
    }
    if (!form.code_verifier || !pkceMatches(form.code_verifier, code.cc)) {
      return oauthError("invalid_grant", "PKCE verification failed.");
    }
    if (!(await stillAllowed(code.sub))) {
      return oauthError("invalid_grant", "This Calman account can no longer connect Claude.");
    }
    return issue(code.sub, code.cid, code.res);
  }

  if (grant === "refresh_token") {
    const refresh = verify(form.refresh_token, "refresh");
    if (!refresh) return oauthError("invalid_grant", "The refresh token is invalid or has expired.");
    if (form.client_id && form.client_id !== refresh.cid) {
      return oauthError("invalid_grant", "The refresh token was issued to a different client.");
    }
    if (!(await stillAllowed(refresh.sub))) {
      return oauthError("invalid_grant", "This Calman account can no longer connect Claude.");
    }
    return issue(refresh.sub, refresh.cid, refresh.res);
  }

  return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
