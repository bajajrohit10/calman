"use client";

import { useActionState } from "react";

import { Button, Input, cx } from "@/components/ui";
import { setLineOverride, updateRatePct } from "./actions";
import { EMPTY_OVERRIDE_STATE } from "./form-state";

/* -------------------------------------------------------- line override -- */

export function SetLinePct({ lineId }: { lineId: string }) {
  const [state, action, pending] = useActionState(setLineOverride, EMPTY_OVERRIDE_STATE);
  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="id" value={lineId} />
      <Input name="override_pct" inputMode="decimal" placeholder="%"
             className="w-[62px]" required aria-label="Override percent" />
      <Input name="override_note" placeholder="Why" className="w-[150px]"
             aria-label="Override note" />
      <Button type="submit" variant="ghost" disabled={pending}>
        {pending ? "…" : "Set %"}
      </Button>
      {state.error ? (
        <span className={cx("text-[11.5px]", "text-danger")}>{state.error}</span>
      ) : null}
    </form>
  );
}

/* ------------------------------------------------- confirm a seeded rate -- */

/**
 * §50C(c). Inline percentage editor for a row the seeder flagged.
 *
 * Deliberately the smallest possible affordance — one field and one button on
 * the row itself. The August figure is already on screen in the note, so this
 * is a decision being recorded, not a form being filled in.
 */
export function ConfirmRatePct({ rateId }: { rateId: string }) {
  const [state, action, pending] = useActionState(updateRatePct, EMPTY_OVERRIDE_STATE);
  return (
    <form action={action} className="flex items-center gap-1.5" data-testid="confirm-rate-form">
      <input type="hidden" name="id" value={rateId} />
      <Input
        name="pct" inputMode="decimal" required placeholder="%"
        className="w-[70px]" aria-label="Confirmed percent"
        data-testid="confirm-rate-pct"
      />
      <Button type="submit" variant="ghost" disabled={pending} data-testid="confirm-rate-save">
        {pending ? "…" : "Confirm %"}
      </Button>
      {state.error ? (
        <span className="text-[11.5px] text-danger" data-testid="confirm-rate-error">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
