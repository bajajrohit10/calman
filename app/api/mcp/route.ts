import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { roleOf } from "@/lib/mcp/db";
import { CORS_HEADERS, MCP_ROLES, originOf, resourceUrl } from "@/lib/mcp/oauth";
import { buildServer } from "@/lib/mcp/server";
import { mcpConfigured, verify } from "@/lib/mcp/tokens";

/**
 * §88. The Calman MCP endpoint (Streamable HTTP, stateless).
 *
 * Add https://calman.zeroinfy.in/api/mcp as a custom connector in Claude. An
 * unauthenticated request gets a 401 pointing at the protected-resource
 * metadata, which is how Claude discovers the OAuth flow and sends the user to
 * Calman's own sign-in and consent screen.
 *
 * Every request re-reads the caller's profile, so deactivating an account or
 * demoting it below manager takes effect on the next tool call.
 */

export const maxDuration = 60;

function unauthorized(request: Request, description: string) {
  const origin = originOf(request);
  return new Response(JSON.stringify({ error: "invalid_token", error_description: description }), {
    status: 401,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp", error="invalid_token", error_description="${description}"`,
      "Access-Control-Expose-Headers": "WWW-Authenticate",
    },
  });
}

async function handle(request: Request): Promise<Response> {
  if (!mcpConfigured()) {
    return Response.json({ error: "The Calman MCP server is not configured on this deployment." }, { status: 503 });
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const access = verify(token, "access");
  if (!access) return unauthorized(request, "Sign in to Calman to continue.");
  if (access.res.replace(/\/+$/, "") !== resourceUrl(originOf(request))) {
    return unauthorized(request, "This token was issued for a different server.");
  }

  const who = await roleOf(access.sub).catch(() => null);
  if (!who || !MCP_ROLES.has(who.role)) {
    return new Response(JSON.stringify({ error: "insufficient_scope", error_description: "This Calman account can no longer use Claude." }), {
      status: 403,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const server = buildServer({ userId: access.sub, role: who.role, name: who.name });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(request, {
      authInfo: { token, clientId: access.cid, scopes: ["calman"], expiresAt: access.exp, resource: new URL(access.res) },
    });
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
    return new Response(response.body, { status: response.status, headers });
  } finally {
    // JSON-response mode has finished writing by the time handleRequest
    // resolves, so closing here cannot cut a reply short.
    await server.close().catch(() => {});
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
