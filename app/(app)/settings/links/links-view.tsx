"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Badge, Button, CARD, CELL, ErrorNote, Input, Select, TABLE_HEAD_ROW, Textarea, cx } from "@/components/ui";

import {
  approveHighConfidence,
  importSuggestions,
  resetProduct,
  setProductStatus,
  setVariantStatus,
} from "./actions";
import { MissingView } from "./missing-view";
import { Workbench } from "./workbench";
import type { ListingGaps } from "@/lib/price-check/gaps";

export type LinkRow = {
  id: string;
  shopify_product_id: number;
  shopify_variant_id: number;
  shopify_product_title: string;
  shopify_product_handle: string | null;
  shopify_vendor: string | null;
  shopify_variant_title: string | null;
  vendor_product_slug: string | null;
  vendor_product_title: string | null;
  vendor_variant_label: string | null;
  status: string;
  confidence: string;
  reason: string | null;
  review_note: string | null;
  vendor_sites: { name: string; website_url: string } | null;
};

const CONF_TONE: Record<string, "ok" | "warn" | "danger"> = { high: "ok", medium: "warn", low: "danger" };
const STATUS_LABEL: Record<string, string> = {
  suggested: "AI suggested",
  approved: "Approved",
  rejected: "Rejected",
  no_match: "No vendor match",
};
const RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

type Group = { pid: number; title: string; handle: string | null; vendor: string | null; rows: LinkRow[]; worst: string };

