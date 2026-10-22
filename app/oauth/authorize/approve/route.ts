import { getViewer } from "@/lib/auth";
import { MCP_ROLES, originOf, redirectWith, validateAuthorize } from "@/lib/mcp/oauth";
import { CODE_TTL_S, digest, nonce, now, sign, verify } from "@/lib/mcp/tokens";

/**
 * §88. The consent form's POST. Issues the authorisation code and sends the
 * browser back to Claude.
 *
 * Three independent checks stand between a forged form and a code:
 *   1. the Origin header must be Calman's own,
 *   2. the CSRF token must be signed for this user *and* these exact
 *      parameters,
 *   3. the session cookie is SameSite=Lax, so a cross-site POST arrives
 *      signed out.
 * And the redirect is re-validated, so even a valid form cannot send a code
 * anywhere but Claude's callback.
 */
function page(message: string, status = 400) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Calman</title><body style="font:14px system-ui;padding:3rem;max-width:32rem">${message}</body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function POST(request: Request) {
  const origin = originOf(request);
  const from = request.headers.get("origin");
  if (from && from !== origin) return page("This request did not come from Calman.", 403);

  const form = await request.formData();
  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : null;
  };

  const checked = validateAuthorize(get, origin);
  if (!checked.ok) {
    return page(checked.ok === false && !checked.redirect ? checked.description : "Invalid request.");
  }
  const { params } = checked;

  if (get("decision") !== "allow") {
    return Response.redirect(
      redirectWith(params.redirectUri, { error: "access_denied", state: params.state }),
      303,
    );
  }

  const viewer = await getViewer();
  if (!viewer.userId) return page("Your Calman session has ended. Go back to Claude and connect again.", 401);
  if (!viewer.profile || !MCP_ROLES.has(viewer.profile.role)) {
    return page("Only a super admin or a manager can connect Claude to Calman.", 403);
  }

  const csrf = verify(get("csrf"), "csrf");
  const expected = digest([params.clientId, params.redirectUri, params.state, params.codeChallenge, params.resource]);
  if (!csrf || csrf.sub !== viewer.userId || csrf.h !== expected) {
    return page("This approval form has expired. Go back to Claude and connect again.", 403);
  }

  const code = sign({
    k: "code",
    sub: viewer.userId,
    cid: params.clientId,
    ruri: params.redirectUri,
    cc: params.codeChallenge,
    res: params.resource,
    n: nonce(),
    exp: now() + CODE_TTL_S,
  });

  return Response.redirect(redirectWith(params.redirectUri, { code, state: params.state }), 303);
}
