import { Badge, ErrorNote, PageHeader, Select, CELL, TABLE_HEAD_ROW, cx } from "@/components/ui";
import { requireAccountsProfile } from "@/lib/auth";
import { istToday } from "@/lib/format";
import { loadBatches } from "@/lib/accounts/sales";
import { loadWallets } from "@/lib/accounts/wallets";
import { WalletEntry } from "./wallet-forms";

export const metadata = { title: "Wallets · Accounts · Calman" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || "";
const money = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * §50G.1(b). Portal wallets.
 *
 * We top these up in advance and every portal or centre sale spends from them,
 * so the number that matters is whether there is enough left to get through
 * the month. "Low" compares the balance against what this wallet actually
 * spends in a month rather than against a fixed figure, because ₹50,000 is
 * comfortable for one house and a fortnight for another.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAccountsProfile();
  const sp = await searchParams;

  const batches = await loadBatches();
  const months = batches.map((b) => String(b.month).slice(0, 7));
  const month = one(sp.month) || months[0] || istToday().slice(0, 7);
  const today = istToday();

  const { wallets, error } = await loadWallets(month);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Wallets"
        description="What each portal holds, what it spent, and whether it will last the month."
      />

      <form method="GET" className="flex items-end gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-card">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">Month</span>
          <Select name="month" defaultValue={month} className="w-[140px]" data-testid="wallet-month">
            {(months.length ? months : [month]).map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </label>
        <button type="submit" className="h-[30px] rounded-md bg-accent px-3 text-[12.5px] font-medium text-accent-ink">
          Apply
        </button>
        <span className="ml-auto text-[12px] text-ink-3" data-testid="wallet-count">
          {wallets.length} wallet{wallets.length === 1 ? "" : "s"}
        </span>
      </form>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="grid gap-3 lg:grid-cols-2" data-testid="wallet-cards">
        {wallets.map((w) => (
          <div key={w.vendor_id}
               className={cx("flex flex-col gap-2 rounded-lg border bg-surface p-3 shadow-card",
                 w.low ? "border-danger" : "border-line")}
               data-testid={`wallet-card-${w.vendor_id}`}>
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-[13.5px] font-semibold text-ink">{w.vendor_name}</h2>
              {w.institute ? <span className="text-[11.5px] text-ink-3">{w.institute}</span> : null}
              {w.low ? (
                <Badge tone="warn"><span data-testid="wallet-low">Low balance</span></Badge>
              ) : null}
              <span className={cx("ml-auto text-[17px] tabular-nums",
                w.balance < 0 ? "text-danger" : "text-ink")}
                    data-testid={`wallet-balance-${w.vendor_id}`}>
                {money(w.balance)}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-[11.5px] text-ink-2">
              <div>
                <div className="text-ink-3">Last top-up</div>
                <div data-testid="wallet-last-topup">
                  {w.last_top_up ? `${money(w.last_top_up.amount)} · ${w.last_top_up.date}` : "never"}
                </div>
              </div>
              <div>
                <div className="text-ink-3">Spent in {month}</div>
                <div data-testid="wallet-spent">{money(w.deductions_this_month)}</div>
              </div>
              <div>
                <div className="text-ink-3">Monthly average</div>
                <div>{w.average_monthly_deductions ? money(w.average_monthly_deductions) : "—"}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <WalletEntry vendorId={w.vendor_id} kind="opening" today={today}
                           hasOpening={w.entries.some((e) => e.kind === "opening")} />
              <WalletEntry vendorId={w.vendor_id} kind="top_up" today={today} hasOpening />
              <WalletEntry vendorId={w.vendor_id} kind="adjustment" today={today} hasOpening />
            </div>

            <details>
              <summary className="cursor-pointer text-[12px] text-ink-2" data-testid="wallet-ledger-toggle">
                Ledger — last {w.entries.length} entries
              </summary>
              <div className="mt-1.5 overflow-x-auto">
                <table className="w-full min-w-[440px] text-left text-[11.5px]">
                  <thead className={TABLE_HEAD_ROW}>
                    <tr>
                      <th className="px-2 py-1">Date</th>
                      <th className="px-2 py-1">Kind</th>
                      <th className="px-2 py-1 text-right">Amount</th>
                      <th className="px-2 py-1 text-right">Balance</th>
                      <th className="px-2 py-1">Ref</th>
                    </tr>
                  </thead>
                  <tbody>
                    {w.entries.map((e) => (
                      <tr key={e.id} className="border-b border-line last:border-b-0">
                        <td className={cx(CELL, "text-ink-2")}>{e.entry_date}</td>
                        <td className={cx(CELL, "text-ink-3")}>{e.kind}</td>
                        <td className={cx(CELL, "text-right tabular-nums",
                          e.amount < 0 ? "text-danger" : "text-ink")}>{money(e.amount)}</td>
                        <td className={cx(CELL, "text-right tabular-nums text-ink-2")}>
                          {money(e.balance_after)}
                        </td>
                        <td className={cx(CELL, "text-ink-3")}>{e.order_id ?? e.note ?? "—"}</td>
                      </tr>
                    ))}
                    {w.entries.length === 0 ? (
                      <tr><td colSpan={5} className="px-2 py-4 text-center text-ink-3">
                        Nothing in this wallet yet. Type its opening balance to start.
                      </td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        ))}
        {wallets.length === 0 ? (
          <p className="rounded-lg border border-line bg-surface px-3 py-8 text-center text-[12.5px] text-ink-3"
             data-testid="wallet-empty">
            No vendor is marked as tracking a portal balance.
          </p>
        ) : null}
      </div>
    </div>
  );
}
