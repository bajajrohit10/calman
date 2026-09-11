import { Suspense, type ReactNode } from "react";

import { signOut } from "@/app/actions/sign-out";
import { Button } from "@/components/ui";
import { ROLE_LABELS, isAdmin, requireUser } from "@/lib/auth";
import { timed } from "@/lib/server-timing";
import { createClient } from "@/lib/supabase/server";

import { Sidebar } from "./sidebar";

/**
 * The number on the New Calls badge (§5.12).
 *
 * Its own component so it has its own Suspense boundary: server-rendered, so
 * it is still current on every navigation without polling, but off the path
 * everything else is waiting on.
 */
async function NewCallsCount() {
  const supabase = await createClient();
  const { data } = await timed("badge", () =>
    supabase.rpc("new_calls_pool", {
      p_limit: 1,
      p_offset: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any),
  );
  const n = Number((data as { total_count: number }[] | null)?.[0]?.total_count ?? 0);
  // Nothing rather than a zero: the wrapper in the sidebar is `empty:hidden`,
  // so returning null is what makes the pill disappear.
  return n > 0 ? <>{n}</> : null;
}

/**
 * Everything still to call on this counsellor's day (§19.4) — the sum of the
 * five My Day tabs' pending counts, as one number from one round trip. Server
 * -rendered like the New Calls badge, so it is current on every navigation
 * without polling, and streamed so nothing waits for it.
 */
async function MyDayPendingCount() {
  const supabase = await createClient();
  const { data } = await timed("badge-myday", () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase.rpc("my_day_pending_count", {} as any),
  );
  const n = Number(data ?? 0);
  return n > 0 ? <>{n}</> : null;
}

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { email, profile } = await requireUser();

  // No profile row, or one with is_active = false. Both make app.role() null,
  // so every RLS policy would deny every read and the app would render as a
  // working shell full of empty tables. Say what actually happened instead.
  if (!profile) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-ground px-6">
        <div className="w-full max-w-[400px] rounded-lg border border-line bg-surface shadow-card p-6">
          <h1 className="text-[15px] font-semibold text-ink">
            Account not activated — contact admin
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            You signed in successfully as{" "}
            <span className="font-medium text-ink">{email}</span>, but this account
            has not been activated for Calman, or has been deactivated.
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            A Super Admin or Manager can activate it from Settings → Users. Until
            then there is nothing here for you to see.
          </p>
          <form action={signOut} className="mt-5">
            <Button type="submit" variant="secondary">
              Sign out
            </Button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <div className="flex min-h-dvh bg-ground">
      <Sidebar
        // Streamed, not awaited. This count is one RPC, and it used to sit at
        // the top of the layout where every route on every navigation waited
        // for it before rendering a single row — a whole round trip spent
        // numbering a badge. Inside Suspense it arrives when it arrives, and
        // the page no longer knows it exists.
        badges={{
          newCalls: (
            <Suspense fallback={null}>
              <NewCallsCount />
            </Suspense>
          ),
          myDay: (
            <Suspense fallback={null}>
              <MyDayPendingCount />
            </Suspense>
          ),
        }}
        showSettings={isAdmin(profile.role)}
        fullName={profile.full_name}
        roleLabel={ROLE_LABELS[profile.role]}
        signOut={signOut}
      />
      <main className="min-w-0 flex-1 px-5 pt-4 pb-7">
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
