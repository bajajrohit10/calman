-- §89 Item 4. The 239 existing competitor losses, from their call notes.
--
-- NOT YET APPLIED when this file was committed. The brief says to run it only
-- after the per-rule counts and the catch-all list have been read, and those
-- are in the §89 report. Applying this file is the go-ahead.
--
-- The rules are the brief's, in the brief's order, first match wins, matched
-- against the lowercased discussion of the lead's most recent competitor
-- outcome call. Three things are worth knowing before it runs:
--
--   * 'purchased from ahemadabad local agent - ca shikha updhyay' names both a
--     local agent and Shikha. Rule 8 comes before rule 9, so it lands on Local
--     Agent — which is why Local Agent is 15 rather than the expected 14 and
--     Shikha 1 rather than 2.
--   * three notes say 'y1', which is YOne (Yash) on the seeded list, and no
--     rule names it: two land on Local Agent (they also say "offline centre"
--     or "local agent") and one falls to Don't know.
--   * 'purchased from offical site - ca siddharth agarwal' is a teacher's own
--     website with 'official' misspelled, so it falls to Don't know too, and
--     four notes saying 'other faculty' do the same — the rules match
--     'faculties', 'faculty site' and 'through faculty' but not that.
--
-- All three are the spec behaving as written rather than defects, and all
-- three are a Promote or Merge away in Settings → Competitors afterwards.

do $$
declare
  r record;
  v_total integer := 0;
begin
  create temp table b89 on commit drop as
  with comp as (
    select e.id,
           lower(coalesce((select c.discussion
                             from public.calls c
                            where c.enquiry_id = e.id and c.outcome = 'competitor'
                            order by c.call_date desc, c.called_at desc, c.id desc
                            limit 1), '')) as note
      from public.enquiries e
     where e.lost_reason = 'competitor'
       and e.competitor_id is null
       and e.competitor_other is null
  )
  select id, note,
    case
      when note ~ 'bb ?v|bbvpl|bb virutal|storefront|flagship|franchisee|vsmart|ultimate|edusmart|ekatvam|igp|brainery|akg|official|faculty site|faculties|direct .*site|teacher site|through faculty|sirs? site|site as the same'
        then 'Teacher''s own website'
      when note ~ 'lecture ?w'                     then 'Lecturewaala'
      when note ~ 'ca point'                       then 'CAPoint'
      when note ~ 'sld'                            then 'SLD'
      when note ~ 'padai'                          then 'Padai Wale'
      when note ~ 'edugyan'                        then 'Edugyan'
      when note ~ 'conferenza'                     then 'Conferenza'
      when note ~ 'agent|broker|offline|local'     then 'Local Agent'
      when note ~ 'shikha'                         then 'Shikha'
      when note ~ 'girish'                         then 'Girish'
      when note ~ 'aman'                           then 'Legendwala (Aman)'
      else 'Don''t know'
    end as competitor
  from comp;

  -- Printed before the write, which is the whole point of the do-block.
  raise notice '--- §89 backfill, per rule ---';
  for r in select competitor, count(*) as n from b89 group by 1 order by 2 desc, 1 loop
    raise notice '% : %', lpad(r.n::text, 4), r.competitor;
    v_total := v_total + r.n;
  end loop;
  raise notice 'total: %', v_total;

  raise notice '--- notes that fell to the catch-all ---';
  for r in select note, count(*) as n from b89
            where competitor = 'Don''t know' group by 1 order by 2 desc, 1 loop
    raise notice '% : %', lpad(r.n::text, 4), r.note;
  end loop;

  -- Every row must match a seeded competitor, or the join below would silently
  -- leave leads unset and the constraint would then refuse to validate.
  if exists (select 1 from b89 b
              where not exists (select 1 from public.competitors c
                                 where c.name = b.competitor)) then
    raise exception 'a rule named a competitor that is not seeded';
  end if;

  update public.enquiries e
     set competitor_id = c.id
    from b89 b
    join public.competitors c on c.name = b.competitor
   where e.id = b.id;

  raise notice 'backfilled % leads', v_total;
end $$;

-- The other half of the rule, now that every competitor loss names somebody.
-- NOT VALID is not used: there is nothing left to exempt, and a constraint that
-- has never been validated is one nobody can trust.
alter table public.enquiries
  drop constraint enquiries_competitor_only_when_lost_to_one;

alter table public.enquiries
  add constraint enquiries_competitor_exactly_one_when_lost
  check (
    case
      when lost_reason = 'competitor'
        then (competitor_id is not null) <> (competitor_other is not null)
      else competitor_id is null and competitor_other is null
    end
  );
