-- Two gaps left open by Brief 23, and a race.
--
-- 1. 'dropped' is the third way a lead is lost — a purchased call that won
--    nothing — and it was left out of offer eligibility because the facet
--    named only two. It is the same kind of lead as the other two: somebody
--    who wanted the course and does not have it. In it goes, with its own
--    place in the filter.
--
-- 2. Two counsellors ringing the same student under the same offer at the same
--    moment each opened their own reopened enquiry. The lock on the lost row
--    already serialises the common case — the same lead twice — but a student
--    with two lost enquiries under one offer takes two different locks and
--    nothing stopped the second insert.

-- ---------------------------------------------------------------------------
-- 1. Lost – dropped joins the offer statuses
-- ---------------------------------------------------------------------------

do $$
declare
  fn record;
  src text;
  patched text;
begin
  for fn in
    select p.oid, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('recommended_calls', 'recommended_facets')
  loop
    src := pg_get_functiondef(fn.oid);
    patched := src;

    -- The default: all of them, still.
    patched := replace(patched,
      'array[''open'',''lost_exhausted'',''lost_competitor'']',
      'array[''open'',''lost_exhausted'',''lost_competitor'',''lost_dropped'']');
    if patched = src then
      raise exception 'no offer-status default found in %', fn.proname;
    end if;

    -- The arm that admits a lost lead to the bucket.
    patched := regexp_replace(
      patched,
      '(or \(e\.status = ''lost'' and e\.lost_reason = ''competitor''\s+and ''lost_competitor'' = any \(t\.os\)\))',
      E'\\1\n             or (e.status = ''lost'' and e.lost_reason = ''dropped''\n                 and ''lost_dropped'' = any (t.os))',
      'g');
    if patched not like '%lost_dropped'' = any (t.os)%' then
      raise exception 'no offer-status arm found in %', fn.proname;
    end if;

    execute patched;
  end loop;
end $$;

-- The facet's own label for a row, so the three-way filter becomes four.
do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'recommended_facets';

  patched := regexp_replace(
    src,
    '(when e\.status = ''lost'' and e\.lost_reason = ''competitor'' then ''lost_competitor'')',
    E'\\1\n       when e.status = ''lost'' and e.lost_reason = ''dropped'' then ''lost_dropped''',
    'g');

  if patched = src then
    raise exception 'recommended_facets: no offer_status mapping found';
  end if;

  execute patched;
end $$;

-- And the count the offer form shows while somebody is typing targets.
do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'offer_match_count';

  patched := replace(src,
    'e.lost_reason in (''max_followups'', ''competitor'')',
    'e.lost_reason in (''max_followups'', ''competitor'', ''dropped'')');

  if patched = src then
    raise exception 'offer_match_count: no lost-reason list found';
  end if;

  execute patched;
end $$;


-- ---------------------------------------------------------------------------
-- 2. One reopened enquiry per student per offer
-- ---------------------------------------------------------------------------
--
-- Recorded on the row rather than inferred from the enquiry_sources note the
-- reopen writes. The note is for a person to read; this is what the guard
-- below matches on, and parsing "(was #112)" back out of prose to decide
-- whether to create a second enquiry is not a thing to build.

alter table public.enquiries
  add column if not exists reopened_via_offer_id uuid references public.offers (id),
  add column if not exists reopened_from_enquiry_id bigint references public.enquiries (id);

comment on column public.enquiries.reopened_via_offer_id is
  'Set when §23.5 opened this enquiry from a lost one during an offer call. '
  'Also the key the one-per-student-per-offer guard matches on.';

-- The backstop. The guard query below is what normally answers, but two
-- transactions can both read "no row" before either commits, and a student
-- with two lost enquiries under one offer does not serialise on a shared lock.
-- Partial on open: once the reopened enquiry is won or lost, a later offer is
-- entitled to open another.
create unique index if not exists enquiries_one_reopen_per_offer_idx
  on public.enquiries (student_id, reopened_via_offer_id)
  where reopened_via_offer_id is not null and status = 'open';

