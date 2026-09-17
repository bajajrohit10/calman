import { PageHeader } from "@/components/ui";
import { requireAccountsProfile } from "@/lib/auth";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import sales · Accounts · Calman" };

/**
 * §50E.2. The monthly sales import.
 *
 * Preview then commit, with nothing written until the counts have been looked
 * at. The column mapping is fixed in lib/accounts/sales-sheet.ts rather than
 * chosen here: the sheet is produced by the same export every month, and a
 * mapping UI would be a way to get it wrong quietly. A missing column fails
 * loudly with its name instead.
 */
export default async function Page() {
  await requireAccountsProfile();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Import sales"
        description="Upload the monthly sales workbook. Nothing is written until you have seen the preview."
      />
      <ImportForm />
    </div>
  );
}
