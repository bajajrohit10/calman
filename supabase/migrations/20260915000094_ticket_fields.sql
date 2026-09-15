-- §44.1–44.3. What a ticket is made of.

-- ---------------------------------------------------------------------------
-- 1. The fields a ticket carries
-- ---------------------------------------------------------------------------
--
-- Order ID moves onto the enquiry. It was only ever on the call, which meant
-- the ticket's own identity — the thing the institute asks for first — lived
-- on whichever call happened to mention it, and a ticket with no calls yet had
-- none at all. It is a fact about the complaint, not about a conversation.
--
-- Teacher likewise: an after-sale problem is about somebody's course, and the
-- institute the ticket has to be chased with is that teacher's institute. It
-- is derived rather than stored, so a teacher moving institutes does not leave
-- old tickets pointing at the wrong one.
--
-- product_text is already here and already free text, so §44.1's Product is
-- that column and not a second one beside it.

alter table public.enquiries
  add column if not exists order_id text,
  add column if not exists teacher_id uuid references public.teachers(id),
  add column if not exists escalated_to uuid references public.profiles(id);

comment on column public.enquiries.order_id is
  'The order this after-sale ticket is about (§44.1). Required to raise one.';
comment on column public.enquiries.teacher_id is
  'Whose course the ticket is about (§44.1). The institute is read through it.';
comment on column public.enquiries.escalated_to is
  'Who the ticket was escalated to (§44.2). Set with the escalated status and '
  'kept afterwards, so a resolved ticket still says who unblocked it.';

create index if not exists enquiries_escalated_to_idx
  on public.enquiries (escalated_to) where escalated_to is not null;

-- ---------------------------------------------------------------------------
-- 2. One outcome per status
-- ---------------------------------------------------------------------------

do $$
declare
  src text := pg_get_functiondef('app.recompute_enquiry'::regproc);
  out text;
begin
  out := replace(src,
    $old$    v_status := case v_last.outcome
                  when 'noted' then 'open'::public.enquiry_status
                  when 'escalated' then 'escalated'::public.enquiry_status
                  when 'resolved' then 'closed'::public.enquiry_status$old$,
    $new$    v_status := case v_last.outcome
                  when 'noted' then 'open'::public.enquiry_status
                  when 'working' then 'working'::public.enquiry_status
                  when 'escalated' then 'escalated'::public.enquiry_status
                  when 'pending_institute' then 'pending_institute'::public.enquiry_status
                  when 'resolved' then 'closed'::public.enquiry_status$new$);
  if out = src then
    raise exception 'recompute_enquiry: the after-sale status case was not found';
  end if;
  execute out;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Every status change, with who and when
-- ---------------------------------------------------------------------------
--
-- A table rather than a read of audit_log. The audit row knows a column
-- changed; this has to answer "who escalated it, to whom, and when" for a
-- screen, and reconstructing that from jsonb diffs on every render is both
-- slow and a second definition of what a status change is.
--
-- Written by a trigger so it cannot be forgotten: the status is derived by
-- recompute_enquiry from the call, and no application code sets it.

create table if not exists public.ticket_events (
  id bigint generated always as identity primary key,
  enquiry_id bigint not null references public.enquiries(id) on delete cascade,
  from_status public.enquiry_status,
  to_status public.enquiry_status not null,
  escalated_to uuid references public.profiles(id),
  actor_id uuid references public.profiles(id),
  at timestamptz not null default now()
);

create index if not exists ticket_events_enquiry_idx
  on public.ticket_events (enquiry_id, at desc);

comment on table public.ticket_events is
  'One row per ticket status change (§44.2): what it moved from and to, who '
  'moved it, and — for an escalation — who it was escalated to.';

alter table public.ticket_events enable row level security;

drop policy if exists ticket_events_select on public.ticket_events;
create policy ticket_events_select on public.ticket_events
  for select using ((select app.is_staff()));

create or replace function app.ticket_events_after_status()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  if new.type <> 'after_sale' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status
     and old.escalated_to is not distinct from new.escalated_to then
    return null;
  end if;

  insert into public.ticket_events (enquiry_id, from_status, to_status, escalated_to, actor_id)
  values (
    new.id,
    case when tg_op = 'UPDATE' then old.status end,
    new.status,
    new.escalated_to,
    -- auth.uid() is null for a service-role write; the column is nullable and
    -- an unattributed change is better recorded than not recorded.
    auth.uid()
  );
  return null;
end $$;

drop trigger if exists z_ticket_events on public.enquiries;
create trigger z_ticket_events
  after insert or update of status, escalated_to on public.enquiries
  for each row execute function app.ticket_events_after_status();

grant select on public.ticket_events to authenticated;
