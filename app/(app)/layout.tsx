import type { ReactNode } from "react";

import { signOut } from "@/app/actions/sign-out";
import { Button } from "@/components/ui";
import { ROLE_LABELS, isAdmin, requireUser } from "@/lib/auth";

import { Sidebar } from "./sidebar";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { email, profile } = await requireUser();

  // No profile row, or one with is_active = false. Both make app.role() null,
  // so every RLS policy would deny every read and the app would render as a
  // working shell full of empty tables. Say what actually happened instead.
  if (!profile) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-ground px-6">
        <div className="w-full max-w-[400px] rounded-lg border border-line bg-surface p-6">
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
        showSettings={isAdmin(profile.role)}
        fullName={profile.full_name}
        roleLabel={ROLE_LABELS[profile.role]}
        signOut={signOut}
      />
      <main className="min-w-0 flex-1 px-7 py-6">
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </main>
    </div>
  );
}
