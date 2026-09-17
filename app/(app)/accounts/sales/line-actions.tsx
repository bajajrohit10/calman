"use client";

import { useActionState, useState } from "react";

import { Button, Input, Select, cx } from "@/components/ui";
import { NO_REMITTANCE_REASONS } from "@/lib/accounts/sales-enums";
import {
  changeVendor, setOverride, clearOverride, setNoRemittance,
  EMPTY_LINE_STATE, type LineActionState,
} from "./actions";

/**
 * §50E.3. The corrections a person makes while reading the month.
 *
 * Collapsed to a single "Fix" toggle per row: the table is fifteen columns
 * wide already, and four permanent controls on every one of 1,500 rows would
 * bury the numbers they are there to correct.
 */
export function LineFix({
  lineId, vendors, hasOverride, reason,
}: {
  lineId: string;
  vendors: { id: string; label: string }[];
  hasOverride: boolean;
  reason: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm"
              onClick={() => setOpen(true)} data-testid={`fix-${lineId}`}>
        Fix
      </Button>
    );
  }
  return (
    <div className="flex min-w-[320px] flex-col gap-1.5 rounded-md border border-accent bg-sunk p-2"
         data-testid={`fix-panel-${lineId}`}>
      <VendorForm lineId={lineId} vendors={vendors} />
      <OverrideForm lineId={lineId} hasOverride={hasOverride} />
      <ReasonForm lineId={lineId} reason={reason} />
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Close
      </Button>
    </div>
  );
}

function Err({ state }: { state: LineActionState }) {
  return state.error ? (
    <span className="text-[11px] text-danger">{state.error}</span>
  ) : null;
}

function VendorForm({ lineId, vendors }: { lineId: string; vendors: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(changeVendor, EMPTY_LINE_STATE);
  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="id" value={lineId} />
      {/* Aliases are offered as well as names: the sheet spells a vendor the
          way the sheet spells it, and making somebody translate is how the
          wrong vendor gets picked. */}
      <Select name="vendor_id" defaultValue="" className="w-[210px]"
              aria-label="Vendor" data-testid={`vendor-select-${lineId}`}>
        <option value="">— no vendor —</option>
        {vendors.map((v, i) => (
          <option key={`${v.id}-${i}`} value={v.id}>{v.label}</option>
        ))}
      </Select>
      <Button type="submit" variant="ghost" size="sm" disabled={pending}
              data-testid={`vendor-save-${lineId}`}>
        {pending ? "…" : "Set vendor"}
      </Button>
      <Err state={state} />
    </form>
  );
}

function OverrideForm({ lineId, hasOverride }: { lineId: string; hasOverride: boolean }) {
  const [state, action, pending] = useActionState(setOverride, EMPTY_LINE_STATE);
  const [clearState, clearAction, clearing] = useActionState(clearOverride, EMPTY_LINE_STATE);
  return (
    <div className="flex flex-col gap-1">
      <form action={action} className="flex items-center gap-1.5">
        <input type="hidden" name="id" value={lineId} />
        <Input name="override_pct" inputMode="decimal" placeholder="%" className="w-[66px]"
               aria-label="Override percent" data-testid={`override-pct-${lineId}`} />
        <Input name="override_note" placeholder="Why" className="w-[130px]"
               aria-label="Override note" data-testid={`override-note-${lineId}`} />
        <Button type="submit" variant="ghost" size="sm" disabled={pending}
                data-testid={`override-save-${lineId}`}>
          {pending ? "…" : "Override"}
        </Button>
        <Err state={state} />
      </form>
      {hasOverride ? (
        <form action={clearAction}>
          <input type="hidden" name="id" value={lineId} />
          <Button type="submit" variant="ghost" size="sm" disabled={clearing}
                  data-testid={`override-clear-${lineId}`}>
            {clearing ? "…" : "Clear override"}
          </Button>
          <Err state={clearState} />
        </form>
      ) : null}
    </div>
  );
}

function ReasonForm({ lineId, reason }: { lineId: string; reason: string | null }) {
  const [state, action, pending] = useActionState(setNoRemittance, EMPTY_LINE_STATE);
  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="id" value={lineId} />
      <Select name="no_remittance_reason" defaultValue={reason ?? ""} className="w-[130px]"
              aria-label="No remittance reason" data-testid={`reason-${lineId}`}>
        <option value="">— pays normally —</option>
        {NO_REMITTANCE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
      </Select>
      <Input name="note" placeholder="Note" className="w-[130px]" aria-label="Reason note" />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}
              data-testid={`reason-save-${lineId}`}>
        {pending ? "…" : "Set"}
      </Button>
      <Err state={state} />
    </form>
  );
}

/** Course titles are long; the table shows a head and the full text on hover. */
export function Truncated({ text, width }: { text: string | null; width: string }) {
  if (!text) return <span className="text-ink-3">—</span>;
  return (
    <span className={cx("block truncate", width)} title={text}>{text}</span>
  );
}
