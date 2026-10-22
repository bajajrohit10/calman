import { CORS_HEADERS, json, originOf, protectedResourceMetadata } from "@/lib/mcp/oauth";

/**
 * §88. RFC 9728 protected-resource metadata for the MCP endpoint.
 *
 * Served at the bare path and at the path-suffixed form
 * (/.well-known/oauth-protected-resource/api/mcp), because clients try both.
 */
export function GET(request: Request) {
  return json(protectedResourceMetadata(originOf(request)));
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
