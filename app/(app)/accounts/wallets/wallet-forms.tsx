"use client";

import { useActionState, useState } from "react";

import { Button, Input, FIELD_LABEL } from "@/components/ui";
import { addOpening, addTopUp, addWalletAdjustment } from "./actions";
import { EMPTY_WALLET_STATE } from "./form-state";

const ACTIONS = {
  opening: { fn: addOpening, label: "Set opening balance" },
  top_up: { fn: addTopUp, label: "Record top-up" },
  adjustment: { fn: addWalletAdjustment, label: "Adjust" },
} as const;

export function WalletEntry({
  vendorId, kind, today, hasOpening,
}: {
  vendorId: string;
  kind: keyof typeof ACTIONS;
  today: string;
  hasOpening: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(ACTIONS[kind].fn, EMPTY_WALLET_STATE);

  // §50G.1(b). The opening balance is typed once and then the button goes,
  // because a second one would double the wallet without a trace.
  if (kind === "opening" && hasOpening) return null;

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}
              data-testid={`wallet-${kind}-${vendorId}`}>
        {ACTIONS[kind].label}
      </Button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-end gap-1.5 rounded-md border border-accent bg-sunk p-2"
          data-testid={`wallet-${kind}-form-${vendorId}`}>
      <input type="hidden" name="vendor_id" value={vendorId} />
      <label className="flex flex-col gap-0.5">
        <span className={FIELD_LABEL}>Amount</span>
        <Input name="amount" inputMode="decimal" required className="w-[100px]"
               data-testid={`wallet-amount-${kind}`} />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className={FIELD_LABEL}>Date</span>
        <Input type="date" name="entry_date" defaultValue={today} required className="w-[140px]"
               data-testid={`wallet-date-${kind}`} />
      </label>
      {kind === "top_up" ? (
        <label className="flex flex-col gap-0.5">
          <span className={FIELD_LABEL}>Reference</span>
          <Input name="reference" className="w-[130px]" data-testid="wallet-ref" />
        </label>
      ) : null}
      <label className="flex flex-col gap-0.5">
        <span className={FIELD_LABEL}>Note</span>
        <Input name="note" className="w-[160px]" />
      </label>
      <Button type="submit" disabled={pending} data-testid={`wallet-save-${kind}`}>
        {pending ? "…" : "Save"}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      {state.error ? (
        <span className="text-[11.5px] text-danger" data-testid="wallet-error">{state.error}</span>
      ) : null}
      {state.message ? (
        <span className="text-[11.5px] text-ink-2" data-testid="wallet-saved">{state.message}</span>
      ) : null}
    </form>
  );
}
