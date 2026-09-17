-- §50.1. The Enquiries date filter reads the same instant its column does.
--
-- Brief 48 made that column show, and sort by, coalesce(arrived_at,
-- created_at) — when the lead actually arrived. The filter behind it kept
-- reading created_at, which is when the row was written. For everything typed
-- as the phone rings those are the same instant and nobody would ever notice.
--
-- They are not the same for the two cases arrived_at exists for. An AC entry
-- keyed at six for a five-o'clock enquiry, or an import of yesterday's file,
-- shows "16 Sept 18:30" in the column and was created today — so the screen
-- would display one date, sort by it, and then filter by a different one.
-- Picking "Today" would return a row visibly dated yesterday, which reads as a
-- bug and is indistinguishable from one.
--
-- So the screen now has a single notion of when an enquiry arrived, used for
-- all three. The trade is deliberate and worth stating: a lead keyed today but
-- timed yesterday no longer appears under Today. That is the honest answer —
-- it is yesterday's lead, and the column has been saying so since Brief 48.
do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'enquiries_table';

  patched := replace(
    src,
    E'         or (e.created_at at time zone ''Asia/Kolkata'')::date >= p_created_from)',
    E'         or (coalesce(e.arrived_at, e.created_at) at time zone ''Asia/Kolkata'')::date >= p_created_from)'
  );
  if patched = src then raise exception 'enquiries_table: created_from filter not matched'; end if;
  src := patched;

  patched := replace(
    src,
    E'         or (e.created_at at time zone ''Asia/Kolkata'')::date <= p_created_to)',
    E'         or (coalesce(e.arrived_at, e.created_at) at time zone ''Asia/Kolkata'')::date <= p_created_to)'
  );
  if patched = src then raise exception 'enquiries_table: created_to filter not matched'; end if;

  -- Same argument list, so this replaces rather than overloading.
  execute patched;
end $$;
