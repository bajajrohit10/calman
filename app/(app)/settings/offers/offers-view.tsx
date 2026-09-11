"use client";

import { useEffect, useState, useTransition } from "react";

import { ExportButton } from "@/components/export-button";
import { MultiSelect } from "@/components/multi-select";
import {
  Badge,
  Button,
  ErrorNote,
  FIELD_LABEL,
  Input,
  cx,
} from "@/components/ui";
import { formatDate, istDatePlus, istToday } from "@/lib/format";
import {
  TARGET_KEYS,
  TARGET_TABLES,
  offerWindowFrom,
  type Offer,
  type OfferPerformance,
  type OfferTargetKey,
  type OfferTargets,
} from "@/lib/offer-shape";

import { previewOfferMatches, saveOffer, setOfferActive } from "./actions";

type Master = { id: string; name: string };
type Subject = Master & { course_id: string };

export type OfferMasters = {
  institutes: Master[];
  teachers: Master[];
  courses: Master[];
  subjects: Subject[];
  contents: Master[];
};

const blankTargets = (): OfferTargets => ({
  institutes: [],
  teachers: [],
  courses: [],
  subjects: [],
  contents: [],
});

const DEFAULT_REMINDER = 5;

/**
 * §3 Offers, and §7's offer performance beside them.
 *
 * One screen rather than two, because the only question worth asking about a
 * finished offer — did it sell anything — is asked of the same row that says
 * what it was aimed at. Splitting them would mean reading the targets on one
 * page to understand the numbers on another.
 */
