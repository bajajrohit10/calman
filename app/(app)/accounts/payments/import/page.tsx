import { PageHeader } from "@/components/ui";
import { requireAccountsProfile } from "@/lib/auth";
import { PaymentImportForm } from "./import-form";

export const metadata = { title: "Import payments · Accounts · Calman" };

/**
 * §50F.2. The monthly payments import.
 *
 * The workbook is 126 tabs and only 59 of them are payments, so the preview's
 * job is as much to say what it ignored as what it will write: a payment tab
 * that grows a title row stops looking like one, and the only defence is that
 * the screen names every sheet it skipped.
 */
export default async function Page() {
  await requireAccountsProfile();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Import payments"
        description="Upload the monthly payments workbook. Every tab is read; nothing is written until you have seen the preview."
      />
      <PaymentImportForm />
    </div>
  );
}
