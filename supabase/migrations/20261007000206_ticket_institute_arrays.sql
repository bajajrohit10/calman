-- §75.1. A ticket can carry several institutes and several teachers.
--
-- One student's complaint can span two houses — a book from one and a video from
-- another — and institute_id / teacher_id could hold only the first, so the
-- second was recorded nowhere and the ticket reported under one institute.
--
-- Arrays rather than junction tables. support.tickets already keeps its
-- multi-value fields this way (issues_work, attachment_urls), the migration is
-- one backfill of the value that is already there, and a GIN index answers both
-- "does this ticket carry institute X" and the facet counts. The price is that
-- Postgres cannot foreign-key an array element, so the trigger below checks that
-- every element names a real master — most of what the foreign key was doing.
--
-- ---------------------------------------------------------------------------
-- 1. The columns.
-- ---------------------------------------------------------------------------
alter table support.tickets
  add column if not exists institute_ids uuid[] not null default '{}',
  add column if not exists teacher_ids   uuid[] not null default '{}',
  -- §75.1. Which of several institutes this was escalated to. Null when the
  -- ticket is not escalated to an institute, or when it carries only one and
  -- there is nothing to choose between.
  add column if not exists escalated_institute_id uuid references public.institutes (id);

comment on column support.tickets.institute_ids is
  '§75.1. Every institute this ticket concerns. institute_id is kept in step as '
  'the first element by support.tickets_sync_faculty() while the old readers are '
  'migrated, and will be dropped once nothing reads it.';
comment on column support.tickets.teacher_ids is
  '§75.1. Every teacher this ticket concerns. teacher_id is kept in step as the '
  'first element, as above.';
comment on column support.tickets.escalated_institute_id is
  '§75.1. The one institute an institute-escalation went to, when the ticket '
  'carries more than one. Reports and the Escalated tab name this rather than '
  'guessing at the first.';

-- ---------------------------------------------------------------------------
-- 2. The backfill: the single value becomes the first element.
-- ---------------------------------------------------------------------------
update support.tickets
   set institute_ids = case when institute_id is null then '{}'::uuid[] else array[institute_id] end,
       teacher_ids   = case when teacher_id   is null then '{}'::uuid[] else array[teacher_id]   end
 where institute_ids = '{}' and teacher_ids = '{}'
   and (institute_id is not null or teacher_id is not null);

-- ---------------------------------------------------------------------------
-- 3. Both shapes stay in step while the readers are migrated.
-- ---------------------------------------------------------------------------
--
-- Two sources of truth is what this codebase has been bitten by before, so this
-- is a transition guard with a stated end, not a design: once every reader and
-- writer uses the arrays, the singular columns and this trigger go together.
--
-- Bidirectional on purpose. A writer that has been migrated sets the array and
-- the singular follows; one that has not sets the singular and the array
-- follows. Whichever moved in this statement wins.
create or replace function support.tickets_sync_faculty()
returns trigger
language plpgsql
set search_path to ''
as $fn$
begin
  if tg_op = 'INSERT' then
    if cardinality(coalesce(new.institute_ids, '{}')) > 0 then
      new.institute_id := new.institute_ids[1];
    elsif new.institute_id is not null then
      new.institute_ids := array[new.institute_id];
    end if;
    if cardinality(coalesce(new.teacher_ids, '{}')) > 0 then
      new.teacher_id := new.teacher_ids[1];
    elsif new.teacher_id is not null then
      new.teacher_ids := array[new.teacher_id];
    end if;
  else
    if new.institute_ids is distinct from old.institute_ids then
      new.institute_id := new.institute_ids[1];
    elsif new.institute_id is distinct from old.institute_id then
      new.institute_ids := case when new.institute_id is null then '{}'::uuid[]
                                else array[new.institute_id] end;
    end if;
    if new.teacher_ids is distinct from old.teacher_ids then
      new.teacher_id := new.teacher_ids[1];
    elsif new.teacher_id is distinct from old.teacher_id then
      new.teacher_ids := case when new.teacher_id is null then '{}'::uuid[]
                              else array[new.teacher_id] end;
    end if;
  end if;

  -- What the foreign keys can no longer do for the arrays. Cheap: these lists
  -- hold one or two elements, never a page of them.
  if exists (select 1 from unnest(new.institute_ids) x
              where not exists (select 1 from public.institutes i where i.id = x)) then
    raise exception 'institute_ids names an institute that does not exist';
  end if;
  if exists (select 1 from unnest(new.teacher_ids) x
              where not exists (select 1 from public.teachers tc where tc.id = x)) then
    raise exception 'teacher_ids names a teacher that does not exist';
  end if;

  return new;
end $fn$;

drop trigger if exists tickets_sync_faculty on support.tickets;
create trigger tickets_sync_faculty
  before insert or update of institute_id, teacher_id, institute_ids, teacher_ids
  on support.tickets
  for each row execute function support.tickets_sync_faculty();

-- ---------------------------------------------------------------------------
-- 4. The queue asks "does this ticket carry X" for every filtered read.
-- ---------------------------------------------------------------------------
create index if not exists tickets_institute_ids_gin on support.tickets using gin (institute_ids);
create index if not exists tickets_teacher_ids_gin   on support.tickets using gin (teacher_ids);
