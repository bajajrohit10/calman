-- Calman — initial schema.
--
-- Covers spec §3 (data model), §4 (lifecycle rules) and §8 (non-functional),
-- as amended by the decisions log in §10.
--
-- Structure of this file:
--   1. extensions and private schemas
--   2. enums
--   3. master tables
--   4. people, core tables, offers, import log, audit log
--   5. helper functions (IST dates, working days, role lookup)
--   6. business triggers — the §4.3 slot rule and the enquiry state machine
--   7. audit trigger
--   8. indexes
--   9. row level security
--  10. grants

-- ---------------------------------------------------------------------------
-- 1. Extensions and private schemas
-- ---------------------------------------------------------------------------

create extension if not exists pg_trgm with schema extensions;

-- `app` holds policy helpers and the state machine; `audit` holds the log
-- trigger. Neither is exposed through PostgREST.
create schema if not exists app;
create schema if not exists audit;

grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Enums
-- ---------------------------------------------------------------------------

-- Declared A -> D on purpose: Postgres sorts enums in declaration order, so
-- §6's "Importance (A -> D)" ordering needs no CASE expression.
create type public.importance as enum ('a', 'b', 'c', 'd');

create type public.user_role as enum ('super_admin', 'manager', 'counsellor', 'ticket_team');
create type public.enquiry_type as enum ('purchase', 'after_sale');
create type public.enquiry_status as enum ('open', 'won', 'lost', 'closed', 'escalated');
create type public.lost_reason as enum ('competitor', 'max_followups', 'dropped');

-- §10 decision 5: `closed` used to mean both "wrong number" and "superseded by
-- a newer enquiry". Only wrong_number is flagged on future imports.
create type public.close_reason as enum ('wrong_number', 'superseded');

create type public.lead_verification as enum ('yes_with_proof', 'yes_without_proof', 'no');

-- After-sale outcomes renamed per §10 decision 4; they map onto enquiry
-- statuses open / escalated / closed.
create type public.call_outcome as enum (
  'follow_up', 'call_back', 'purchased', 'competitor', 'closed',
  'noted', 'escalated', 'resolved');

create type public.item_status as enum ('open', 'won', 'competitor', 'closed');
create type public.assignment_bucket as enum ('follow_up', 'fresh', 'campaign', 'call_back', 'offer');
create type public.issue_category as enum ('video_access', 'book_delivery', 'refund', 'wrong_course', 'other');
create type public.import_outcome as enum ('imported', 'duplicate_updated', 'duplicate_new_enquiry', 'skipped');

-- ---------------------------------------------------------------------------
-- 3. Master tables
--
-- All soft-delete via is_active: a deactivated option still resolves on the
-- historical rows that reference it. `name` is unique so the seed script can
-- be re-run idempotently.
-- ---------------------------------------------------------------------------

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.teachers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (course_id, name),
  -- Target for the enquiry_items composite FK below, which is what stops a
  -- subject being filed under a course it does not belong to.
  unique (id, course_id)
);

