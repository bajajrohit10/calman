-- Order the report by what it prints, not by what it groups on.
--
-- 0058 ordered the final select by the grain key. For the day grain that is
-- the date and reads correctly; for the counsellor grain it is the profile's
-- uuid, so the team came out in an order that looks random and changes when
-- somebody is added. The label sorts correctly for both — a day's label is its
-- ISO date — so the order follows the column the reader is looking at.
--
-- Patched off the live definition rather than restated, and it raises if the
-- pattern is not found: an exact-string patch that silently matches nothing is
-- the failure mode this project has hit three times.

do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'call_report';

  if src is null then
    raise exception 'public.call_report is not defined';
  end if;

  patched := regexp_replace(
    src,
    'order\s+by\s+g\.is_total\s*,\s*g\.k\s*;',
    'order by g.is_total, g.label;',
    'g'
  );

  if patched = src then
    raise exception 'call_report: the order by clause was not found — nothing patched';
  end if;

  execute patched;
end;
$$;
