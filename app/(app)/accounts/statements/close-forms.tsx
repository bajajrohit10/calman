"use client";

import { useActionState, useState } from "react";

import { Button, Input, FIELD_LABEL } from "@/components/ui";
import { markReady, markPaid } from "./actions";
import { EMPTY_CLOSE_STATE } from "./close-state";

export function MarkReady({
  vendorId, month, isFinal,
}: { vendorId: string; month: string; isFinal: boolean }) {
  const [state, action, pending] = useActionState(markReady, EMPTY_CLOSE_STATE);
  const [open, setOpen] = useState(false);

  if (!isFinal) {
    return (
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="vendor_id" value={vendorId} />
        <input type="hidden" name="month" value={month} />
        <Button type="submit" disabled={pending} data-testid="mark-ready">
          {pending ? "Freezing…" : "Mark ready"}
        </Button>
        {state.error ? <span className="text-[11.5px] text-danger" data-testid="close-error">{state.error}</span> : null}
        {state.message ? <span className="text-[11.5px] text-ink-2" data-testid="close-message">{state.message}</span> : null}
      </form>
    );
  }

  // Already final: re-issuing is a correction and has to say what changed.
  if (!open) {
    return (
      <Button type="button" variant="ghost" onClick={() => setOpen(true)} data-testid="reissue">
        Re-issue statement
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-1.5 rounded-md border border-warn bg-warn-soft p-2">
      <input type="hidden" name="vendor_id" value={vendorId} />
      <input type="hidden" name="month" value={month} />
      <label className="flex flex-col gap-0.5">
        <span className={FIELD_LABEL}>What changed</span>
        <Input name="change_note" required className="w-[260px]"
               placeholder="Corrected the AFM rate" data-testid="reissue-note" />
      </label>
      <Button type="submit" disabled={pending} data-testid="reissue-save">
        {pending ? "…" : "Issue new version"}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      {state.error ? <span className="text-[11.5px] text-danger" data-testid="close-error">{state.error}</span> : null}
      {state.message ? <span className="text-[11.5px] text-ink-2" data-testid="close-message">{state.message}</span> : null}
    </form>
  );
}

export function MarkPaid({
  vendorId, month, today, disabled,
}: { vendorId: string; month: string; today: string; disabled: boolean }) {
  const [state, action, pending] = useActionState(markPaid, EMPTY_CLOSE_STATE);
  const [open, setOpen] = useState(false);

  if (disabled) {
    return <span className="text-[11.5px] text-ink-3">Mark ready before recording payment.</span>;
  }
  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} data-testid="mark-paid">
        Mark paid
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-1.5 rounded-md border border-accent bg-sunk p-2">
      <input type="hidden" name="vendor_id" value={vendorId} />
      <input type="hidden" name="month" value={month} />
      <label className="flex flex-col gap-0.5">
        <span className={FIELD_LABEL}>Paid on</span>
        <Input type="date" name="paid_on" defaultValue={today} required className="w-[140px]"
               data-testid="paid-on" />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className={FIELD_LABEL}>Reference</span>
        <Input name="reference" required className="w-[180px]" placeholder="NEFT ref"
               data-testid="paid-ref" />
      </label>
      <Button type="submit" disabled={pending} data-testid="paid-save">
        {pending ? "…" : "Record payment"}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      {state.error ? <span className="text-[11.5px] text-danger" data-testid="paid-error">{state.error}</span> : null}
      {state.message ? <span className="text-[11.5px] text-ink-2" data-testid="paid-message">{state.message}</span> : null}
    </form>
  );
}
