"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button, cx } from "@/components/ui";

type Item = {
  href: string;
  label: string;
  hint: string;
  /** A glyph, not an icon set: one character, no bundle, no licence. */
  icon: string;
  adminOnly?: boolean;
  /** Key into the counts prop, for a live badge. */
  badge?: "newCalls";
};

// Spec §2. Every item except Settings is available to all four roles; Settings
// is Super Admin and Manager only. The server also enforces this — hiding a
// link is presentation, not permission.
const ITEMS: Item[] = [
  { href: "/my-day", label: "My Day", hint: "Today's assigned calls", icon: "▣" },
  {
    href: "/new-calls",
    label: "New Calls",
    hint: "Unclaimed leads",
    icon: "◈",
    badge: "newCalls",
  },
  {
    href: "/assign",
    label: "Assign",
    hint: "Plan and hand out the day",
    icon: "▤",
    adminOnly: true,
  },
  { href: "/enquiries", label: "Enquiries", hint: "Every enquiry, filterable", icon: "≡" },
  { href: "/quick-add", label: "Quick Add", hint: "Log a ringing phone", icon: "✎" },
  { href: "/import", label: "Import", hint: "Bulk import with review", icon: "↑" },
  { href: "/reports", label: "Reports", hint: "Daily and team reports", icon: "◔" },
  { href: "/tickets", label: "Tickets", hint: "After-sale queue", icon: "✱" },
];

const SETTINGS: Item = {
  href: "/settings/users",
  label: "Settings",
  hint: "Users and master lists",
  icon: "⚙",
};

/**
 * The navigation rail.
 *
 * Dark, and the only dark surface in the app: it stops being something to read
 * and becomes the edge of the window, which is what nine hours of looking at
 * the same eight links actually wants. The one-line-per-item form replaced a
 * two-line one carrying a description under every label — useful on the first
 * day, noise on the second — so the descriptions moved to the title attribute
 * and the rail lost about a third of its height.
 */
export function Sidebar({
  showSettings,
  fullName,
  roleLabel,
  counts,
  signOut,
}: {
  showSettings: boolean;
  fullName: string;
  roleLabel: string;
  /** Server-rendered, so it refreshes on navigation (§5.12). */
  counts: { newCalls: number };
  signOut: () => Promise<void>;
}) {
  const pathname = usePathname();
  const items = showSettings
    ? [...ITEMS, SETTINGS]
    : ITEMS.filter((item) => !item.adminOnly);

  return (
    <nav
      aria-label="Main"
      className="flex w-[208px] shrink-0 flex-col bg-rail py-3 text-rail-ink"
    >
      <div className="mb-2 border-b border-rail-line px-4 pb-3.5">
        <div className="text-[14px] font-semibold tracking-[-0.01em] text-white">
          Calman
        </div>
        <div className="text-[11px] text-rail-ink-2">Zeroinfy counselling</div>
      </div>

      <ul className="flex flex-1 flex-col gap-px px-2">
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
                title={item.hint}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex items-center gap-[9px] rounded-md px-2 py-1.5 text-[12.5px] transition-colors",
                  active
                    ? "bg-accent font-medium text-accent-ink"
                    : "text-rail-ink hover:bg-rail-hover hover:text-white",
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    "w-[15px] shrink-0 text-center text-[12px]",
                    active ? "opacity-100" : "opacity-60",
                  )}
                >
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
                {item.badge && counts[item.badge] > 0 ? (
                  <span
                    aria-label={`${counts[item.badge]} waiting`}
                    className={cx(
                      "ml-auto rounded-[9px] px-1.5 text-[10.5px]/[16px] font-semibold",
                      active
                        ? "bg-accent-ink/20 text-accent-ink"
                        : "bg-accent text-accent-ink",
                    )}
                  >
                    {counts[item.badge]}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto border-t border-rail-line px-4 pt-2.5">
        <div className="truncate text-[12px] font-medium text-white" title={fullName}>
          {fullName}
        </div>
        <div className="text-[11.5px] text-rail-ink-2" data-testid="viewer-role">
          {roleLabel}
        </div>
        <form action={signOut} className="mt-2">
          <Button
            type="submit"
            size="sm"
            className="w-full justify-start border-0 bg-transparent px-2 text-rail-ink-2 hover:bg-rail-hover hover:text-white"
          >
            Sign out
          </Button>
        </form>
      </div>
    </nav>
  );
}
