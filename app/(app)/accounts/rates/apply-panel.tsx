"use client";

import { useActionState, useState } from "react";

import { Button, Input, Select, FIELD_LABEL, cx } from "@/components/ui";
import { applyRate, editCellPct } from "./apply-actions";
import { EMPTY_APPLY_STATE, type ApplyState } from "./apply-state";

type Cell = { level: string; product_type: string; hasRate: boolean; lines: number };

/**
 * §50H.3. One percentage, many cells.
 *
 * The old screen asked for a form per cell. A vendor's commission is one
 * number far more often than not, so this asks once and writes a row per
 * selected cell — and the retrospective guard runs once for the batch, because
 * "how many settled lines does this disturb" is a question about the act
 * rather than about each row of it.
 */
export function ApplyPanel({
  vendorId, saleKind, cells, levels, types, today,
}: {
  vendorId: string;
  saleKind: "single" | "combo";
  cells: Cell[];
  levels: readonly string[];
  types: readonly string[];
  today: string;
}) {
  const [state, action, pending] = useActionState<ApplyState, FormData>(applyRate, EMPTY_APPLY_STATE);
  const [selected, setSelected] = useState<string[]>([]);
  const [addingCell, setAddingCell] = useState(false);
  const [from, setFrom] = useState(today);

  const all = selected.length === 0;
  const toggle = (k: string) =>
    setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  // The confirm step re-posts what the server validated, because React resets
  // an uncontrolled form once an action has run.
  if (state.confirm) {
    const c = state.confirm;
    return (
      <form action={action}
            className="flex flex-col gap-2 rounded-lg border border-warn bg-warn-soft p-3"
            data-testid="apply-guard">
        <input type="hidden" name="vendor_id" value={vendorId} />
        <input type="hidden" name="sale_kind" value={c.sale_kind} />
        <input type="hidden" name="pct" value={c.pct} />
        <input type="hidden" name="effective_from" value={c.from} />
        {c.language ? <input type="hidden" name="language" value={c.language} /> : null}
        {c.cells.map((x) => (
          <input key={`${x.level}|${x.product_type}`} type="hidden" name="cell"
                 value={`${x.level}|${x.product_type}`} />
        ))}
        <input type="hidden" name="confirmed" value="1" />
        <p className="text-[12.5px] text-ink">
          This will change {c.paid} sales line{c.paid === 1 ? "" : "s"} already in status paid
          and {c.ready} in status ready, across {c.cells.length} cell
          {c.cells.length === 1 ? "" : "s"}.
        </p>
        <p className="text-[11.5px] text-ink-2">
          {c.pct}% from {c.from}{c.language ? " (English only)" : ""}. Saving records the
          rates only — nothing is recalculated and no difference statement is issued.
        </p>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending} data-testid="apply-confirm">
            {pending ? "Saving…" : "Apply anyway"}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form action={action}
          className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-3 shadow-card"
          data-testid="apply-panel">
      <input type="hidden" name="vendor_id" value={vendorId} />
      <input type="hidden" name="sale_kind" value={saleKind} />

      <div className="flex flex-wrap items-end gap-2.5">
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Commission %</span>
          <Input name="pct" inputMode="decimal" required placeholder="21"
                 className="w-[90px]" data-testid="apply-pct" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Language</span>
          <Select name="language" defaultValue="" className="w-[140px]" data-testid="apply-language">
            <option value="">Any</option>
            <option value="english">English only</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Effective from</span>
          <Input type="date" name="effective_from" value={from}
                 onChange={(e) => setFrom(e.target.value)}
                 className="w-[150px]" data-testid="apply-from" />
        </label>
        <Button type="submit" disabled={pending} data-testid="apply-save">
          {pending ? "Applying…" : all ? `Apply to all ${cells.length} cells` : `Apply to ${selected.length}`}
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <span className={FIELD_LABEL}>
          Apply to {all ? "— all cells (none ticked)" : `— ${selected.length} selected`}
        </span>
        <div className="flex flex-wrap gap-1.5" data-testid="apply-cells">
          {cells.map((c) => {
            const k = `${c.level}|${c.product_type}`;
            const on = all || selected.includes(k);
            return (
              <label key={k}
                     className={cx("cursor-pointer rounded-md border px-2 py-1 text-[12px]",
                       on ? "border-accent bg-accent text-accent-ink" : "border-line-2 bg-surface text-ink-2")}
                     data-testid={`apply-cell-${k}`}>
                <input type="checkbox" name="cell" value={k} className="sr-only"
                       checked={on} onChange={() => toggle(k)} />
                {c.level} {c.product_type}
                {c.hasRate ? "" : " ·new"}
              </label>
            );
          })}
          {!addingCell ? (
            <Button type="button" variant="ghost" size="sm"
                    onClick={() => setAddingCell(true)} data-testid="apply-add-cell">
              Add new cell…
            </Button>
          ) : (
            <span className="flex items-end gap-1.5">
              <NewCell levels={levels} types={types}
                       onAdd={(k) => { setSelected((s) => [...s, k]); setAddingCell(false); }} />
            </span>
          )}
        </div>
        {/* Ticking nothing means all, so the common case is one click. */}
      </div>

      {state.error ? (
        <p className="text-[12.5px] text-danger" data-testid="apply-error">{state.error}</p>
      ) : null}
      {state.message ? (
        <p className="text-[12.5px] text-ink-2" data-testid="apply-message">{state.message}</p>
      ) : null}
    </form>
  );
}

