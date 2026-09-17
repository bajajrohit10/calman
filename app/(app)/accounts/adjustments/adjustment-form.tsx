"use client";

import { useActionState } from "react";

import { Button, Input, Select, Textarea, FIELD_LABEL } from "@/components/ui";
import { ADJUSTMENT_REASONS, ADJUSTMENT_REASON_LABELS } from "@/lib/accounts/adjustment-enums";
import { addAdjustment, deleteAdjustment } from "./actions";
import { EMPTY_ADJ_STATE } from "./form-state";

export function AddAdjustment({
  vendors, month,
}: { vendors: { id: string; label: string }[]; month: string }) {
  const [state, action, pending] = useActionState(addAdjustment, EMPTY_ADJ_STATE);
  return (
    <form action={action}
          className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-3 shadow-card"
          data-testid="adj-form">
      <input type="hidden" name="month" value={month} />
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Vendor</span>
          <Select name="vendor_id" defaultValue="" required className="w-[230px]" data-testid="adj-vendor">
            <option value="" disabled>Choose…</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Amount</span>
          {/* Signed: a deduction is typed with a minus, so the statement total
              is a plain sum and nobody has to learn which reasons subtract. */}
          <Input name="amount" inputMode="decimal" required placeholder="-500"
                 className="w-[110px]" data-testid="adj-amount" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Reason</span>
          <Select name="reason" defaultValue="" required className="w-[190px]" data-testid="adj-reason">
            <option value="" disabled>Choose…</option>
            {ADJUSTMENT_REASONS.map((r) => (
              <option key={r} value={r}>{ADJUSTMENT_REASON_LABELS[r]}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Order id (optional)</span>
          <Input name="linked_order_id" className="w-[140px]" placeholder="ZI2534…"
                 data-testid="adj-order" />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL}>Note</span>
        <Textarea name="note" rows={2} placeholder="What this is for." data-testid="adj-note" />
      </label>
      {state.error ? (
        <p className="text-[12.5px] text-danger" data-testid="adj-error">{state.error}</p>
      ) : null}
      {state.message ? (
        <p className="text-[12.5px] text-ink-2" data-testid="adj-saved">{state.message}</p>
      ) : null}
      <div>
        <Button type="submit" disabled={pending} data-testid="adj-save">
          {pending ? "Saving…" : "Add adjustment"}
        </Button>
      </div>
    </form>
  );
}

export function DeleteAdjustment({ id }: { id: string }) {
  const [state, action, pending] = useActionState(deleteAdjustment, EMPTY_ADJ_STATE);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}
              data-testid={`adj-delete-${id}`}>
        {pending ? "…" : "Remove"}
      </Button>
      {state.error ? <span className="text-[11px] text-danger">{state.error}</span> : null}
    </form>
  );
}
