/**
 * The nine master lists, described once.
 *
 * They differ only in their extra columns, so the screen is one engine driven
 * by this config rather than eight near-identical pages. TABLES doubles as the
 * server-side allowlist: an action will not touch a table that is not a key
 * here, so a forged form cannot aim a write at `profiles`.
 */

/** The nine tables this screen is allowed to touch. */
export type MasterTable =
  | "sources"
  | "institutes"
  | "teachers"
  | "courses"
  | "subjects"
  | "contents"
  | "terms"
  | "whatsapp_templates"
  | "holidays";

export type FieldKind =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "course"
  | "institute"
  | "stage";

export type FieldSpec = {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  width?: string;
};

export type ListSpec = {
  key: string;
  label: string;
  table: MasterTable;
  /** Primary key column. Every list uses `id` except holidays, keyed by date. */
  pk: string;
  blurb: string;
  fields: FieldSpec[];
  orderBy: { column: string; ascending: boolean }[];
  /** Rendered grouped under their course rather than as one flat list. */
  groupByCourse?: boolean;
  /** Carries sort_order and shows up/down controls (§11.1). */
  reorderable?: boolean;
};

const NAME: FieldSpec = {
  name: "name",
  label: "Name",
  kind: "text",
  required: true,
};

export const LISTS: ListSpec[] = [
  {
    key: "sources",
    label: "Sources",
    table: "sources",
    pk: "id",
    blurb: "Where an enquiry came from — the channel recorded on every lead.",
    fields: [NAME],
    orderBy: [{ column: "name", ascending: true }],
  },
  {
    key: "institutes",
    label: "Institutes",
    table: "institutes",
    pk: "id",
    blurb:
      "The bodies teachers teach under. Teachers link to one optionally; offers will target them in Phase 2.",
    fields: [NAME],
    orderBy: [{ column: "name", ascending: true }],
  },
  {
    key: "teachers",
    label: "Teachers",
    table: "teachers",
    pk: "id",
    blurb:
      "Faculty names. Teacher-wise won/lost analytics run on enquiry items, so spelling matters — merge duplicates rather than adding variants.",
    fields: [
      NAME,
      {
        name: "institute_id",
        label: "Institute",
        kind: "institute",
        width: "w-48",
        hint: "Optional. Offers will target institutes in Phase 2.",
      },
    ],
    orderBy: [{ column: "name", ascending: true }],
  },
  {
    key: "courses",
    label: "Courses",
    table: "courses",
    pk: "id",
    blurb:
      "CA Final, CA Inter and so on. Subjects hang off these. The order here is the order every filter, facet and picker uses.",
    fields: [NAME],
    orderBy: [
      { column: "sort_order", ascending: true },
      { column: "name", ascending: true },
    ],
    reorderable: true,
  },
  {
    key: "subjects",
    label: "Subjects",
    table: "subjects",
    pk: "id",
    blurb:
      "Each subject belongs to exactly one course; the database enforces that an enquiry item cannot pair a subject with the wrong course.",
    fields: [
      NAME,
      { name: "course_id", label: "Course", kind: "course", required: true, width: "w-48" },
    ],
    orderBy: [
      { column: "sort_order", ascending: true },
      { column: "name", ascending: true },
    ],
    groupByCourse: true,
    reorderable: true,
  },
  {
    key: "contents",
    label: "Contents",
    table: "contents",
    pk: "id",
    blurb:
      "Product type, in the order the recommended list prefers them: lower priority number is called first (spec §6).",
    fields: [
      NAME,
      {
        name: "priority",
        label: "Priority",
        kind: "number",
        required: true,
        hint: "1 is called first",
        width: "w-24",
      },
    ],
    orderBy: [{ column: "priority", ascending: true }],
  },
  {
    key: "terms",
    label: "Terms",
    table: "terms",
    pk: "id",
    blurb: "Exam attempts. Sort order is chronological, not alphabetical.",
    fields: [
      NAME,
      { name: "sort_order", label: "Order", kind: "number", width: "w-24" },
    ],
    orderBy: [{ column: "sort_order", ascending: true }],
  },
  {
    key: "whatsapp_templates",
    label: "WhatsApp templates",
    table: "whatsapp_templates",
    pk: "id",
    blurb:
      "Message bodies offered by the WhatsApp button. The picker opens on the template matching the lead's stage.",
    fields: [
      NAME,
      {
        name: "body",
        label: "Message",
        kind: "textarea",
        required: true,
        placeholder: "Hi {name}, about your {course} enquiry…",
      },
      {
        name: "stage",
        label: "Stage",
        kind: "stage",
        width: "w-40",
        hint: "When the picker offers this first",
      },
      { name: "sort_order", label: "Order", kind: "number", width: "w-24" },
    ],
    orderBy: [{ column: "sort_order", ascending: true }],
  },
  {
    key: "holidays",
    label: "Holidays",
    table: "holidays",
    pk: "date",
    blurb:
      "Non-working days. Sundays are skipped automatically; Saturday is a working day. A follow-up date landing on one of these moves to the next working day.",
    fields: [
      { name: "date", label: "Date", kind: "date", required: true, width: "w-40" },
      NAME,
    ],
    orderBy: [{ column: "date", ascending: true }],
  },
];

export const TABLES = Object.fromEntries(LISTS.map((l) => [l.table, l]));

export function listByKey(key: string | undefined): ListSpec {
  return LISTS.find((l) => l.key === key) ?? LISTS[0];
}
