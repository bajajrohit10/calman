-- Price check (27 Oct 2026): rules — one answer from the owner that settles
-- many To do items at once, and keeps applying on every refresh.
--   kind 'option_type', key e.g. 'live_at_home', answer 'never_sell' | 'sell'
--   kind 'price_down',  key 'all',               answer 'keep_ours' | 'follow_bb'
-- A rule never chooses which BB product a variant is linked to. New table,
-- nothing existing changes.

create table public.price_check_rules (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('option_type', 'price_down')),
  key text not null,
  answer text not null,
  note text,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz not null default now(),
  unique (kind, key)
);

alter table public.price_check_rules enable row level security;

create policy price_check_rules_select on public.price_check_rules
  for select to authenticated using ((select app.is_admin()));
create policy price_check_rules_insert on public.price_check_rules
  for insert to authenticated with check ((select app.is_admin()));
create policy price_check_rules_update on public.price_check_rules
  for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()));
create policy price_check_rules_delete on public.price_check_rules
  for delete to authenticated using ((select app.is_admin()));

create trigger z_audit_price_check_rules
  after insert or update or delete on public.price_check_rules
  for each row execute function audit.log_change();