create table public.contents (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  priority smallint not null,          -- Full=1 -> Books=5, §6 sort order
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.terms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,           -- May-26, Sep-26, Jan-27 …
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  body text not null,                  -- placeholders {name}, {course}
  sort_order smallint not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- §4 overdue: Saturday is a working day; only Sundays and these dates are
-- skipped (§10 decision 12).
create table public.holidays (
  date date primary key,
  name text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. People and core tables
-- ---------------------------------------------------------------------------

-- No self-signup (§8). A user with no active profile row has app.role() =
-- null, so every policy in section 9 evaluates false and they see nothing.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text not null,
  role public.user_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key default gen_random_uuid(),
  -- §8: the mobile rule is validated in the browser, in the API and here.
  mobile text not null unique
    constraint mobile_is_10_digit_indian check (mobile ~ '^[6-9][0-9]{9}$'),
  name text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create table public.enquiries (
  id bigint generated always as identity primary key,   -- §3 "auto-number ID"
  student_id uuid not null references public.students (id),
  type public.enquiry_type not null,
  source_id uuid references public.sources (id),
  product_text text,
  term_id uuid references public.terms (id),
  importance public.importance,
  lead_verification public.lead_verification,
  status public.enquiry_status not null default 'open',
  lost_reason public.lost_reason,
  close_reason public.close_reason,
  next_follow_up_date date,

  -- Derived. Maintained by app.recompute_enquiry(); never written by the
  -- application, and excluded from the audit change test.
  fresh_call_date date,
  follow_up_slots_used smallint not null default 0,
  last_slot_date date,
  top_content_priority smallint,

  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  closed_at timestamptz,

  constraint status_matches_type check (
    (type = 'purchase'   and status in ('open', 'won', 'lost', 'closed')) or
    (type = 'after_sale' and status in ('open', 'escalated', 'closed'))),
  constraint lost_reason_iff_lost check ((status = 'lost') = (lost_reason is not null)),
  constraint close_reason_only_when_closed check (close_reason is null or status = 'closed'),

  -- Target for the calls composite FK below.
  unique (id, type)
);

create table public.enquiry_items (
  id uuid primary key default gen_random_uuid(),
  enquiry_id bigint not null references public.enquiries (id) on delete cascade,
  teacher_id uuid not null references public.teachers (id),
  course_id uuid not null references public.courses (id),
  subject_id uuid,
  content_id uuid references public.contents (id),
  status public.item_status not null default 'open',
  order_id text,
  amount numeric(12, 2) check (amount is null or amount >= 0),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  -- The subject must belong to the course named on the same row. A plain FK
  -- on subject_id alone would let the two disagree and quietly corrupt the
  -- teacher-wise analytics in §7.
  foreign key (subject_id, course_id) references public.subjects (id, course_id)
);

create table public.calls (
  id bigint generated always as identity primary key,
  enquiry_id bigint not null references public.enquiries (id),
  -- Denormalised from the parent by trigger and pinned by the composite FK
  -- below, so the outcome CHECK can be a real constraint rather than a
  -- second trigger, and the copy can never drift.
  enquiry_type public.enquiry_type not null,
  called_at timestamptz not null default now(),
  call_date date not null,             -- IST calendar day, trigger-set
  called_by uuid not null references public.profiles (id),
  outcome public.call_outcome not null,
  discussion text,
  next_follow_up_date date,
  whatsapp_sent boolean not null default false,
  issue_category public.issue_category,
  order_id text,

  foreign key (enquiry_id, enquiry_type) references public.enquiries (id, type),
  constraint outcome_matches_type check (
    (enquiry_type = 'purchase'
       and outcome in ('follow_up', 'call_back', 'purchased', 'competitor', 'closed')) or
    (enquiry_type = 'after_sale'
       and outcome in ('noted', 'escalated', 'resolved'))),
  constraint issue_category_only_after_sale check (
    enquiry_type = 'after_sale' or issue_category is null)
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  enquiry_id bigint not null references public.enquiries (id),
  date date not null,
  counsellor_id uuid not null references public.profiles (id),
  bucket public.assignment_bucket not null,
  assigned_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  -- §10 decision 9: one owner per enquiry per day. Reassignment is an UPDATE.
  unique (enquiry_id, date)
);

-- ---------------------------------------------------------------------------
-- Offers (§3, Phase 2 — schema present from day one)
-- ---------------------------------------------------------------------------

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null,
  end_date date not null,
  reminder_days smallint not null default 5,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id),
  constraint offer_dates_ordered check (end_date >= start_date)
);

-- Four narrow join tables rather than one polymorphic offer_targets, so every
-- target keeps a real foreign key.
create table public.offer_teachers (
  offer_id uuid not null references public.offers (id) on delete cascade,
  teacher_id uuid not null references public.teachers (id),
  primary key (offer_id, teacher_id)
);

