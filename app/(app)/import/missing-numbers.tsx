"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, ErrorNote, Input, MobileInput, cx } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

import { resolveHeldCheckout, type HeldRow } from "./actions";

const OUTCOME_WORDS: Record<string, string> = {
  import: "imported as a new lead",
  re_enquire: "added to the lead they already had",
  supersede: "imported; the closed enquiry was superseded",
  discarded: "discarded",
};

/**
 * §55.3. The checkouts nobody can ring.
 *
 * A Shopify checkout with no usable phone number is a real person who filled a
 * cart, and throwing it away because one field was blank loses them. Equally it
 * cannot become an enquiry: a lead with no number sits in every list as work
 * nobody can do. So it waits here until somebody who recognises the name — a
 * counsellor, usually, which is why this is not admin-only — finds the number.
 *
 * Rows persist across batches. Tomorrow's file will carry the same checkout
 * again and the dedupe on checkout_ref keeps it from being held twice.
 */
export function MissingNumbers({ rows }: { rows: HeldRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  function run(id: string, fn: () => Promise<{ error: string | null; outcome?: string }>) {
    setError(null);
    setNote(null);
    setBusyId(id);
    start(async () => {
      const res = await fn();
      setBusyId(null);
      if (res.error) setError(res.error);
      else {
        setNote(
          res.outcome
            ? `Done — ${OUTCOME_WORDS[res.outcome] ?? res.outcome}.`
            : "Done.",
        );
        router.refresh();
      }
    });
  }

  if (!rows.length) {
    return (
      <p className="rounded-lg border border-line bg-surface px-4 py-6 text-center text-[12.5px] text-ink-3">
        Nothing waiting. Checkouts with no usable phone number land here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {note ? <p className="text-[12.5px] text-ok">{note}</p> : null}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full min-w-[980px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="w-[150px] px-1.5 py-[7px]">Name</th>
              <th className="w-[200px] px-1.5 py-[7px]">Email</th>
              <th className="w-[130px] px-1.5 py-[7px]">Created at</th>
              <th className="px-1.5 py-[7px]">Product text</th>
              <th className="w-[140px] px-1.5 py-[7px]">Checkout Id</th>
              <th className="w-[150px] px-1.5 py-[7px]">Mobile</th>
              <th className="w-[150px] px-1.5 py-[7px]">Action</th>
            </tr>
          </thead>
          <tbody data-testid="missing-numbers">
            {rows.map((r) => {
              const draft = drafts[r.id] ?? "";
              const busy = pending && busyId === r.id;
              return (
                <tr key={r.id} className="border-b border-line last:border-b-0 [&>td]:align-top">
                  <td className="px-1.5 py-[6px] text-ink">
                    {r.name || <span className="italic text-ink-3">no name</span>}
                  </td>
                  <td className="px-1.5 py-[6px] break-words text-ink-2">{r.email ?? "—"}</td>
                  <td className="px-1.5 py-[6px] text-ink-3">
                    {r.arrived_at ? formatDateTime(r.arrived_at) : "—"}
                  </td>
                  <td className="px-1.5 py-[6px] whitespace-pre-wrap break-words text-ink-2">
                    {r.product_text ?? "—"}
                    {/* What the file actually offered, so somebody can see
                        whether it was blank or simply not a mobile. */}
                    {r.raw_phones?.length ? (
                      <span className="mt-0.5 block text-[11px] text-warn">
                        file had: {r.raw_phones.join(", ")}
                      </span>
                    ) : (
                      <span className="mt-0.5 block text-[11px] text-ink-3">
                        no phone in the file
                      </span>
                    )}
                  </td>
                  <td className="px-1.5 py-[6px] tabular-nums text-ink-3">
                    {r.checkout_ref}
                  </td>
                  <td className="px-1.5 py-[6px]">
                    <MobileInput
                      name={`mobile-${r.id}`}
                      aria-label={`Mobile for checkout ${r.checkout_ref}`}
                      value={draft}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [r.id]: e.target.value }))
                      }
                    />
                  </td>
                  <td className="px-1.5 py-[6px]">
                    <span className="flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busy || draft.replace(/\D/g, "").length !== 10}
                        onClick={() =>
                          run(r.id, () =>
                            resolveHeldCheckout({ id: r.id, mobile: draft }),
                          )
                        }
                      >
                        {busy ? "Saving…" : "Save"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          run(r.id, () =>
                            resolveHeldCheckout({
                              id: r.id,
                              discard: true,
                              reason: "No number could be found.",
                            }),
                          )
                        }
                      >
                        Discard
                      </Button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11.5px] text-ink-3">
        Saving a number puts the checkout through the ordinary import rules —
        the same duplicate handling, the same parser, and the arrival time the
        file gave it.
      </p>
    </div>
  );
}

/** The tab strip above the importer (§55.3). */
export function ImportTabs({
  active,
  heldCount,
}: {
  active: "upload" | "missing";
  heldCount: number;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-line">
      {[
        { key: "upload" as const, label: "Upload", href: "/import" },
        { key: "missing" as const, label: "Missing number", href: "/import?tab=missing" },
      ].map((t) => (
        <a
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={cx(
            "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors",
            active === t.key
              ? "border-accent font-medium text-ink"
              : "border-transparent text-ink-2 hover:text-ink",
          )}
        >
          {t.label}
          {t.key === "missing" && heldCount > 0 ? (
            <span className="rounded-[9px] bg-warn px-1.5 text-[10.5px]/[16px] font-semibold text-white">
              {heldCount}
            </span>
          ) : null}
        </a>
      ))}
    </div>
  );
}
