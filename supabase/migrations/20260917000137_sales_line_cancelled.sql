-- §50E.2. `cancelled` becomes a status a sales line can hold.
--
-- The original constraint allowed draft/ready/paid/disputed/deferred, on the
-- reasoning that a cancelled order is a line with no_remittance_reason =
-- 'cancelled' — the row still has to exist so next month's import can match
-- the order again, and the reason column already said why it earns nothing.
--
-- The August sheet shows why that is not enough. 51 rows name "cancelled" in
-- the Accounting Vendor column itself: the cancellation is the fact being
-- recorded, not a note on a live line, and 18 of them have no surviving row to
-- attach a reason to. Leaving them as `draft` would put them in the working
-- list of everything still to be rated and chased, which is the opposite of
-- what they are. They keep no_remittance_reason = 'cancelled' as well, so
-- nothing that reads the reason column changes.
alter table accounts.sales_lines drop constraint sales_lines_status_check;

alter table accounts.sales_lines add constraint sales_lines_status_check
  check (status in ('draft', 'ready', 'paid', 'disputed', 'deferred', 'cancelled'));
