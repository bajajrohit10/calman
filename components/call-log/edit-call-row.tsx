"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type {
  CallOutcome,
  EnquiryType,
  Importance,
  LeadVerification,
} from "@/lib/enquiry-labels";

import { EditCallForm, canEditCall } from "./edit-call";

/**
 * The Edit control for one row of the unified history (§29.4).
 *
 * A client island inside a server-rendered table: the table itself has no
 * state and should not acquire any, and the form only exists for the one row
 * somebody is correcting.
 */
export function EditCallRow({
  call,
  type,
  importance,
  leadVerification,
  viewerId,
  viewerIsAdmin,
}: {
  call: {
    id: number;
    calledBy: string;
    callDate: string;
    outcome: CallOutcome;
    discussion: string | null;
    nextFollowUpDate: string | null;
  };
  type: EnquiryType;
  importance: Importance | null;
  leadVerification: LeadVerification | null;
  viewerId?: string | null;
  viewerIsAdmin?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (!canEditCall(call, viewerId, viewerIsAdmin)) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-ink-3 underline-offset-2 hover:text-ink hover:underline"
      >
        Edit
      </button>
    );
  }

  return (
    <div className="mt-1">
      <EditCallForm
        call={call}
        type={type}
        importance={importance}
        leadVerification={leadVerification}
        onDone={(changed) => {
          setOpen(false);
          // The row is server-rendered, so the corrected value arrives with the
          // next render rather than from local state.
          if (changed) router.refresh();
        }}
      />
    </div>
  );
}