create or replace function public.reopen_via_offer(
  p_enquiry_id bigint,
  p_offer_id uuid
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  old public.enquiries%rowtype;
  v_offer public.offers%rowtype;
  v_new bigint;
  v_note text;
begin
  if not app.is_staff() then
    raise exception 'not authorised to reopen an enquiry'
      using errcode = '42501';
  end if;

  select * into old from public.enquiries where id = p_enquiry_id for update;
  if not found then
    raise exception 'enquiry % does not exist', p_enquiry_id using errcode = 'P0002';
  end if;
  if old.type <> 'purchase' then
    raise exception 'only a purchase enquiry can be reopened by an offer'
      using errcode = '22023';
  end if;
  if old.status <> 'lost' then
    raise exception 'only a lost enquiry is reopened by an offer (this one is %)', old.status
      using errcode = '22023';
  end if;
  if old.archived_at is not null then
    raise exception 'enquiry % is archived', p_enquiry_id using errcode = '22023';
  end if;

  select * into v_offer from public.offers where id = p_offer_id;
  if not found then
    raise exception 'offer % does not exist', p_offer_id using errcode = 'P0002';
  end if;

  -- Already reopened, by whoever got here first. Read after the lock above, so
  -- two counsellors on the *same* lead serialise and the second one finds the
  -- first one's enquiry rather than making a twin.
  select e.id into v_new
    from public.enquiries e
   where e.student_id = old.student_id
     and e.reopened_via_offer_id = p_offer_id
     and e.status = 'open'
     and e.archived_at is null
   order by e.id
   limit 1;

  if v_new is not null then
    return v_new;
  end if;

  v_note := 'Reopened via offer ' || v_offer.name;

  -- The new enquiry starts clean: no calls, so no fresh date and no slots, and
  -- recompute will leave it open until somebody calls it. The grading is
  -- carried because it is what we know about the person, not about the dead
  -- enquiry.
  begin
    insert into public.enquiries (
      student_id, type, source_id, product_text, term_id,
      importance, lead_verification, status, created_by,
      reopened_via_offer_id, reopened_from_enquiry_id
    )
    values (
      old.student_id, 'purchase', old.source_id,
      case when nullif(btrim(coalesce(old.product_text, '')), '') is null
           then v_note
           else old.product_text || E'\n' || v_note end,
      old.term_id, old.importance, old.lead_verification, 'open',
      (select auth.uid()), p_offer_id, p_enquiry_id
    )
    returning id into v_new;
  exception when unique_violation then
    -- The backstop fired: somebody else's insert landed between the read above
    -- and this one. Theirs is as good as ours.
    select e.id into v_new
      from public.enquiries e
     where e.student_id = old.student_id
       and e.reopened_via_offer_id = p_offer_id
       and e.status = 'open'
       and e.archived_at is null
     order by e.id
     limit 1;

    if v_new is null then
      raise;
    end if;
    return v_new;
  end;

  -- Only the lines the offer is actually about. Copying the whole dead
  -- enquiry would put a teacher the student already said no to back on a list
  -- as though it were live interest.
  insert into public.enquiry_items (
    enquiry_id, teacher_id, course_id, subject_id, content_id, status, created_by
  )
  select distinct v_new, i.teacher_id, i.course_id, i.subject_id, i.content_id,
         'open'::public.item_status, (select auth.uid())
    from public.enquiry_items i
   where i.enquiry_id = p_enquiry_id
     and exists (
       select 1 from public.offer_matches om
        where om.offer_id = p_offer_id
          and om.item_id = i.id
     );

  insert into public.enquiry_sources (enquiry_id, source_id, note)
  values (v_new, old.source_id, v_note || ' (was #' || p_enquiry_id || ')');

  return v_new;
end;
$$;

comment on function public.reopen_via_offer is
  'A live outcome on an offer call to a lost lead opens a new enquiry for the '
  'student (§23.5, §4.8): the original''s source and term, the grading, and '
  'only the interest lines the offer targets. One per student per offer while '
  'it is open — a second caller gets the first one''s enquiry. The lost '
  'enquiry is left exactly as it was.';

revoke all on function public.reopen_via_offer from public;
grant execute on function public.reopen_via_offer to authenticated;
