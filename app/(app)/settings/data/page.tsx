import { requireAdminProfile } from "@/lib/auth";
import {
  EMPTY_FILTER,
  loadArchiveBatches,
  loadArchivePreview,
  type ArchiveFilter,
} from "@/lib/archive";
import type { EnquiryStatus, EnquiryType, LostReason } from "@/lib/enquiry-labels";

import { DataManagement } from "./data-management";

export const metadata = { title: "Data management · Calman" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || null;

/**
 * The status checkboxes submit repeated `statuses=` values; a hand-built or
 * pasted link may comma-join them instead. Both shapes mean the same thing.
 */
const many = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v : v ? [v] : [])
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * §9 Data management. Admin-gated by the settings layout; the purge controls
 * are further gated to super_admin, here and in the function.
 *
 * The filter lives in the query string like every other filter in Calman, so
 * the count on screen is reproducible and a link to it means something.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const { profile } = await requireAdminProfile();
  const sp = await searchParams;

  const mode = one(sp.mode) === "purge" ? "purge" : "archive";
  const filter: ArchiveFilter = {
    ...EMPTY_FILTER,
    createdFrom: one(sp.createdFrom),
    createdTo: one(sp.createdTo),
    statuses: many(sp.statuses) as EnquiryStatus[],
    type: one(sp.type) as EnquiryType | null,
    lostReason: one(sp.lostReason) as LostReason | null,
  };

  const archived = mode === "purge";
  const [{ preview, error }, { batches, error: batchError }] = await Promise.all([
    loadArchivePreview(filter, archived),
    loadArchiveBatches(),
  ]);

  return (
    <DataManagement
      mode={mode}
      filter={filter}
      preview={preview}
      error={error ?? batchError}
      batches={batches}
      isSuperAdmin={profile.role === "super_admin"}
    />
  );
}
