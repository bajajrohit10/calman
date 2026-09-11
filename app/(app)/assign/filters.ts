import type {
  CloseReason,
  EnquiryStatus,
  EnquiryType,
  Importance,
  LostReason,
} from "@/lib/enquiry-labels";
import type { EnquiryFilters } from "@/lib/enquiries";
import { istToday } from "@/lib/format";
import type { RecommendedFilters } from "@/lib/recommended";

export const PAGE_SIZE = 50;

/**
 * The desk's filter state lives entirely in the query string. Both readers of
 * it — the page that renders a page of results, and the action that selects
 * every matching row across all pages — parse it here, so "select all N
 * matching" cannot end up meaning something different from what is on screen.
 */
export type ParamReader = (key: string) => string | null;

const str = (get: ParamReader, key: string) => {
  const value = get(key);
  return value === null || value === "" ? null : value;
};

/**
 * A multi-select filter travels comma-joined, the shape the New Calls source
 * select has used since Brief 7. An empty list means "any".
 */
const many = (get: ParamReader, key: string): string[] =>
  (str(get, key) ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

export function parseDeskParams(get: ParamReader): {
  date: string;
  page: number;
  includeNotDue: boolean;
  filters: RecommendedFilters;
} {
  const date = str(get, "date") ?? istToday();
  const page = Math.max(1, Number(str(get, "page") ?? 1) || 1);
  const includeNotDue = str(get, "notDue") === "1";

  return {
    date,
    page,
    includeNotDue,
    filters: {
      date,
      includeNotDue,
      counsellorId: str(get, "counsellor"),
      teacherIds: many(get, "teacher"),
      courseId: str(get, "course"),
      subjectId: str(get, "subject"),
      contentIds: many(get, "content"),
      instituteId: str(get, "institute"),
      stages: many(get, "stage"),
      lastCalledFrom: str(get, "lastCalledFrom"),
      lastCalledTo: str(get, "lastCalledTo"),
      termId: str(get, "term"),
      sourceId: str(get, "source"),
      importance: str(get, "importance") as Importance | null,
      type: str(get, "type") as EnquiryType | null,
      status: str(get, "status") as EnquiryStatus | null,
      createdFrom: str(get, "createdFrom"),
      createdTo: str(get, "createdTo"),
      followUpFrom: str(get, "followUpFrom"),
      followUpTo: str(get, "followUpTo"),
      discussion: str(get, "q"),
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    },
  };
}

/**
 * §5.6 reads the same query-string keys as the desk — so a filter built on one
 * screen can be pasted into the other — plus the fields that only make sense
 * once every status is in scope: status itself, why it was lost or closed, a
 * mobile-number search, and the sort.
 */
export function parseEnquiriesParams(get: ParamReader): {
  page: number;
  sort: string;
  dir: "asc" | "desc";
  filters: EnquiryFilters;
} {
  const page = Math.max(1, Number(str(get, "page") ?? 1) || 1);
  const sort = str(get, "sort") ?? "created_at";
  const dir = str(get, "dir") === "asc" ? "asc" : "desc";

  return {
    page,
    sort,
    dir,
    filters: {
      type: str(get, "type") as EnquiryType | null,
      status: str(get, "status") as EnquiryStatus | null,
      lostReason: str(get, "lostReason") as LostReason | null,
      closeReason: str(get, "closeReason") as CloseReason | null,
      counsellorId: str(get, "counsellor"),
      teacherIds: many(get, "teacher"),
      courseId: str(get, "course"),
      subjectId: str(get, "subject"),
      contentIds: many(get, "content"),
      termId: str(get, "term"),
      sourceId: str(get, "source"),
      importance: str(get, "importance") as Importance | null,
      createdFrom: str(get, "createdFrom"),
      createdTo: str(get, "createdTo"),
      followUpFrom: str(get, "followUpFrom"),
      followUpTo: str(get, "followUpTo"),
      discussion: str(get, "q"),
      stages: many(get, "stage"),
      lastCalledFrom: str(get, "lastCalledFrom"),
      lastCalledTo: str(get, "lastCalledTo"),
      mobile: str(get, "mobile"),
      // §9: the Enquiries table is the investigative screen, so it is the one
      // list that can be asked to include archived rows.
      includeArchived: str(get, "archived") === "1",
      sort,
      dir,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    },
  };
}