/** A cell the vendor has never sold or been rated for. */
function NewCell({
  levels, types, onAdd,
}: { levels: readonly string[]; types: readonly string[]; onAdd: (k: string) => void }) {
  const [level, setLevel] = useState("");
  const [type, setType] = useState("");
  return (
    <>
      <Select value={level} onChange={(e) => setLevel(e.target.value)}
              className="w-[130px]" aria-label="New cell level" data-testid="new-cell-level">
        <option value="">Level…</option>
        {levels.map((l) => <option key={l} value={l}>{l}</option>)}
      </Select>
      <Select value={type} onChange={(e) => setType(e.target.value)}
              className="w-[110px]" aria-label="New cell type" data-testid="new-cell-type">
        <option value="">Type…</option>
        {types.map((t) => <option key={t} value={t}>{t}</option>)}
      </Select>
      <Button type="button" size="sm" disabled={!level || !type}
              onClick={() => onAdd(`${level}|${type}`)} data-testid="new-cell-add">
        Add
      </Button>
    </>
  );
}

/**
 * §50H.3. Click the percentage, type, Enter.
 *
 * Saves as a new rate row from the panel's date, so the history survives; Esc
 * puts it back. The smallest possible affordance for the commonest correction.
 */
export function InlinePct({
  vendorId, saleKind, level, productType, language, pct, from, needsReview,
}: {
  vendorId: string;
  saleKind: "single" | "combo";
  level: string;
  productType: string;
  language: string | null;
  pct: number | null;
  from: string;
  needsReview: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<ApplyState, FormData>(editCellPct, EMPTY_APPLY_STATE);

  if (!editing) {
    return (
      <button type="button" onClick={() => setEditing(true)}
              className={cx("tabular-nums underline-offset-2 hover:underline",
                needsReview ? "text-danger" : "text-ink")}
              data-testid={`inline-pct-${level}-${productType}`}>
        {pct === null ? "none" : `${Number(pct).toFixed(2).replace(/\.00$/, "")}%`}
        {needsReview ? " — review" : ""}
      </button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-1"
          data-testid={`inline-form-${level}-${productType}`}>
      <input type="hidden" name="vendor_id" value={vendorId} />
      <input type="hidden" name="sale_kind" value={saleKind} />
      <input type="hidden" name="level" value={level} />
      <input type="hidden" name="product_type" value={productType} />
      {language ? <input type="hidden" name="language" value={language} /> : null}
      <input type="hidden" name="effective_from" value={from} />
      <Input name="pct" inputMode="decimal" autoFocus required className="w-[74px]"
             defaultValue={pct === null ? "" : String(pct)}
             aria-label={`${level} ${productType} percent`}
             onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
             data-testid={`inline-input-${level}-${productType}`} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}
              data-testid={`inline-save-${level}-${productType}`}>
        {pending ? "…" : "Save"}
      </Button>
      {state.error ? <span className="text-[11px] text-danger">{state.error}</span> : null}
    </form>
  );
}
