"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { Input, FIELD_LABEL } from "@/components/ui";

/**
 * §6.2. The effective-from date, in the URL.
 *
 * It used to be state inside the Apply panel, which meant the inline cell
 * editor — a different component, rendered by the server — could not see it
 * and silently saved from today instead. Two controls that look like one date
 * and are not is the kind of thing nobody notices until a rate lands in the
 * wrong month.
 *
 * So the date lives in the query string: the server reads it once and hands
 * the same value to both, and the choice survives a reload and can be shared.
 */
export function EffectiveDate({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  return (
    <label className="flex flex-col gap-1">
      <span className={FIELD_LABEL}>Effective from</span>
      <Input
        type="date"
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value) next.set("from", e.target.value);
          else next.delete("from");
          start(() => router.replace(`${pathname}?${next}`, { scroll: false }));
        }}
        className="w-[150px]"
        data-testid="apply-from"
      />
    </label>
  );
}
