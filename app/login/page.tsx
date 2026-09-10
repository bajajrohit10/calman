import { redirect } from "next/navigation";

import { getViewer } from "@/lib/auth";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Calman" };

export default async function LoginPage() {
  const { userId } = await getViewer();
  if (userId) redirect("/my-day");

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ground px-6 py-12">
      <div className="w-full max-w-[340px]">
        <div className="mb-7">
          <div className="flex items-baseline gap-2">
            <span className="text-[19px] font-semibold tracking-tight text-ink">Calman</span>
            <span className="text-[12px] text-ink-3">Zeroinfy counselling</span>
          </div>
          <p className="mt-1 text-[13px] text-ink-2">Sign in to continue.</p>
        </div>

        <LoginForm />

        {/*
          No signup link and no "forgot password" link, on purpose. There is no
          SMTP on this project: accounts and password resets are both handled by
          an admin in Settings → Users (spec §8, "no self-signup").
        */}
        <p className="mt-6 border-t border-line pt-4 text-[12.5px] leading-relaxed text-ink-3">
          Accounts are created by an administrator. If you cannot sign in or need
          your password reset, contact your manager.
        </p>
      </div>
    </main>
  );
}
