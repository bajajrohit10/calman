-- What to call an offer's sub-tab on My Day (§24.2).
--
-- "Diwali Discount" on its own does not tell a counsellor what is behind the
-- tab; "Diwali Discount (BB Virtuals)" does. The bracket is the offer's target
-- read at the level it was aimed at: an offer aimed at a body is named by the
-- body, one aimed at faculty by the faculty, and one aimed at neither by
-- whatever it does name.
--
-- The order is the same precedence the matching rule uses — institute, then
-- teacher, then course, then subject — so the label says the same thing about
-- the offer that the bucket does. string_agg returns null over no rows, which
-- is what makes the coalesce fall through cleanly; an offer with no targets at
-- all gets no bracket rather than an empty one.

create or replace function public.offer_tab_labels(p_ids uuid[])
returns table (offer_id uuid, name text, target_label text)
language sql
stable
security invoker
set search_path to ''
as $function$
  select
    o.id,
    o.name,
    coalesce(
      (select string_agg(i.name, ', ' order by i.name)
         from public.offer_institutes oi
         join public.institutes i on i.id = oi.institute_id
        where oi.offer_id = o.id),
      (select string_agg(t.name, ', ' order by t.name)
         from public.offer_teachers ot
         join public.teachers t on t.id = ot.teacher_id
        where ot.offer_id = o.id),
      (select string_agg(c.name, ', ' order by c.name)
         from public.offer_courses oc
         join public.courses c on c.id = oc.course_id
        where oc.offer_id = o.id),
      (select string_agg(s.name, ', ' order by s.name)
         from public.offer_subjects os
         join public.subjects s on s.id = os.subject_id
        where os.offer_id = o.id)
    )
  from public.offers o
  where o.id = any (p_ids)
  order by o.name;
$function$;

comment on function public.offer_tab_labels is
  'Name and target of each offer, for My Day''s offer sub-tabs (§24.2). The '
  'target follows the same precedence the matching rule does — institute, '
  'teacher, course, subject — so the tab says what the bucket means.';

revoke all on function public.offer_tab_labels from public;
grant execute on function public.offer_tab_labels to authenticated;
