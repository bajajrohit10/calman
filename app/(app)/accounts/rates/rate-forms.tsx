"use client";

import { useActionState, useId, useState } from "react";

import { Button, Input, Select, Textarea, FIELD_LABEL, cx } from "@/components/ui";
import { normaliseKey } from "@/lib/accounts/normalise-key";
import { addCombo, addRate, setLineOverride } from "./actions";
import {
  EMPTY_COMBO_STATE, EMPTY_OVERRIDE_STATE, EMPTY_RATE_STATE,
  type ComboFormState, type RateFormState,
} from "./form-state";

/* ------------------------------------------------------------ add a rate -- */

type AddRateProps = {
  vendorId: string;
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
  vendorId, levels, types, states, today, level, productType, label,
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
      vendorId={vendorId} levels={levels} types={types} states={states}
      today={today} level={level} productType={productType}
      fixedCell={fixedCell} fieldId={id}
      onClose={() => setOpen(false)}
      onAnother={() => setNonce((n) => n + 1)}
    />
  );
}

function RateFormBody({
  vendorId, levels, types, states, today, level, productType,
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

  return (
    <form
      action={action}
      className="flex flex-col gap-2.5 rounded-lg border border-accent bg-sunk p-3"
      data-testid={fixedCell ? "add-rate-form" : "add-cell-form"}
    >
      <input type="hidden" name="vendor_id" value={vendorId} />

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

      {/* The retrospective guard. The server refuses the first submit of a
          back-dated rate and sends back what it would land on; confirming
          re-submits the same form with the flag set. */}
      {state.confirm ? (
        <div
          className="rounded-md border border-warn bg-warn-soft px-2.5 py-2 text-[12.5px] text-ink"
          data-testid="retro-guard"
        >
          This will change {state.confirm.paid} sales line
          {state.confirm.paid === 1 ? "" : "s"} already in status paid and{" "}
          {state.confirm.ready} in status ready.
          <span className="mt-1 block text-[11.5px] text-ink-2">
            Saving records the rate only. Nothing is recalculated in this
            release, and no difference statement is issued.
          </span>
          <input type="hidden" name="confirmed" value="1" />
          <Button type="submit" className="mt-2" disabled={pending}
                  data-testid="retro-confirm">
            {pending ? "Saving…" : "Save anyway"}
          </Button>
        </div>
      ) : null}

      {state.error ? (
        <p className="text-[12.5px] text-danger" data-testid="rate-error">{state.error}</p>
      ) : null}

      <div className="flex items-center gap-2">
        {state.confirm ? null : (
          <Button type="submit" disabled={pending} data-testid="rate-save">
            {pending ? "Saving…" : "Save rate"}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/* ----------------------------------------------------------- add a combo -- */

export function AddCombo({
  vendors, today,
}: {
  vendors: { id: string; name: string }[];
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState(0);

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} data-testid="add-combo">
        Add combo rate
      </Button>
    );
  }

  return (
    <ComboFormBody
      key={nonce}
      vendors={vendors} today={today}
      onClose={() => setOpen(false)}
      onAnother={() => setNonce((n) => n + 1)}
    />
  );
}

function ComboFormBody({
  vendors, today, onClose, onAnother,
}: {
  vendors: { id: string; name: string }[];
  today: string;
  onClose: () => void;
  onAnother: () => void;
}) {
  const [title, setTitle] = useState("");
  const [key, setKey] = useState("");
  const [touched, setTouched] = useState(false);
  const [state, action, pending] = useActionState<ComboFormState, FormData>(
    addCombo, EMPTY_COMBO_STATE);

  // The key follows the title until somebody edits the key, after which it is
  // theirs. Deriving it on every keystroke would throw away their edit.
  const onTitle = (v: string) => {
    setTitle(v);
    if (!touched) setKey(normaliseKey(v) ?? "");
  };

  if (state.ok) {
    return (
      <div
        className="flex flex-wrap items-center gap-2 rounded-lg border border-accent bg-sunk p-3 text-[12.5px] text-ink"
        data-testid="combo-saved"
      >
        Combo rate saved.
        <Button type="button" variant="ghost" onClick={onAnother}>Add another</Button>
        <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
      </div>
    );
  }

  return (
    <form
      action={action}
      className="flex flex-col gap-2.5 rounded-lg border border-accent bg-sunk p-3"
      data-testid="add-combo-form"
    >
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Paid to</span>
          <Select name="vendor_id" defaultValue="" required className="w-[220px]"
                  data-testid="combo-vendor">
            <option value="" disabled>Choose…</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Combo title</span>
          <Input
            name="display_title" required className="w-[280px]"
            value={title} onChange={(e) => onTitle(e.target.value)}
            placeholder="CA Final DT and IDT Combo"
            data-testid="combo-title"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Combo key</span>
          <Input
            name="combo_key" required className="w-[280px] font-mono text-[12px]"
            value={key}
            onChange={(e) => { setTouched(true); setKey(e.target.value); }}
            data-testid="combo-key"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-2.5">
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Percent</span>
          <Input name="pct" inputMode="decimal" required placeholder="18.00"
                 className="w-[90px]" data-testid="combo-pct" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Effective from</span>
          <Input type="date" name="effective_from" defaultValue={today} required
                 className="w-[150px]" data-testid="combo-from" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Effective to</span>
          <Input type="date" name="effective_to" className="w-[150px]" />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={FIELD_LABEL}>Note</span>
          <Input name="note" placeholder="Optional" />
        </label>
      </div>

      <p className="text-[11.5px] text-ink-3">
        The key is what the importer matches on. It is derived from the title —
        cut at “by”, lowercased, punctuation to hyphens — and you can edit it.
      </p>

      {state.error ? (
        <p className="text-[12.5px] text-danger" data-testid="combo-error">{state.error}</p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending} data-testid="combo-save">
          {pending ? "Saving…" : "Save combo rate"}
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