create table public.offer_courses (
  offer_id uuid not null references public.offers (id) on delete cascade,
  course_id uuid not null references public.courses (id),
  primary key (offer_id, course_id)
);

create table public.offer_subjects (
  offer_id uuid not null references public.offers (id) on delete cascade,
  subject_id uuid not null references public.subjects (id),
  primary key (offer_id, subject_id)
);

create table public.offer_contents (
  offer_id uuid not null references public.offers (id) on delete cascade,
  content_id uuid not null references public.contents (id),
  primary key (offer_id, content_id)
);

-- ---------------------------------------------------------------------------
-- Import log (§5.7) — skipped rows stay actionable
-- ---------------------------------------------------------------------------

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  filename text,
  uploaded_by uuid references public.profiles (id),
  uploaded_at timestamptz not null default now(),
  total_rows integer
);

create table public.import_rows (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.import_batches (id) on delete cascade,
  row_number integer not null,
  raw jsonb not null,
  normalised_mobile text,
  outcome public.import_outcome not null,
  skip_reason text,
  student_id uuid references public.students (id),
  enquiry_id bigint references public.enquiries (id),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id)
);

-- ---------------------------------------------------------------------------
-- Audit log (§8) — append-only, written only by the trigger in section 7
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_pk text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  actor_id uuid,
  actor_source text not null,          -- 'jwt' | 'guc' | 'service_role' | 'unknown'
  at timestamptz not null default now(),
  old_data jsonb,
  new_data jsonb,
  changed_fields text[]
);

