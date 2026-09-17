"use client";

import { useActionState, useId, useState } from "react";

import { Button, Input, Select, Textarea, FIELD_LABEL, cx } from "@/components/ui";
import { addRate, setLineOverride, updateRatePct } from "./actions";
import {
  EMPTY_OVERRIDE_STATE, EMPTY_RATE_STATE, type RateFormState,
} from "./form-state";

/* ------------------------------------------------------------ add a rate -- */

type AddRateProps = {
  vendorId: string;
  /** Which grid this form writes to: the single-product one or the combo one. */
  saleKind: "single" | "combo";
  levels: readonly string[];
  types: readonly string[];
  states: readonly string[];
  today: string;
  /** Fixed when adding to an existing cell; chosen when adding a new one. */
  level?: string;
  productType?: string;
  label: string;
};

/**
 * §50B.2. One form for both "Add rate" and "Add cell".
 *
 * They differ only in whether level and type are already known, so they are
 * the same component with those two fields swapped for hidden inputs. Two
 * components would have drifted the moment the retrospective guard changed.
 */
export function AddRate({
  vendorId, saleKind, levels, types, states, today, level, productType, label,
}: AddRateProps) {
  // `nonce` remounts the form, which is how a fresh useActionState is got:
  // React 19 has no reset for it, and syncing "did it save" into an effect
  // just to close the form causes the cascading render the lint rule is
  // about. Remounting says the same thing with less machinery.
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState(0);
  const id = useId();
  const fixedCell = Boolean(level && productType);

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen(true)}
        data-testid={fixedCell ? `add-rate-${level}-${productType}` : "add-cell"}
      >
        {label}
      </Button>
    );
  }

  return (
    <RateFormBody
      key={nonce}
      vendorId={vendorId} saleKind={saleKind} levels={levels} types={types} states={states}
      today={today} level={level} productType={productType}
      fixedCell={fixedCell} fieldId={id}
      onClose={() => setOpen(false)}
      onAnother={() => setNonce((n) => n + 1)}
    />
  );
}

function RateFormBody({
  vendorId, saleKind, levels, types, states, today, level, productType,
  fixedCell, fieldId, onClose, onAnother,
}: Omit<AddRateProps, "label"> & {
  fixedCell: boolean;
  fieldId: string;
  onClose: () => void;
  onAnother: () => void;
}) {
  const [state, action, pending] = useActionState<RateFormState, FormData>(
    addRate, EMPTY_RATE_STATE);
  const id = fieldId;

  if (state.ok) {
    return (
      <div
        className="flex flex-wrap items-center gap-2 rounded-lg border border-accent bg-sunk p-3 text-[12.5px] text-ink"
        data-testid="rate-saved"
      >
        Rate saved.
        <Button type="button" variant="ghost" onClick={onAnother}>Add another</Button>
        <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
      </div>
    );
  }

  // The retrospective guard, rendered as its own form rather than as a panel
  // inside the main one. The fields the user typed have already been reset by
  // React, so this posts the values the server validated and counted, as
  // hidden inputs. Confirming can therefore only ever save the rate the
  // warning is describing.
  if (state.confirm) {
    const v = state.confirm.values;
    return (
      <form
        action={action}
        className="flex flex-col gap-2 rounded-lg border border-warn bg-warn-soft p-3"
        data-testid="retro-guard"
      >
        <input type="hidden" name="vendor_id" value={vendorId} />
        <input type="hidden" name="sale_kind" value={saleKind} />
        <input type="hidden" name="level" value={v.level} />
        <input type="hidden" name="product_type" value={v.product_type} />
        <input type="hidden" name="pct" value={v.pct} />
        <input type="hidden" name="effective_from" value={v.effective_from} />
        {v.effective_to ? (
          <input type="hidden" name="effective_to" value={v.effective_to} />
        ) : null}
        {v.note ? <input type="hidden" name="note" value={v.note} /> : null}
        {v.state_scope.map((sc) => (
          <input key={sc} type="hidden" name="state_scope" value={sc} />
        ))}
        <input type="hidden" name="confirmed" value="1" />

        <p className="text-[12.5px] text-ink">
          This will change {state.confirm.paid} sales line
          {state.confirm.paid === 1 ? "" : "s"} already in status paid and{" "}
          {state.confirm.ready} in status ready.
        </p>
        <p className="text-[11.5px] text-ink-2">
          {v.level} · {v.product_type} · {v.pct}% from {v.effective_from}
          {v.effective_to ? ` to ${v.effective_to}` : " onwards"}
          {v.state_scope.length ? ` · ${v.state_scope.join(", ")}` : ""}.
          Saving records the rate only. Nothing is recalculated in this
          release, and no difference statement is issued.
        </p>

        {state.error ? (
          <p className="text-[12.5px] text-danger" data-testid="rate-error">{state.error}</p>
        ) : null}

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={pending} data-testid="retro-confirm">
            {pending ? "Saving…" : "Save anyway"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    );
  }

  return (
    <form
      action={action}
      className="flex flex-col gap-2.5 rounded-lg border border-accent bg-sunk p-3"
      data-testid={fixedCell ? "add-rate-form" : "add-cell-form"}
    >
      <input type="hidden" name="vendor_id" value={vendorId} />
      <input type="hidden" name="sale_kind" value={saleKind} />

      <div className="flex flex-wrap items-end gap-2.5">
        {fixedCell ? (
          <>
            <input type="hidden" name="level" value={level} />
            <input type="hidden" name="product_type" value={productType} />
            <span className="text-[12.5px] text-ink-2">
              {level} · {productType}
            </span>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Level</span>
              <Select name="level" defaultValue="" required className="w-[150px]"
                      data-testid="new-cell-level">
                <option value="" disabled>Choose…</option>
                {levels.map((l) => <option key={l} value={l}>{l}</option>)}
              </Select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={FIELD_LABEL}>Type</span>
              <Select name="product_type" defaultValue="" required className="w-[120px]"
                      data-testid="new-cell-type">
                <option value="" disabled>Choose…</option>
                {types.map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </label>
          </>
        )}

        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Percent</span>
          <Input name="pct" inputMode="decimal" required placeholder="21.00"
                 className="w-[90px]" data-testid="rate-pct" />
        </label>

        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Effective from</span>
          <Input type="date" name="effective_from" defaultValue={today} required
                 className="w-[150px]" data-testid="rate-from" />
        </label>

        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Effective to</span>
          <Input type="date" name="effective_to" className="w-[150px]"
                 data-testid="rate-to" />
        </label>
      </div>

      <details className="rounded-md border border-line bg-surface px-2.5 py-1.5">
        <summary className="cursor-pointer text-[12px] text-ink-2">
          State scope — leave closed for every state
        </summary>
        <div className="mt-2 grid max-h-44 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto sm:grid-cols-3">
          {states.map((s) => (
            <label key={s} className="flex items-center gap-1.5 text-[12px] text-ink-2">
              <input type="checkbox" name="state_scope" value={s} />
              {s}
            </label>
          ))}
        </div>
      </details>

      <label className="flex flex-col gap-1">
        <span className={FIELD_LABEL} id={`${id}-note`}>Note</span>
        <Textarea name="note" rows={2} aria-labelledby={`${id}-note`}
                  placeholder="Why this rate, and who agreed it." />
      </label>

      {state.error ? (
        <p className="text-[12.5px] text-danger" data-testid="rate-error">{state.error}</p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending} data-testid="rate-save">
          {pending ? "Saving…" : "Save rate"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

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
