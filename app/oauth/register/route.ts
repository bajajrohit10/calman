import { CORS_HEADERS, json, redirectAllowed } from "@/lib/mcp/oauth";
import { mcpConfigured, sign } from "@/lib/mcp/tokens";

/**
 * §88. RFC 7591 dynamic client registration.
 *
 * Stateless: the client id *is* the signed registration, carrying its own
 * redirect URIs, so nothing is written. Every client is public (PKCE, no
 * secret), which is what claude.ai and Claude Code are.
 *
 * Registration being open is safe because of what it is allowed to register:
 * redirectAllowed() only admits Claude's own callback and localhost, so an
 * outsider can register a client but cannot point it anywhere they control.
 */
export async function POST(request: Request) {
  if (!mcpConfigured()) {
    return json({ error: "temporarily_unavailable", error_description: "MCP is not configured on this deployment." }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_client_metadata", error_description: "Body must be JSON." }, 400);
  }

  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (!uris.length || uris.length > 10 || !uris.every((u) => typeof u === "string")) {
    return json({ error: "invalid_redirect_uri", error_description: "redirect_uris is required." }, 400);
  }
  const bad = (uris as string[]).find((u) => !redirectAllowed(u));
  if (bad) {
    return json(
      { error: "invalid_redirect_uri", error_description: `Calman does not accept redirects to ${bad}.` },
      400,
    );
  }

  const method = body.token_endpoint_auth_method ?? "none";
  if (method !== "none") {
    return json(
      { error: "invalid_client_metadata", error_description: "Only public clients (token_endpoint_auth_method none) are supported." },
      400,
    );
  }

  const name = typeof body.client_name === "string" ? body.client_name.slice(0, 80) : "MCP client";
  const clientId = sign({ k: "client", name, redirect_uris: uris as string[] });

  return json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