create table public.overdue_dismissals (
  date date primary key,
  dismissed_by uuid not null references public.profiles (id),
  dismissed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. Helper functions
--
-- All are SECURITY DEFINER with an empty search_path. For app.role() that is
-- not optional: reading profiles from inside a profiles policy would recurse.
-- ---------------------------------------------------------------------------

create or replace function app.ist_today()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

comment on function app.ist_today() is
  'Today in IST (§8: timezone is IST throughout).';

create or replace function app.is_working_day(d date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- isodow 7 = Sunday. Saturday is a working day (§10 decision 12).
  select extract(isodow from d) <> 7
     and not exists (select 1 from public.holidays h where h.date = d);
$$;

create or replace function app.next_working_day(d date)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result date := d;
  guard integer := 0;
begin
  if result is null then
    return null;
  end if;

  while not app.is_working_day(result) loop
    result := result + 1;
    guard := guard + 1;
    if guard > 30 then
      raise exception 'no working day found within 30 days of %', d;
    end if;
  end loop;

  return result;
end;
$$;

create or replace function app.role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
    from public.profiles p
   where p.id = (select auth.uid())
     and p.is_active;
$$;

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.role() in ('super_admin', 'manager');
$$;

create or replace function app.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.role() is not null;
$$;

-- ---------------------------------------------------------------------------
-- 6. Business triggers — the §4.3 slot rule and the enquiry state machine
--
-- This lives in the database, not the application, for three reasons:
--   * it must be atomic with the call insert (§5.3 saves optimistically);
--   * `calls` has more than one writer — logging, import, admin correction;
--   * it lets counsellors hold INSERT on calls and nothing else, which is
--     what makes §2's "edit own, same day only" coherent with "log calls on
--     any enquiry" (§10 decision 2).
-- ---------------------------------------------------------------------------

-- Snap a follow-up date forward off a Sunday or holiday at WRITE time, so the
-- stored date is always a working day. Overdue itself is computed at READ
-- time and never rewrites the stored date (§4 Overdue).
create or replace function app.enquiries_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.next_follow_up_date := app.next_working_day(new.next_follow_up_date);
  return new;
end;
$$;

create or replace function app.calls_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_type public.enquiry_type;
begin
  select e.type into parent_type
    from public.enquiries e
   where e.id = new.enquiry_id;

  if parent_type is null then
    raise exception 'enquiry % does not exist', new.enquiry_id;
  end if;

  new.enquiry_type := parent_type;

  -- timezone('Asia/Kolkata', …) is STABLE, not IMMUTABLE, so this cannot be a
  -- GENERATED column. Setting it here avoids declaring a wrapper IMMUTABLE
  -- that isn't — a lie the planner would happily bake into an index.
  new.call_date := (new.called_at at time zone 'Asia/Kolkata')::date;

  new.next_follow_up_date := app.next_working_day(new.next_follow_up_date);

  return new;
end;
$$;

-- Recompute the whole derived state of one enquiry from its calls and items.
--
-- Recomputing rather than incrementing a counter buys two things: it is
-- self-healing (a corrected outcome or a backdated call produces the right
-- answer instead of permanent drift) and it is idempotent, which is what
-- makes the same-day revival in §4.4 work.
create or replace function app.recompute_enquiry(p_enquiry_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  enq public.enquiries%rowtype;
  v_fresh date;
  v_last_slot date;
  v_slots integer := 0;
  v_last public.calls%rowtype;
  v_priority smallint;
  v_items_total integer := 0;
  v_items_open integer := 0;
  v_items_won integer := 0;
  v_items_competitor integer := 0;
  v_status public.enquiry_status;
  v_lost public.lost_reason;
  v_close public.close_reason;
  v_next date;
begin
  select * into enq
    from public.enquiries
   where id = p_enquiry_id
   for update;

  if not found then
    return;
  end if;

  -- A superseded enquiry was closed by a human decision in §5.1, not by call
  -- history. Never recompute it back open.
  if enq.status = 'closed' and enq.close_reason = 'superseded' then
    return;
  end if;

  select min(c.call_date), max(c.call_date)
    into v_fresh, v_last_slot
    from public.calls c
   where c.enquiry_id = p_enquiry_id;

  -- A slot is a calendar day AFTER the fresh-call day, so same-day repeat
  -- calls collapse into one and the fresh day itself never counts (§4.3).
  select count(distinct c.call_date)
    into v_slots
    from public.calls c
   where c.enquiry_id = p_enquiry_id
     and c.call_date > v_fresh;

  select c.* into v_last
    from public.calls c
   where c.enquiry_id = p_enquiry_id
   order by c.call_date desc, c.called_at desc, c.id desc
   limit 1;

  select count(*),
         count(*) filter (where i.status = 'open'),
         count(*) filter (where i.status = 'won'),
         count(*) filter (where i.status = 'competitor')
    into v_items_total, v_items_open, v_items_won, v_items_competitor
    from public.enquiry_items i
   where i.enquiry_id = p_enquiry_id;

  -- Best (lowest) content priority across still-open items, so §6 can sort
  -- the recommended list on enquiries alone rather than joining items.
  select min(ct.priority)
    into v_priority
    from public.enquiry_items i
    join public.contents ct on ct.id = i.content_id
   where i.enquiry_id = p_enquiry_id
     and i.status = 'open';

  if v_last.id is null then
    -- No calls yet: a fresh import or quick-add.
    v_status := 'open';
    v_next := enq.next_follow_up_date;

  elsif enq.type = 'after_sale' then
    -- §10 decision 4. The reminder date is carried, but after-sale enquiries
    -- never enter a §6 bucket — the Tickets screen (§5.11) reads them.
    v_status := case v_last.outcome
                  when 'noted' then 'open'::public.enquiry_status
                  when 'escalated' then 'escalated'::public.enquiry_status
                  when 'resolved' then 'closed'::public.enquiry_status
                end;
    v_next := v_last.next_follow_up_date;

  elsif v_last.outcome = 'closed' then
    v_status := 'closed';
    v_close := 'wrong_number';          -- §4.7, the only import-flagging close
    v_next := null;

  elsif v_last.outcome = 'competitor' then
    v_status := 'lost';
    v_lost := 'competitor';
    v_next := null;

  elsif v_last.outcome = 'purchased' then
    -- §4.5, as corrected by §10 decision 6: "no open items remain" is not
    -- enough to call it won — at least one item has to have been won.
    if v_items_open > 0 then
      v_status := 'open';
      v_next := v_last.next_follow_up_date;
    elsif v_items_won > 0 or v_items_total = 0 then
      v_status := 'won';
      v_next := null;
    elsif v_items_competitor > 0 then
      v_status := 'lost';
      v_lost := 'competitor';
      v_next := null;
    else
      v_status := 'lost';
      v_lost := 'dropped';
      v_next := null;
    end if;

  else
    -- follow_up | call_back
    if v_slots >= 3 then
      v_status := 'lost';
      v_lost := 'max_followups';
      v_next := null;
    else
      v_status := 'open';
      v_next := v_last.next_follow_up_date;
    end if;
  end if;

  update public.enquiries e
     set status = v_status,
         lost_reason = case when v_status = 'lost' then v_lost end,
         close_reason = case when v_status = 'closed' then coalesce(v_close, e.close_reason) end,
         next_follow_up_date = v_next,
         fresh_call_date = v_fresh,
         follow_up_slots_used = v_slots,
         last_slot_date = v_last_slot,
         top_content_priority = v_priority,
         closed_at = case
                       when v_status in ('won', 'lost', 'closed') then coalesce(e.closed_at, now())
                     end
   where e.id = p_enquiry_id;
end;
$$;

create or replace function app.calls_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.recompute_enquiry(coalesce(new.enquiry_id, old.enquiry_id));

  -- A call moved between enquiries has to settle both.
  if tg_op = 'UPDATE' and new.enquiry_id is distinct from old.enquiry_id then
    perform app.recompute_enquiry(old.enquiry_id);
  end if;

  return null;
end;
$$;

create or replace function app.enquiry_items_after_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.recompute_enquiry(coalesce(new.enquiry_id, old.enquiry_id));

  if tg_op = 'UPDATE' and new.enquiry_id is distinct from old.enquiry_id then
    perform app.recompute_enquiry(old.enquiry_id);
  end if;

  return null;
end;
$$;

create trigger a_enquiries_before_write
  before insert or update on public.enquiries
  for each row execute function app.enquiries_before_write();

create trigger a_calls_before_write
  before insert or update on public.calls
  for each row execute function app.calls_before_write();

create trigger b_calls_recompute
  after insert or update or delete on public.calls
  for each row execute function app.calls_after_write();

create trigger b_enquiry_items_recompute
  after insert or update or delete on public.enquiry_items
  for each row execute function app.enquiry_items_after_write();

-- Only an admin may change a role or deactivate an account. An RLS policy
-- cannot compare against OLD, so without this a counsellor holding UPDATE on
-- their own row could promote themselves to Super Admin.
create or replace function app.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if app.is_admin() then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.is_active is distinct from old.is_active
     or new.id is distinct from old.id then
    raise exception 'only an admin may change a role or account status';
  end if;

  return new;
end;
$$;

create trigger a_profiles_guard
  before update on public.profiles
  for each row execute function app.profiles_guard();

-- ---------------------------------------------------------------------------
-- 7. Audit trigger (§8 — "via DB trigger, not application code")
-- ---------------------------------------------------------------------------

create or replace function audit.log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_excluded text[] := coalesce(tg_argv, '{}'::text[]);
  v_changed text[];
  v_actor uuid;
  v_source text;
  v_pk text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new);
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}'::text[])
      into v_changed
      from (select jsonb_object_keys(v_new) as k
            union
            select jsonb_object_keys(v_old)) keys
     where (v_old -> keys.k) is distinct from (v_new -> keys.k)
       and not (keys.k = any (v_excluded));

    -- Nothing a human changed. Without this test the derived columns from
    -- section 6 would write an audit row on every single call and bury the
    -- edits the log exists to capture.
    if coalesce(array_length(v_changed, 1), 0) = 0 then
      return null;
    end if;
  end if;

  -- auth.uid() is null for service-role work and for anything run from a
  -- script, so bulk imports would otherwise be attributed to nobody.
  v_actor := (select auth.uid());

  if v_actor is not null then
    v_source := 'jwt';
  else
    begin
      v_actor := nullif(current_setting('app.actor', true), '')::uuid;
    exception when others then
      v_actor := null;
    end;

    if v_actor is not null then
      v_source := 'guc';
    elsif current_user::text = 'service_role' then
      v_source := 'service_role';
    else
      v_source := 'unknown';
    end if;
  end if;

  -- Primary keys differ in type across these tables (uuid here, bigint
  -- there), so one generic function serves all of them.
  v_pk := coalesce(v_new, v_old) ->> 'id';

  insert into public.audit_log
    (table_name, row_pk, action, actor_id, actor_source, old_data, new_data, changed_fields)
  values
    (tg_table_name, v_pk, lower(tg_op), v_actor, v_source, v_old, v_new, v_changed);

  return null;
end;
$$;

-- Named z_* so they sort after the business triggers above: AFTER row
-- triggers fire in name order, and the audit must observe the state
-- machine's final values, not its intermediates.
create trigger z_audit_enquiries
  after insert or update or delete on public.enquiries
  for each row execute function audit.log_change(
    'fresh_call_date', 'follow_up_slots_used', 'last_slot_date', 'top_content_priority');

create trigger z_audit_enquiry_items
  after insert or update or delete on public.enquiry_items
  for each row execute function audit.log_change();

create trigger z_audit_calls
  after insert or update or delete on public.calls
  for each row execute function audit.log_change();

create trigger z_audit_assignments
  after insert or update or delete on public.assignments
  for each row execute function audit.log_change();

create trigger z_audit_students
  after insert or update or delete on public.students
  for each row execute function audit.log_change();

create trigger z_audit_profiles
  after insert or update or delete on public.profiles
  for each row execute function audit.log_change();

-- ---------------------------------------------------------------------------
-- 8. Indexes (§8's list, plus what the screens in §5 actually need)
-- ---------------------------------------------------------------------------

-- students.mobile is covered by its unique constraint.

-- §6 recommended list: open purchase enquiries by follow-up date.
create index enquiries_follow_up_queue_idx
  on public.enquiries (next_follow_up_date)
  where status = 'open' and type = 'purchase';

-- §5.11 Tickets: after-sale work sorted by reminder date.
create index enquiries_ticket_queue_idx
  on public.enquiries (next_follow_up_date)
  where type = 'after_sale' and status in ('open', 'escalated');

create index enquiries_status_idx on public.enquiries (status);
create index enquiries_student_idx on public.enquiries (student_id);
create index enquiries_source_idx on public.enquiries (source_id);
create index enquiries_term_idx on public.enquiries (term_id);
create index enquiries_created_at_idx on public.enquiries (created_at);

create index calls_enquiry_idx on public.calls (enquiry_id);
create index calls_counsellor_day_idx on public.calls (called_by, call_date);  -- §5.8 daily report
create index calls_day_idx on public.calls (call_date);                        -- §5.8 team summary

create index enquiry_items_enquiry_idx on public.enquiry_items (enquiry_id);
create index enquiry_items_teacher_status_idx on public.enquiry_items (teacher_id, status);  -- §7
create index enquiry_items_content_idx on public.enquiry_items (content_id);

create index assignments_day_counsellor_idx on public.assignments (date, counsellor_id);
create index assignments_enquiry_idx on public.assignments (enquiry_id);

create index import_rows_batch_idx on public.import_rows (batch_id);
create index import_rows_mobile_idx on public.import_rows (normalised_mobile);

create index audit_log_row_idx on public.audit_log (table_name, row_pk);
create index audit_log_actor_idx on public.audit_log (actor_id, at desc);
create index audit_log_at_idx on public.audit_log (at desc);

-- §5.6's "discussion contains" filter. Without trigram indexes this is a
-- sequential scan of the largest table in the database on every keystroke.
create index calls_discussion_trgm_idx
  on public.calls using gin (discussion extensions.gin_trgm_ops);
create index enquiries_product_text_trgm_idx
  on public.enquiries using gin (product_text extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 9. Row level security (§8 — on every table from the first migration)
--
-- "Delete entries: never" (§2) is enforced by the ABSENCE of a delete policy,
-- not by application code remembering not to. Assignments are the one
-- exception (§10 decision 8): they are a schedule, not a record.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.enquiries enable row level security;
alter table public.enquiry_items enable row level security;
alter table public.calls enable row level security;
alter table public.assignments enable row level security;
alter table public.sources enable row level security;
alter table public.teachers enable row level security;
alter table public.courses enable row level security;
alter table public.subjects enable row level security;
alter table public.contents enable row level security;
alter table public.terms enable row level security;
alter table public.whatsapp_templates enable row level security;
alter table public.holidays enable row level security;
alter table public.offers enable row level security;
alter table public.offer_teachers enable row level security;
alter table public.offer_courses enable row level security;
alter table public.offer_subjects enable row level security;
alter table public.offer_contents enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
alter table public.audit_log enable row level security;
alter table public.overdue_dismissals enable row level security;

-- --- profiles ---
create policy profiles_select on public.profiles
  for select to authenticated using (app.is_staff());
create policy profiles_insert on public.profiles
  for insert to authenticated with check (app.is_admin());
-- Column privileges in section 10 narrow this to full_name for non-admins;
-- the guard trigger in section 6 is the belt to that pair of braces.
create policy profiles_update on public.profiles
  for update to authenticated
  using (app.is_admin() or id = (select auth.uid()))
  with check (app.is_admin() or id = (select auth.uid()));

-- --- students ---
create policy students_select on public.students
  for select to authenticated using (app.is_staff());
create policy students_insert on public.students
  for insert to authenticated with check (app.is_staff());
-- §2: counsellors and ticket team edit their own entries, same day only.
create policy students_update on public.students
  for update to authenticated
  using (app.is_admin()
         or (created_by = (select auth.uid())
             and (created_at at time zone 'Asia/Kolkata')::date = app.ist_today()))
  with check (app.is_admin()
         or (created_by = (select auth.uid())
             and (created_at at time zone 'Asia/Kolkata')::date = app.ist_today()));

-- --- enquiries ---
-- Status and follow-up dates move through the state machine in section 6,
-- which runs as definer. This policy governs only manual field correction.
create policy enquiries_select on public.enquiries
  for select to authenticated using (app.is_staff());
create policy enquiries_insert on public.enquiries
  for insert to authenticated with check (app.is_staff());
create policy enquiries_update on public.enquiries
  for update to authenticated
  using (app.is_admin()
         or (created_by = (select auth.uid())
             and (created_at at time zone 'Asia/Kolkata')::date = app.ist_today()))
  with check (app.is_admin()
         or (created_by = (select auth.uid())
             and (created_at at time zone 'Asia/Kolkata')::date = app.ist_today()));

-- --- enquiry_items ---
-- §10 decision 3: whoever logs the `purchased` call ticks the items, which
-- may not be whoever created them. The audit log is the control here.
create policy enquiry_items_select on public.enquiry_items
  for select to authenticated using (app.is_staff());
create policy enquiry_items_insert on public.enquiry_items
  for insert to authenticated with check (app.is_staff());
create policy enquiry_items_update on public.enquiry_items
  for update to authenticated using (app.is_staff()) with check (app.is_staff());

-- --- calls ---
create policy calls_select on public.calls
  for select to authenticated using (app.is_staff());
create policy calls_insert on public.calls
  for insert to authenticated
  with check (app.is_staff() and called_by = (select auth.uid()));
create policy calls_update on public.calls
  for update to authenticated
  using (app.is_admin()
         or (called_by = (select auth.uid()) and call_date = app.ist_today()))
  with check (app.is_admin()
         or (called_by = (select auth.uid()) and call_date = app.ist_today()));

-- --- assignments ---
create policy assignments_select on public.assignments
  for select to authenticated using (app.is_staff());
create policy assignments_insert on public.assignments
  for insert to authenticated with check (app.is_admin());
create policy assignments_update on public.assignments
  for update to authenticated using (app.is_admin()) with check (app.is_admin());
create policy assignments_delete on public.assignments
  for delete to authenticated using (app.is_admin());

-- --- master lists ---
-- Readable including inactive rows, so historical references still resolve.
-- Soft delete only: no delete policy anywhere here.
do $$
declare
  t text;
begin
  foreach t in array array['sources', 'teachers', 'courses', 'subjects', 'contents',
                           'terms', 'whatsapp_templates', 'holidays', 'offers']
  loop
    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated using (app.is_staff())', t);
    execute format(
      'create policy %1$s_insert on public.%1$I for insert to authenticated with check (app.is_admin())', t);
    execute format(
      'create policy %1$s_update on public.%1$I for update to authenticated using (app.is_admin()) with check (app.is_admin())', t);
  end loop;

  foreach t in array array['offer_teachers', 'offer_courses', 'offer_subjects', 'offer_contents']
  loop
    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated using (app.is_staff())', t);
    execute format(
      'create policy %1$s_insert on public.%1$I for insert to authenticated with check (app.is_admin())', t);
    execute format(
      'create policy %1$s_delete on public.%1$I for delete to authenticated using (app.is_admin())', t);
  end loop;
end;
$$;

-- --- import log ---
create policy import_batches_select on public.import_batches
  for select to authenticated using (app.is_staff());
create policy import_batches_insert on public.import_batches
  for insert to authenticated with check (app.is_staff());
create policy import_rows_select on public.import_rows
  for select to authenticated using (app.is_staff());
create policy import_rows_insert on public.import_rows
  for insert to authenticated with check (app.is_staff());
-- §5.7: skipped rows stay actionable — a counsellor can reopen or ignore one.
create policy import_rows_update on public.import_rows
  for update to authenticated using (app.is_staff()) with check (app.is_staff());

-- --- audit log ---
-- Readable by admins only, and written by nothing but the definer trigger.
-- No insert, update or delete policy exists at all.
create policy audit_log_select on public.audit_log
  for select to authenticated using (app.is_admin());

-- --- overdue dismissals ---
create policy overdue_dismissals_select on public.overdue_dismissals
  for select to authenticated using (app.is_staff());
create policy overdue_dismissals_insert on public.overdue_dismissals
  for insert to authenticated with check (app.is_admin());

-- ---------------------------------------------------------------------------
-- 10. Grants
--
-- RLS is the fence; these are the belt. Supabase grants broadly to anon and
-- authenticated by default, so both are narrowed explicitly here.
-- ---------------------------------------------------------------------------

-- No unauthenticated access to anything. There is no self-signup (§8).
revoke all on all tables in schema public from anon;

-- "Delete entries: never" (§2), at the privilege level as well as the policy
-- level. Assignments and offer targets are the documented exceptions.
revoke delete on all tables in schema public from authenticated;
grant delete on public.assignments to authenticated;
grant delete on public.offer_teachers, public.offer_courses,
                public.offer_subjects, public.offer_contents to authenticated;

-- A non-admin may rename themselves and nothing else. Role changes go through
-- the service role (lib/supabase/admin.ts), which is a server-only path.
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- The audit log is append-only to every client.
revoke insert, update, delete on public.audit_log from authenticated;
