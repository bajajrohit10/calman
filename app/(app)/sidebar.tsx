"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button, cx } from "@/components/ui";

type Item = { href: string; label: string; hint: string };

// Spec §2. Every item except Settings is available to all four roles; Settings
// is Super Admin and Manager only. The server also enforces this — hiding a
// link is presentation, not permission.
const ITEMS: Item[] = [
  { href: "/my-day", label: "My Day", hint: "Today's assigned calls" },
  { href: "/enquiries", label: "Enquiries", hint: "Every enquiry, filterable" },
  { href: "/quick-add", label: "Quick Add", hint: "Log a ringing phone" },
  { href: "/import", label: "Import", hint: "Bulk import with review" },
  { href: "/reports", label: "Reports", hint: "Daily and team reports" },
  { href: "/tickets", label: "Tickets", hint: "After-sale queue" },
];

const SETTINGS: Item = {
  href: "/settings/users",
  label: "Settings",
  hint: "Users and master lists",
};

export function Sidebar({
  showSettings,
  fullName,
  roleLabel,
  signOut,
}: {
  showSettings: boolean;
  fullName: string;
  roleLabel: string;
  signOut: () => Promise<void>;
}) {
  const pathname = usePathname();
  const items = showSettings ? [...ITEMS, SETTINGS] : ITEMS;

  return (
    <nav
      aria-label="Main"
      className="flex w-[212px] shrink-0 flex-col border-r border-line bg-surface"
    >
      <div className="border-b border-line px-4 py-3.5">
        <div className="text-[15px] font-semibold tracking-tight text-ink">Calman</div>
        <div className="text-[11.5px] text-ink-3">Zeroinfy counselling</div>
      </div>

      <ul className="flex flex-1 flex-col gap-0.5 p-2">
        {items.map((item) => {
          const active =
            pathname === item.href ||
            pathname.startsWith(`${item.href}/`) ||
            // Settings has sub-routes under a different first segment.
            (item.href === SETTINGS.href && pathname.startsWith("/settings"));

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "block rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                  active
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                )}
              >
                {item.label}
                <span className="block text-[11px] font-normal text-ink-3">
                  {item.hint}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-line p-3">
        <div className="truncate text-[12.5px] font-medium text-ink" title={fullName}>
          {fullName}
        </div>
        <div className="text-[11.5px] text-ink-3" data-testid="viewer-role">
          {roleLabel}
        </div>
        <form action={signOut} className="mt-2">
          <Button type="submit" variant="ghost" size="sm" className="w-full justify-start px-2">
            Sign out
          </Button>
        </form>
      </div>
    </nav>
  );
}
