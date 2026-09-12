"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { cx } from "@/components/ui";

import { newCallsWaiting } from "./actions/new-calls-waiting";

/**
 * "New Calls · N waiting", on every page (§29.1).
 *
 * The sidebar badge says the same number and is not enough: it is a number in
 * a navigation rail, which is exactly where the eye stops going after an hour.
 * This sits over the work and does the one thing a badge cannot — it moves
 * when the number goes up, so leads arriving mid-shift are noticed by somebody
 * who is looking at a call panel rather than at the menu.
 *
 * Sixty seconds, polled rather than streamed. Leads arrive by import and by
 * Quick Add, both of which are somebody else's browser; a realtime
 * subscription would be the right shape for that and is a socket per user
 * plus a publication for a number that changes a handful of times a day.
 */
export function NewCallsAlert({ initial }: { initial: number }) {
  const router = useRouter();
  const [count, setCount] = useState(initial);
  const [added, setAdded] = useState(0);
  const previous = useRef(initial);

  useEffect(() => {
    let live = true;
    const tick = async () => {
      const next = await newCallsWaiting();
      if (!live || next === null) return;
      setCount(next);
      if (next > previous.current) {
        setAdded(next - previous.current);
        // The pulse is one animation, not a state the pill stays in: it is a
        // nudge for somebody mid-call, not something to dismiss.
        window.setTimeout(() => { if (live) setAdded(0); }, 6000);
      }
      previous.current = next;
    };
    const id = window.setInterval(tick, 60_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, []);

  if (count <= 0) return null;

  return (
    <button
      type="button"
      onClick={() => router.push("/new-calls")}
      className={cx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12.5px] transition-colors",
        added > 0
          ? "animate-pulse border-accent bg-accent text-accent-ink"
          : "border-line-2 bg-surface-2 text-ink-2 hover:border-ink-3 hover:text-ink",
      )}
    >
      <span className="font-medium">New Calls</span>
      <span className="tabular-nums">· {count} waiting</span>
      {added > 0 ? (
        <span className="rounded-full bg-accent-ink/20 px-1.5 text-[11px] font-semibold tabular-nums">
          +{added}
        </span>
      ) : null}
    </button>
  );
}
