"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { CallLogPanel, type PanelEnquiry, type PanelMasters } from "@/components/call-log/panel";
import { StudentHistoryView } from "@/components/student-history";
import { Badge, Button, ErrorNote, Input, Select, Textarea, cx } from "@/components/ui";
import {
  IMPORTANCE_LABELS,
  LEAD_VERIFICATION_LABELS,
  type EnquiryType,
  type Importance,
  type LeadVerification,
} from "@/lib/enquiry-labels";
import { isValidMobile, mobileHint, normaliseMobile } from "@/lib/mobile";
import type { StudentHistory } from "@/lib/students";

import { createEnquiry, lookupMobile } from "./actions";

export type QuickAddMasters = PanelMasters & {
  sources: { id: string; name: string }[];
  terms: { id: string; name: string }[];
};

type Stage =
  | { kind: "idle" }
  | { kind: "looking" }
  | { kind: "unknown" }
  | { kind: "known"; student: StudentHistory }
  | { kind: "logging"; enquiry: PanelEnquiry; student: StudentHistory | null };

/**
 * §5.1. One box, live lookup, and the three branches the number can take.
 *
 * The number is normalised on every keystroke rather than on blur, so what is
 * in the box is always what would be stored — pasting "+91 98765-43210" from
 * WhatsApp shows 9876543210 immediately.
 */
