"use client";

import Link from "next/link";

import { cx } from "@/components/ui";

export function ListTabs({
  current,
  lists,
}: {
  current: string;
  lists: { key: string; label: string }[];
}) {
  return (
    <nav aria-label="Master lists" className="flex flex-wrap gap-1">
      {lists.map((list) => {
        const active = list.key === current;
        return (
          <Link
            key={list.key}
            href={`/settings/master-lists?list=${list.key}`}
            aria-current={active ? "page" : undefined}
            className={cx(
              "rounded-md border px-2.5 py-1 text-[12.5px] transition-colors",
              active
                ? "border-accent bg-accent-soft font-medium text-accent"
                : "border-line-2 bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink",
            )}
          >
            {list.label}
          </Link>
        );
      })}
    </nav>
  );
}
