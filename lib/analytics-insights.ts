import {
  COMPETITOR_MIN_CLOSED,
  COMPETITOR_VS_TEAM,
  CONVERSION_MIN_CLOSED,
  CONVERSION_TOP_N,
  DATA_GAP_SHARE,
  DEMAND_CHANGE,
  DEMAND_MIN_ENQUIRIES,
  HEAD_MAX,
  MISSING_AMOUNT_MIN,
} from "@/lib/analytics-thresholds";
import {
  change,
  conversion,
  pointsChange,
  type AnalyticsScope,
  type CourseRow,
  type TeacherRow,
} from "@/lib/analytics-shape";

/**
 * §84.1. "What stands out", in three heads.
 *
 * §81 through §83 built this as a grid of cards ranked against each other, which
 * made every card compete with every other for five slots — a competitor problem
 * and a tagging problem and a falling teacher, jostling. Three headed lists instead:
 * each head is one question, each bullet is one sentence with its numbers, and the
 * ordering inside a head is by effect size because that is the only ordering that
 * means anything within a single question.
 *
 * All three read the comparison window when there is one. Without it the demand head
 * has nothing to say and says so, rather than silently showing two heads and leaving
 * the reader to wonder.
 *
 * Pure: it takes the rows the page already has. No reads, no thresholds of its own,
 * nothing that needs a clock — so a head is testable by handing it rows.
 */

export type Bullet = {
  /** Stable, so a bullet can be asserted on without matching its prose. */
  id: string;
  text: string;
  href: string;
  /** What the head sorts on: the size of the move or the rate, never the rule. */
  effect: number;
  tone: "ok" | "warn" | "danger" | "neutral";
};

export type Heads = {
  demand: { bullets: Bullet[]; note: string | null };
  competitor: { bullets: Bullet[]; teamLine: string | null };
  conversion: { best: Bullet[]; weakest: Bullet[]; teamLine: string | null };
  housekeeping: Bullet[];
};

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const signed = (v: number) => `${v > 0 ? "▲" : "▼"}${Math.abs(Math.round(v * 100))}%`;
const pts = (v: number) => `${v > 0 ? "▲" : "▼"}${Math.abs(Math.round(v))} pts`;

