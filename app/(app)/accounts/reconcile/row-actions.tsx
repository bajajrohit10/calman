"use client";

import { useActionState, useState } from "react";

import { Button, Input, Select, cx } from "@/components/ui";
import { NO_REMITTANCE_REASONS } from "@/lib/accounts/sales-enums";
import { setOverride, setNoRemittance, EMPTY_LINE_STATE } from "../sales/line-state-bridge";
import { setReviewed, savePortalPrice } from "./actions";
import { EMPTY_RECON_STATE } from "./recon-state";

/**
 * §50F.4. Learn the price this payment implies.
 *
 * The number is already on the row; this is a confirmation, not a form. It
 * rebases every draft line for the same vendor and product, so the button says
 * what it is about to do rather than just "Save".
 */
export function SavePortalPrice({
  lineId, price, method,
}: { lineId: string; price: number; method: string }) {
  const isCenter = /center|centre/i.test(method);
  const [state, action, pending] = useActionState(savePortalPrice, EMPTY_RECON_STATE);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="line_id" value={lineId} />
      <input type="hidden" name="price" value={price} />
      <input type="hidden" name="base_source" value={isCenter ? "center_price" : "portal_price"} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}
              data-testid={`save-price-${lineId}`}>
        {pending ? "…" : `Save ₹${price.toLocaleString("en-IN")} as ${isCenter ? "centre" : "portal"} price`}
      </Button>
      {state.error ? <span className="text-[11px] text-danger">{state.error}</span> : null}
      {state.message ? (
        <span className="text-[11px] text-ink-2" data-testid="price-saved">{state.message}</span>
      ) : null}
    </form>
  );
}

/** Everything a person can change from a reconcile row. */
export function RowFix({
  lineId, paymentIds, reviewed, reviewNote, hasOverride,
}: {
  lineId: string | null;
  paymentIds: string[];
  reviewed: boolean;
  reviewNote: string | null;
  hasOverride: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}
              data-testid={`recon-fix-${lineId ?? paymentIds[0]}`}>
        {reviewed ? "Reviewed ✓" : "Fix"}
      </Button>
    );
  }
  return (
    <div className="flex min-w-[300px] flex-col gap-1.5 rounded-md border border-accent bg-sunk p-2"
         data-testid={`recon-panel-${lineId ?? paymentIds[0]}`}>
      {paymentIds.length ? (
        <ReviewForm paymentIds={paymentIds} reviewed={reviewed} note={reviewNote} />
      ) : (
        <span className="text-[11px] text-ink-3">No payment on this row to review.</span>
      )}
      {lineId ? <OverrideForm lineId={lineId} hasOverride={hasOverride} /> : null}
      {lineId ? <ReasonForm lineId={lineId} /> : null}
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Close</Button>
    </div>
  );
}

function ReviewForm({
  paymentIds, reviewed, note,
}: { paymentIds: string[]; reviewed: boolean; note: string | null }) {
  const [state, action, pending] = useActionState(setReviewed, EMPTY_RECON_STATE);
  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="payment_ids" value={paymentIds.join(",")} />
      <input type="hidden" name="reviewed" value={reviewed ? "0" : "1"} />
      <Input name="note" placeholder="Note" defaultValue={note ?? ""} className="w-[150px]"
             aria-label="Review note" data-testid="review-note" />
      <Button type="submit" variant="ghost" size="sm" disabled={pending} data-testid="review-save">
        {pending ? "…" : reviewed ? "Un-review" : "Mark reviewed"}
      </Button>
      {state.error ? <span className="text-[11px] text-danger">{state.error}</span> : null}
    </form>
  );
}

function OverrideForm({ lineId, hasOverride }: { lineId: string; hasOverride: boolean }) {
  const [state, action, pending] = useActionState(setOverride, EMPTY_LINE_STATE);
  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="id" value={lineId} />
      <Input name="override_pct" inputMode="decimal" placeholder="%" className="w-[64px]"
             aria-label="Override percent" data-testid={`recon-override-${lineId}`} />
      <Input name="override_note" placeholder="Why" className="w-[120px]" aria-label="Override note" />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}
              data-testid={`recon-override-save-${lineId}`}>
        {pending ? "…" : hasOverride ? "Re-override" : "Override %"}
      </Button>
      {state.error ? <span className={cx("text-[11px]", "text-danger")}>{state.error}</span> : null}
    </form>
  );
}

function ReasonForm({ lineId }: { lineId: string }) {
  const [state, action, pending] = useActionState(setNoRemittance, EMPTY_LINE_STATE);
  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="id" value={lineId} />
      <Select name="no_remittance_reason" defaultValue="" className="w-[124px]"
              aria-label="No remittance reason" data-testid={`recon-reason-${lineId}`}>
        <option value="">— pays normally —</option>
        {NO_REMITTANCE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
      </Select>
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "…" : "Set"}
      </Button>
      {state.error ? <span className="text-[11px] text-danger">{state.error}</span> : null}
    </form>
  );
}
