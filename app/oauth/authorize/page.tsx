import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui";
import { getViewer } from "@/lib/auth";
import { MCP_ROLES, originFromHeaders, redirectWith, validateAuthorize } from "@/lib/mcp/oauth";
import { CSRF_TTL_S, digest, mcpConfigured, now, sign } from "@/lib/mcp/tokens";

export const metadata = { title: "Connect Claude · Calman" };

type Params = Record<string, string | string[] | undefined>;

/**
 * §88. The consent screen Claude sends a manager to when they add the Calman
 * connector.
 *
 * Sign-in is the ordinary Calman login (with a `next` back to here), so there is
 * no second password and the same deactivation that locks someone out of the
 * app locks them out of this. Only super admins and managers may connect —
 * the same people who can see the Assignment Desk and Analytics.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const get = (k: string) => {
    const v = sp[k];
    return typeof v === "string" ? v : null;
  };

  if (!mcpConfigured()) {
    return <Shell title="Not available">The Claude connector is not configured on this deployment yet.</Shell>;
  }

  const origin = originFromHeaders(await headers());
  const checked = validateAuthorize(get, origin);

  if (!checked.ok && !checked.redirect) {
    return <Shell title="This link can’t be used">{checked.description}</Shell>;
  }
  if (!checked.ok) {
    redirect(
      redirectWith(checked.params.redirectUri, {
        error: checked.error,
        error_description: checked.description,
        state: checked.params.state,
      }),
    );
  }

  const viewer = await getViewer();
  if (!viewer.userId) {
    const qs = new URLSearchParams(
      Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string"),
    ).toString();
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${qs}`)}`);
  }

  if (!viewer.profile || !MCP_ROLES.has(viewer.profile.role)) {
    return (
      <Shell title="Not allowed">
        Only a super admin or a manager can connect Claude to Calman. You are signed in as{" "}
        {viewer.email ?? "an account"} without that role.
      </Shell>
    );
  }

  const { params, client } = checked;
  const csrf = sign({
    k: "csrf",
    sub: viewer.userId,
    h: digest([params.clientId, params.redirectUri, params.state, params.codeChallenge, params.resource]),
    exp: now() + CSRF_TTL_S,
  });
  const callbackHost = new URL(params.redirectUri).host;
  // The registered name is whatever the registering client typed, so it is only
  // shown as-is for a local client; Claude's own callback gets a fixed label.
  const appName = /^(claude\.ai|claude\.com)$/.test(callbackHost) ? "Claude" : `${client.name} (on this computer)`;

  return (
    <Shell title="Connect Claude to Calman">
      <p>
        <strong className="text-ink">{appName}</strong> is asking to use Calman as{" "}
        <strong className="text-ink">{viewer.profile.full_name || viewer.email}</strong>.
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5">
        <li>Read everything you can see in Calman — leads, phone numbers, calls, sales, reports.</li>
        <li>Create and switch offers on or off, and assign or unassign leads, recorded in the audit log under your name.</li>
        <li>Nothing can be deleted, and access stops if your account is deactivated.</li>
      </ul>
      <p className="mt-3 text-[12px] text-ink-3">You will be returned to {callbackHost}.</p>

      <form method="post" action="/oauth/authorize/approve" className="mt-5 flex gap-2">
        <input type="hidden" name="client_id" value={params.clientId} />
        <input type="hidden" name="redirect_uri" value={params.redirectUri} />
        <input type="hidden" name="state" value={params.state} />
        <input type="hidden" name="code_challenge" value={params.codeChallenge} />
        <input type="hidden" name="code_challenge_method" value="S256" />
        <input type="hidden" name="response_type" value="code" />
        <input type="hidden" name="resource" value={params.resource} />
        <input type="hidden" name="csrf" value={csrf} />
        <Button type="submit" name="decision" value="allow" variant="primary">
          Allow
        </Button>
        <Button type="submit" name="decision" value="deny">
          Cancel
        </Button>
      </form>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-ground px-6 py-12">
      <div className="w-full max-w-[440px]">
        <div className="mb-5 flex items-baseline gap-2">
          <span className="text-[19px] font-semibold tracking-tight text-ink">Calman</span>
          <span className="text-[12px] text-ink-3">Zeroinfy counselling</span>
        </div>
        <h1 className="text-[15px] font-semibold text-ink">{title}</h1>
        <div className="mt-2 text-[13px] leading-relaxed text-ink-2">{children}</div>
      </div>
    </main>
  );
}
