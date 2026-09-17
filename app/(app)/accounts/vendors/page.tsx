import Link from "next/link";

import { Badge, PageHeader, Select, ErrorNote } from "@/components/ui";
import { requireAccountsProfile } from "@/lib/auth";
import { instituteOptions, loadVendors } from "@/lib/accounts/vendors";
import { VendorEdit } from "./vendor-edit";

export const metadata = { title: "Vendors · Accounts · Calman" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) || "";

const KINDS = [
  { id: "teacher", label: "Teacher" },
  { id: "institute", label: "Institute" },
  { id: "books", label: "Books" },
  { id: "zeroinfy_internal", label: "Zeroinfy internal" },
];

const MODE_LABELS: Record<string, string> = {
  portal_balance: "Portal balance",
  online_instant: "Online / instant",
  later: "Later",
};

/**
 * The vendor master, read-only (§50A.3).
 *
 * Read-only on purpose at this stage. The list is seeded from a year of real
 * remittance sheets and the first job is to check it against what the team
 * knows — which is reading, not editing. Rates are deliberately absent: an
 * empty rate_grid is honest about the fact that nobody has agreed them in
 * Calman yet, where a screen full of zeroes would not be.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  await requireAccountsProfile();
  const sp = await searchParams;
  const kind = one(sp.kind);
  const institute = one(sp.institute);

  // The institute filter offers what exists, so it is loaded unfiltered and
  // narrowed here rather than asking the database twice.
  const { rows: all, error } = await loadVendors({});
  const rows = all.filter(
    (r) => (!kind || r.kind === kind) && (!institute || r.institute === institute),
  );
  const institutes = instituteOptions(all);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Vendors"
        description="Everyone remittance can be paid to: teachers, the houses they teach under, books arms, and Zeroinfy itself."
      />

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <form
        method="GET"
        className="flex flex-wrap items-end gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-card"
      >
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Kind
          </span>
          <Select name="kind" defaultValue={kind} className="w-[170px]">
            <option value="">Any</option>
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            Institute
          </span>
          <Select name="institute" defaultValue={institute} className="w-[220px]">
            <option value="">Any</option>
            {institutes.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </Select>
        </label>

        <button
          type="submit"
          className="h-[30px] rounded-md bg-accent px-3 text-[12.5px] font-medium text-accent-ink"
        >
          Apply
        </button>
        <Link
          href="/accounts/vendors"
          className="text-[12.5px] text-ink-3 underline-offset-2 hover:underline"
        >
          Clear
        </Link>
        <span className="ml-auto text-[12px] text-ink-3" data-testid="vendor-count">
          {rows.length} of {all.length} vendors
        </span>
      </form>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full min-w-[1180px] text-left text-[12.5px]">
          <thead className="border-b border-line bg-sunk text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
            <tr>
              <th className="px-2 py-[7px]">Vendor</th>
              <th className="px-2 py-[7px]">Kind</th>
              <th className="px-2 py-[7px]">Institute</th>
              <th className="px-2 py-[7px]">Payment mode</th>
              <th className="px-2 py-[7px]">Wallet</th>
              <th className="px-2 py-[7px]">Settled through</th>
              <th className="px-2 py-[7px] text-right">Aliases</th>
              <th className="px-2 py-[7px] text-right">Opening</th>
              <th className="px-2 py-[7px]">Centre</th>
              <th className="px-2 py-[7px]" />
            </tr>
          </thead>
          <tbody data-testid="vendor-rows">
            {rows.map((v) => (
              <tr key={v.id} className="border-b border-line last:border-b-0">
                <td className="px-2 py-[5px] text-ink">
                  {v.name}
                  {v.is_active ? null : (
                    <span className="ml-1.5 text-[11px] text-ink-3">(inactive)</span>
                  )}
                  {v.note ? (
                    <span className="block text-[11px] text-ink-3">{v.note}</span>
                  ) : null}
                </td>
                <td className="px-2 py-[5px]">
                  <Badge
                    tone={
                      v.kind === "institute"
                        ? "info"
                        : v.kind === "books"
                          ? "warn"
                          : v.kind === "zeroinfy_internal"
                            ? "neutral"
                            : "accent"
                    }
                  >
                    {KINDS.find((k) => k.id === v.kind)?.label ?? v.kind}
                  </Badge>
                </td>
                <td className="px-2 py-[5px] text-ink-2">{v.institute ?? "—"}</td>
                <td className="px-2 py-[5px] text-ink-2">
                  {MODE_LABELS[v.default_payment_mode] ?? v.default_payment_mode}
                </td>
                <td className="px-2 py-[5px] text-ink-2">
                  {v.tracks_portal_balance ? "tracked" : "—"}
                </td>
                {/* §50A.4. Rates are the teacher's, the wallet is the house's;
                    this column is the only place that distinction is visible. */}
                <td className="px-2 py-[5px] text-ink-2">{v.portal_owner_name ?? "—"}</td>
                <td className="px-2 py-[5px] text-right tabular-nums text-ink-3">
                  {v.alias_count}
                </td>
                <td className="px-2 py-[5px] text-right tabular-nums text-ink-2">
                  {v.opening_balance ? `₹${v.opening_balance}` : "—"}
                </td>
                <td className="px-2 py-[5px] text-ink-2" data-testid={`vendor-centre-${v.id}`}>
                  {v.center_discount_amount === null
                    ? "—"
                    : `₹${v.center_discount_amount} above ₹${v.center_discount_threshold}`}
                </td>
                <td className="px-2 py-[5px] align-top">
                  <VendorEdit
                    vendor={{
                      id: v.id, name: v.name, institute: v.institute, kind: v.kind,
                      default_payment_mode: v.default_payment_mode,
                      tracks_portal_balance: v.tracks_portal_balance,
                      portal_owner_vendor_id: v.portal_owner_vendor_id,
                      center_discount_amount: v.center_discount_amount,
                      center_discount_threshold: v.center_discount_threshold,
                      is_active: v.is_active, note: v.note, aliases: v.aliases,
                    }}
                    owners={all.map((o) => ({ id: o.id, name: o.name }))}
                  />
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-ink-3">
                  No vendors match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="text-[11.5px] text-ink-3">
        The name is the one field that cannot be edited: it is what next
        month’s sales and payments sheets are matched against. A vendor that
        needs another spelling gets an alias.
      </p>
    </div>
  );
}
