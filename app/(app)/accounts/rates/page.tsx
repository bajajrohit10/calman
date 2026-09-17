import Link from "next/link";

import { Badge, ErrorNote, Input, PageHeader, Select, CELL, TABLE_HEAD_ROW, cx } from "@/components/ui";
import { requireAccountsProfile } from "@/lib/auth";
import { istToday } from "@/lib/format";
import {
  LEVELS, PRODUCT_TYPES, STATES,
  loadRateCells, loadUnknownLines, loadVendor, loadVendorOptions,
} from "@/lib/accounts/rates";
import type { SaleKind } from "@/lib/accounts/classify";
import { AddRate, ConfirmRatePct, SetLinePct } from "./rate-forms";

export const metadata = { title: "Rates · Accounts · Calman" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";

const TABS = [
  { id: "single", label: "Single courses" },
  { id: "combos", label: "Combos" },
  { id: "unknown", label: "Unknown" },
] as const;

const KINDS = [
  { id: "teacher", label: "Teacher" },
  { id: "institute", label: "Institute" },
  { id: "books", label: "Books" },
];

/**
 * §50D.2. Combos are agreed with the house, not the teacher, so the Combos
 * tab opens on institutes. It is a default and not a restriction — a few
 * teachers do sell their own bundles, and the filter still offers every kind.
 */
const DEFAULT_KIND: Record<SaleKind, string> = { single: "", combo: "institute" };

const pctText = (n: number) => `${Number(n).toFixed(2).replace(/\.00$/, "")}%`;
const dateText = (d: string | null) => (d ? d : "—");

/**
 * §50B.2. The rate tables.
 *
 * Three tabs because there are three ways a line gets a percentage, and they
 * fail differently: the grid is per vendor and needs a vendor picked before it
 * means anything, combos are global and keyed by title, and Unknown is the
 * list of lines no rule reached. Putting the last one behind its own tab makes
 * it countable — the number of unresolved lines is the health of the whole
 * module, and it should not be something you have to go looking for.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  await requireAccountsProfile();
  const sp = await searchParams;
  const tab = (TABS.find((t) => t.id === one(sp.tab))?.id ?? "single") as
    (typeof TABS)[number]["id"];
  const search = one(sp.q);
  const kind = one(sp.kind);
  const vendorId = one(sp.vendor);
  const today = istToday();

  const tabHref = (id: string) => {
    const p = new URLSearchParams();
    p.set("tab", id);
    if (vendorId) p.set("vendor", vendorId);
    if (search) p.set("q", search);
    if (kind) p.set("kind", kind);
    return `/accounts/rates?${p}`;
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Rates"
        description="What each vendor earns, by level and product type, over time — and the lines no rate reached."
      />

      <nav className="flex flex-wrap gap-1.5" data-testid="rate-tabs">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={tabHref(t.id)}
            data-testid={`tab-${t.id}`}
            aria-current={t.id === tab ? "page" : undefined}
            className={cx(
              "rounded-md px-2.5 py-1 text-[12.5px]",
              t.id === tab
                ? "bg-accent text-accent-ink"
                : "border border-line-2 bg-surface text-ink-2 hover:bg-surface-2",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {/* §50D.2. One grid, two tabs. The only difference is which sale_kind
          it reads and writes, so they cannot drift apart. */}
      {tab === "single" || tab === "combos" ? (
        <RateGrid
          saleKind={tab === "combos" ? "combo" : "single"}
          search={search}
          kind={sp.kind === undefined ? DEFAULT_KIND[tab === "combos" ? "combo" : "single"] : kind}
          vendorId={vendorId}
          today={today}
        />
      ) : null}
      {tab === "unknown" ? <Unknown /> : null}
    </div>
  );
}

/* ------------------------------------------------------------ the grid -- */

