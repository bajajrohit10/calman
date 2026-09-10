-- Calman — schema and lifecycle tests.
--
-- Exercises the §4 lifecycle rules, the mobile constraint, the composite
-- foreign keys, IST date handling, the audit trigger and RLS. Everything runs
-- inside one transaction and rolls back, so it is safe against any database
-- that has the migration applied:
--
--   psql "$DATABASE_URL" -f supabase/tests/schema_test.sql
--
-- Locally with the Supabase CLI:
--   supabase db reset && psql "$(supabase status -o json | jq -r .DB_URL)" \
--     -f supabase/tests/schema_test.sql
--
-- Output is one PASS/FAIL line per assertion and a summary; a failure sets a
-- non-zero exit code via the final assert.

\set ON_ERROR_STOP on
\timing off

begin;

\o /dev/null
create temp table results (id serial, name text, ok boolean, detail text);

create function pg_temp.ok(p_name text, p_cond boolean, p_detail text default '')
returns void language sql as $$
  insert into results (name, ok, detail) values (p_name, coalesce(p_cond, false), p_detail);
$$;

-- Assert that a statement is rejected. Used for constraints and RLS denials.
create function pg_temp.rejects(p_name text, p_sql text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    insert into results (name, ok, detail) values (p_name, false, 'expected rejection, statement succeeded');
  exception when others then
    insert into results (name, ok, detail) values (p_name, true, left(sqlerrm, 60));
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin@zeroinfy.in'),
  ('22222222-2222-2222-2222-222222222222', 'c1@zeroinfy.in'),
  ('33333333-3333-3333-3333-333333333333', 'c2@zeroinfy.in');

insert into public.profiles (id, full_name, role) values
  ('11111111-1111-1111-1111-111111111111', 'Admin', 'super_admin'),
  ('22222222-2222-2222-2222-222222222222', 'Counsellor One', 'counsellor'),
  ('33333333-3333-3333-3333-333333333333', 'Counsellor Two', 'counsellor');

insert into public.students (id, mobile, name, created_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '9876543210', 'Test Student',
   '22222222-2222-2222-2222-222222222222');

-- ---------------------------------------------------------------------------
-- 1. Mobile constraint (§3, §8)
-- ---------------------------------------------------------------------------

select pg_temp.rejects('mobile: rejects leading 1',
  $$insert into public.students (mobile) values ('1234567890')$$);
select pg_temp.rejects('mobile: rejects 9 digits',
  $$insert into public.students (mobile) values ('987654321')$$);
select pg_temp.rejects('mobile: rejects 11 digits',
  $$insert into public.students (mobile) values ('98765432101')$$);
select pg_temp.rejects('mobile: rejects +91 prefix (normalise before insert)',
  $$insert into public.students (mobile) values ('+919876543210')$$);
select pg_temp.rejects('mobile: rejects duplicate',
  $$insert into public.students (mobile) values ('9876543210')$$);

do $$
begin
  insert into public.students (mobile) values ('6000000001'), ('7000000002'), ('8000000003');
  perform pg_temp.ok('mobile: accepts 6/7/8/9 leading digits', true);
exception when others then
  perform pg_temp.ok('mobile: accepts 6/7/8/9 leading digits', false, sqlerrm);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Composite foreign keys
-- ---------------------------------------------------------------------------

insert into public.courses (name) values ('CA Inter');
insert into public.subjects (course_id, name)
  select id, 'FM' from public.courses where name = 'CA Inter';

insert into public.enquiries (id, student_id, type, created_by)
  overriding system value
  values (1001, 'aaaaaaaa-0000-0000-0000-000000000001', 'purchase',
          '22222222-2222-2222-2222-222222222222');

select pg_temp.rejects('composite FK: subject from another course is rejected',
  $$insert into public.enquiry_items (enquiry_id, teacher_id, course_id, subject_id)
    select 1001,
           (select id from public.teachers where name = 'Bhanwar Borana'),
           (select id from public.courses  where name = 'CA Final'),
           (select id from public.subjects where name = 'FM')$$);

select pg_temp.rejects('composite FK: after-sale outcome on a purchase enquiry is rejected',
  $$insert into public.calls (enquiry_id, called_by, outcome)
    values (1001, '22222222-2222-2222-2222-222222222222', 'escalated')$$);

-- ---------------------------------------------------------------------------
-- 3. IST call_date (§8)
-- ---------------------------------------------------------------------------

do $$
declare d date;
begin
  insert into public.calls (enquiry_id, called_by, outcome, called_at)
    values (1001, '22222222-2222-2222-2222-222222222222', 'follow_up',
            timestamptz '2026-06-01 20:00:00+00')     -- 01:30 IST on 2 June
    returning call_date into d;
  perform pg_temp.ok('IST: 20:00 UTC lands on the next IST day', d = date '2026-06-02', d::text);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The §4.3 slot rule
-- ---------------------------------------------------------------------------

insert into public.enquiries (id, student_id, type, created_by)
  overriding system value
  values (2001, 'aaaaaaaa-0000-0000-0000-000000000001', 'purchase',
          '22222222-2222-2222-2222-222222222222');

-- Fresh day: two calls, one day. Neither consumes a slot.
insert into public.calls (enquiry_id, called_by, outcome, called_at) values
  (2001, '22222222-2222-2222-2222-222222222222', 'call_back',  timestamptz '2026-06-01 05:00:00+00'),
  (2001, '22222222-2222-2222-2222-222222222222', 'follow_up',  timestamptz '2026-06-01 09:00:00+00');

select pg_temp.ok('slots: fresh day consumes no slot',
  (select follow_up_slots_used = 0 and status = 'open' from public.enquiries where id = 2001),
  (select 'slots=' || follow_up_slots_used || ' status=' || status from public.enquiries where id = 2001));

-- Slot 1.
insert into public.calls (enquiry_id, called_by, outcome, called_at) values
  (2001, '22222222-2222-2222-2222-222222222222', 'follow_up', timestamptz '2026-06-03 05:00:00+00');
select pg_temp.ok('slots: first day after fresh = slot 1',
  (select follow_up_slots_used = 1 and status = 'open' from public.enquiries where id = 2001));

-- Slot 2, three calls in one day — still one slot.
insert into public.calls (enquiry_id, called_by, outcome, called_at) values
  (2001, '22222222-2222-2222-2222-222222222222', 'call_back', timestamptz '2026-06-05 04:00:00+00'),
  (2001, '22222222-2222-2222-2222-222222222222', 'call_back', timestamptz '2026-06-05 06:00:00+00'),
  (2001, '22222222-2222-2222-2222-222222222222', 'follow_up', timestamptz '2026-06-05 08:00:00+00');
select pg_temp.ok('slots: three calls in one day collapse to one slot',
  (select follow_up_slots_used = 2 and status = 'open' from public.enquiries where id = 2001),
  (select 'slots=' || follow_up_slots_used from public.enquiries where id = 2001));

-- Slot 3 ending on follow_up: auto-lost.
insert into public.calls (enquiry_id, called_by, outcome, called_at) values
  (2001, '22222222-2222-2222-2222-222222222222', 'follow_up', timestamptz '2026-06-09 05:00:00+00');
select pg_temp.ok('slots: 3rd slot ending on follow_up auto-loses (max_followups)',
  (select status = 'lost' and lost_reason = 'max_followups'
          and next_follow_up_date is null and closed_at is not null
     from public.enquiries where id = 2001),
  (select 'status=' || status || ' reason=' || coalesce(lost_reason::text, 'null')
     from public.enquiries where id = 2001));

-- §4.4 revival: a later call on the same slot day recomputes the state.
insert into public.calls (enquiry_id, called_by, outcome, called_at) values
  (2001, '22222222-2222-2222-2222-222222222222', 'purchased', timestamptz '2026-06-09 11:00:00+00');
select pg_temp.ok('slots: same-day later call revives from lost (§4.4)',
  (select status = 'won' and lost_reason is null from public.enquiries where id = 2001),
  (select 'status=' || status from public.enquiries where id = 2001));

-- Three separate days of call_back with no answer also lose the lead (Q1b).
insert into public.enquiries (id, student_id, type, created_by)
  overriding system value
  values (2002, 'aaaaaaaa-0000-0000-0000-000000000001', 'purchase',
          '22222222-2222-2222-2222-222222222222');
insert into public.calls (enquiry_id, called_by, outcome, called_at) values
  (2002, '22222222-2222-2222-2222-222222222222', 'call_back', timestamptz '2026-06-01 05:00:00+00'),
  (2002, '22222222-2222-2222-2222-222222222222', 'call_back', timestamptz '2026-06-02 05:00:00+00'),
  (2002, '22222222-2222-2222-2222-222222222222', 'call_back', timestamptz '2026-06-03 05:00:00+00'),
  (2002, '22222222-2222-2222-2222-222222222222', 'call_back', timestamptz '2026-06-04 05:00:00+00');
select pg_temp.ok('slots: three no-answer days lose the lead (Q1b)',
  (select status = 'lost' and lost_reason = 'max_followups' from public.enquiries where id = 2002));

-- ---------------------------------------------------------------------------
-- 5. Purchase resolution (§4.5, as corrected by Q6)
-- ---------------------------------------------------------------------------

insert into public.enquiries (id, student_id, type, created_by)
  overriding system value
  values (3001, 'aaaaaaaa-0000-0000-0000-000000000001', 'purchase',
          '22222222-2222-2222-2222-222222222222');

insert into public.enquiry_items (id, enquiry_id, teacher_id, course_id, subject_id, content_id)
select ('bbbbbbbb-0000-0000-0000-00000000000' || n)::uuid,
       3001,
       (select id from public.teachers where name = 'Bhanwar Borana'),
       (select id from public.courses where name = 'CA Final'),
       (select id from public.subjects where name = s),
       (select id from public.contents where name = 'Full')
  from (values ('DT', '1'), ('IDT', '2')) as v(s, n);

insert into public.calls (enquiry_id, called_by, outcome, called_at) values
  (3001, '22222222-2222-2222-2222-222222222222', 'purchased', timestamptz '2026-06-01 05:00:00+00');

select pg_temp.ok('items: purchased with an open item leaves the enquiry open',
  (select status = 'open' from public.enquiries where id = 3001),
  (select 'status=' || status from public.enquiries where id = 3001));

update public.enquiry_items set status = 'won', order_id = 'ZI-1'
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';
select pg_temp.ok('items: one won, one still open leaves the enquiry open',
  (select status = 'open' from public.enquiries where id = 3001));

update public.enquiry_items set status = 'closed'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
select pg_temp.ok('items: no open items and one won -> enquiry won',
  (select status = 'won' and closed_at is not null from public.enquiries where id = 3001),
  (select 'status=' || status from public.enquiries where id = 3001));

-- Q6: all items resolved, none won, one competitor -> lost/competitor.
insert into public.enquiries (id, student_id, type, created_by)
  overriding system value
  values (3002, 'aaaaaaaa-0000-0000-0000-000000000001', 'purchase',
          '22222222-2222-2222-2222-222222222222');
insert into public.enquiry_items (enquiry_id, teacher_id, course_id, status)
values (3002, (select id from public.teachers where name = 'Bhanwar Borana'),
        (select id from public.courses where name = 'CA Final'), 'competitor');
insert into public.calls (enquiry_id, called_by, outcome, called_at) values
  (3002, '22222222-2222-2222-2222-222222222222', 'purchased', timestamptz '2026-06-01 05:00:00+00');
select pg_temp.ok('items: none won, one competitor -> lost/competitor, not won (Q6)',
  (select status = 'lost' and lost_reason = 'competitor' from public.enquiries where id = 3002),
  (select 'status=' || status || ' reason=' || coalesce(lost_reason::text, 'null')
     from public.enquiries where id = 3002));

-- Q6: all items closed, none won, none competitor -> lost/dropped.
insert into public.enquiries (id, student_id, type, created_by)
  overriding system value
  values (3003, 'aaaaaaaa-0000-0000-0000-000000000001', 'purchase',
          '22222222-2222-2222-2222-222222222222');
insert into public.enquiry_items (enquiry_id, teacher_id, course_id, status)
values (3003, (select id from public.teachers where name = 'Bhanwar Borana'),
        (select id from public.courses where name = 'CA Final'), 'closed');
insert into public.calls (enquiry_id, called_by, outcome, called_at) values
  (3003, '22222222-2222-2222-2222-222222222222', 'purchased', timestamptz '2026-06-01 05:00:00+00');
select pg_temp.ok('items: none won, none competitor -> lost/dropped (Q6)',
  (select status = 'lost' and lost_reason = 'dropped' from public.enquiries where id = 3003),
  (select 'status=' || status || ' reason=' || coalesce(lost_reason::text, 'null')
     from public.enquiries where id = 3003));

-- ---------------------------------------------------------------------------
-- 6. close_reason (§4.7 / Q5)
-- ---------------------------------------------------------------------------

insert into public.enquiries (id, student_id, type, created_by)
  overriding system value
  values (4001, 'aaaaaaaa-0000-0000-0000-000000000001', 'purchase',
          '22222222-2222-2222-2222-222222222222');
insert into public.calls (enquiry_id, called_by, outcome, called_at) values
  (4001, '22222222-2222-2222-2222-222222222222', 'closed', timestamptz '2026-06-01 05:00:00+00');
select pg_temp.ok('close: wrong-number call sets close_reason = wrong_number',
  (select status = 'closed' and close_reason = 'wrong_number' from public.enquiries where id = 4001));

-- A superseded enquiry is closed by hand and must never be recomputed open.
insert into public.enquiries (id, student_id, type, status, close_reason, created_by)
  overriding system value
  values (4002, 'aaaaaaaa-0000-0000-0000-000000000001', 'purchase', 'closed', 'superseded',
          '22222222-2222-2222-2222-222222222222');
insert into public.calls (enquiry_id, called_by, outcome, called_at) values
  (4002, '22222222-2222-2222-2222-222222222222', 'follow_up', timestamptz '2026-06-01 05:00:00+00');
select pg_temp.ok('close: superseded enquiry is never recomputed back open (Q5)',
  (select status = 'closed' and close_reason = 'superseded' from public.enquiries where id = 4002),
  (select 'status=' || status from public.enquiries where id = 4002));

-- ---------------------------------------------------------------------------
-- 7. After-sale (Q4)
-- ---------------------------------------------------------------------------

insert into public.enquiries (id, student_id, type, created_by)
  overriding system value
  values (5001, 'aaaaaaaa-0000-0000-0000-000000000001', 'after_sale',
          '22222222-2222-2222-2222-222222222222');

insert into public.calls (enquiry_id, called_by, outcome, issue_category, called_at) values
  (5001, '22222222-2222-2222-2222-222222222222', 'noted', 'video_access',
   timestamptz '2026-06-01 05:00:00+00');
select pg_temp.ok('after-sale: noted -> open',
  (select status = 'open' from public.enquiries where id = 5001));

insert into public.calls (enquiry_id, called_by, outcome, called_at) values
  (5001, '22222222-2222-2222-2222-222222222222', 'escalated', timestamptz '2026-06-02 05:00:00+00');
select pg_temp.ok('after-sale: escalated -> escalated',
  (select status = 'escalated' from public.enquiries where id = 5001));

insert into public.calls (enquiry_id, called_by, outcome, called_at) values
  (5001, '22222222-2222-2222-2222-222222222222', 'resolved', timestamptz '2026-06-03 05:00:00+00');
select pg_temp.ok('after-sale: resolved -> closed',
  (select status = 'closed' from public.enquiries where id = 5001));

select pg_temp.ok('after-sale: never consumes follow-up slots',
  (select follow_up_slots_used = 2 and status = 'closed' from public.enquiries where id = 5001),
  'slots are counted but never drive auto-lost for after_sale');

select pg_temp.rejects('after-sale: issue_category rejected on a purchase call',
  $$insert into public.calls (enquiry_id, called_by, outcome, issue_category)
    values (1001, '22222222-2222-2222-2222-222222222222', 'follow_up', 'refund')$$);

-- ---------------------------------------------------------------------------
-- 8. Working days (§4 Overdue, Q12)
-- ---------------------------------------------------------------------------

select pg_temp.ok('working day: Saturday is a working day',
  app.is_working_day(date '2026-06-06'), 'isodow=' || extract(isodow from date '2026-06-06')::text);
select pg_temp.ok('working day: Sunday is not',
  not app.is_working_day(date '2026-06-07'));

insert into public.holidays (date, name) values ('2026-06-08', 'Test holiday');
select pg_temp.ok('working day: Sunday + holiday Monday snaps to Tuesday',
  app.next_working_day(date '2026-06-07') = date '2026-06-09',
  app.next_working_day(date '2026-06-07')::text);

do $$
declare d date;
begin
  insert into public.enquiries (student_id, type, next_follow_up_date, created_by)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'purchase', date '2026-06-07',
          '22222222-2222-2222-2222-222222222222')
  returning next_follow_up_date into d;
  perform pg_temp.ok('working day: a Sunday follow-up date is snapped forward on write',
                     d = date '2026-06-09', d::text);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Audit trigger (§8)
