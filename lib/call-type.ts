/**
 * Book / Video / Unknown (§47.5).
 *
 * The classification itself lives in the database — app.derive_call_type, run
 * by recompute_enquiry and stored on the enquiry — because it depends on the
 * latest call's note and every list would otherwise have to join calls to show
 * it. This module is the vocabulary the screens share: what each value is
 * called, and what it stands in for when a lead has no content recorded.
 */

export type CallType = "video" | "books" | "unknown";

export const CALL_TYPES: CallType[] = ["video", "books", "unknown"];

export const CALL_TYPE_LABELS: Record<CallType, string> = {
  video: "Video",
  books: "Books",
  unknown: "Unknown",
};

export function isCallType(value: string | null | undefined): value is CallType {
  return value === "video" || value === "books" || value === "unknown";
}

/** The query-string value, or null for "all three". */
export function parseCallTypes(value: string | null | undefined): CallType[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(isCallType);
}

/* -------------------------------------------------------------------------- */

/**
 * The content a classification stands in for, where a lead has none recorded.
 *
 * §47.5 asks the desk, Smart Assign and Enquiries to treat the derived type as
 * content when the interest lines carry none — shown as "Full (auto)" and
 * "Books (auto)", and never written to enquiry_items. So this is a display
 * rule and a sort key, not data.
 *
 * The names are the real content masters' names on purpose. A counsellor
 * scanning the Content column should see the same word whether it was recorded
 * or inferred; the "(auto)" is what tells them which, and it is the only thing
 * that should differ. Inventing a separate word for the inferred case would
 * make the column read as two vocabularies.
 *
 * Unknown stands in for nothing. A lead we cannot classify has no content, and
 * saying so is the honest rendering — "Unknown (auto)" would dress an absence
 * up as a finding.
 */
export const AUTO_CONTENT: Record<CallType, { name: string; priority: number } | null> = {
  // Full is priority 1 in the contents master, Books is 5. Reusing those exact
  // numbers is what makes §47.5's ordering rule — "Books auto-sorts after
  // Video within every bucket" — fall out of the sort that already exists
  // rather than needing a second one beside it.
  video: { name: "Full", priority: 1 },
  books: { name: "Books", priority: 5 },
  unknown: null,
};

/** The id an auto content option travels under, kept apart from real ids. */
export const AUTO_CONTENT_PREFIX = "auto:";

export function autoContentId(type: CallType): string {
  return `${AUTO_CONTENT_PREFIX}${type}`;
}

export function isAutoContentId(id: string): boolean {
  return id.startsWith(AUTO_CONTENT_PREFIX);
}

/**
 * What the Content column shows for one row.
 *
 * `contents` is what the lead's open interest lines actually name. Anything at
 * all there wins: §47.5 is explicit that a counsellor setting real content
 * overrides the guess, and that is the whole point — the inferred value exists
 * to fill a silence, not to argue with an answer.
 */
export function contentLabel(
  contents: string[] | null | undefined,
  callType: CallType | null | undefined,
): { text: string; auto: boolean } | null {
  const real = (contents ?? []).filter(Boolean);
  if (real.length) return { text: real.join(", "), auto: false };
  const stand = callType ? AUTO_CONTENT[callType] : null;
  if (!stand) return null;
  return { text: `${stand.name} (auto)`, auto: true };
}

/**
 * Split a Content selection into real ids and derived types.
 *
 * The filter bar holds one list, because to a counsellor "Full" and "Full
 * (auto)" are two options in the same column and picking either is the same
 * gesture. The database holds two parameters, because one is a uuid[] of
 * content ids and the other is a list of classifications. This is the seam,
 * kept in one function so the desk, Smart Assign and Enquiries cannot drift
 * about where it sits — the same reason '__none__' is split out of the same
 * list a few lines away from every call site.
 */
export function splitContentIds(ids: string[] | null | undefined): {
  real: string[];
  auto: CallType[];
} {
  const real: string[] = [];
  const auto: CallType[] = [];
  for (const id of ids ?? []) {
    if (!isAutoContentId(id)) {
      real.push(id);
      continue;
    }
    const kind = id.slice(AUTO_CONTENT_PREFIX.length);
    if (isCallType(kind)) auto.push(kind);
  }
  return { real, auto };
}

/**
 * The Content facet's options: the real contents, then the derived ones.
 *
 * Auto options come last and only when the facet counted something behind
 * them, so a column of filters does not carry two permanently empty rows on a
 * database where every lead has its content recorded.
 */
export function contentOptions(
  contents: { id: string; name: string }[],
  counts: Record<string, { numbers: number }> | undefined,
): { id: string; name: string }[] {
  const auto = (["video", "books"] as const)
    .filter((k) => (counts?.[autoContentId(k)]?.numbers ?? 0) > 0)
    .map((k) => ({ id: autoContentId(k), name: `${AUTO_CONTENT[k]!.name} (auto)` }));
  return [...contents, ...auto];
}
