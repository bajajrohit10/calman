"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, CARD, ErrorNote, Input, cx } from "@/components/ui";
import type { MissingGroup, PriceFix, Todo, TodoListing } from "@/lib/price-check/todo";

import { finishRefresh, ignoreGap, refreshVendorOptions, vendorProductsToRefresh } from "./gap-actions";
import { answerAttempt, confirmListing, dismissChoices, importPlan, fixPrices, ignoreOptions, refreshListing, refreshShopify, setKeepPrice, shopifyProductsToRefresh, type PriceFixIn } from "./todo-actions";
import { Workbench } from "./workbench";
import { linkPastedProduct, removeVariants, retargetLink } from "./workbench-actions";

/**
 * Settings → Links → "To do on Zeroinfy": one list of what to change on the
 * Zeroinfy listings. Links, confidence and review states stay out of sight.
 */

const rupees = (n: number | null | undefined) => (n == null ? "—" : `₹${n.toLocaleString("en-IN")}`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "never");

type Filter = "all" | "attempt" | "batch" | "confirm" | "price" | "missing" | "past" | "dropped";
const FILTERS: { key: Filter; label: string; count: (t: Todo) => number }[] = [
  { key: "all", label: "Everything", count: (t) => t.listings.length },
  { key: "attempt", label: "1. Which BB product?", count: (t) => t.counts.attempt },
  { key: "batch", label: "2. Batch names differ", count: (t) => t.counts.batch },
  { key: "dropped", label: "3. BB dropped", count: (t) => t.counts.dropped },
  { key: "confirm", label: "4. Confirm BB match", count: (t) => t.counts.confirm },
  { key: "past", label: "5. Past attempts listed", count: (t) => t.counts.past },
  { key: "missing", label: "6. Add on Zeroinfy", count: (t) => t.counts.missing },
  { key: "price", label: "7. Price to fix", count: (t) => t.counts.price },
];

function has(l: TodoListing, f: Filter) {
  switch (f) {
    case "attempt":
      return !!l.attemptQuestion || l.unlinked.length > 0;
    case "batch":
      return l.batchMismatch.length > 0;
    case "confirm":
      return !!l.confirm;
    case "price":
      return l.priceFixes.length > 0;
    case "missing":
      return l.missing.length > 0;
    case "past":
      return l.pastAttempts.length > 0;
    case "dropped":
      return l.dropped.length > 0;
    default:
      return true;
  }
}

const toFix = (l: TodoListing, f: PriceFix): PriceFixIn => ({ pid: l.pid, title: l.title, linkId: f.linkId, variantId: f.variantId, price: f.expected, compareAt: Math.max(f.compareAt ?? 0, f.vendorPrice) });

