"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, CARD, ErrorNote, Input, cx } from "@/components/ui";
import type { GapOption, ListingGaps } from "@/lib/price-check/gaps";

import { finishRefresh, ignoreGap, refreshVendorOptions, vendorProductsToRefresh } from "./gap-actions";
import { Workbench } from "./workbench";

/**
 * Settings → Links → "Missing on Zeroinfy": for reviewed listings, vendor
 * batches/modes no variant sells (to create on Shopify) and linked options the
 * vendor has dropped. The team works through it with "Batches & options".
 */

const rupees = (n: number | null) => (n == null ? "—" : `₹${n.toLocaleString("en-IN")}`);
const rulePrice = (p: number | null) => (p == null ? null : p > 4000 ? p - 500 : p);

export function MissingView({ listings, refreshedAt, error }: { listings: ListingGaps[]; refreshedAt: string | null; error: string | null }) {
  const router = useRouter();
  const [progress, setProgress] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refreshAll() {
    setBusy(true);
    setNote(null);
    const list = await vendorProductsToRefresh();
    if (list.error || !list.items) {
      setNote(list.error ?? "Nothing to refresh.");
      setBusy(false);
      return;
    }
    const failed: string[] = [];
    for (let i = 0; i < list.items.length; i += 8) {
      setProgress(`Reading vendor pages… ${Math.min(i + 8, list.items.length)} / ${list.items.length}`);
      const r = await refreshVendorOptions(list.items.slice(i, i + 8));
      if (r.error) {
        setNote(r.error);
        break;
      }
      failed.push(...(r.failed ?? []));
    }
    await finishRefresh();
    setProgress(null);
    setBusy(false);
    if (failed.length) setNote(`Couldn't read ${failed.length}: ${failed.slice(0, 5).join(" · ")}${failed.length > 5 ? " …" : ""}`);
    router.refresh();
  }

  const totalMissing = listings.reduce((n, l) => n + l.missing.length, 0);
  const totalGone = listings.reduce((n, l) => n + l.gone.length, 0);

  return (
    <div className="flex flex-col gap-3">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {note ? <ErrorNote>{note}</ErrorNote> : null}
      <div className={cx(CARD, "flex flex-wrap items-center gap-3 p-3 text-[12px]")}>
        <span className="text-ink-2">
          {listings.length} listings · {totalMissing} vendor options not sold on Zeroinfy · {totalGone} linked options the vendor dropped
        </span>
        <span className="text-ink-3">
          Vendor options last read: {refreshedAt ? new Date(refreshedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "never"}
        </span>
        <Button size="sm" variant="primary" className="ml-auto" disabled={busy} onClick={refreshAll}>
          {progress ?? "Refresh from vendor sites"}
        </Button>
      </div>
      <p className="text-[12px] text-ink-3">
        Only listings with approved links are checked. Open <b>Batches &amp; options</b> to add a batch to Shopify, or mark an option{" "}
        <b>We don&apos;t sell this</b> to hide it for that listing.
      </p>
      {!refreshedAt ? (
        <p className="text-[12.5px] text-ink-2">No vendor options stored yet — click “Refresh from vendor sites” (about 2–3 minutes).</p>
      ) : null}
      {listings.map((l) => (
        <ListingCard key={l.pid} l={l} />
      ))}
    </div>
  );
}

function ListingCard({ l }: { l: ListingGaps }) {
  const [bench, setBench] = useState(false);
  return (
    <section className={cx(CARD, "flex flex-col gap-2 p-3")}>
      <div className="flex flex-wrap items-center gap-2">
        {l.handle ? (
          <a href={`https://zeroinfy.in/products/${l.handle}`} target="_blank" rel="noreferrer" className="text-[13.5px] font-semibold text-ink hover:underline">
            {l.title}
          </a>
        ) : (
          <span className="text-[13.5px] font-semibold text-ink">{l.title}</span>
        )}
        <Button size="sm" variant={bench ? "primary" : "secondary"} className="ml-auto" onClick={() => setBench((b) => !b)}>
          Batches &amp; options
        </Button>
      </div>
      {l.missing.length ? (
        <div className="flex flex-col gap-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.045em] text-warn">Vendor sells, Zeroinfy doesn&apos;t</div>
          {l.missing.map((g) => (
            <GapRow key={`${g.slug}|${g.variantId}`} pid={l.pid} g={g} />
          ))}
        </div>
      ) : null}
      {l.gone.length ? (
        <div className="flex flex-col gap-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.045em] text-danger">Vendor no longer lists (re-point these variants)</div>
          {l.gone.map((g) => (
            <div key={g.variantId} className="text-[12px] text-ink-2">
              {g.label} <span className="text-ink-3">· {g.variants} variant{g.variants === 1 ? "" : "s"} linked · {g.productTitle}</span>
            </div>
          ))}
        </div>
      ) : null}
      {bench ? <Workbench productId={l.pid} onClose={() => setBench(false)} /> : null}
    </section>
  );
}

function GapRow({ pid, g }: { pid: number; g: GapOption }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px]">
      <span className="text-ink">{g.label}</span>
      <span className="text-ink-3">
        {g.siteName} {rupees(g.price)} → Zeroinfy ~{rupees(rulePrice(g.price))}
      </span>
      <a href={`${g.siteUrl}/product/${g.slug}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
        {g.productTitle ?? g.slug}
      </a>
      {open ? (
        <form
          className="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await ignoreGap(pid, g.siteId, g.slug, g.variantId, why);
              if (r.error) setErr(r.error);
              else router.refresh();
            });
          }}
        >
          <Input autoFocus className="h-[24px] w-[220px]" value={why} placeholder="Why (optional)" onChange={(e) => setWhy(e.target.value)} />
          <Button size="sm" variant="secondary" type="submit" disabled={pending}>
            Hide
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
          We don&apos;t sell this
        </Button>
      )}
      {err ? <span className="text-danger">{err}</span> : null}
    </div>
  );
}
