-- §5.10: the record of every WhatsApp message sent to a student.
--
-- A table rather than a call row with an outcome the trigger ignores. That
-- alternative would have needed app.recompute_enquiry() taught to skip these
-- rows in three separate places — the last-call lookup that decides status,
-- the `count(distinct call_date)` that counts follow-up slots, and the
-- `min(call_date)` that fixes the fresh-call day. Miss any one and a WhatsApp
-- message consumes a follow-up slot or moves the slot window; three messages
-- would lose a lead to max_followups. That is a wildly disproportionate blast
-- radius for a log line, and the trigger never needs to see this table at all.
--
-- message_text is what was actually sent, after the counsellor edited the
-- preview. The template alone does not tell you what the student received.

create table public.whatsapp_sends (
  id bigint generated always as identity primary key,
  enquiry_id bigint not null references public.enquiries (id),
  template_id uuid references public.whatsapp_templates (id),
  message_text text not null,
  sent_by uuid not null references public.profiles (id),
  sent_at timestamptz not null default now()
);

create index whatsapp_sends_enquiry_idx on public.whatsapp_sends (enquiry_id, sent_at desc);
create index whatsapp_sends_sender_day_idx on public.whatsapp_sends (sent_by, sent_at desc);

alter table public.whatsapp_sends enable row level security;

create policy whatsapp_sends_select on public.whatsapp_sends
  for select to authenticated using (app.is_staff());

-- Insert only, and only as yourself: this is a record of something that
-- happened, not a field to be corrected later.
create policy whatsapp_sends_insert on public.whatsapp_sends
  for insert to authenticated
  with check (app.is_staff() and sent_by = (select auth.uid()));

revoke all on public.whatsapp_sends from anon;
grant select, insert on public.whatsapp_sends to authenticated;

comment on table public.whatsapp_sends is
  'Every WhatsApp message sent from Calman (§5.10). Deliberately outside the '
  'calls table so the §4.3 slot rule never sees it.';

-- calls.whatsapp_sent is left in place: historical rows carry it, and the
-- history screen still renders it. Nothing writes it from now on.
comment on column public.calls.whatsapp_sent is
  'Legacy. WhatsApp sends are recorded in public.whatsapp_sends from Brief 6 '
  'onward; this column is retained for rows written before that.';