export function buildHeads(input: {
  scope: AnalyticsScope;
  teachers: TeacherRow[];
  courses: CourseRow[];
  query: string;
}): Heads {
  const { scope, query } = input;
  const now = scope.now;
  const comparing = Boolean(scope.prev && scope.cmpFrom && scope.cmpTo);
  // The Untagged pseudo-row measures what cannot be attributed; no head judges it.
  const teachers = input.teachers.filter((r) => r.teacher_id);
  const courses = input.courses.filter((r) => r.course_id);
  const link = (tab: string, anchor?: string) =>
    `/analytics?${query}&tab=${tab}${anchor ? `#${anchor}` : ""}`;

  // -------------------------------------------------------------------------
  // Head 1. Demand, rising then falling.
  // -------------------------------------------------------------------------
  const demand: Bullet[] = [];
  if (comparing) {
    type Cand = { id: string; label: string; now: number; before: number; href: string };
    const cands: Cand[] = [
      ...teachers.map((r) => ({
        id: `t:${r.teacher_id}`,
        label: r.teacher_name,
        now: r.leads,
        before: r.prev_leads,
        href: link("teachers", `row-${r.teacher_id}`),
      })),
      ...courses.map((r) => ({
        id: `c:${r.course_id}:${r.subject_id ?? "none"}`,
        label: `${r.course_name} · ${r.subject_name}`,
        now: r.leads,
        before: r.prev_leads,
        href: link("products"),
      })),
    ];
    const moved = cands
      .map((c) => ({ c, g: change(c.now, c.before) }))
      .filter(
        (x) =>
          x.g !== null &&
          Math.abs(x.g) >= DEMAND_CHANGE &&
          // Either side, so a collapse from twelve to two still shows.
          Math.max(x.c.now, x.c.before) >= DEMAND_MIN_ENQUIRIES,
      ) as { c: Cand; g: number }[];

    // Rising first, as the brief sets it; within each group, biggest move first.
    const rising = moved.filter((x) => x.g > 0).sort((a, b) => b.g - a.g);
    const falling = moved.filter((x) => x.g < 0).sort((a, b) => a.g - b.g);
    for (const { c, g } of [...rising, ...falling].slice(0, HEAD_MAX)) {
      demand.push({
        id: `demand:${c.id}`,
        text: `${c.label} ${signed(g)} (${c.before} → ${c.now})`,
        href: c.href,
        effect: Math.abs(g),
        tone: g > 0 ? "ok" : "warn",
      });
    }
  }

  // -------------------------------------------------------------------------
  // Head 2. Competitor losses, against the team's own rate.
  // -------------------------------------------------------------------------
  const teamCompetitor = now.closed > 0 ? now.lostCompetitor / now.closed : 0;
  const prevTeamCompetitor =
    scope.prev && scope.prev.closed > 0 ? scope.prev.lostCompetitor / scope.prev.closed : null;
  const competitor: Bullet[] = teachers
    .filter((r) => r.closed >= COMPETITOR_MIN_CLOSED && r.lost_competitor > 0)
    .map((r) => ({ r, share: r.lost_competitor / r.closed }))
    .filter((x) => teamCompetitor > 0 && x.share >= teamCompetitor * COMPETITOR_VS_TEAM)
    .sort((a, b) => b.share - a.share)
    .slice(0, HEAD_MAX)
    .map(({ r, share }) => {
      const beforeShare =
        comparing && r.prev_closed > 0 ? r.prev_lost_competitor / r.prev_closed : null;
      const move = beforeShare === null ? null : pointsChange(share, beforeShare);
      return {
        id: `competitor:${r.teacher_id}`,
        text:
          `${r.teacher_name}: ${r.lost_competitor} of ${r.closed} closed lost to competitor ` +
          `(${pct(share)} vs team ${pct(teamCompetitor)})` +
          (move !== null && Math.abs(move) >= 0.5 ? `, ${pts(move)}` : ""),
        href: link("teachers", `row-${r.teacher_id}`),
        effect: share,
        tone: "danger" as const,
      };
    });

  // -------------------------------------------------------------------------
  // Head 3. Conversion: best and weakest, against the team's own rate.
  // -------------------------------------------------------------------------
  const teamConv = conversion(now.purchased, now.closed);
  const prevTeamConv = scope.prev ? conversion(scope.prev.purchased, scope.prev.closed) : null;
  const ranked = teachers
    .filter((r) => r.closed >= CONVERSION_MIN_CLOSED)
    .map((r) => ({ r, conv: conversion(r.purchased, r.closed) }))
    .filter((x) => x.conv !== null)
    .sort((a, b) => (b.conv as number) - (a.conv as number)) as {
    r: TeacherRow;
    conv: number;
  }[];

  const bullet = (r: TeacherRow, conv: number, tone: Bullet["tone"]): Bullet => {
    const beforeConv =
      comparing && r.prev_closed > 0 ? r.prev_purchased / r.prev_closed : null;
    const move = beforeConv === null ? null : pointsChange(conv, beforeConv);
    return {
      id: `conversion:${r.teacher_id}`,
      text:
        `${r.teacher_name}: ${pct(conv)} of ${r.closed} closed` +
        (move !== null && Math.abs(move) >= 0.5 ? `, ${pts(move)}` : ""),
      href: link("teachers", `row-${r.teacher_id}`),
      effect: conv,
      tone,
    };
  };

  const best = ranked.slice(0, CONVERSION_TOP_N).map(({ r, conv }) => bullet(r, conv, "ok"));
  // Weakest only where it is actually weak: below the team rate. A bottom three
  // that is still above average is a ranking, not a finding.
  const weakest = [...ranked]
    .reverse()
    .filter((x) => teamConv !== null && x.conv < teamConv)
    .slice(0, CONVERSION_TOP_N)
    .map(({ r, conv }) => bullet(r, conv, "warn"));

  // -------------------------------------------------------------------------
  // The housekeeping line, only when something fires.
  // -------------------------------------------------------------------------
  const housekeeping: Bullet[] = [];
  if (now.wonItemsNoAmount >= MISSING_AMOUNT_MIN) {
    housekeeping.push({
      id: "missing-amount",
      text: `${now.wonItemsNoAmount} of ${now.wonItems} sold lines have no amount, so revenue is understated`,
      href: `/enquiries?status=won&createdFrom=${scope.from}&createdTo=${scope.to}`,
      effect: now.wonItemsNoAmount,
      tone: "neutral",
    });
  }
  const gap = now.leads > 0 ? scope.untagged / now.leads : 0;
  if (gap > DATA_GAP_SHARE) {
    housekeeping.push({
      id: "data-gap",
      text: `${scope.untagged} of ${now.leads} leads (${pct(gap)}) name no teacher, so these rates are computed on the other ${scope.taggedLeads}`,
      href: link("teachers", "row-untagged"),
      effect: scope.untagged,
      tone: "neutral",
    });
  }

  const teamMove = (nowRate: number | null, beforeRate: number | null) => {
    if (!comparing || nowRate === null || beforeRate === null) return "";
    const m = pointsChange(nowRate, beforeRate);
    return m === null || Math.abs(m) < 0.5 ? "" : `, ${pts(m)} vs the comparison`;
  };

  return {
    demand: {
      bullets: demand,
      note: comparing
        ? demand.length
          ? null
          : `No teacher or subject moved ${Math.round(DEMAND_CHANGE * 100)}% or more.`
        : "Set a comparison period to see demand changes",
    },
    competitor: {
      bullets: competitor,
      teamLine:
        now.closed > 0
          ? `Team: ${now.lostCompetitor} of ${now.closed} closed lost to a competitor (${pct(teamCompetitor)})` +
            teamMove(teamCompetitor, prevTeamCompetitor)
          : null,
    },
    conversion: {
      best,
      weakest,
      teamLine:
        now.closed > 0
          ? `Team: ${pct(teamConv)} of ${now.closed} closed` + teamMove(teamConv, prevTeamConv)
          : null,
    },
    housekeeping,
  };
}
