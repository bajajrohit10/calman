"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, CARD, ErrorNote, cx } from "@/components/ui";
import type { Todo } from "@/lib/price-check/todo";

import { confirmListing, deleteRule, fixPrices, setRule } from "./todo-actions";
import { removeVariants } from "./workbench-actions";

/**
 * Settings → Links → To do: "Common causes". Groups of To do items that one
 * answer settles; an answer about a kind of option is saved as a rule and keeps
 * applying on every refresh (see the Rules list, where it can be undone).
 */

const rupees = (n: number | null | undefined) => (n == null ? "—" : `₹${n.toLocaleString("en-IN")}`);

export function CausesView({ todo, canWrite }: { todo: Todo; canWrite: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const c = todo.causes;

  function run(fn: () => Promise<{ error: string | null }>, msg: string) {
    setErr(null);
    setOk(null);
    setSure(null);
    start(async () => {
      const r = await fn();
      if (r.error) setErr(r.error);
      else setOk(msg);
      router.refresh();
    });
  }

  const total = c.optionTypes.reduce((n, t) => n + t.count, 0) + c.past.count + c.confirm.reduce((n, g) => n + g.listings.length, 0) + c.priceDown.count;
  if (!total && !todo.rules.length) return null;

  return (
    <div className={cx(CARD, "flex flex-col gap-2 p-3 text-[12px]")}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[13px] font-semibold text-ink">Common causes</span>
        <span className="text-ink-3">One answer settles many items. Answers about a kind of option are saved as rules and apply on every refresh.</span>
      </div>
      {err ? <ErrorNote>{err}</ErrorNote> : null}
      {ok ? <div className="rounded-md border border-ok/35 bg-ok-soft px-3 py-2 text-ok">{ok}</div> : null}
      {busy ? <div className="text-ink-2">{busy}</div> : null}

      {c.optionTypes.map((t) => (
        <Row key={t.key}>
          <div className="text-ink">
            BB sells <b>{t.count}</b> “{t.label}” option{t.count === 1 ? "" : "s"} you don&apos;t have, on {t.listings.length} listing{t.listings.length === 1 ? "" : "s"}.{" "}
            <b>Does Zeroinfy sell {t.label.replace(/ \(.*\)$/, "")}?</b>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => setRule("option_type", t.key, "never_sell", ""), `Rule saved: Zeroinfy never sells ${t.label}. ${t.count} items hidden.`)}>
              No — hide them everywhere
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setRule("option_type", t.key, "sell", ""), `Rule saved: Zeroinfy sells ${t.label}. They stay under “Add on Zeroinfy”.`)}>
              Yes, we sell these
            </Button>
            <Preview open={open} setOpen={setOpen} id={`t-${t.key}`}>
              {t.listings.map((l) => (
                <div key={l.pid} className="py-0.5">
                  <b>{l.title}</b>: {l.labels.slice(0, 3).join(" · ")}
                  {l.labels.length > 3 ? ` (+${l.labels.length - 3})` : ""}
                </div>
              ))}
            </Preview>
          </div>
        </Row>
      ))}

      {c.past.count ? (
        <Row>
          <div className="text-ink">
            <b>{c.past.count}</b> variants are for exams that have passed, on {c.past.listings.length} listings. <b>Remove them all from Zeroinfy?</b>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canWrite ? (
              sure === "past" ? (
                <>
                  <span className="text-danger">Delete {c.past.count} variants on Shopify?</span>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        let n = 0;
                        const errs: string[] = [];
                        for (const [i, l] of c.past.listings.entries()) {
                          setBusy(`Removing… ${i + 1} / ${c.past.listings.length}`);
                          const r = await removeVariants(l.pid, l.variants.map((v) => v.id));
                          if (r.error) errs.push(`${l.title}: ${r.error}`);
                          else n += r.count ?? 0;
                        }
                        setBusy(null);
                        return { error: errs.length ? `Removed ${n}; ${errs.length} listings need a look — ${errs.slice(0, 3).join(" · ")}` : null };
                      }, `Removed the passed-attempt variants.`)
                    }
                  >
                    Yes, delete
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSure(null)}>
                    No
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => setSure("past")}>
                  Remove all {c.past.count}
                </Button>
              )
            ) : null}
            <Preview open={open} setOpen={setOpen} id="past">
              {c.past.listings.map((l) => (
                <div key={l.pid} className="py-0.5">
                  <b>{l.title}</b>: {l.variants.map((v) => v.title).join(" · ")}
                </div>
              ))}
            </Preview>
          </div>
          <div className="text-[11px] text-ink-3">A listing where every variant has passed is skipped (Shopify needs at least one variant) — archive those in Shopify.</div>
        </Row>
      ) : null}

      {c.confirm.map((g) => (
        <Row key={g.reason}>
          <div className="text-ink">
            <b>{g.listings.length}</b> listings wait for the same check: <i>{g.reason}</i> <b>Are they right?</b>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  for (const l of g.listings) {
                    const r = await confirmListing(l.pid);
                    if (r.error) return r;
                  }
                  return { error: null };
                }, `Confirmed ${g.listings.length} listings.`)
              }
            >
              Yes — confirm all {g.listings.length}
            </Button>
            <span className="text-ink-3">If not, open them one by one under “4. Confirm BB match”.</span>
            <Preview open={open} setOpen={setOpen} id={`c-${g.reason}`}>
              {g.listings.map((l) => (
                <div key={l.pid} className="py-0.5">
                  {l.title} ({l.count} variants)
                </div>
              ))}
            </Preview>
          </div>
        </Row>
      ))}

      {c.priceDown.count ? (
        <Row>
          <div className="text-ink">
            BB is now <b>cheaper</b> than Zeroinfy on <b>{c.priceDown.count}</b> variants ({c.priceDown.listings.length} listings). <b>Lower ours to BB&apos;s price?</b>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canWrite ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const items = c.priceDown.listings.flatMap((l) =>
                      l.fixes.map((f) => ({ pid: l.pid, title: l.title, linkId: f.linkId, variantId: f.variantId, price: f.expected, compareAt: Math.max(f.compareAt ?? 0, f.vendorPrice) })),
                    );
                    const r = await fixPrices(items);
                    if (r.error) return r;
                    return setRule("price_down", "all", "follow_bb", "");
                  }, `Lowered ${c.priceDown.count} prices to BB's.`)
                }
              >
                Yes — lower them all
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setRule("price_down", "all", "keep_ours", ""), "Rule saved: when BB is cheaper, Zeroinfy keeps its price.")}>
              No — keep ours when BB is cheaper
            </Button>
            <Preview open={open} setOpen={setOpen} id="down">
              {c.priceDown.listings.map((l) => (
                <div key={l.pid} className="py-0.5">
                  <b>{l.title}</b>: {l.fixes.map((f) => `${f.variantTitle} ${rupees(f.current)} → ${rupees(f.expected)}`).join(" · ")}
                </div>
              ))}
            </Preview>
          </div>
        </Row>
      ) : null}

      {todo.rules.length ? (
        <details className="text-[11.5px]">
          <summary className="cursor-pointer text-ink-2">Rules in force ({todo.rules.length})</summary>
          <table className="mt-1 w-full">
            <tbody>
              {todo.rules.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="py-1 pr-2">{r.label}</td>
                  <td className="py-1 pr-2 font-semibold">
                    {r.answer === "never_sell" ? "Never sell — hidden" : r.answer === "sell" ? "We sell these" : r.answer === "keep_ours" ? "Keep ours" : "Follow BB"}
                  </td>
                  <td className="py-1 pr-2 text-ink-3">{r.settles ? `settles ${r.settles} now` : ""}</td>
                  <td className="py-1 pr-2 text-ink-3">{new Date(r.decidedAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}</td>
                  <td className="py-1 text-right">
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => deleteRule(r.id), "Rule removed; its items are back on the list.")}>
                      Undo
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1 rounded-md border border-accent/30 bg-accent-soft/30 px-3 py-2">{children}</div>;
}

function Preview({ id, open, setOpen, children }: { id: string; open: string | null; setOpen: (s: string | null) => void; children: React.ReactNode }) {
  return (
    <>
      <button type="button" className="text-[11.5px] text-accent hover:underline" onClick={() => setOpen(open === id ? null : id)}>
        {open === id ? "Hide list" : "See which"}
      </button>
      {open === id ? <div className="basis-full max-h-[260px] overflow-auto rounded border border-line bg-surface px-2 py-1 text-[11.5px] text-ink-2">{children}</div> : null}
    </>
  );
}