export function QuickAdd({ masters }: { masters: QuickAddMasters }) {
  const [raw, setRaw] = useState("");
  const mobile = normaliseMobile(raw);
  const valid = isValidMobile(mobile);
  const hint = mobileHint(mobile);

  // What the last completed lookup found, tagged with the number it was for.
  // Keeping the number alongside the answer is what lets the visible stage be
  // derived rather than pushed from the effect: any keystroke immediately
  // makes `lookup.mobile !== mobile` and the panel reads as "looking up".
  const [lookup, setLookup] = useState<{
    mobile: string;
    student: StudentHistory | null;
  } | null>(null);
  const [logging, setLogging] = useState<{
    enquiry: PanelEnquiry;
    student: StudentHistory | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, startCreate] = useTransition();

  const boxRef = useRef<HTMLInputElement | null>(null);
  // Guards against an older lookup landing after a newer one.
  const lookupSeq = useRef(0);

  useEffect(() => {
    if (!valid || lookup?.mobile === mobile) return;

    const seq = ++lookupSeq.current;
    let cancelled = false;

    void (async () => {
      const res = await lookupMobile(mobile);
      if (cancelled || seq !== lookupSeq.current) return; // a newer keystroke won
      if (res.error) {
        setError(res.error);
        return;
      }
      setLookup({ mobile, student: res.student });
    })();

    return () => {
      cancelled = true;
    };
  }, [mobile, valid, lookup?.mobile]);

  const stage: Stage = logging
    ? { kind: "logging", enquiry: logging.enquiry, student: logging.student }
    : !valid
      ? { kind: "idle" }
      : lookup?.mobile === mobile
        ? lookup.student
          ? { kind: "known", student: lookup.student }
          : { kind: "unknown" }
        : { kind: "looking" };

  function reset() {
    setRaw("");
    setLookup(null);
    setLogging(null);
    setError(null);
    boxRef.current?.focus();
  }

  function openEnquiry(input: {
    type: EnquiryType;
    name?: string | null;
    sourceId?: string | null;
    productText?: string | null;
    termId?: string | null;
    importance?: Importance | "";
    leadVerification?: LeadVerification | "";
    supersedeEnquiryId?: number | null;
  }) {
    setError(null);
    startCreate(async () => {
      const res = await createEnquiry({
        mobile,
        name: input.name ?? null,
        type: input.type,
        sourceId: input.sourceId ?? null,
        productText: input.productText ?? null,
        termId: input.termId ?? null,
        importance: input.importance ?? null,
        leadVerification: input.leadVerification ?? null,
        supersedeEnquiryId: input.supersedeEnquiryId ?? null,
      });
      if (res.error || !res.enquiry) {
        setError(res.error ?? "Could not open the enquiry.");
        return;
      }
      setLogging({ enquiry: res.enquiry, student: lookup?.student ?? null });
    });
  }

  const openEnquiryRow =
    stage.kind === "known" ? stage.student.enquiries.find((e) => e.status === "open") : null;

  return (
    <div className="flex flex-col gap-5">
      {/* ---- the one box ---- */}
      <div>
        <label htmlFor="quick-add-mobile" className="sr-only">
          Mobile number
        </label>
        <Input
          id="quick-add-mobile"
          ref={boxRef}
          autoFocus
          inputMode="numeric"
          autoComplete="off"
          placeholder="Mobile number"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setLogging(null);
            setError(null);
          }}
          className="h-14 w-full max-w-md text-[24px] tracking-[0.12em] tabular-nums"
        />
        <div className="mt-1.5 flex items-center gap-2 text-[12.5px]">
          {mobile ? (
            <span className="tabular-nums text-ink-2">
              Normalised: <span className="font-medium text-ink">{mobile || "—"}</span>
            </span>
          ) : (
            <span className="text-ink-3">
              Type or paste a number — +91, leading zeros, spaces and dashes are stripped.
            </span>
          )}
          {hint ? <span className="text-warn">{hint}</span> : null}
          {valid && stage.kind === "looking" ? (
            <span className="text-ink-3">looking up…</span>
          ) : null}
        </div>
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {/* ---- branch: unknown number ---- */}
      {stage.kind === "unknown" ? (
        <NewEnquiryForm
          masters={masters}
          busy={creating}
          onSubmit={(values) => openEnquiry(values)}
        />
      ) : null}

      {/* ---- branch: known number ---- */}
      {stage.kind === "known" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-info/40 bg-info-soft/40 px-4 py-3">
            <Badge tone="info">Known number</Badge>
            <span className="text-[13px] text-ink">
              {stage.student.name || "No name recorded"}
            </span>
            {openEnquiryRow ? (
              <span className="text-[12.5px] text-ink-2">
                has an open enquiry (#{openEnquiryRow.id})
              </span>
            ) : (
              <span className="text-[12.5px] text-ink-2">has no open enquiry</span>
            )}

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {openEnquiryRow ? (
                <Button
                  variant="primary"
                  disabled={creating}
                  onClick={() =>
                    setLogging({
                      enquiry: {
                        id: openEnquiryRow.id,
                        type: openEnquiryRow.type,
                        studentName: stage.student.name,
                        mobile: stage.student.mobile,
                        term: openEnquiryRow.term?.name ?? null,
                        items: openEnquiryRow.enquiry_items.map((i) => ({
                          id: i.id,
                          status: i.status,
                          teacher: i.teacher?.name ?? null,
                          course: i.course?.name ?? null,
                          subject: i.subject?.name ?? null,
                          content: i.content?.name ?? null,
                        })),
                      },
                      student: stage.student,
                    })
                  }
                >
                  Update existing enquiry
                </Button>
              ) : null}

              <NewEnquiryButtons
                busy={creating}
                supersede={openEnquiryRow ? openEnquiryRow.id : null}
                onOpen={(type) =>
                  openEnquiry({
                    type,
                    supersedeEnquiryId: openEnquiryRow ? openEnquiryRow.id : null,
                  })
                }
              />
            </div>
          </div>

          <StudentHistoryView student={stage.student} />
        </div>
      ) : null}

      {/* ---- branch: logging ---- */}
      {stage.kind === "logging" ? (
        <div className="flex flex-col gap-4">
          <CallLogPanel
            enquiry={stage.enquiry}
            masters={masters}
            onSaved={reset}
            onCancel={reset}
          />
          <p className="text-[12.5px] text-ink-3">
            Saving returns you to an empty box, ready for the next call.{" "}
            <Link
              href={`/students/${stage.enquiry.mobile}`}
              className="underline underline-offset-2"
            >
              Open the full history
            </Link>
          </p>
          {stage.student ? <StudentHistoryView student={stage.student} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function NewEnquiryButtons({
  busy,
  supersede,
  onOpen,
}: {
  busy: boolean;
  supersede: number | null;
  onOpen: (type: EnquiryType) => void;
}) {
  const [type, setType] = useState<EnquiryType>("purchase");

  return (
    <div className="flex items-center gap-1.5">
      <Select
        aria-label="New enquiry type"
        className="w-[130px]"
        value={type}
        onChange={(e) => setType(e.target.value as EnquiryType)}
      >
        <option value="purchase">Purchase</option>
        <option value="after_sale">After Sale</option>
      </Select>
      <Button
        variant={supersede ? "secondary" : "primary"}
        disabled={busy}
        onClick={() => onOpen(type)}
        title={
          supersede
            ? `Closes enquiry #${supersede} as superseded and opens a new one`
            : undefined
        }
      >
        Open new enquiry
      </Button>
    </div>
  );
}

function NewEnquiryForm({
  masters,
  busy,
  onSubmit,
}: {
  masters: QuickAddMasters;
  busy: boolean;
  onSubmit: (values: {
    type: EnquiryType;
    name: string | null;
    sourceId: string | null;
    productText: string | null;
    termId: string | null;
    importance: Importance | "";
    leadVerification: LeadVerification | "";
  }) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<EnquiryType>("purchase");
  const [sourceId, setSourceId] = useState("");
  const [productText, setProductText] = useState("");
  const [termId, setTermId] = useState("");
  const [importance, setImportance] = useState<Importance | "">("");
  const [leadVerification, setLeadVerification] = useState<LeadVerification | "">("");

  function submit() {
    if (busy) return;
    onSubmit({
      type,
      name: name.trim() || null,
      sourceId: sourceId || null,
      productText: productText.trim() || null,
      termId: termId || null,
      importance,
      leadVerification,
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && (e.target as HTMLElement).tagName !== "BUTTON") {
          e.preventDefault();
          submit();
        }
      }}
      className="rounded-lg border border-line bg-surface"
    >
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <Badge tone="ok">New number</Badge>
        <span className="text-[12.5px] text-ink-2">
          Everything here is optional — only the number is required.
        </span>
      </header>

      <div className="grid gap-3 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
        <Labelled label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
        </Labelled>

        <Labelled label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as EnquiryType)}>
            <option value="purchase">Purchase</option>
            <option value="after_sale">After Sale</option>
          </Select>
        </Labelled>

        <Labelled label="Source">
          <Select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">—</option>
            {masters.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Labelled>

        <Labelled label="Term">
          <Select value={termId} onChange={(e) => setTermId(e.target.value)}>
            <option value="">—</option>
            {masters.terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Labelled>

        <Labelled label="Importance">
          <Select
            value={importance}
            onChange={(e) => setImportance(e.target.value as Importance | "")}
          >
            <option value="">—</option>
            {Object.entries(IMPORTANCE_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
        </Labelled>

        <Labelled label="Lead verification">
          <Select
            value={leadVerification}
            onChange={(e) => setLeadVerification(e.target.value as LeadVerification | "")}
          >
            <option value="">—</option>
            {Object.entries(LEAD_VERIFICATION_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
        </Labelled>

        <div className="sm:col-span-2 lg:col-span-3">
          <Labelled label="Product text">
            <Textarea
              rows={2}
              value={productText}
              onChange={(e) => setProductText(e.target.value)}
              placeholder="The raw product title, as the lead described it"
            />
          </Labelled>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-line px-4 py-3">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Opening…" : "Save and log the call"}
        </Button>
        <span className="text-[11.5px] text-ink-3">Enter opens the call log</span>
      </div>
    </form>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={cx("flex flex-col gap-1")}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
        {label}
      </span>
      {children}
    </label>
  );
}