-- ---------------------------------------------------------------------------

do $$
declare before_n bigint; after_n bigint;
begin
  select count(*) into before_n from public.audit_log where table_name = 'enquiries';
  update public.enquiries set product_text = product_text where id = 1001;   -- no-op
  select count(*) into after_n from public.audit_log where table_name = 'enquiries';
  perform pg_temp.ok('audit: a no-op update writes no row', before_n = after_n,
                     before_n || ' -> ' || after_n);
end;
$$;

do $$
declare before_n bigint; after_n bigint;
begin
  select count(*) into before_n from public.audit_log where table_name = 'enquiries';
  update public.enquiries set product_text = 'CA Final DT Full' where id = 1001;
  select count(*) into after_n from public.audit_log where table_name = 'enquiries';
  perform pg_temp.ok('audit: a real update writes exactly one row', after_n = before_n + 1,
                     before_n || ' -> ' || after_n);
end;
$$;

select pg_temp.ok('audit: changed_fields names the edited column',
  (select changed_fields = array['product_text']
     from public.audit_log
    where table_name = 'enquiries' and action = 'update'
    order by id desc limit 1),
  (select array_to_string(changed_fields, ',')
     from public.audit_log
    where table_name = 'enquiries' and action = 'update'
    order by id desc limit 1));