async function RateGrid({
  saleKind, search, kind, vendorId, today,
}: {
  saleKind: SaleKind; search: string; kind: string; vendorId: string; today: string;
}) {
  const tab = saleKind === "combo" ? "combos" : "single";
  const { rows: vendors, error: vErr } = await loadVendorOptions(search, kind);
  const vendor = vendorId ? await loadVendor(vendorId) : null;
  const { cells, error: cErr } = vendor
    ? await loadRateCells(vendor.id, saleKind)
    : { cells: [], error: null };

  return (
    <div className="flex flex-col gap-4">
      {vErr ? <ErrorNote>{vErr}</ErrorNote> : null}

      <form
        method="GET"
        className="flex flex-wrap items-end gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-card"
      >
        <input type="hidden" name="tab" value={tab} />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Search vendor
          </span>
          <Input name="q" defaultValue={search} placeholder="Name contains…"
                 className="w-[220px]" data-testid="vendor-search" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Kind
          </span>
          <Select name="kind" defaultValue={kind} className="w-[150px]"
                  data-testid="vendor-kind">
            <option value="">Any</option>
            {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </Select>
        </label>
        <button type="submit"
                className="h-[30px] rounded-md bg-accent px-3 text-[12.5px] font-medium text-accent-ink">
          Search
        </button>
        <span className="ml-auto text-[12px] text-ink-3" data-testid="vendor-option-count">
          {vendors.length} vendor{vendors.length === 1 ? "" : "s"}
        </span>
      </form>

      <div className="flex flex-wrap gap-1.5" data-testid="vendor-options">
        {vendors.slice(0, 60).map((v) => (
          <Link
            key={v.id}
            href={`/accounts/rates?tab=${tab}&vendor=${v.id}${search ? `&q=${encodeURIComponent(search)}` : ""}${kind ? `&kind=${kind}` : ""}`}
            data-testid="vendor-option"
            aria-current={v.id === vendorId ? "true" : undefined}
            className={cx(
              "rounded-md px-2 py-1 text-[12px]",
              v.id === vendorId
                ? "bg-accent text-accent-ink"
                : "border border-line-2 bg-surface text-ink-2 hover:bg-surface-2",
            )}
          >
            {v.name}
          </Link>
        ))}
      </div>

      {/* Nothing shows until a vendor is picked: a grid of every vendor's
          every cell would be 93 vendors wide and mean nothing. */}
      {!vendor ? (
        <p className="rounded-lg border border-line bg-surface px-3 py-8 text-center text-[12.5px] text-ink-3"
           data-testid="no-vendor">
          Pick a vendor to see its {saleKind === "combo" ? "combo " : ""}rates.
        </p>
      ) : (
        <>
          {cErr ? <ErrorNote>{cErr}</ErrorNote> : null}

          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-[13.5px] font-semibold text-ink" data-testid="picked-vendor">
              {vendor.name}
            </h2>
            <Badge tone="neutral">{vendor.kind}</Badge>
            {vendor.institute ? (
              <span className="text-[12px] text-ink-3">{vendor.institute}</span>
            ) : null}
            <div className="ml-auto">
              <AddRate
                vendorId={vendor.id} saleKind={saleKind}
                levels={LEVELS} types={PRODUCT_TYPES}
                states={STATES} today={today} label="Add cell"
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
            <table className="w-full min-w-[820px] text-left text-[12.5px]">
              <thead className={TABLE_HEAD_ROW}>
                <tr>
                  <th className="px-2 py-[7px]">Level</th>
                  <th className="px-2 py-[7px]">Type</th>
                  <th className="px-2 py-[7px] text-right">Current %</th>
                  <th className="px-2 py-[7px]">Effective from</th>
                  <th className="px-2 py-[7px]">Effective to</th>
                  <th className="px-2 py-[7px]">State scope</th>
                  <th className="px-2 py-[7px]">History</th>
                </tr>
              </thead>
              <tbody data-testid="rate-rows">
                {cells.map((c) => (
                  <tr key={`${c.level} ${c.product_type}`} className="border-b border-line last:border-b-0 align-top">
                    <td className={cx(CELL, "text-ink")}>{c.level}</td>
                    <td className={cx(CELL, "text-ink-2")}>{c.product_type}</td>
                    <td className={cx(CELL, "text-right tabular-nums")}>
                      {c.current ? (
                        // §50C(c). A seeded, unconfirmed rate is shown in red
                        // and says so. resolve_rate skips it, so what the cell
                        // really holds today is nothing — and the screen has
                        // to be honest that the figure beside it is August's
                        // observation, not an agreed rate.
                        <span
                          className={c.current.needs_review ? "text-danger" : "text-ink"}
                          data-testid={c.current.needs_review ? "rate-needs-review" : "rate-live"}
                        >
                          {pctText(c.current.pct)}
                          {c.current.needs_review ? " — review" : ""}
                        </span>
                      ) : (
                        <span className="text-ink-3" data-testid="no-current-rate">none</span>
                      )}
                    </td>
                    <td className={cx(CELL, "text-ink-2")}>
                      {c.current ? c.current.effective_from : "—"}
                    </td>
                    <td className={cx(CELL, "text-ink-2")}>
                      {c.current ? dateText(c.current.effective_to) : "—"}
                    </td>
                    <td className={cx(CELL, "text-ink-2")}>
                      {c.current?.state_scope?.length
                        ? c.current.state_scope.join(", ")
                        : "All states"}
                    </td>
                    <td className={CELL}>
                      <div className="flex flex-col items-start gap-1.5">
                        <details>
                          <summary className="cursor-pointer text-[12px] text-ink-2"
                                   data-testid="history-toggle">
                            {c.history.length} row{c.history.length === 1 ? "" : "s"}
                          </summary>
                          <ul className="mt-1 flex flex-col gap-1" data-testid="history-list">
                            {c.history.map((h) => (
                              <li key={h.id} className="text-[11.5px] text-ink-3">
                                <span className="tabular-nums text-ink-2">{pctText(h.pct)}</span>
                                {" · "}{h.effective_from} → {dateText(h.effective_to)}
                                {h.state_scope?.length ? ` · ${h.state_scope.join(", ")}` : ""}
                                {h.note ? ` · ${h.note}` : ""}
                              </li>
                            ))}
                            {c.history.length === 0 ? (
                              <li className="text-[11.5px] text-ink-3">
                                No rate has ever been set for this cell.
                              </li>
                            ) : null}
                          </ul>
                        </details>
                        {c.current?.needs_review ? (
                          <>
                            {c.current.note ? (
                              <span className="text-[11.5px] text-ink-3"
                                    data-testid="review-note">
                                {c.current.note}
                              </span>
                            ) : null}
                            <ConfirmRatePct rateId={c.current.id} />
                          </>
                        ) : null}
                        <AddRate
                          vendorId={vendor.id} saleKind={saleKind}
                          levels={LEVELS} types={PRODUCT_TYPES}
                          states={STATES} today={today}
                          level={c.level} productType={c.product_type}
                          label="Add rate"
                        />
                      </div>
                    </td>
                  </tr>
                ))}
                {cells.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-ink-3"
                        data-testid="no-cells">
                      No {saleKind === "combo" ? "combo " : ""}rates or sales lines for this
                      vendor yet. Use “Add cell”.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- unknown -- */

async function Unknown() {
  const { rows, error } = await loadUnknownLines();

  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const g = groups.get(r.vendor_name) ?? [];
    g.push(r);
    groups.set(r.vendor_name, g);
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full min-w-[980px] text-left text-[12.5px]">
          <thead className={TABLE_HEAD_ROW}>
            <tr>
              <th className="px-2 py-[7px]">Order</th>
              <th className="px-2 py-[7px]">Date</th>
              <th className="px-2 py-[7px]">Course</th>
              <th className="px-2 py-[7px]">Level</th>
              <th className="px-2 py-[7px]">Type</th>
              <th className="px-2 py-[7px] text-right">Teacher’s price</th>
              <th className="px-2 py-[7px]">Set %</th>
            </tr>
          </thead>
          <tbody data-testid="unknown-rows">
            {[...groups.entries()].map(([vendorName, list]) => (
              <>
                <tr key={vendorName} className="border-b border-line bg-sunk">
                  <td colSpan={7} className="px-2 py-[5px] text-[11.5px] font-semibold text-ink-2">
                    {vendorName} · {list.length} line{list.length === 1 ? "" : "s"}
                  </td>
                </tr>
                {list.map((l) => (
                  <tr key={l.id} className="border-b border-line last:border-b-0">
                    <td className={cx(CELL, "text-ink")}>{l.order_id}</td>
                    <td className={cx(CELL, "text-ink-2")}>
                      {l.order_date ? l.order_date.slice(0, 10) : "—"}
                    </td>
                    <td className={cx(CELL, "text-ink-2")}>{l.course_title ?? "—"}</td>
                    <td className={cx(CELL, "text-ink-2")}>{l.level ?? "—"}</td>
                    <td className={cx(CELL, "text-ink-2")}>{l.product_type ?? "—"}</td>
                    <td className={cx(CELL, "text-right tabular-nums text-ink-2")}>
                      {l.teachers_price === null ? "—" : `₹${l.teachers_price}`}
                    </td>
                    <td className={CELL}><SetLinePct lineId={l.id} /></td>
                  </tr>
                ))}
              </>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-ink-3"
                    data-testid="unknown-empty">
                  No unresolved lines. Lines appear here after a sales import
                  when no grid or combo rate matches.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
