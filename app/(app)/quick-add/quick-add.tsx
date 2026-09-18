"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { CallLogPanel, type PanelEnquiry, type PanelMasters } from "@/components/call-log/panel";
import { loadPanelEnquiry } from "@/components/call-log/actions";
import { StudentHistoryView } from "@/components/student-history";
import { Button, ErrorNote } from "@/components/ui";
import type { StudentHistory } from "@/lib/students";

import { lookupMobile, setMyQuickAddTab } from "./actions";
import { QuickAddGrid, type QuickAddMode } from "./grid";

type Tab = QuickAddMode;

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
  initialTab,
  acSourceId,
}: {
  masters: QuickAddMasters;
  counsellorName: string | null;
  /** §45.3: every active user, for the escalate-to picker on a new ticket. */
  escalatees: { id: string; name: string }[];
  /** §29.4: who is looking, so a call row in the history knows if it is theirs. */
  viewerId: string | null;
  viewerIsAdmin: boolean;
  /** §48.3: the grid this user last had open, read from their profile. */
  initialTab: Tab;
  /** §48.3: the AC source, or null if the master list has no source named AC. */
  acSourceId: string | null;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
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

  function choose(next: Tab) {
    setTab(next);
    // Recorded, not awaited — see setMyQuickAddTab.
    void setMyQuickAddTab(next);
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {/* §54.1. Three ways of arriving at the same enquiry.
          A call happening now, a stack of numbers being keyed, and a batch of
          AC entries being caught up on. They want different columns and the
          last wants a time — but they are the same rules underneath, so they
          are three tabs over one grid rather than three screens. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-md border border-line-2">
          {([
            { key: "one" as const, label: "One by one" },
            { key: "multi" as const, label: "Multiple add" },
            { key: "ac" as const, label: "AC" },
          ]).map((t) => (
            <button
              key={t.key}
              type="button"
              aria-current={tab === t.key ? "page" : undefined}
              onClick={() => choose(t.key)}
              className={
                tab === t.key
                  ? "bg-accent px-3 py-1 text-[12.5px] font-medium text-accent-ink"
                  : "bg-surface px-3 py-1 text-[12.5px] text-ink-2 hover:bg-surface-2"
              }
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-[11.5px] text-ink-3">
          {tab === "ac"
            ? "Every row is an AC arrival. The time defaults to now — change it for an entry you are keying later."
            : tab === "one"
              ? "One call at a time. Type what was said while you are still on it; the number can come last."
              : "A number per row, as fast as you can key them."}
        </span>
      </div>

      {tab === "ac" && !acSourceId ? (
        <ErrorNote>
          No source named “AC” is in the master list, so these rows would save
          with no source. Add one in Settings → Master lists first.
        </ErrorNote>
      ) : null}

      {/* Keyed on the tab so switching starts a clean grid rather than
          carrying half-typed rows between two different column sets. */}
      <QuickAddGrid
        key={tab}
        mode={tab}
        acSourceId={acSourceId}
        sources={masters.sources}
        onLogCall={openCall}
      />
    </div>
  );
}
