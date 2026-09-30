"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Select } from "@/components/ui";

import { changeSaleCredit } from "./actions";

/**
 * §77.3, extended by §79. Who a sale belongs to, on one row of the history.
 *
 * A client island inside a server-rendered table, the same shape as the Edit
 * control beside it: the table has no state and should not acquire any, and the
 * picker only exists for the one row somebody is correcting.
 *
 * §77.3 put this on the call panel's own Previous-calls list and nowhere else.
 * That is the wrong place for it to live alone — the panel is open while you are
 * making a call, and correcting an attribution is something you do afterwards,
 * from the student's history, usually because a report showed the wrong name. So
 * the enquiry page had the mistake visible and no way to fix it.
 *
 * Shown whoever is reading, because a counsellor should be able to see that a
 * sale of theirs went to somebody else. The change control is the admins', for
 * the §77.3 reason: they are the ones reading the report that made it visible.
 */
export function SaleCreditCell({
  callId,
  callerName,
  creditedToId,
  creditedToName,
  escalatees,
  viewerIsAdmin,
}: {
  callId: number;
  callerName: string | null;
  creditedToId: string | null;
  creditedToName: string | null;
  escalatees: { id: string; name: string }[];
  viewerIsAdmin?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();

  return (
    <span className="mt-0.5 block text-[11px] text-ink-3" data-testid="sale-credit">
      credited to{" "}
      <span className="text-ink-2">{creditedToName ?? callerName ?? "the caller"}</span>
      {viewerIsAdmin ? (
        <>
          {" "}
          <button
            type="button"
            disabled={saving}
            onClick={() => setOpen((v) => !v)}
            className="underline-offset-2 hover:text-ink hover:underline disabled:opacity-60"
          >
            change
          </button>
          {open ? (
            <Select
              aria-label="Credit the sale to"
              value={creditedToId ?? ""}
              disabled={saving}
              onChange={(e) => {
                const to = e.target.value || null;
                setOpen(false);
                startTransition(async () => {
                  const res = await changeSaleCredit({ callId, creditedTo: to });
                  setError(res.error ?? null);
                  // The cell is server-rendered from the row, so the new name
                  // only appears once the page has re-read it.
                  if (!res.error) router.refresh();
                });
              }}
              className="ml-1 mt-1 inline-block w-[170px]"
            >
              <option value="">{callerName ?? "the caller"} (caller)</option>
              {escalatees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          ) : null}
          {/* A refused write says so on the row it was refused on: the action
              is admin-only in the database too, so this is reachable. */}
          {error ? <span className="ml-1 text-danger">{error}</span> : null}
        </>
      ) : null}
    </span>
  );
}
