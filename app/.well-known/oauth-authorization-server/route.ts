import { authServerMetadata, CORS_HEADERS, json, originOf } from "@/lib/mcp/oauth";

/** §88. RFC 8414 authorisation-server metadata. Calman is its own issuer. */
export function GET(request: Request) {
  return json(authServerMetadata(originOf(request)));
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
