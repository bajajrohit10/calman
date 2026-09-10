import type { ReactNode } from "react";

import { requireAdminProfile } from "@/lib/auth";

import { SettingsTabs } from "./tabs";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  // Server-side gate. The sidebar hides Settings for non-admins, but hiding a
  // link is not a permission — anyone can type the URL.
  const { profile } = await requireAdminProfile();

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[17px] font-semibold tracking-tight text-ink">Settings</h1>
        <p className="mt-0.5 text-[13px] text-ink-2">
          Users, roles and the master lists every other screen draws from.
        </p>
      </div>
      <SettingsTabs role={profile.role} />
      {children}
    </div>
  );
}
