"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSyncExternalStore, useTransition, type ReactNode } from "react";

import { syncBlink } from "@/components/blink";
import { Button, cx } from "@/components/ui";
import { useConfirmLeave } from "@/components/unsaved-guard";

import { setTheme } from "./actions/set-theme";
import { useNewCallsCount } from "./new-calls-count";

type Item = {
  href: string;
  label: string;
  hint: string;
  /** A glyph, not an icon set: one character, no bundle, no licence. */
  icon: string;
  adminOnly?: boolean;
  /** Key into the counts prop, for a live badge. */
  badge?: "newCalls" | "myDay";
  /**
   * A second way into the same area, shown under it (§40.1). One level only:
   * a rail that grows a tree is a rail nobody reads.
   */
  sub?: { href: string; label: string; hint: string }[];
};

// Spec §2. Every item except Settings is available to all four roles; Settings
// is Super Admin and Manager only. The server also enforces this — hiding a
// link is presentation, not permission.
const ITEMS: Item[] = [
  {
    href: "/my-day",
    label: "My Day",
    hint: "Today's assigned calls",
    icon: "▣",
    badge: "myDay",
  },
  {
    href: "/new-calls",
    label: "New Calls",
    hint: "Unclaimed leads",
    icon: "◈",
    badge: "newCalls",
  },
  { href: "/quick-add", label: "Quick Add", hint: "Log a ringing phone", icon: "✎" },
  { href: "/import", label: "Import", hint: "Bulk import with review", icon: "↑" },
  { href: "/tickets", label: "Tickets", hint: "After-sale queue", icon: "✱" },
  { href: "/enquiries", label: "Enquiries", hint: "Every enquiry, filterable", icon: "≡" },
  {
    href: "/assign",
    label: "Assign",
    hint: "Plan and hand out the day",
    icon: "▤",
    adminOnly: true,
    sub: [
      {
        href: "/assign/smart",
        label: "Smart",
        hint: "The whole board as columns of options",
      },
    ],
  },
  { href: "/reports", label: "Reports", hint: "Daily and team reports", icon: "◔" },
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
  theme,
  badges,
  signOut,
}: {
  showSettings: boolean;
  fullName: string;
  roleLabel: string;
  /** §43.2: which palette this person is looking at. */
  theme: "dark" | "light";
  /**
   * The two counts, as streamed server components rather than numbers. They
   * arrive after the rest of the rail, so nothing here can wait on them —
   * which is the point: see the Suspense boundaries in the layout.
   */
  badges: Partial<Record<"newCalls" | "myDay", ReactNode>>;
  signOut: () => Promise<void>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const confirmLeave = useConfirmLeave();
  // The pill's polled figure, once it has one. Until then the server's.
  const newCalls = useNewCallsCount();
  const collapsed = useRailCollapsed();
  const [themePending, startTheme] = useTransition();
  const items = showSettings
    ? [...ITEMS, SETTINGS]
    : ITEMS.filter((item) => !item.adminOnly);

  /** Hidden while the rail is icons-only, back on hover. */
  const label = collapsed ? "hidden group-hover:block" : "";

  return (
    // §40.2. The rail keeps its place in the row at whatever width it is at
    // rest, and the nav floats above that place so hovering it does not shove
    // the page sideways. Below 1366 that resting width is 56px — icons — and
    // the labels come back on hover, which is what makes the collapsed state
    // usable without the toggle.
    <div
      className={cx(
        "relative shrink-0 transition-[width] duration-150",
        collapsed ? "w-[56px]" : "w-[208px]",
      )}
    >
      <nav
        aria-label="Main"
        className={cx(
          "group absolute inset-y-0 left-0 z-30 flex flex-col overflow-hidden bg-rail py-3 text-rail-ink transition-[width] duration-150",
          collapsed ? "w-[56px] hover:w-[208px] hover:shadow-2xl" : "w-[208px]",
        )}
      >
      <div
        className={cx(
          "mb-2 flex items-start border-b border-rail-line pb-3",
          collapsed ? "px-2.5" : "px-4",
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold tracking-[-0.01em] text-white">
            {collapsed ? (
              <>
                <span className="group-hover:hidden">C</span>
                <span className="hidden group-hover:inline">Calman</span>
              </>
            ) : (
              "Calman"
            )}
          </div>
          <div className={cx("text-[11px] text-rail-ink-2", label)}>
            Zeroinfy counselling
          </div>
        </div>
        <RailToggle collapsed={collapsed} />
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
                // §27.4. A sidebar click is the commonest way to walk away
                // from a half-written note, so it asks first and navigates
                // itself once the answer is in.
                onClick={(e) => {
                  e.preventDefault();
                  void confirmLeave().then((ok: boolean) => {
                    if (ok) router.push(item.href);
                  });
                }}
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
                <span className={cx("truncate", label)}>{item.label}</span>
                {item.badge ? (
                  // empty:hidden is what lets the count stream in. While the
                  // boundary is still pending — and when the count is zero,
                  // which renders nothing — this span has no children and CSS
                  // removes it, so there is never an empty coloured pill. It
                  // is also what makes the blink below self-limiting: an
                  // animation on a display:none element shows nobody anything,
                  // so the badge blinks exactly while there is something to
                  // blink about, without the rail needing to know the count.
                  <span
                    ref={item.badge === "newCalls" ? syncBlink : undefined}
                    className={cx(
                      "ml-auto rounded-[9px] px-1.5 text-[10.5px]/[16px] font-semibold empty:hidden",
                      active
                        ? "bg-accent-ink/20 text-accent-ink"
                        : "bg-accent text-accent-ink",
                      // §29.1 follow-up: in step with the pill over the page,
                      // so the two read as one alert rather than two faults —
                      // including the faster beat while the pill is flashing.
                      item.badge === "newCalls" &&
                        (newCalls.added > 0 ? "animate-blink-fast" : "animate-blink"),
                    )}
                  >
                    {item.badge === "newCalls" && newCalls.count !== null
                      ? newCalls.count > 0
                        ? newCalls.count
                        : null
                      : badges[item.badge]}
                  </span>
                ) : null}
              </Link>

              {/* §40.1. One indented line under its parent: a second way into
                  the same area, which only makes sense next to the first. */}
              {item.sub?.length ? (
                <ul className={cx("mt-px flex flex-col gap-px", label)}>
                  {item.sub.map((child) => (
                    <li key={child.href}>
                      <Link
                        href={child.href}
                        title={child.hint}
                        onClick={(e) => {
                          e.preventDefault();
                          void confirmLeave().then((ok: boolean) => {
                            if (ok) router.push(child.href);
                          });
                        }}
                        aria-current={pathname === child.href ? "page" : undefined}
                        className={cx(
                          "ml-[24px] block truncate rounded-md px-2 py-1 text-[11.5px] transition-colors",
                          pathname === child.href
                            ? "bg-rail-hover font-medium text-white"
                            : "text-rail-ink-2 hover:bg-rail-hover hover:text-white",
                        )}
                      >
                        {child.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div
        className={cx(
          "mt-auto border-t border-rail-line pt-2.5",
          collapsed ? "px-2.5" : "px-4",
        )}
      >
        <div
          className={cx("truncate text-[12px] font-medium text-white", label)}
          title={fullName}
        >
          {fullName}
        </div>
        <div
          className={cx("text-[11.5px] text-rail-ink-2", label)}
          data-testid="viewer-role"
        >
          {roleLabel}
        </div>
        {/* §43.2. Two words, one of them on. A switch that only says "Dark"
            makes you press it to find out what it does; this says what you
            are looking at and what the other one is. */}
        <div
          className={cx(
            "mt-1.5 inline-flex overflow-hidden rounded-md border border-rail-line",
            label,
          )}
        >
          {(["dark", "light"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={theme === t}
              disabled={themePending}
              onClick={() => {
                if (theme === t) return;
                startTheme(async () => {
                  await setTheme(t);
                  // The palette lives on <html>, which the root layout owns;
                  // refresh re-renders it with the value just written.
                  router.refresh();
                });
              }}
              className={cx(
                "px-2 py-[3px] text-[11.5px] capitalize transition-colors",
                theme === t
                  ? "bg-rail-hover font-medium text-white"
                  : "text-rail-ink-2 hover:text-white",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <form action={signOut} className={collapsed ? "" : "mt-2"}>
          <Button
            type="submit"
            size="sm"
            title="Sign out"
            className="w-full justify-start border-0 bg-transparent px-2 text-rail-ink-2 hover:bg-rail-hover hover:text-white"
          >
            {collapsed ? (
              <>
                <span aria-hidden className="group-hover:hidden">
                  ⏻
                </span>
                <span className="hidden group-hover:inline">Sign out</span>
              </>
            ) : (
              "Sign out"
            )}
          </Button>
        </form>
      </div>
      </nav>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const RAIL_KEY = "calman.rail";
/** Below this the rail is icons unless somebody has said otherwise (§40.2). */
const RAIL_BREAKPOINT = 1366;

/**
 * Whether the rail is icons-only.
 *
 * Two rules, in order: what this person last chose, and failing that the width
 * of the window. A 1280 laptop loses 208px of a 1280px screen to eight links
 * somebody learned in a day, which is most of a column of the desk; a 1920
 * monitor can afford them. The choice is remembered because a rail that
 * reopens itself every morning is a rail you close every morning.
 *
 * Starts expanded on the server and on the first client render, because
 * neither knows the width — the effect settles it before paint matters.
 */
function useRailCollapsed() {
  const narrow = useSyncExternalStore(
    subscribeWidth,
    () => window.innerWidth < RAIL_BREAKPOINT,
    () => false,
  );
  const choice = useSyncExternalStore(subscribeChoice, readChoice, () => null);
  return choice === null ? narrow : choice === "icons";
}

function subscribeWidth(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function subscribeChoice(onChange: () => void) {
  window.addEventListener("calman:rail", onChange);
  // Another tab's choice is this tab's choice: one person, one rail.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("calman:rail", onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Returns the same string each time it is unchanged, which is what the store wants. */
function readChoice(): "icons" | "open" | null {
  try {
    const v = window.localStorage.getItem(RAIL_KEY);
    return v === "icons" || v === "open" ? v : null;
  } catch {
    return null;
  }
}

/** The one control that overrides the width rule, and remembers it. */
function RailToggle({ collapsed }: { collapsed: boolean }) {
  return (
    <button
      type="button"
      title={collapsed ? "Expand the sidebar" : "Collapse to icons"}
      aria-label={collapsed ? "Expand the sidebar" : "Collapse to icons"}
      onClick={() => {
        const next = !collapsed;
        try {
          window.localStorage.setItem(RAIL_KEY, next ? "icons" : "open");
        } catch {
          /* a rail that will not persist still has to open. */
        }
        window.dispatchEvent(new CustomEvent("calman:rail", { detail: next }));
      }}
      className={cx(
        "shrink-0 rounded p-0.5 text-[13px] leading-none text-rail-ink-2 hover:bg-rail-hover hover:text-white",
        collapsed ? "hidden group-hover:block" : "",
      )}
    >
      {collapsed ? "»" : "«"}
    </button>
  );
}