export function OffersView({
  offers,
  performance,
  error,
  masters,
}: {
  offers: Offer[];
  performance: Record<string, OfferPerformance>;
  error: string | null;
  masters: OfferMasters;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<{ error: string | null; ok?: string } | null>(null);
  const [pending, start] = useTransition();

  const today = istToday();

  function deactivate(offer: Offer) {
    start(async () => {
      const res = await setOfferActive(offer.id, !offer.is_active);
      setNote(res);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-[14px] font-semibold text-ink">Offers</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-2">
            While an offer is closing, every open lead it targets moves into the Offer
            bucket on the desk and into Offer Calls on My Day.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ExportButton source="offers" />
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setCreating((v) => !v);
              setEditing(null);
              setNote(null);
            }}
          >
            {creating ? "Cancel" : "New offer"}
          </Button>
        </div>
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {note?.error ? <ErrorNote>{note.error}</ErrorNote> : null}
      {note?.ok ? (
        <p className="rounded-md border border-ok/40 bg-ok-soft px-3 py-1.5 text-[12.5px] text-ok">
          {note.ok}
        </p>
      ) : null}

      {creating ? (
        <OfferForm
          masters={masters}
          onDone={(res) => {
            setNote(res);
            if (!res.error) setCreating(false);
          }}
        />
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full min-w-[1060px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="px-2 py-[7px]">Offer</th>
              <th className="px-2 py-[7px]">Runs</th>
              <th className="px-2 py-[7px]">Reminders from</th>
              <th className="px-2 py-[7px]">Targets</th>
              <th className="px-2 py-[7px] text-right">Matches today</th>
              <th className="border-l border-line px-2 py-[7px] text-right">Reached</th>
              <th className="px-2 py-[7px] text-right">Called</th>
              <th className="px-2 py-[7px] text-right">Won</th>
              <th className="px-2 py-[7px] text-right">Amount</th>
              <th className="px-2 py-[7px]" />
            </tr>
          </thead>
          <tbody>
            {offers.map((offer) => {
              const p = performance[offer.id];
              const windowFrom = offerWindowFrom(
                offer.start_date,
                offer.end_date,
                offer.reminder_days,
              );
              const live =
                offer.is_active && today >= windowFrom && today <= offer.end_date;
              return (
                <Row key={offer.id}>
                  <tr
                    className={cx(
                      "border-b border-line last:border-b-0",
                      !offer.is_active && "text-ink-3",
                    )}
                  >
                    <td className="px-2 py-[6px]">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-ink">{offer.name}</span>
                        {live ? <Badge dot tone="info">Reminding</Badge> : null}
                        {!offer.is_active ? <Badge tone="neutral">Inactive</Badge> : null}
                      </span>
                    </td>
                    <td className="px-2 py-[6px] whitespace-nowrap text-ink-2">
                      {formatDate(offer.start_date)} — {formatDate(offer.end_date)}
                    </td>
                    <td className="px-2 py-[6px] whitespace-nowrap text-ink-2">
                      {formatDate(windowFrom)}
                      <span className="ml-1 text-ink-3">({offer.reminder_days}d)</span>
                    </td>
                    <td className="px-2 py-[6px] text-ink-2">
                      <TargetSummary targets={offer.targets} masters={masters} />
                    </td>
                    <td className="px-2 py-[6px] text-right tabular-nums text-ink">
                      {p?.matches_now ?? 0}
                    </td>
                    <td className="border-l border-line px-2 py-[6px] text-right tabular-nums text-ink-2">
                      {p?.reached || "—"}
                    </td>
                    <td className="px-2 py-[6px] text-right tabular-nums text-ink-2">
                      {p?.called || "—"}
                    </td>
                    <td className="px-2 py-[6px] text-right tabular-nums text-ink">
                      {p?.won || "—"}
                    </td>
                    <td className="px-2 py-[6px] text-right tabular-nums text-ink-2">
                      {p?.won_amount
                        ? `₹${Number(p.won_amount).toLocaleString("en-IN")}`
                        : "—"}
                    </td>
                    <td className="px-2 py-[6px] text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(editing === offer.id ? null : offer.id);
                          setCreating(false);
                          setNote(null);
                        }}
                      >
                        {editing === offer.id ? "Close" : "Edit"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() => deactivate(offer)}
                      >
                        {offer.is_active ? "Deactivate" : "Reactivate"}
                      </Button>
                    </td>
                  </tr>
                  {editing === offer.id ? (
                    <tr>
                      <td colSpan={10} className="border-b border-line bg-sunk/40 p-2.5">
                        <OfferForm
                          offer={offer}
                          masters={masters}
                          onDone={(res) => {
                            setNote(res);
                            if (!res.error) setEditing(null);
                          }}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Row>
              );
            })}
            {offers.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-ink-3">
                  No offers yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="text-[11.5px] leading-relaxed text-ink-3">
        A lead matches an offer when it has at least one <strong>open</strong> interest
        line satisfying every dimension the offer names — one line has to satisfy all of
        them at once, not one line each. A dimension with nothing chosen matches
        anything. Teacher and Institute are one dimension asked two ways: a line
        qualifies if either list names it. Reminders start at the later of the start
        date and end&nbsp;date&nbsp;−&nbsp;reminder&nbsp;days, so an offer never nags
        about a discount that has not begun. Reached, Called and Won are one funnel over
        the leads actually handed out under this offer during its run.
      </p>
    </div>
  );
}

/** Two <tr>s per offer need a fragment with a key; this is that fragment. */
function Row({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function TargetSummary({
  targets,
  masters,
}: {
  targets: OfferTargets;
  masters: OfferMasters;
}) {
  const names = (key: OfferTargetKey) => {
    const list: Master[] = masters[key];
    const chosen = targets[key] ?? [];
    return chosen
      .map((id) => list.find((m) => m.id === id)?.name ?? "(removed)")
      .sort((a, b) => a.localeCompare(b));
  };

  const parts = TARGET_KEYS.flatMap((key) => {
    const n = names(key);
    if (!n.length) return [];
    return [{ key, label: TARGET_TABLES[key].label, names: n }];
  });

  if (!parts.length) return <span className="italic text-ink-3">Everything</span>;

  return (
    <span className="flex flex-wrap gap-x-2.5 gap-y-1">
      {parts.map((p) => (
        <span key={p.key} className="whitespace-nowrap">
          <span className="text-ink-3">{p.label}: </span>
          {p.names.length > 3
            ? `${p.names.slice(0, 3).join(", ")} +${p.names.length - 3}`
            : p.names.join(", ")}
        </span>
      ))}
    </span>
  );
}

function OfferForm({
  offer,
  masters,
  onDone,
}: {
  offer?: Offer;
  masters: OfferMasters;
  onDone: (res: { error: string | null; ok?: string }) => void;
}) {
  const [name, setName] = useState(offer?.name ?? "");
  const [startDate, setStartDate] = useState(offer?.start_date ?? istToday());
  const [endDate, setEndDate] = useState(offer?.end_date ?? istDatePlus(14));
  const [reminderDays, setReminderDays] = useState(
    String(offer?.reminder_days ?? DEFAULT_REMINDER),
  );
  const [targets, setTargets] = useState<OfferTargets>(
    offer ? { ...blankTargets(), ...offer.targets } : blankTargets(),
  );
  // The answer, tagged with the targets it is an answer to. "Counting" is then
  // a comparison rather than a second piece of state — which also keeps the
  // flag honest if a request is superseded before it lands.
  const [counted, setCounted] = useState<{ key: string; count: number | null }>({
    key: "",
    count: null,
  });
  const [pending, start] = useTransition();

  const targetKey = JSON.stringify(targets);
  const counting = counted.key !== targetKey;
  const matches = counted.count;

  // Debounced: every tick of a checkbox would otherwise be a round trip. Asked
  // again on every target change because a target the manager did not mean to
  // pick is only obvious while the number moves.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const res = await previewOfferMatches(JSON.parse(targetKey) as OfferTargets);
      if (cancelled) return;
      setCounted({ key: targetKey, count: res.error ? null : res.count });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [targetKey]);

  const setTarget = (key: OfferTargetKey, values: string[]) =>
    setTargets((t) => ({ ...t, [key]: values }));

  const windowFrom = offerWindowFrom(startDate, endDate, Number(reminderDays) || 0);

  function submit() {
    start(async () => {
      const res = await saveOffer({
        id: offer?.id ?? null,
        name,
        startDate,
        endDate,
        reminderDays: Number(reminderDays) || 0,
        targets,
      });
      onDone(res);
    });
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-2.5 shadow-card">
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Name</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Diwali — CA Final"
            className="w-[220px]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Starts</span>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Ends</span>
          <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={FIELD_LABEL}>Reminder days</span>
          <Input
            type="number"
            min={0}
            max={365}
            value={reminderDays}
            onChange={(e) => setReminderDays(e.target.value)}
            className="w-[110px]"
          />
        </label>
        <p className="pb-1.5 text-[11.5px] text-ink-3">
          Reminders from <strong className="text-ink-2">{formatDate(windowFrom)}</strong>{" "}
          to {formatDate(endDate)}
        </p>
        {/* The whole point of the form, and above the target selects rather
            than below them: a multi-select's popover opens downwards and would
            cover the number at exactly the moment it is changing. */}
        <span
          className={cx(
            "ml-auto pb-1.5 text-[12.5px]",
            counting ? "text-ink-3" : matches === 0 ? "text-warn" : "text-ink-2",
          )}
          role="status"
        >
          {counting
            ? "Counting…"
            : matches === null
              ? "Could not count the matching leads."
              : `Matches ${matches} open lead${matches === 1 ? "" : "s"} today.`}
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-2.5 border-t border-line pt-2.5">
        {TARGET_KEYS.map((key) => (
          <label key={key} className="flex flex-col gap-1">
            <span className={FIELD_LABEL}>{TARGET_TABLES[key].label}</span>
            <MultiSelect
              name={`target-${key}`}
              options={masters[key]}
              values={targets[key] ?? []}
              anyLabel="Any"
              onChange={(values) => setTarget(key, values)}
            />
          </label>
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2.5 border-t border-line pt-2.5">
        <Button size="sm" variant="primary" disabled={pending} onClick={submit}>
          {pending ? "Saving…" : offer ? "Save offer" : "Create offer"}
        </Button>
      </div>
    </div>
  );
}