export function TodoView({ todo, canWrite }: { todo: Todo; canWrite: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [pending, start] = useTransition();

  const shown = useMemo(
    () => todo.listings.filter((l) => has(l, filter) && (!q.trim() || l.title.toLowerCase().includes(q.trim().toLowerCase()))),
    [todo, filter, q],
  );
  const shownFixes = shown.flatMap((l) => l.priceFixes.map((f) => toFix(l, f)));

  async function refreshAll() {
    setNote(null);
    setOk(null);
    const failed: string[] = [];
    const s = await shopifyProductsToRefresh();
    if (s.error || !s.pids) return setNote(s.error ?? "Nothing to refresh.");
    for (let i = 0; i < s.pids.length; i += 10) {
      setBusy(`Reading Zeroinfy listings… ${Math.min(i + 10, s.pids.length)} / ${s.pids.length}`);
      const r = await refreshShopify(s.pids.slice(i, i + 10));
      if (r.error) {
        setNote(r.error);
        break;
      }
      failed.push(...(r.failed ?? []));
    }
    const v = await vendorProductsToRefresh();
    if (v.items) {
      for (let i = 0; i < v.items.length; i += 8) {
        setBusy(`Reading BB pages… ${Math.min(i + 8, v.items.length)} / ${v.items.length}`);
        const r = await refreshVendorOptions(v.items.slice(i, i + 8));
        if (r.error) {
          setNote(r.error);
          break;
        }
        failed.push(...(r.failed ?? []));
      }
    }
    await finishRefresh();
    setBusy(null);
    if (failed.length) setNote(`Couldn't read ${failed.length}: ${failed.slice(0, 4).join(" · ")}${failed.length > 4 ? " …" : ""}`);
    router.refresh();
  }

  function act(fn: () => Promise<{ error: string | null; count?: number }>, done: (n: number) => string) {
    setNote(null);
    setOk(null);
    start(async () => {
      const r = await fn();
      if (r.error) setNote(r.error);
      else setOk(done(r.count ?? 0));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {todo.error ? <ErrorNote>{todo.error}</ErrorNote> : null}
      {note ? <ErrorNote>{note}</ErrorNote> : null}
      {ok ? <div className="rounded-md border border-ok/35 bg-ok-soft px-3 py-2 text-[12.5px] text-ok">{ok}</div> : null}

      <div className={cx(CARD, "flex flex-col gap-2 p-3")}>
        <div className="flex flex-wrap items-center gap-1">
          {FILTERS.map((f) => (
            <Button key={f.key} size="sm" variant={filter === f.key ? "primary" : "secondary"} onClick={() => setFilter(f.key)}>
              {f.label} ({f.count(todo)})
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <Input className="h-[26px] w-[260px]" value={q} placeholder="Search listing…" onChange={(e) => setQ(e.target.value)} />
          <span className="text-ink-3">
            Zeroinfy prices read {when(todo.shopifyReadAt)} · BB read {when(todo.vendorReadAt)}
          </span>
          {canWrite ? (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              disabled={pending}
              title="One-off: matching corrections prepared by Claude"
              onClick={() =>
                act(async () => {
                  const r = await fetch("/api/price-check/plan-file", { cache: "no-store" });
                  if (!r.ok) return { error: "No prepared corrections to load." };
                  return importPlan(await r.text());
                }, (n) => `Loaded the batch-name questions (${n} links updated).`)
              }
            >
              Load batch-name questions (24 Oct, v5)
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" className={canWrite ? "" : "ml-auto"} disabled={!!busy} onClick={refreshAll}>
            {busy ?? "Refresh everything (~5 min)"}
          </Button>
          {canWrite && shownFixes.length ? (
            confirmAll ? (
              <>
                <span className="text-ink-2">Change {shownFixes.length} prices on zeroinfy.in?</span>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending}
                  onClick={() => {
                    setConfirmAll(false);
                    act(() => fixPrices(shownFixes), (n) => `Updated ${n} prices on Shopify.`);
                  }}
                >
                  Yes, update Shopify
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmAll(false)}>
                  No
                </Button>
              </>
            ) : (
              <Button size="sm" variant="primary" disabled={pending} onClick={() => setConfirmAll(true)}>
                Fix all prices shown ({shownFixes.length})
              </Button>
            )
          ) : null}
        </div>
      </div>

      <p className="text-[12px] text-ink-3">Work through the filters in number order: settle the BB link and batch first, add or remove variants, fix prices last. {shown.length} listings. Zeroinfy price = BB price (BB&apos;s offer ended 27 Oct).</p>

      {shown.map((l) => (
        <ListingCard key={l.pid} l={l} canWrite={canWrite} pending={pending} act={act} />
      ))}
    </div>
  );
}

function ListingCard({
  l,
  canWrite,
  pending,
  act,
}: {
  l: TodoListing;
  canWrite: boolean;
  pending: boolean;
  act: (fn: () => Promise<{ error: string | null; count?: number }>, done: (n: number) => string) => void;
}) {
  const [bench, setBench] = useState<null | { slug: string; variantId: string } | "open">(null);
  return (
    <section className={cx(CARD, "flex flex-col gap-2 p-3 text-[12px]")}>
      <div className="flex flex-wrap items-center gap-2">
        {l.handle ? (
          <a href={`https://zeroinfy.in/products/${l.handle}`} target="_blank" rel="noreferrer" className="text-[13.5px] font-semibold text-ink hover:underline">
            {l.title}
          </a>
        ) : (
          <span className="text-[13.5px] font-semibold text-ink">{l.title}</span>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          disabled={pending}
          title="Re-read this listing from Shopify and its BB products from bbvirtuals.com"
          onClick={() => act(() => refreshListing(l.pid), () => "Refreshed this listing from Shopify and BB.")}
        >
          ↻ Refresh
        </Button>
        <Button size="sm" variant={bench ? "primary" : "ghost"} onClick={() => setBench(bench ? null : "open")}>
          Batches &amp; options
        </Button>
      </div>

      {l.attemptQuestion ? (
        <Block tone="accent" title="Which BB product do these variants resell?">
          <p className="text-ink-3">
            More than one BB product matches by name (subjects, batch type, teachers, attempt), or the titles disagree. Open them on BB (↗), then pick the one that is the same course. Any BB attempt you don&apos;t sell
            will show up under “Add on Zeroinfy”.
          </p>
          {l.attemptQuestion.map((g, gi) => (
            <div key={gi} className="flex flex-col gap-1 border-t border-line pt-1 first:border-0 first:pt-0">
              <div className="text-ink-2">
                {g.variants.length} variant{g.variants.length === 1 ? "" : "s"}:{" "}
                {g.variants
                  .slice(0, 4)
                  .map((v) => `${v.title} (${rupees(v.price)})`)
                  .join(" · ")}
                {g.variants.length > 4 ? " …" : ""}
              </div>
              <div className="flex flex-col gap-1">
                {g.choices.map((c) => (
                  <div key={c.slug} className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => act(() => answerAttempt(l.pid, c.siteId, c.slug, g.variantIds), (n) => `Linked ${n} variants to “${c.productTitle}”.`)}
                    >
                      This one
                    </Button>
                    <a href={`${c.siteUrl}/product/${c.slug}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      {c.productTitle ?? c.slug} ↗
                    </a>
                    <span className="text-ink-3">
                      {c.attempts} · BB {rupees(c.price)}
                    </span>
                    {c.label ? <div className="basis-full pl-[86px] text-[11.5px] text-ink-2">BB batch: {c.label}</div> : null}
                  </div>
                ))}
                <PasteLink
                  pending={pending}
                  onUse={(link) =>
                    act(
                      async () => {
                        const r = await linkPastedProduct(l.pid, link, g.variantIds);
                        if (!r.error) setBench("open");
                        return r;
                      },
                      (n) => `Linked ${n} variants to that BB product. Now pick the matching BB option for each one below.`,
                    )
                  }
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  disabled={pending}
                  onClick={() => act(() => dismissChoices(l.pid, g.variantIds), () => "Left unmatched.")}
                >
                  None of these
                </Button>
              </div>
            </div>
          ))}
        </Block>
      ) : null}

      {l.unlinked.length ? (
        <Block tone="accent" title={`Not linked to BB yet (${l.unlinked.length})`}>
          <p className="text-ink-2">
            {l.unlinked.slice(0, 6).map((v) => v.title).join(" · ")}
            {l.unlinked.length > 6 ? " …" : ""}
          </p>
          <p className="text-ink-3">Pick the BB option each one resells in Batches &amp; options. If BB doesn&apos;t sell it (e.g. without books), choose “Zeroinfy-only option”. If the BB product isn&apos;t listed, paste its link there.</p>
          <Button size="sm" variant="secondary" className="self-start" onClick={() => setBench("open")}>
            Link in Batches &amp; options
          </Button>
        </Block>
      ) : null}

      {l.batchMismatch.length ? (
        <Block tone="warn" title="Batch names don't match the linked BB option">
          {l.batchMismatch.map((b) => (
            <div key={b.linkId} className="flex flex-col gap-1 border-t border-line pt-1 first:border-0 first:pt-0">
              <div className="text-ink">
                {b.variantTitle} <span className="text-ink-3">— Zeroinfy batches: {b.ziDates}</span>
              </div>
              <div className="text-ink-3">Linked now: {b.currentLabel || "—"}</div>
              <div className="text-ink-2">
                Same BB product, matching batches: <b>{b.suggestLabel}</b> · BB {rupees(b.suggestPrice)}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => act(() => retargetLink(b.linkId, b.slug, b.suggestId, b.suggestLabel, b.productTitle), () => "Switched to the BB option with the same batches.")}
                >
                  Switch to this option
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => act(() => ignoreGap(l.pid, b.siteId, b.slug, `batch-ok:${b.variantId}`, "Current link confirmed despite batch names"), () => "Kept the current link.")}
                >
                  Current link is right
                </Button>
              </div>
            </div>
          ))}
          <p className="text-ink-3">Its price fix (if any) is held until this is settled.</p>
        </Block>
      ) : null}

      {l.confirm ? (
        <Block tone="warn" title={`Confirm the BB match (${l.confirm.count} variants)`}>
          {l.confirm.products.map((p) => (
            <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              Linked to: {p.title} ↗
            </a>
          ))}
          {l.confirm.reasons.map((r, i) => (
            <p key={i} className="text-ink-3">
              {r}
            </p>
          ))}
          <div className="flex gap-2">
            <Button size="sm" variant="primary" disabled={pending} onClick={() => act(() => confirmListing(l.pid), (n) => `Confirmed ${n} variants.`)}>
              Looks right
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setBench("open")}>
              Check / change in Batches &amp; options
            </Button>
          </div>
        </Block>
      ) : null}

      {l.missing.map((g) => (
        <MissingBlock key={g.slug} l={l} g={g} canWrite={canWrite} pending={pending} act={act} onAdd={(variantId) => setBench({ slug: g.slug, variantId })} />
      ))}

      {l.pastAttempts.length ? <PastBlock l={l} canWrite={canWrite} pending={pending} act={act} openBench={() => setBench("open")} /> : null}

      {l.dropped.length ? (
        <Block tone="danger" title="BB no longer lists the option these variants are linked to">
          {l.dropped.map((d) => (
            <p key={d.label} className="text-ink-2">
              {d.label} · {d.variants} variant{d.variants === 1 ? "" : "s"} — re-point them in Batches &amp; options
            </p>
          ))}
        </Block>
      ) : null}

      {l.priceFixes.length ? (
        <Block tone="danger" title="Price to fix">
          <table className="w-full">
            <tbody>
              {l.priceFixes.map((f) => (
                <tr key={f.linkId} className="border-b border-line last:border-0">
                  <td className="py-1 pr-2">{f.variantTitle}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">
                    Zeroinfy <b>{rupees(f.current)}</b> → should be <b>{rupees(f.expected)}</b>
                  </td>
                  <td className="py-1 pr-2 text-ink-3">
                    BB {rupees(f.vendorPrice)} · {f.rule}
                    {!f.confirmed ? " · BB match not confirmed yet" : ""}
                    <div className="truncate max-w-[420px]" title={f.vendorLabel}>
                      <a href={f.vendorUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                        {f.vendorTitle ?? "BB product"} ↗
                      </a>{" "}
                      · {f.vendorLabel}
                    </div>
                  </td>
                  <td className="py-1 text-right whitespace-nowrap">
                    {canWrite ? (
                      <Button size="sm" variant="secondary" disabled={pending} onClick={() => act(() => fixPrices([toFix(l, f)]), () => "Price updated on Shopify.")}>
                        Fix
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      title="Our price is different on purpose (e.g. includes books). Stop checking this variant against BB."
                      onClick={() => act(() => setKeepPrice([f.linkId], true, ""), () => "Our price is kept for this variant.")}
                    >
                      Keep our price
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap gap-2">
            {canWrite && l.priceFixes.length > 1 ? (
              <Button size="sm" variant="primary" disabled={pending} onClick={() => act(() => fixPrices(l.priceFixes.map((f) => toFix(l, f))), (n) => `Updated ${n} prices on Shopify.`)}>
                Fix all {l.priceFixes.length}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setBench("open")}>
              Wrong BB option? Change it
            </Button>
          </div>
        </Block>
      ) : null}

      {bench ? (
        <Workbench key={bench === "open" ? "open" : `${bench.slug}|${bench.variantId}`} productId={l.pid} focus={bench === "open" ? undefined : bench} onClose={() => setBench(null)} />
      ) : null}
    </section>
  );
}

function MissingBlock({
  l,
  g,
  canWrite,
  pending,
  act,
  onAdd,
}: {
  l: TodoListing;
  g: MissingGroup;
  canWrite: boolean;
  pending: boolean;
  act: (fn: () => Promise<{ error: string | null; count?: number }>, done: (n: number) => string) => void;
  onAdd: (variantId: string) => void;
}) {
  const [why, setWhy] = useState("");
  const [hiding, setHiding] = useState<string | "all" | null>(null);
  const title = g.kind === "attempt" ? `BB also sells this for ${g.attempts ?? "another attempt"} — not on Zeroinfy` : "New batch / mode on BB — not on Zeroinfy";
  return (
    <Block tone="ok" title={title}>
      <a href={`${g.siteUrl}/product/${g.slug}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">
        {g.productTitle ?? g.slug}
      </a>
      {g.options.map((o) => (
        <div key={o.variantId} className="flex flex-wrap items-center gap-2">
          <span className="text-ink">{o.label}</span>
          <span className="text-ink-3">
            BB {rupees(o.price)} → add at {rupees(o.expected)}
          </span>
          {canWrite ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => onAdd(o.variantId)}>
              Add to Zeroinfy…
            </Button>
          ) : null}
          {hiding === o.variantId ? null : (
            <Button size="sm" variant="ghost" onClick={() => setHiding(o.variantId)}>
              We don&apos;t sell this
            </Button>
          )}
          {hiding === o.variantId ? (
            <HideForm why={why} setWhy={setWhy} pending={pending} onCancel={() => setHiding(null)} onHide={() => act(() => ignoreGap(l.pid, g.siteId, g.slug, o.variantId, why), () => "Hidden for this listing.")} />
          ) : null}
        </div>
      ))}
      {g.kind === "attempt" && g.options.length > 1 ? (
        hiding === "all" ? (
          <HideForm
            why={why}
            setWhy={setWhy}
            pending={pending}
            onCancel={() => setHiding(null)}
            onHide={() => act(() => ignoreOptions(l.pid, g.siteId, g.slug, g.options.map((o) => o.variantId), why), () => "Attempt hidden for this listing.")}
          />
        ) : (
          <Button size="sm" variant="ghost" className="self-start" onClick={() => setHiding("all")}>
            We don&apos;t sell this attempt
          </Button>
        )
      ) : null}
    </Block>
  );
}

function PasteLink({ pending, onUse }: { pending: boolean; onUse: (link: string) => void }) {
  const [link, setLink] = useState("");
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (link.trim()) onUse(link.trim());
      }}
    >
      <span className="text-ink-2">Found the right one yourself?</span>
      <Input className="h-[26px] w-[420px] max-w-full" value={link} placeholder="Paste the BB product link" onChange={(e) => setLink(e.target.value)} />
      <Button size="sm" variant="secondary" type="submit" disabled={pending || !link.trim()}>
        Use this BB product
      </Button>
    </form>
  );
}

function HideForm({ why, setWhy, pending, onCancel, onHide }: { why: string; setWhy: (s: string) => void; pending: boolean; onCancel: () => void; onHide: () => void }) {
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        onHide();
      }}
    >
      <Input autoFocus className="h-[24px] w-[220px]" value={why} placeholder="Why (optional)" onChange={(e) => setWhy(e.target.value)} />
      <Button size="sm" variant="secondary" type="submit" disabled={pending}>
        Hide
      </Button>
      <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

const TONE: Record<string, string> = {
  accent: "border-accent/40 bg-accent-soft/40",
  warn: "border-warn/35 bg-warn-soft",
  danger: "border-danger/30 bg-danger-soft",
  ok: "border-ok/35 bg-ok-soft",
  muted: "border-line bg-surface-2",
};

function Block({ tone, title, children }: { tone: keyof typeof TONE; title: string; children: React.ReactNode }) {
  return (
    <div className={cx("flex flex-col gap-1 rounded-md border px-3 py-2", TONE[tone])}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.045em] text-ink-2">{title}</div>
      {children}
    </div>
  );
}

function PastBlock({
  l,
  canWrite,
  pending,
  act,
  openBench,
}: {
  l: TodoListing;
  canWrite: boolean;
  pending: boolean;
  act: (fn: () => Promise<{ error: string | null; count?: number }>, done: (n: number) => string) => void;
  openBench: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Block tone="muted" title={`Options for exams that have passed (${l.pastAttempts.length})`}>
      <p className="text-ink-3">
        BB no longer sells these: {l.pastAttempts.slice(0, 6).map((v) => v.title).join(" · ")}
        {l.pastAttempts.length > 6 ? " …" : ""}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {canWrite ? (
          confirm ? (
            <>
              <span className="text-danger">Delete {l.pastAttempts.length} variants from the listing on Shopify?</span>
              <Button
                size="sm"
                variant="danger"
                disabled={pending}
                onClick={() => {
                  setConfirm(false);
                  act(() => removeVariants(l.pid, l.pastAttempts.map((v) => v.id)), (n) => `Removed ${n} variants from the listing.`);
                }}
              >
                Yes, delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                No
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirm(true)}>
              Remove them
            </Button>
          )
        ) : null}
        <Button size="sm" variant="ghost" onClick={openBench}>
          Or change the attempt (e.g. May-26 → May-27) in Batches &amp; options
        </Button>
      </div>
    </Block>
  );
}