export function LinksView({
  rows,
  counts,
  status,
  conf,
  q,
  canImport,
  error,
  truncated,
  gaps,
}: {
  rows: LinkRow[];
  counts: Record<string, number>;
  status: string;
  conf: string | null;
  q: string;
  canImport: boolean;
  error: string | null;
  truncated: boolean;
  gaps: { error: string | null; listings: ListingGaps[]; refreshedAt: string | null };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [search, setSearch] = useState(q);

  const groups = useMemo(() => {
    const m = new Map<number, Group>();
    for (const r of rows) {
      let g = m.get(r.shopify_product_id);
      if (!g) {
        g = { pid: r.shopify_product_id, title: r.shopify_product_title, handle: r.shopify_product_handle, vendor: r.shopify_vendor, rows: [], worst: "high" };
        m.set(r.shopify_product_id, g);
      }
      g.rows.push(r);
      if (RANK[r.confidence] < RANK[g.worst]) g.worst = r.confidence;
    }
    return [...m.values()];
  }, [rows]);

  const highPids = groups.filter((g) => g.rows.some((r) => r.confidence === "high")).map((g) => g.pid);
  const highCount = rows.filter((r) => r.confidence === "high").length;

  function setParam(k: string, v: string | null) {
    const p = new URLSearchParams(params.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.push(`${pathname}?${p.toString()}`);
  }

  function run(fn: () => Promise<{ error: string | null; count?: number }>, done?: (n: number) => string) {
    setNote(null);
    setOkMsg(null);
    start(async () => {
      const res = await fn();
      if (res.error) setNote(res.error);
      else {
        if (done) setOkMsg(done(res.count ?? 0));
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {truncated ? <ErrorNote>Only the first 50,000 links are shown — narrow the filter.</ErrorNote> : null}
      {note ? <ErrorNote>{note}</ErrorNote> : null}
      {okMsg ? (
        <div className="rounded-md border border-ok/35 bg-ok-soft px-3 py-2 text-[12.5px] text-ok">{okMsg}</div>
      ) : null}

      <div className={cx(CARD, "flex flex-wrap items-end gap-3 p-3")}>
        <div className="flex gap-1">
          {(["suggested", "approved", "rejected", "no_match"] as const).map((s) => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? "primary" : "secondary"}
              onClick={() => setParam("status", s === "suggested" ? null : s)}
            >
              {STATUS_LABEL[s]} ({counts[s] ?? 0})
            </Button>
          ))}
          <Button size="sm" variant={status === "missing" ? "primary" : "secondary"} onClick={() => setParam("status", "missing")}>
            Missing on Zeroinfy ({gaps.listings.length})
          </Button>
        </div>
        <label className="flex flex-col gap-[3px]">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">Confidence</span>
          <Select className="h-[26px] w-[130px]" value={conf ?? ""} onChange={(e) => setParam("conf", e.target.value || null)}>
            <option value="">Any</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
        </label>
        <form
          className="flex items-end gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            setParam("q", search.trim() || null);
          }}
        >
          <Input className="h-[26px] w-[260px]" value={search} placeholder="Search Zeroinfy product title…" onChange={(e) => setSearch(e.target.value)} />
          <Button size="sm" type="submit">
            Search
          </Button>
        </form>

        {status === "suggested" && highCount > 0 ? (
          <div className="ml-auto flex items-center gap-2">
            {confirmBulk ? (
              <>
                <span className="text-[12px] text-ink-2">
                  Approve {highCount} high-confidence links on {highPids.length} products shown?
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending}
                  onClick={() => {
                    setConfirmBulk(false);
                    run(() => approveHighConfidence(highPids), (n) => `Approved ${n} high-confidence links.`);
                  }}
                >
                  Yes, approve
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmBulk(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="primary" disabled={pending} onClick={() => setConfirmBulk(true)}>
                Approve all high-confidence shown ({highCount})
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {status === "missing" ? <MissingView listings={gaps.listings} refreshedAt={gaps.refreshedAt} error={gaps.error} /> : null}

      <p className={cx("text-[12px] text-ink-3", status === "missing" && "hidden")}>
        {groups.length} products · {rows.length} variant links. Spot-check a few before bulk-approving — a wrong link
        silently compares against the wrong price.
      </p>

      {groups.map((g) => (
        <ProductCard key={g.pid} group={g} status={status} pending={pending} run={run} />
      ))}

      {canImport ? <ImportBox pending={pending} run={run} /> : null}
    </div>
  );
}

function ProductCard({
  group,
  status,
  pending,
  run,
}: {
  group: Group;
  status: string;
  pending: boolean;
  run: (fn: () => Promise<{ error: string | null; count?: number }>, done?: (n: number) => string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [why, setWhy] = useState("");
  const [bench, setBench] = useState(false);
  const reasons = [...new Set(group.rows.map((r) => r.reason).filter(Boolean))] as string[];
  const notes = [...new Set(group.rows.map((r) => r.review_note).filter(Boolean))] as string[];
  const targets = [...new Set(group.rows.map((r) => r.vendor_product_title ?? r.vendor_product_slug).filter(Boolean))];

  return (
    <section className={cx(CARD, "flex flex-col gap-2 p-3")}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={CONF_TONE[group.worst]} dot>
          {group.worst}
        </Badge>
        {group.handle ? (
          <a
            href={`https://zeroinfy.in/products/${group.handle}`}
            target="_blank"
            rel="noreferrer"
            className="text-[13.5px] font-semibold text-ink hover:underline"
          >
            {group.title}
          </a>
        ) : (
          <span className="text-[13.5px] font-semibold text-ink">{group.title}</span>
        )}
        <span className="text-[11.5px] text-ink-3">{group.vendor}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant={bench ? "primary" : "ghost"} onClick={() => setBench((b) => !b)}>
            Batches &amp; options
          </Button>
          {status === "suggested" ? (
            rejecting ? (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  setRejecting(false);
                  run(() => setProductStatus(group.pid, "rejected", why), () => "Rejected.");
                }}
              >
                <Input
                  autoFocus
                  className="h-[26px] w-[280px]"
                  value={why}
                  placeholder="What's wrong / which BB product it should be?"
                  onChange={(e) => setWhy(e.target.value)}
                />
                <Button size="sm" variant="danger" type="submit" disabled={pending}>
                  Reject
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setRejecting(false)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <>
                <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => setProductStatus(group.pid, "approved"), (n) => `Approved ${n} links.`)}>
                  Approve
                </Button>
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => setRejecting(true)}>
                  Reject…
                </Button>
              </>
            )
          ) : status === "approved" || status === "rejected" ? (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => resetProduct(group.pid), () => "Moved back to suggestions.")}>
              Undo review
            </Button>
          ) : null}
        </div>
      </div>

      {targets.length ? (
        <div className="text-[12px] text-ink-2">
          → {group.rows[0]?.vendor_sites?.name}: {targets.join("  ·  ")}
        </div>
      ) : null}
      {reasons.map((r, i) => (
        <p key={i} className="text-[12px] text-ink-3">
          {r}
        </p>
      ))}
      {notes.map((n, i) => (
        <p key={i} className="text-[12px] text-danger">
          Review note: {n}
        </p>
      ))}

      {bench ? <Workbench productId={group.pid} onClose={() => setBench(false)} /> : null}

      <table className="w-full text-[12px]">
        <thead>
          <tr className={TABLE_HEAD_ROW}>
            <th className={CELL}>Zeroinfy variant</th>
            <th className={CELL}>Vendor product</th>
            <th className={CELL}>Vendor batch / option</th>
            <th className={CELL}>Conf.</th>
            <th className={CELL} />
          </tr>
        </thead>
        <tbody>
          {group.rows.map((r) => {
            const site = r.vendor_sites?.website_url;
            return (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className={cx(CELL, "max-w-[320px]")}>{r.shopify_variant_title ?? "Default"}</td>
                <td className={cx(CELL, "max-w-[340px]")}>
                  {r.vendor_product_slug && site ? (
                    <a href={`${site}/product/${r.vendor_product_slug}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      {r.vendor_product_title ?? r.vendor_product_slug}
                    </a>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </td>
                <td className={cx(CELL, "max-w-[320px] text-ink-2")}>{r.vendor_variant_label ?? "—"}</td>
                <td className={CELL}>
                  <Badge tone={CONF_TONE[r.confidence]}>{r.confidence}</Badge>
                </td>
                <td className={cx(CELL, "whitespace-nowrap text-right")}>
                  {status === "suggested" ? (
                    <>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setVariantStatus(r.id, "approved"))}>
                        ✓
                      </Button>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setVariantStatus(r.id, "rejected"))}>
                        ✕
                      </Button>
                    </>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function ImportBox({
  pending,
  run,
}: {
  pending: boolean;
  run: (fn: () => Promise<{ error: string | null; count?: number }>, done?: (n: number) => string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  return (
    <div className={cx(CARD, "p-3")}>
      <button type="button" className="text-[12px] text-ink-3 hover:text-ink" onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} Load AI suggestions (Super Admin)
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-2">
          <Textarea rows={4} value={text} placeholder="Paste the suggestions JSON here" onChange={(e) => setText(e.target.value)} />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={pending || !text.trim()}
              onClick={() =>
                run(
                  async () => {
                    const r = await importSuggestions(text);
                    return { error: r.error, count: r.count };
                  },
                  (n) => `Loaded ${n} suggestions. Links already approved or rejected were left untouched.`,
                )
              }
            >
              Load
            </Button>
            <span className="text-[11.5px] text-ink-3">{text ? `${text.length.toLocaleString()} characters` : ""}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
