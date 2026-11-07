"use client";

import { Input, Select, cx } from "@/components/ui";

/**
 * §89. "Which competitor?", in one place.
 *
 * Three callers: the compact call window, the first-call form, and the edit
 * form on a student's history. §77 is the reason it is a module rather than
 * three copies — the credit picker shipped to one layout only and the control
 * was simply missing in production for a fortnight.
 */
export type CompetitorFields = {
  show: boolean;
  competitors: { id: string; name: string }[];
  competitorId: string;
  setCompetitorId: (v: string) => void;
  competitorOther: string;
  setCompetitorOther: (v: string) => void;
  missing: boolean;
};

/** The sentinel the select uses for "not on the list". */
const COMPETITOR_OTHER = "__other__";

/**
 * §89. "Which competitor?" — on both layouts, from one definition.
 *
 * A select of the listed competitors plus one option that reveals a text box.
 * The two cannot both be set: choosing a name clears the box, and typing in the
 * box is only possible once the select is on Other.
 */
export function CompetitorField({
  show,
  competitors,
  competitorId,
  setCompetitorId,
  competitorOther,
  setCompetitorOther,
  missing,
  wide,
}: CompetitorFields & { wide?: boolean }) {
  if (!show) return null;
  const typing = competitorOther !== "" || competitorId === "";
  return (
    <div
      className={cx("flex flex-col gap-1", wide && "min-w-[220px]")}
      data-testid="which-competitor"
    >
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
          Which competitor?
        </span>
        <Select
          aria-label="Which competitor"
          value={competitorId || (competitorOther ? COMPETITOR_OTHER : "")}
          onChange={(e) => {
            const v = e.target.value;
            if (v === COMPETITOR_OTHER) {
              setCompetitorId("");
              // A space is not a name; the box below is what makes it one.
              setCompetitorOther(competitorOther === "" ? " " : competitorOther);
            } else {
              setCompetitorId(v);
              setCompetitorOther("");
            }
          }}
        >
          <option value="">Choose…</option>
          {competitors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={COMPETITOR_OTHER}>Other — type name</option>
        </Select>
      </label>
      {competitorOther !== "" ? (
        <Input
          aria-label="Competitor name"
          placeholder="Where did they buy it?"
          value={competitorOther.trim() === "" ? "" : competitorOther}
          onChange={(e) => setCompetitorOther(e.target.value)}
        />
      ) : null}
      {missing ? (
        <span className="text-[11px] text-danger">
          {typing ? "Type the name." : "Name the competitor."}
        </span>
      ) : null}
    </div>
  );
}
