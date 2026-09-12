"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { syncBlink } from "@/components/blink";
import { cx } from "@/components/ui";

import { newCallsWaiting } from "./actions/new-calls-waiting";
import { usePublishNewCallsCount } from "./new-calls-count";

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
 *
 * Filled accent and blinking for as long as anything is waiting, not just for
 * a moment when the number moves. A lead sitting unclaimed is a person who
 * rang and is waiting to be rung back, and a nudge that fires once is a nudge
 * missed by whoever was on a call at the time. It goes away by being dealt
 * with: at zero the pill does not exist.
 */
export function NewCallsAlert({ initial }: { initial: number }) {
  const router = useRouter();
  const [count, setCount] = useState(initial);
  const [added, setAdded] = useState(0);
  const previous = useRef(initial);
  const publish = usePublishNewCallsCount();

  useEffect(() => {
    let live = true;
    const tick = async () => {
      const next = await newCallsWaiting();
      if (!live || next === null) return;
      setCount(next);
      const grew = next > previous.current ? next - previous.current : 0;
      if (grew) {
        setAdded(grew);
        // "+2" and the faster beat are the flash, and only the flash ends:
        // the pill drops back to its standing blink rather than to nothing.
        window.setTimeout(() => {
          if (!live) return;
          setAdded(0);
          // Only the flash ends here, whatever the count has since become.
          publish((s) => ({ ...s, added: 0 }));
        }, 6000);
      }
      // The rail's badge reads this, so the two never disagree about a number
      // they are blinking about together.
      publish({ count: next, added: grew });
      previous.current = next;
    };
    const id = window.setInterval(tick, 60_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [publish]);

  if (count <= 0) return null;

  return (
    <button
      type="button"
      ref={syncBlink}
      onClick={() => router.push("/new-calls")}
      aria-live="polite"
      title={`${count} lead${count === 1 ? "" : "s"} waiting in New Calls — click to take one`}
      className={cx(
        "inline-flex items-center gap-2 rounded-full border border-accent bg-accent px-3.5 py-1.5",
        "text-[13px] font-semibold text-accent-ink shadow-card ring-4 ring-accent/20",
        "hover:bg-accent-hover",
        added > 0 ? "animate-blink-fast" : "animate-blink",
      )}
    >
      <span>New Calls</span>
      <span className="tabular-nums">· {count} waiting</span>
      {added > 0 ? (
        <span className="rounded-full bg-accent-ink/25 px-1.5 text-[11.5px] font-semibold tabular-nums">
          +{added}
        </span>
      ) : null}
    </button>
  );
}
