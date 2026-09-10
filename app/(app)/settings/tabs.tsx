"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@/components/ui";
import { ROLE_LABELS, type Role } from "@/lib/roles";

const TABS = [
  { href: "/settings/users", label: "Users" },
  { href: "/settings/master-lists", label: "Master lists" },
];

export function SettingsTabs({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <div className="flex items-center justify-between border-b border-line">
      <nav aria-label="Settings sections" className="flex gap-1">
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors",
                active
                  ? "border-accent font-medium text-ink"
                  : "border-transparent text-ink-2 hover:text-ink",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <span className="pb-2 text-[11.5px] text-ink-3">
        Signed in as {ROLE_LABELS[role]}
      </span>
    </div>
  );
}
