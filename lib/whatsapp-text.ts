/**
 * WhatsApp template placeholders (§5.10).
 *
 * Plain module, not part of the client component: the student history page
 * renders on the server and needs to call this, and a function exported from a
 * "use client" file cannot be invoked from a Server Component.
 */

export type TemplateItem = {
  teacher: string | null;
  course: string | null;
  subject: string | null;
  content: string | null;
};

export type TemplateContext = {
  name: string | null;
  items: TemplateItem[];
  term: string | null;
  counsellor: string | null;
  /** Only used to fill {course} when an enquiry has no items yet. */
  productText?: string | null;
};

export const PLACEHOLDERS = [
  { token: "{name}", description: "Student's name" },
  { token: "{teacher}", description: "Teacher(s), comma separated" },
  { token: "{subject}", description: "Subject(s), comma separated" },
  { token: "{course}", description: "Course(s), comma separated" },
  { token: "{content}", description: "Content type(s), e.g. Full, FT" },
  { token: "{term}", description: "Exam attempt on the enquiry" },
  { token: "{counsellor}", description: "You — the person sending it" },
] as const;

/** Distinct, in the order the items were recorded, joined with commas. */
function join(items: TemplateItem[], key: keyof TemplateItem): string {
  const seen = new Set<string>();
  for (const item of items) {
    const value = item[key]?.trim();
    if (value) seen.add(value);
  }
  return [...seen].join(", ");
}

/**
 * Substitute every placeholder.
 *
 * Blank-safe means *empty*, never the literal `{token}` — a student must never
 * receive "Hi {name}". Emptying a placeholder mid-sentence leaves doubled
 * spaces and stranded punctuation behind, so the result is tidied afterwards:
 * runs of spaces collapse and a space before a comma or full stop is removed.
 * Line breaks are left alone, because templates use them deliberately.
 */
export function fillTemplate(body: string, ctx: TemplateContext): string {
  const course = join(ctx.items, "course") || (ctx.productText ?? "").trim();

  const values: Record<string, string> = {
    "{name}": (ctx.name ?? "").trim(),
    "{teacher}": join(ctx.items, "teacher"),
    "{subject}": join(ctx.items, "subject"),
    "{course}": course,
    "{content}": join(ctx.items, "content"),
    "{term}": (ctx.term ?? "").trim(),
    "{counsellor}": (ctx.counsellor ?? "").trim(),
  };

  let out = body;
  for (const [token, value] of Object.entries(values)) {
    out = out.split(token).join(value);
  }

  return out
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\s+([,.!?;:])/g, "$1")
        .replace(/([(“"'])\s+/g, "$1")
        .trim(),
    )
    .join("\n");
}

/**
 * Which template stage an enquiry is at.
 *
 * follow_up_slots_used is maintained by app.recompute_enquiry() from the call
 * history, so this reads the same number §4.3 caps at three.
 */
export type Stage =
  | "fresh"
  | "followup_1"
  | "followup_2"
  | "followup_3"
  | "after_sale"
  | "any";

export const STAGE_LABELS: Record<Stage, string> = {
  fresh: "Fresh",
  followup_1: "Follow-up 1",
  followup_2: "Follow-up 2",
  followup_3: "Follow-up 3",
  after_sale: "After sale",
  any: "Any",
};

export function stageOf(type: string, slotsUsed: number): Stage {
  if (type === "after_sale") return "after_sale";
  if (slotsUsed <= 0) return "fresh";
  if (slotsUsed === 1) return "followup_1";
  if (slotsUsed === 2) return "followup_2";
  return "followup_3";
}
