-- §11.1 Course restructure: explicit ordering, and the master data reconciled.
--
-- Two things at once, because the second needs the first.
--
-- Ordering. Courses and subjects were listed alphabetically everywhere, which
-- put CA Foundation above CA Inter and buried Set A - Law under FR. They now
-- carry sort_order, and every list honours it. The exception by design is a
-- faceted select: Brief 8 decided those sort by count descending, and
-- sort_order becomes the tiebreak — so within equal counts, and within the
-- zero-count group at the bottom, the syllabus order shows through.
--
-- Reconciliation. Renames happen IN PLACE so ids and history survive: CA
-- Final's "DT" carries an enquiry_item, and a drop-and-recreate would orphan
-- it. Nothing is deleted; the three legacy CMA subjects are deactivated, which
-- Settings can undo.
--
-- The starting state was already half-changed by hand, and this reuses that
-- rather than fighting it:
--   * the original single "CMA" course had already been renamed "CMA
--     Foundation" in Settings — same row, same id, still holding its old
--     Foundation/Inter/Final subjects. It stays as CMA Foundation; only those
--     three subjects are deactivated and the four papers added.
--   * "CMA Final" and "CMA Inter" were created by hand this morning and are
--     reused as they are.
--
-- Net: 0 courses created, 0 deactivated. 24 subjects created, 3 deactivated,
-- 10 renamed, 0 deleted.

alter table public.courses  add column sort_order smallint not null default 0;
alter table public.subjects add column sort_order smallint not null default 0;

comment on column public.courses.sort_order is
  'Display order, lowest first. Ties fall back to name. Settings → Master '
  'lists reorders these.';
comment on column public.subjects.sort_order is
  'Display order within the course, lowest first (syllabus order, not '
  'alphabetical).';

-- ---------------------------------------------------------------------------
-- Courses: order only. Every one of the nine already exists.
-- ---------------------------------------------------------------------------
update public.courses set sort_order = v.n, is_active = true
  from (values
    ('CA Final', 1), ('CA Inter', 2), ('CA Foundation', 3),
    ('CMA Final', 4), ('CMA Inter', 5), ('CMA Foundation', 6),
    ('ACCA', 7), ('CFA', 8), ('CS', 9)
  ) as v(name, n)
 where public.courses.name = v.name;

-- ---------------------------------------------------------------------------
-- CA Final: eight subjects, all present, six renamed, all reordered.
-- "DT" is the one carrying an enquiry_item — renamed, never recreated.
-- ---------------------------------------------------------------------------
update public.subjects s set name = v.new_name, sort_order = v.n, is_active = true
  from (values
    ('FR',          'FR',                             1),
    ('AFM',         'AFM/SFM',                        2),
    ('Audit',       'Audit',                          3),
    ('DT',          'Direct Tax',                     4),
    ('IDT',         'Indirect Tax',                   5),
    ('IBS',         'Integrated Business Solutions',  6),
    ('Set A Law',   'Set A - Law',                    7),
    ('Set B Cost',  'Set B - Costing',                8)
  ) as v(old_name, new_name, n)
 where s.name = v.old_name
   and s.course_id = (select id from public.courses where name = 'CA Final');

-- ---------------------------------------------------------------------------
-- CA Inter: six subjects, all present, three renamed.
-- ---------------------------------------------------------------------------
update public.subjects s set name = v.new_name, sort_order = v.n, is_active = true
  from (values
    ('Adv Account', 'Advanced Accounting', 1),
    ('Law',         'Corporate Law',       2),
    ('Taxation',    'Taxation',            3),
    ('Costing',     'Costing',             4),
    ('Audit',       'Audit and Ethics',    5),
    ('FM SM',       'FM SM',               6)
  ) as v(old_name, new_name, n)
 where s.name = v.old_name
   and s.course_id = (select id from public.courses where name = 'CA Inter');

-- ---------------------------------------------------------------------------
-- CA Foundation: unchanged names, explicit order.
-- ---------------------------------------------------------------------------
update public.subjects s set sort_order = v.n, is_active = true
  from (values
    ('Accounts', 1), ('Law', 2), ('Maths & Stats', 3), ('Economics', 4)
  ) as v(name, n)
 where s.name = v.name
   and s.course_id = (select id from public.courses where name = 'CA Foundation');

-- ---------------------------------------------------------------------------
-- CS: "keep as is" — order only, names untouched.
-- ---------------------------------------------------------------------------
update public.subjects s set sort_order = v.n
  from (values ('Foundation', 1), ('Inter', 2), ('Final', 3)) as v(name, n)
 where s.name = v.name
   and s.course_id = (select id from public.courses where name = 'CS');

-- ---------------------------------------------------------------------------
-- CMA Foundation: the three legacy subjects from the old single "CMA" course
-- are deactivated (not deleted — Settings can put them back), and the four
-- papers added.
-- ---------------------------------------------------------------------------
update public.subjects s set is_active = false
 where s.course_id = (select id from public.courses where name = 'CMA Foundation')
   and s.name in ('Foundation', 'Inter', 'Final');

insert into public.subjects (course_id, name, sort_order, is_active)
select (select id from public.courses where name = 'CMA Foundation'), v.name, v.n, true
  from (values
    ('Business Law & Comm (Paper 1)',        1),
    ('Financial & Cost Accounting (Paper 2)', 2),
    ('Business Maths & Stats (Paper 3)',     3),
    ('Business Economics & Mgmt (Paper 4)',  4)
  ) as v(name, n)
on conflict (course_id, name) do update
  set sort_order = excluded.sort_order, is_active = true;

-- ---------------------------------------------------------------------------
-- CMA Inter: eight papers, none present.
-- ---------------------------------------------------------------------------
insert into public.subjects (course_id, name, sort_order, is_active)
select (select id from public.courses where name = 'CMA Inter'), v.name, v.n, true
  from (values
    ('Business Law (Paper 5)',                  1),
    ('Financial Accounts (Paper 6)',            2),
    ('Direct & Indirect Tax (Paper 7)',         3),
    ('Cost Accounts (Paper 8)',                 4),
    ('OM & SM (Paper 9)',                       5),
    ('Corporate Accounts and Audit (Paper 10)', 6),
    ('FM & DA (Paper 11)',                      7),
    ('Mgmt Accounts (Paper 12)',                8)
  ) as v(name, n)
on conflict (course_id, name) do update
  set sort_order = excluded.sort_order, is_active = true;

-- ---------------------------------------------------------------------------
-- CMA Final: ten papers, none present.
-- ---------------------------------------------------------------------------
insert into public.subjects (course_id, name, sort_order, is_active)
select (select id from public.courses where name = 'CMA Final'), v.name, v.n, true
  from (values
    ('Corporate Law (Paper 13)',                          1),
    ('SFM (Paper 14)',                                    2),
    ('Direct Tax (Paper 15)',                             3),
    ('SCM (Paper 16)',                                    4),
    ('Cost Audit (Paper 17)',                             5),
    ('CFR (Paper 18)',                                    6),
    ('Indirect Tax (Paper 19)',                           7),
    ('Elective SPMBV (Paper 20A)',                        8),
    ('Elective Risk Management (Paper 20B)',              9),
    ('Elective Entrepreneurship And Startup (Paper 20C)', 10)
  ) as v(name, n)
on conflict (course_id, name) do update
  set sort_order = excluded.sort_order, is_active = true;

-- Ordering reads: (course_id, sort_order) for the per-course lists, and
-- sort_order alone for the course list itself.
create index subjects_course_order_idx on public.subjects (course_id, sort_order);
create index courses_order_idx on public.courses (sort_order);
