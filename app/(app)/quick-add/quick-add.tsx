"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { CallLogPanel, type PanelEnquiry, type PanelMasters } from "@/components/call-log/panel";
import { loadPanelEnquiry } from "@/components/call-log/actions";
import { StudentHistoryView } from "@/components/student-history";
import { Button, ErrorNote } from "@/components/ui";
import type { StudentHistory } from "@/lib/students";

import { lookupMobile } from "./actions";
import { QuickAddGrid } from "./grid";

export type QuickAddMasters = PanelMasters & {
  sources: { id: string; name: string }[];
  terms: { id: string; name: string }[];
};

/**
 * §30.1. Quick Add is the grid, and the call window the grid opens.
 *
 * The single-number box that used to live here has gone. It was the same three
 * steps as one row of the grid — type the number, see what Calman knows,
 * decide what to do — done on a screen of its own, which meant two
 * implementations of §10.1's rules and two places for a change to be forgotten.
 * The phone ringing is now the first row.
 *
 * The call window is reached from a row rather than being a stage of the box:
 * every filled row is saved first (so nothing typed is lost to opening a
 * call), then this loads the enquiry that row became and hands it to the same
 * panel My Day uses.
 */
export function QuickAdd({
  masters,
  counsellorName,
  escalatees,
  viewerId,
  viewerIsAdmin,
}: {
  masters: QuickAddMasters;
  counsellorName: string | null;
  /** §45.3: every active user, for the escalate-to picker on a new ticket. */
  escalatees: { id: string; name: string }[];
  /** §29.4: who is looking, so a call row in the history knows if it is theirs. */
  viewerId: string | null;
  viewerIsAdmin: boolean;
}) {
  const [logging, setLogging] = useState<{
    enquiry: PanelEnquiry;
    student: StudentHistory | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startLoad] = useTransition();

  function openCall(enquiryId: number, mobile: string) {
    setError(null);
    startLoad(async () => {
      // Both at once: the panel needs the enquiry, the history below it needs
      // the student, and neither waits on the other.
      const [panel, history] = await Promise.all([
        loadPanelEnquiry(enquiryId),
        lookupMobile(mobile),
      ]);
      if (panel.error || !panel.enquiry) {
        setError(panel.error ?? "Could not open that enquiry.");
        return;
      }
      setLogging({ enquiry: panel.enquiry, student: history.student });
    });
  }

  function close() {
    setLogging(null);
    setError(null);
  }

  if (logging) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <Button size="sm" variant="ghost" onClick={close}>
            ← Back to the grid
          </Button>
        </div>
        <CallLogPanel
          enquiry={logging.enquiry}
          masters={masters}
          counsellorName={counsellorName}
          escalatees={escalatees}
          onSaved={close}
          onCancel={close}
        />
        <p className="text-[12.5px] text-ink-3">
          Saving returns you to the grid, ready for the next number.{" "}
          <Link
            href={`/students/${logging.enquiry.mobile}`}
            className="underline underline-offset-2"
          >
            Open the full history
          </Link>
        </p>
        {logging.student ? (
          <StudentHistoryView
            student={logging.student}
            masters={masters}
            counsellorName={counsellorName}
            viewerId={viewerId}
            viewerIsAdmin={viewerIsAdmin}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <QuickAddGrid sources={masters.sources} onLogCall={openCall} />
    </div>
  );
}