-- Derived columns are excluded, so trigger churn does not bury human edits.
do $$
declare before_n bigint; after_n bigint; d date;
begin
  select next_follow_up_date into d from public.enquiries where id = 1001;
  select count(*) into before_n from public.audit_log where table_name = 'enquiries';
  -- Same follow-up date as the enquiry already carries, so the only columns
  -- this call changes on the parent are the derived ones.
  insert into public.calls (enquiry_id, called_by, outcome, next_follow_up_date, called_at)
  values (1001, '22222222-2222-2222-2222-222222222222', 'follow_up', d,
          timestamptz '2026-06-10 05:00:00+00');
  select count(*) into after_n from public.audit_log where table_name = 'enquiries';
  perform pg_temp.ok('audit: derived-column-only update is excluded', before_n = after_n,
                     before_n || ' -> ' || after_n);
end;
$$;

select pg_temp.ok('audit: service-role writes are attributed, not dropped',
  (select count(*) > 0 from public.audit_log where actor_source in ('unknown', 'service_role', 'guc')),
  'actor_source is recorded even when auth.uid() is null');

do $$
declare src text;
begin
  perform set_config('app.actor', '11111111-1111-1111-1111-111111111111', true);
  insert into public.students (mobile) values ('9000000099');
  select actor_source into src from public.audit_log
   where table_name = 'students' order by id desc limit 1;
  perform pg_temp.ok('audit: app.actor GUC attributes server-side scripts', src = 'guc', src);
  perform set_config('app.actor', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Row level security (§8, Q2)
-- ---------------------------------------------------------------------------

grant all on results to authenticated;
grant usage, select on all sequences in schema pg_temp to authenticated;

-- The crux of the design: a counsellor holds INSERT on calls and nothing
-- else, yet logging a call still moves an enquiry they did not create.
do $$
declare moved boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', true);

  insert into public.calls (enquiry_id, called_by, outcome, called_at)
  values (2002, '33333333-3333-3333-3333-333333333333', 'purchased',
          timestamptz '2026-06-04 11:00:00+00');

  perform set_config('role', 'postgres', true);
  select status = 'won' into moved from public.enquiries where id = 2002;
  perform pg_temp.ok('rls: counsellor drives enquiry state through the trigger (Q2)', moved);
exception when others then
  perform set_config('role', 'postgres', true);
  perform pg_temp.ok('rls: counsellor drives enquiry state through the trigger (Q2)', false, sqlerrm);
end;
$$;

do $$
declare denied boolean := false;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
  begin
    update public.enquiries set importance = 'a' where id = 1001;   -- created by c1, not today
    denied := not found;
  exception when others then
    denied := true;
  end;
  perform set_config('role', 'postgres', true);
  perform pg_temp.ok('rls: counsellor cannot edit another counsellor''s enquiry', denied);
end;
$$;

do $$
declare denied boolean := false;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
  begin
    insert into public.assignments (enquiry_id, date, counsellor_id, bucket, assigned_by)
    values (1001, current_date, '33333333-3333-3333-3333-333333333333', 'fresh',
            '33333333-3333-3333-3333-333333333333');
  exception when others then
    denied := true;
  end;
  perform set_config('role', 'postgres', true);
  perform pg_temp.ok('rls: counsellor cannot assign work (§2)', denied);
end;
$$;

do $$
declare visible bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
  select count(*) into visible from public.audit_log;
  perform set_config('role', 'postgres', true);
  perform pg_temp.ok('rls: counsellor cannot read the audit log', visible = 0, visible::text);
end;
$$;

do $$
declare visible bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
  select count(*) into visible from public.audit_log;
  perform set_config('role', 'postgres', true);
  perform pg_temp.ok('rls: admin can read the audit log', visible > 0, visible::text);
end;
$$;

do $$
declare denied boolean := false;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
  begin
    update public.profiles set role = 'super_admin'
     where id = '33333333-3333-3333-3333-333333333333';
  exception when others then
    denied := true;
  end;
  perform set_config('role', 'postgres', true);
  perform pg_temp.ok('rls: counsellor cannot promote themselves', denied
    and (select role from public.profiles where id = '33333333-3333-3333-3333-333333333333') = 'counsellor');
end;
$$;

do $$
declare denied boolean := false;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
  begin
    delete from public.calls where enquiry_id = 2002;
    denied := not found;
  exception when others then
    denied := true;
  end;
  perform set_config('role', 'postgres', true);
  perform pg_temp.ok('rls: nobody may delete a call (§2 "never")', denied);
end;
$$;

do $$
declare denied boolean := false;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
  begin
    insert into public.teachers (name) values ('Unauthorised Teacher');
  exception when others then
    denied := true;
  end;
  perform set_config('role', 'postgres', true);
  perform pg_temp.ok('rls: counsellor cannot edit master lists (§2)', denied);
end;
$$;

-- A user with no profile row sees nothing at all. This, not the dashboard
-- toggle, is what enforces "no self-signup" (§8).
do $$
declare visible bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999"}', true);
  select count(*) into visible from public.enquiries;
  perform set_config('role', 'postgres', true);
  perform pg_temp.ok('rls: a user with no profile row sees nothing', visible = 0, visible::text);
end;
$$;

do $$
declare visible bigint;
begin
  perform set_config('role', 'anon', true);
  begin
    select count(*) into visible from public.enquiries;
  exception when others then
    visible := -1;
  end;
  perform set_config('role', 'postgres', true);
  perform pg_temp.ok('rls: anon has no access to enquiries', coalesce(visible, 0) <= 0, visible::text);
end;
$$;

-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------

\o

select case when ok then 'PASS' else 'FAIL' end as result,
       name,
       case when ok then '' else detail end as detail
  from results
 order by id;

select count(*) filter (where ok) as passed,
       count(*) filter (where not ok) as failed,
       count(*) as total
  from results;

do $$
declare n integer;
begin
  select count(*) into n from results where not ok;
  if n > 0 then
    raise exception '% assertion(s) failed', n;
  end if;
  raise notice 'all % assertions passed', (select count(*) from results);
end;
$$;

rollback;
