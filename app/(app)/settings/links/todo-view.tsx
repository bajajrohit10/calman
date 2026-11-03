"use client";

import { createContext, useContext, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, CARD, ErrorNote, Input, cx } from "@/components/ui";
import type { MissingGroup, PriceFix, Todo, TodoListing } from "@/lib/price-check/todo";
import { productUrl } from "@/lib/price-check/vendor-groups";

import { finishRefresh, ignoreGap, refreshVendorOptions, vendorProductsToRefresh } from "./gap-actions";
import { answerAttempt, confirmListing, dismissChoices, fixPrices, ignoreOptions, refreshListing, refreshShopify, setKeepPrice, shopifyProductsToRefresh, type PriceFixIn } from "./todo-actions";
import { CausesView } from "./causes-view";
import { Workbench } from "./workbench";
import { addAttemptAuto, linkPastedProduct, removeVariants, retargetLink } from "./workbench-actions";

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
  { key: "batch", label: "2. Batch or books differ", count: (t) => t.counts.batch },
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

/** The vendor this view is about ("BB", "Vsmart"), for the wording of every block. */
const VendorCtx = createContext({ V: "BB", VSITE: "bbvirtuals.com" });

export function TodoView({ todo, canWrite, vendor = "BB", vendorSite = "bbvirtuals.com" }: { todo: Todo; canWrite: boolean; vendor?: string; vendorSite?: string }) {
  const V = vendor;
  const VSITE = vendorSite;
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [pending, start] = useTransition();

  const shown = useMemo(
    () => {
      const needle = q.trim().toLowerCase();
      // Under "Add on Zeroinfy" the search also matches BB option names (e.g. "pendrive").
      const hit = (l: TodoListing) =>
        l.title.toLowerCase().includes(needle) || (filter === "missing" && l.missing.some((g) => g.options.some((o) => o.label.toLowerCase().includes(needle))));
      return todo.listings.filter((l) => has(l, filter) && (!needle || hit(l)));
    },
    [todo, filter, q],
  );
  const shownFixes = shown.flatMap((l) => l.priceFixes.map((f) => toFix(l, f)));
  const [confirmAtt, setConfirmAtt] = useState(false);
  const clearAttempts = shown.flatMap((l) => l.missing.filter((g) => g.auto?.ok).map((g) => ({ pid: l.pid, title: l.title, siteId: g.siteId, slug: g.slug })));

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
        setBusy(`Reading ${V} pages… ${Math.min(i + 8, v.items.length)} / ${v.items.length}`);
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
    <VendorCtx.Provider value={{ V, VSITE }}>
    <div className="flex flex-col gap-3">
      {todo.error ? <ErrorNote>{todo.error}</ErrorNote> : null}
      {note ? <ErrorNote>{note}</ErrorNote> : null}
      {ok ? <div className="rounded-md border border-ok/35 bg-ok-soft px-3 py-2 text-[12.5px] text-ok">{ok}</div> : null}

      <CausesView todo={todo} canWrite={canWrite} />

      <div className={cx(CARD, "flex flex-col gap-2 p-3")}>
        <div className="flex flex-wrap items-center gap-1">
          {FILTERS.map((f) => (
            <Button key={f.key} size="sm" variant={filter === f.key ? "primary" : "secondary"} onClick={() => setFilter(f.key)}>
              {f.label.replace(/\bBB\b/, V)} ({f.count(todo)})
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <Input className="h-[26px] w-[260px]" value={q} placeholder={filter === "missing" ? `Search listing or ${V} option (e.g. pendrive)…` : "Search listing…"} onChange={(e) => setQ(e.target.value)} />
          <span className="text-ink-3">
            Zeroinfy prices read {when(todo.shopifyReadAt)} · {V} read {when(todo.vendorReadAt)}
          </span>
          <Button size="sm" variant="secondary" className="ml-auto" disabled={!!busy} onClick={refreshAll}>
            {busy ?? "Refresh everything (~5 min)"}
          </Button>
          {canWrite && clearAttempts.length ? (
            confirmAtt ? (
              <>
                <span className="text-ink-2">Add {clearAttempts.length} attempts on zeroinfy.in?</span>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending}
                  onClick={() => {
                    setConfirmAtt(false);
                    act(async () => {
                      let n = 0;
                      const errs: string[] = [];
                      for (const c of clearAttempts) {
                        const r = await addAttemptAuto(c.pid, c.siteId, c.slug);
                        if (r.error) errs.push(`${c.title}: ${r.error}`);
                        else n += r.count ?? 0;
                      }
                      return { error: errs.length ? `Added ${n} variants; ${errs.length} failed — ${errs.slice(0, 3).join(" · ")}` : null, count: n };
                    }, (n) => `Added ${n} variants on Shopify (clear attempts) and linked them.`);
                  }}
                >
                  Yes, add them
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmAtt(false)}>
                  No
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => setConfirmAtt(true)}>
                Add all clear attempts ({clearAttempts.length})
              </Button>
            )
          ) : null}
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

      <p className="text-[12px] text-ink-3">Work through the filters in number order: settle the {V} link and batch first, add or remove variants, fix prices last. {shown.length} listings. {V === "BB" ? "Zeroinfy price = BB price (BB’s offer ended 27 Oct)." : `Zeroinfy price = ${V}’s price after its automatic coupon.`}</p>

      {shown.map((l) => (
        <ListingCard key={l.pid} l={l} canWrite={canWrite} pending={pending} act={act} />
      ))}
    </div>
    </VendorCtx.Provider>
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
  const { V, VSITE } = useContext(VendorCtx);
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
          title={`Re-read this listing from Shopify and its ${V} products from ${VSITE}`}
          onClick={() => act(() => refreshListing(l.pid), () => `Refreshed this listing from Shopify and ${V}.`)}
        >
          ↻ Refresh
        </Button>
        <Button size="sm" variant={bench ? "primary" : "ghost"} onClick={() => setBench(bench ? null : "open")}>
          Batches &amp; options
        </Button>
      </div>

      {l.attemptQuestion ? (
        <Block tone="accent" title={`Which ${V} product do these variants resell?`}>
          <p className="text-ink-3">
            More than one {V} product matches by name (subjects, batch type, teachers, attempt), or the titles disagree. Open them on {V} (↗), then pick the one that is the same course. Any {V} attempt you don&apos;t sell
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
                    <a href={productUrl(c.siteUrl, c.slug)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      {c.productTitle ?? c.slug} ↗
                    </a>
                    <span className="text-ink-3">
                      {c.attempts} · {V} {rupees(c.price)}
                    </span>
                    {c.label ? <div className="basis-full pl-[86px] text-[11.5px] text-ink-2">{V} batch: {c.label}</div> : null}
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
                      (n) => `Linked ${n} variants to that ${V} product. Now pick the matching ${V} option for each one below.`,
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
        <Block tone="accent" title={`Not linked to ${V} yet (${l.unlinked.length})`}>
          <p className="text-ink-2">
            {l.unlinked.slice(0, 6).map((v) => v.title).join(" · ")}
            {l.unlinked.length > 6 ? " …" : ""}
          </p>
          <p className="text-ink-3">Pick the {V} option each one resells in Batches &amp; options. If {V} doesn&apos;t sell it (e.g. without books), choose “Zeroinfy-only option”. If the {V} product isn&apos;t listed, paste its link there.</p>
          <Button size="sm" variant="secondary" className="self-start" onClick={() => setBench("open")}>
            Link in Batches &amp; options
          </Button>
        </Block>
      ) : null}

      {l.batchMismatch.length ? (
        <Block tone="warn" title={`Batch or books don't match the linked ${V} option`}>
          {l.batchMismatch.map((b) => (
            <div key={b.linkId} className="flex flex-col gap-1 border-t border-line pt-1 first:border-0 first:pt-0">
              <div className="text-ink">
                {b.variantTitle} <span className="text-ink-3">— {b.why === "books" ? `Zeroinfy says ${b.ziDates}` : `Zeroinfy batches: ${b.ziDates}`}</span>
              </div>
              <div className="text-ink-3">Linked now: {b.currentLabel || "—"}</div>
              <div className="text-ink-2">
                Same {V} product, {b.why === "books" ? "matching books (E-Book / without books = without Hard Copy)" : "matching batches"}: <b>{b.suggestLabel}</b> · {V} {rupees(b.suggestPrice)}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => act(() => retargetLink(b.linkId, b.slug, b.suggestId, b.suggestLabel, b.productTitle), () => `Switched to the ${V} option with the same batches.`)}
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
        <Block tone="warn" title={`Confirm the ${V} match (${l.confirm.count} variants)`}>
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
        <Block tone="danger" title={`${V} no longer lists the option these variants are linked to`}>
          {l.dropped.map((d) => (
            <div key={d.label} className="flex flex-col gap-1 border-t border-line pt-1 first:border-0 first:pt-0">
              <div className="text-ink-2">
                <s>{d.label}</s> · {d.variants} variant{d.variants === 1 ? "" : "s"}
              </div>
              {d.replacement ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ink">
                    {V} now sells instead: <b>{d.replacement.changed}</b> · {V} {rupees(d.replacement.price)}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() =>
                      act(async () => {
                        for (const id of d.linkIds) {
                          const r = await retargetLink(id, d.slug, d.replacement!.id, d.replacement!.label, d.productTitle);
                          if (r.error) return r;
                        }
                        return { error: null, count: d.linkIds.length };
                      }, (n) => `Re-pointed ${n} variants. Rename the batch on Zeroinfy in Batches & options if its name should change too.`)
                    }
                  >
                    Re-point to it
                  </Button>
                </div>
              ) : (
                <span className="text-ink-3">No single replacement on {V} — re-point or remove these variants in Batches &amp; options.</span>
              )}
            </div>
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
                    {V} {rupees(f.vendorPrice)} · {f.rule}
                    {!f.confirmed ? ` · ${V} match not confirmed yet` : ""}
                    <div className="truncate max-w-[420px]" title={f.vendorLabel}>
                      <a href={f.vendorUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                        {f.vendorTitle ?? `${V} product`} ↗
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
                      title={`Our price is different on purpose (e.g. includes books). Stop checking this variant against ${V}.`}
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
            {l.priceFixes.length > 1 ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                title={`All these prices are different on purpose: stop checking them against ${V}`}
                onClick={() => act(() => setKeepPrice(l.priceFixes.map((f) => f.linkId), true, ""), (n) => `Kept our price for ${n} variants.`)}
              >
                Keep our price for all {l.priceFixes.length}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setBench("open")}>
              Wrong {V} option? Change it
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
  const { V } = useContext(VendorCtx);
  const title = g.kind === "attempt" ? `${V} also sells this for ${g.attempts ?? "another attempt"} — not on Zeroinfy` : `New batch / mode on ${V} — not on Zeroinfy`;
  return (
    <Block tone="ok" title={title}>
      <a href={productUrl(g.siteUrl, g.slug)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
        {g.productTitle ?? g.slug}
      </a>
      {g.auto?.ok ? (
        <div className="flex flex-wrap items-center gap-2 rounded border border-ok/40 bg-surface px-2 py-1">
          <span className="text-ink">
            Clear case: add <b>{g.auto.newValue}</b> with the same options as “{g.auto.baseValue}” — {g.auto.items.length} variant{g.auto.items.length === 1 ? "" : "s"} at {V}&apos;s prices (
            {[...new Set(g.auto.items.map((i) => rupees(i.price)))].join(", ")}).
          </span>
          {canWrite ? (
            <Button size="sm" variant="primary" disabled={pending} onClick={() => act(() => addAttemptAuto(l.pid, g.siteId, g.slug), (n) => `Added ${n} variants on Shopify and linked them.`)}>
              Add it on Zeroinfy
            </Button>
          ) : null}
        </div>
      ) : g.auto ? (
        <div className="text-ink-3">Needs a person: {g.auto.why}</div>
      ) : null}
      {g.options.map((o) => (
        <div key={o.variantId} className="flex flex-wrap items-center gap-2">
          <span className="text-ink">{o.label}</span>
          <span className="text-ink-3">
            {V} {rupees(o.price)} → add at {rupees(o.expected)}
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
  const { V } = useContext(VendorCtx);
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (link.trim()) onUse(link.trim());
      }}
    >
      <span className="text-ink-2">Found the right one yourself?</span>
      <Input className="h-[26px] w-[420px] max-w-full" value={link} placeholder={`Paste the ${V} product link`} onChange={(e) => setLink(e.target.value)} />
      <Button size="sm" variant="secondary" type="submit" disabled={pending || !link.trim()}>
        Use this {V} product
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
  const { V } = useContext(VendorCtx);
  return (
    <Block tone="muted" title={`Options for exams that have passed (${l.pastAttempts.length})`}>
      <p className="text-ink-3">
        {V} no longer sells these: {l.pastAttempts.slice(0, 6).map((v) => v.title).join(" · ")}
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
