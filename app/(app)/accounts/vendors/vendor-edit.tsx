"use client";

import { useActionState, useState } from "react";

import { Button, Input, Select, FIELD_LABEL, cx } from "@/components/ui";
import { updateVendor, addAlias, removeAlias } from "./actions";
import { EMPTY_VENDOR_STATE } from "./form-state";

export type EditableVendor = {
  id: string;
  name: string;
  institute: string | null;
  kind: string;
  default_payment_mode: string;
  tracks_portal_balance: boolean;
  portal_owner_vendor_id: string | null;
  center_discount_amount: number | null;
  center_discount_threshold: number | null;
  is_active: boolean;
  note: string | null;
  aliases: { id: string; alias: string }[];
};

const KINDS = [
  { id: "teacher", label: "Teacher" },
  { id: "institute", label: "Institute" },
  { id: "books", label: "Books" },
  { id: "zeroinfy_internal", label: "Zeroinfy internal" },
];
const MODES = [
  { id: "portal_balance", label: "Portal balance" },
  { id: "online_instant", label: "Online / instant" },
  { id: "later", label: "Later" },
];

/**
 * §6.3. Edit one vendor.
 *
 * Collapsed until asked for: the table is a reference list read far more often
 * than it is changed, and 104 permanently-open forms would bury it.
 */
export function VendorEdit({
  vendor, owners,
}: { vendor: EditableVendor; owners: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}
              data-testid={`vendor-edit-${vendor.id}`}>
        Edit
      </Button>
    );
  }
  return (
    <div className="flex min-w-[560px] flex-col gap-2 rounded-md border border-accent bg-sunk p-2.5"
         data-testid={`vendor-panel-${vendor.id}`}>
      <Fields vendor={vendor} owners={owners} onClose={() => setOpen(false)} />
      <Aliases vendor={vendor} />
    </div>
  );
}

function Fields({
  vendor, owners, onClose,
}: { vendor: EditableVendor; owners: { id: string; name: string }[]; onClose: () => void }) {
  const [state, action, pending] = useActionState(updateVendor, EMPTY_VENDOR_STATE);
  return (
    <form action={action} className="flex flex-col gap-2" data-testid={`vendor-form-${vendor.id}`}>
      <input type="hidden" name="id" value={vendor.id} />
      {/* The name is not editable: it is what next month's sheets are matched
          against, so renaming would silently stop the import finding it. */}
      <div className="text-[12.5px] font-semibold text-ink">{vendor.name}</div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className={FIELD_LABEL}>Kind</span>
          <Select name="kind" defaultValue={vendor.kind} className="w-[150px]"
                  data-testid="vendor-kind-field">
            {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={FIELD_LABEL}>Institute</span>
          <Input name="institute" defaultValue={vendor.institute ?? ""} className="w-[170px]"
                 data-testid="vendor-institute" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={FIELD_LABEL}>Payment mode</span>
          <Select name="default_payment_mode" defaultValue={vendor.default_payment_mode}
                  className="w-[160px]" data-testid="vendor-mode">
            {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={FIELD_LABEL}>Settled through</span>
          <Select name="portal_owner_vendor_id" defaultValue={vendor.portal_owner_vendor_id ?? ""}
                  className="w-[190px]" data-testid="vendor-owner">
            <option value="">— none —</option>
            {owners.filter((o) => o.id !== vendor.id)
                   .map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-0.5">
          <span className={FIELD_LABEL}>Centre discount</span>
          <Input name="center_discount_amount" inputMode="decimal" className="w-[110px]"
                 defaultValue={vendor.center_discount_amount ?? ""} placeholder="500"
                 data-testid="vendor-center-amount" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={FIELD_LABEL}>Above</span>
          <Input name="center_discount_threshold" inputMode="decimal" className="w-[110px]"
                 defaultValue={vendor.center_discount_threshold ?? ""} placeholder="3999"
                 data-testid="vendor-center-threshold" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className={FIELD_LABEL}>Note</span>
          <Input name="note" defaultValue={vendor.note ?? ""} className="w-[220px]" />
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <input type="checkbox" name="tracks_portal_balance" value="1"
                 defaultChecked={vendor.tracks_portal_balance} data-testid="vendor-wallet" />
          Tracks a wallet
        </label>
        <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
          <input type="checkbox" name="is_active" value="1"
                 defaultChecked={vendor.is_active} data-testid="vendor-active" />
          Active
        </label>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending} data-testid={`vendor-save-${vendor.id}`}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
        {state.error ? (
          <span className="text-[11.5px] text-danger" data-testid="vendor-error">{state.error}</span>
        ) : null}
        {state.message ? (
          <span className="text-[11.5px] text-ink-2" data-testid="vendor-saved">{state.message}</span>
        ) : null}
      </div>
      <p className="text-[11px] text-ink-3">
        Changing the payment mode affects future imports only — lines already
        imported keep the mode they were settled under.
      </p>
    </form>
  );
}

function Aliases({ vendor }: { vendor: EditableVendor }) {
  const [addState, addAction, adding] = useActionState(addAlias, EMPTY_VENDOR_STATE);
  const [rmState, rmAction, removing] = useActionState(removeAlias, EMPTY_VENDOR_STATE);
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-2">
      <span className={FIELD_LABEL}>Other spellings</span>
      <div className="flex flex-wrap items-center gap-1.5" data-testid={`vendor-aliases-${vendor.id}`}>
        {vendor.aliases.map((a) => (
          <form key={a.id} action={rmAction}
                className="flex items-center gap-1 rounded-md border border-line-2 bg-surface px-1.5 py-0.5">
            <input type="hidden" name="alias_id" value={a.id} />
            <span className="text-[12px] text-ink-2">{a.alias}</span>
            <button type="submit" disabled={removing}
                    className={cx("text-[12px] text-ink-3 hover:text-danger")}
                    aria-label={`Remove ${a.alias}`}
                    data-testid={`alias-remove-${a.alias}`}>
              ×
            </button>
          </form>
        ))}
        {vendor.aliases.length === 0 ? (
          <span className="text-[11.5px] text-ink-3">none</span>
        ) : null}
      </div>
      <form action={addAction} className="flex items-center gap-1.5">
        <input type="hidden" name="id" value={vendor.id} />
        <Input name="alias" placeholder="Another spelling" className="w-[220px]"
               aria-label="New alias" data-testid={`alias-input-${vendor.id}`} />
        <Button type="submit" variant="ghost" size="sm" disabled={adding}
                data-testid={`alias-add-${vendor.id}`}>
          {adding ? "…" : "Add"}
        </Button>
        {addState.error ? (
          <span className="text-[11.5px] text-danger" data-testid="alias-error">{addState.error}</span>
        ) : null}
        {rmState.error ? (
          <span className="text-[11.5px] text-danger">{rmState.error}</span>
        ) : null}
      </form>
    </div>
  );
}
