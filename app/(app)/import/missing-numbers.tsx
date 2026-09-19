"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, ErrorNote, Input, MobileInput, cx } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

import {
  resolveHeldCheckout,
  type HeldOutcome,
  type HeldRow,
  type ResolvedHeldRow,
} from "./actions";

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
export function MissingNumbers({
  rows,
  resolved,
}: {
  rows: HeldRow[];
  resolved: ResolvedHeldRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /**
   * §55.6. The outcome stays until it is dismissed.
   *
   * It used to be a line of text that the next render replaced. The one moment
   * somebody learns that filling in a number just took a lead off a
   * colleague's day is this one, and a message that clears itself is a message
   * for whoever happened to be looking.
   */
  const [toast, setToast] = useState<HeldOutcome | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  /**
   * §55.5. The number is already somebody's, and this asks before attaching.
   *
   * Held rather than confirmed inline because the answer is a fact about two
   * people — the one in Calman and the one on the checkout — and both names
   * have to be on screen for the question to mean anything.
   */
  const [confirm, setConfirm] = useState<{
    id: string;
    mobile: string;
    existingName: string;
    checkoutName: string;
  } | null>(null);

  function run(
    id: string,
    fn: () => Promise<{
      error: string | null;
      outcome?: HeldOutcome;
      confirmExisting?: { existingName: string; checkoutName: string };
    }>,
    mobile?: string,
  ) {
    setError(null);
    setBusyId(id);
    start(async () => {
      const res = await fn();
      setBusyId(null);
      if (res.error) {
        setError(res.error);
        return;
      }
      if (res.confirmExisting) {
        setConfirm({ id, mobile: mobile ?? "", ...res.confirmExisting });
        return;
      }
      setConfirm(null);
      if (res.outcome) setToast(res.outcome);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {toast ? <OutcomeToast outcome={toast} onDismiss={() => setToast(null)} /> : null}

      {confirm ? (
        <div
          role="alertdialog"
          aria-label="This number already belongs to somebody"
          data-testid="attach-confirm"
          className="rounded-lg border border-warn/50 bg-warn-soft/40 px-4 py-3 shadow-card"
        >
          <p className="text-[13px] text-ink">
            This number is already{" "}
            <strong className="font-semibold">{confirm.existingName}</strong>.
            Attach this checkout to them?
          </p>
          <p className="mt-1 text-[11.5px] text-ink-2">
            The checkout is in the name of {confirm.checkoutName}.{" "}
            {confirm.existingName} keeps their name either way — only the
            checkout is attached.
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={pending}
              onClick={() =>
                run(
                  confirm.id,
                  () =>
                    resolveHeldCheckout({
                      id: confirm.id,
                      mobile: confirm.mobile,
                      attachToExisting: true,
                    }),
                  confirm.mobile,
                )
              }
            >
              Attach
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => setConfirm(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {/* §55.6. The empty state no longer takes the whole component over:
          the outcome of the last fill and the Resolved list below it are the
          two things somebody comes back to this tab for, and they outlive the
          queue being empty. */}
      {rows.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface px-4 py-6 text-center text-[12.5px] text-ink-3">
          Nothing waiting. Checkouts with no usable phone number land here.
        </p>
      ) : (
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
                          run(
                            r.id,
                            () => resolveHeldCheckout({ id: r.id, mobile: draft }),
                            draft,
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
      )}

      {rows.length ? (
        <p className="text-[11.5px] text-ink-3">
          Saving a number puts the checkout through the ordinary import rules —
          the same duplicate handling, the same parser, and the arrival time the
          file gave it.
        </p>
      ) : null}

      <ResolvedList rows={resolved} />
    </div>
  );
}

/**
 * §55.6. The outcome of the last fill, until somebody dismisses it.
 *
 * Two lines, the same two the import review shows: what the number was, and
 * what the fill did about it. The second is the one that matters — it is the
 * only place a counsellor is told they have taken a lead off a colleague.
 */
function OutcomeToast({
  outcome,
  onDismiss,
}: {
  outcome: HeldOutcome;
  onDismiss: () => void;
}) {
  const tone =
    outcome.tone === "ok"
      ? "border-ok/50 bg-ok-soft/40"
      : outcome.tone === "warn"
        ? "border-warn/50 bg-warn-soft/40"
        : "border-accent/40 bg-accent-soft/30";

  return (
    <div
      role="status"
      data-testid="fill-outcome"
      className={cx("flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg border px-4 py-3 shadow-card", tone)}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-ink">
          {outcome.mobile ? (
            <span className="tabular-nums">{outcome.mobile} · </span>
          ) : null}
          {outcome.label}
        </p>
        <p className="mt-0.5 text-[12.5px] text-ink-2" data-testid="fill-outcome-action">
          {outcome.action}
        </p>
      </div>
      <Button size="sm" variant="ghost" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}

/** §55.6. The last twenty fills, so the tab has a memory. */
function ResolvedList({ rows }: { rows: ResolvedHeldRow[] }) {
  if (!rows.length) return null;
  return (
    <section>
      <h3 className="mb-1.5 text-[12.5px] font-semibold text-ink">
        Resolved ({rows.length})
      </h3>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full min-w-[860px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="w-[130px] px-1.5 py-[7px]">Number</th>
              <th className="w-[130px] px-1.5 py-[7px]">Checkout</th>
              <th className="px-1.5 py-[7px]">Outcome</th>
              <th className="w-[140px] px-1.5 py-[7px]">By</th>
              <th className="w-[130px] px-1.5 py-[7px]">When</th>
            </tr>
          </thead>
          <tbody data-testid="resolved-list">
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-b-0 [&>td]:align-top">
                <td className="px-1.5 py-[6px] tabular-nums text-ink">
                  {r.resolved_mobile ?? <span className="text-ink-3">—</span>}
                </td>
                <td className="px-1.5 py-[6px] tabular-nums text-ink-3">
                  {r.checkout_ref}
                </td>
                <td className="px-1.5 py-[6px] break-words text-ink-2">
                  <span className="block text-ink">{r.resolution_label ?? r.resolution}</span>
                  {r.resolution_action ? (
                    <span className="block text-ink-2">{r.resolution_action}</span>
                  ) : null}
                </td>
                <td className="px-1.5 py-[6px] text-ink-2">{r.resolved_by_name ?? "—"}</td>
                <td className="px-1.5 py-[6px] whitespace-nowrap text-ink-3">
                  {r.resolved_at ? formatDateTime(r.resolved_at) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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
