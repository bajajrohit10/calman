-- §89. The three competitor writers have to be SECURITY DEFINER.
--
-- `authenticated` has SELECT and INSERT on public.enquiries and no UPDATE at
-- all: every update to a lead in this project goes through a definer function
-- (app.recompute_enquiry, public.set_ticket_fields, public.set_product_text),
-- which is how the columns a counsellor may change are kept to the ones those
-- functions choose to change. Written as SECURITY INVOKER, these three failed
-- with "permission denied for table enquiries" — and set_enquiry_competitor
-- failed quietly enough that the call saved, the recompute's fallback wrote
-- "Don't know", and the competitor the counsellor actually picked was lost.
--
-- Caught by a ZTEST lead saved against SLD coming back as Don't know.
--
-- Each therefore checks its own caller, because a definer function is a hole
-- in RLS by definition: set_enquiry_competitor wants any staff member (a
-- counsellor logs the call), the other two want an admin (they re-point every
-- lead carrying a name).

create or replace function public.set_enquiry_competitor(
  p_enquiry_id bigint,
  p_competitor_id uuid default null,
  p_competitor_other text default null
) returns void
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_other text := nullif(btrim(coalesce(p_competitor_other, '')), '');
  v_lost public.lost_reason;
begin
  -- The gate RLS would have been, said explicitly because definer bypasses it.
  if not (select app.is_staff()) then
    raise exception 'not authorised to record a competitor' using errcode = '42501';
  end if;

  if (p_competitor_id is null) = (v_other is null) then
    raise exception 'name one competitor: either a listed one or a typed name, not both and not neither';
  end if;

  select e.lost_reason into v_lost
    from public.enquiries e where e.id = p_enquiry_id;
  if not found then
    raise exception 'enquiry % not found', p_enquiry_id;
  end if;
  if v_lost is distinct from 'competitor' then
    raise exception 'enquiry % is not a competitor loss', p_enquiry_id;
  end if;

  if p_competitor_id is not null
     and not exists (select 1 from public.competitors c where c.id = p_competitor_id) then
    raise exception 'no such competitor';
  end if;

  -- Both in one statement: setting them in two would pass through the state
  -- the "not both" constraint exists to forbid.
  update public.enquiries e
     set competitor_id = p_competitor_id,
         competitor_other = v_other
   where e.id = p_enquiry_id;
end $fn$;

create or replace function public.promote_competitor_other(
  p_name text,
  p_new_name text default null
) returns uuid
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_new text := coalesce(nullif(btrim(coalesce(p_new_name, '')), ''), v_name);
  v_id uuid;
  v_next integer;
begin
  if not (select app.is_admin()) then
    raise exception 'only a manager or super admin can change the competitor list'
      using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'which typed name?';
  end if;

  select c.id into v_id from public.competitors c where lower(c.name) = lower(v_new);
  if v_id is null then
    select coalesce(max(c.sort_order), 0) + 10 into v_next from public.competitors c;
    insert into public.competitors (name, sort_order)
    values (v_new, v_next)
    returning id into v_id;
  end if;

  update public.enquiries e
     set competitor_id = v_id,
         competitor_other = null
   where e.competitor_other = v_name;

  return v_id;
end $fn$;

create or replace function public.merge_competitor_other(
  p_name text,
  p_competitor_id uuid
) returns bigint
language plpgsql
security definer
set search_path to ''
as $fn$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_n bigint;
begin
  if not (select app.is_admin()) then
    raise exception 'only a manager or super admin can change the competitor list'
      using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'which typed name?';
  end if;
  if not exists (select 1 from public.competitors c where c.id = p_competitor_id) then
    raise exception 'no such competitor';
  end if;

  with moved as (
    update public.enquiries e
       set competitor_id = p_competitor_id,
           competitor_other = null
     where e.competitor_other = v_name
    returning 1
  )
  select count(*) into v_n from moved;

  return v_n;
end $fn$;
