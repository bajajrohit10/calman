-- §50A. service_role needs the same table privileges the app role has.
--
-- The policy loop granted to `authenticated` only, so seeding and any
-- back-office script — both of which use the service key — were refused at the
-- privilege check before RLS was ever consulted. service_role bypasses RLS but
-- it does not bypass GRANT, which is a distinction worth remembering: the key
-- that ignores policies still needs to be allowed at the table.
do $$
declare
  t text;
begin
  foreach t in array array[
    'vendors', 'vendor_aliases', 'rate_grid', 'combo_rates', 'portal_prices',
    'sales_batches', 'sales_lines', 'payment_batches', 'payments',
    'adjustments', 'portal_ledger'
  ] loop
    execute format(
      'grant select, insert, update, delete on accounts.%I to service_role', t);
  end loop;
end $$;

grant select on accounts.portal_balances to service_role;

-- Anything added to this schema later should arrive with the same privileges
-- rather than waiting to be noticed.
alter default privileges in schema accounts
  grant select, insert, update, delete on tables to authenticated, service_role;

notify pgrst, 'reload schema';
