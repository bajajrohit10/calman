-- §44.1/§44.2. Writing a ticket's own fields.
--
-- public.enquiries grants UPDATE on four columns only — importance,
-- lead_verification, source_id, term_id — because every other column on it is
-- derived by app.recompute_enquiry() from the call history, and an application
-- that could write them could disagree with the trigger that owns them.
--
-- The three ticket columns are not derived: somebody types them. But widening
-- the grant to reach them would also reach status, closed_at and the follow-up
-- date, which is exactly what the narrow grant exists to prevent. So they are
-- written by a function that can touch those three and nothing else — the same
-- shape as §43.2's set_my_theme, and for the same reason.

create or replace function public.set_ticket_fields(
  p_enquiry_id bigint,
  p_order_id text default null,
  p_product text default null,
  p_teacher_id uuid default null,
  -- Escalation is a separate act from filling the form in, so it is separately
  -- opted into: a save that is not about escalation must leave the name that
  -- is already there alone.
  p_touch_escalated boolean default false,
  p_escalated_to uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  v_type public.enquiry_type;
begin
  if not app.is_staff() then
    raise exception 'Not allowed.';
  end if;

  select type into v_type from public.enquiries where id = p_enquiry_id;
  if v_type is null then
    raise exception 'No such enquiry %', p_enquiry_id;
  end if;
  if v_type <> 'after_sale' then
    raise exception 'Enquiry % is not a ticket', p_enquiry_id;
  end if;

  update public.enquiries
     set order_id     = coalesce(p_order_id, order_id),
         product_text = coalesce(p_product, product_text),
         teacher_id   = coalesce(p_teacher_id, teacher_id),
         escalated_to = case when p_touch_escalated then p_escalated_to else escalated_to end
   where id = p_enquiry_id;
end $$;

comment on function public.set_ticket_fields(bigint, text, text, uuid, boolean, uuid) is
  'Writes the three typed-in ticket columns and, when asked, the escalatee '
  '(§44.1, §44.2). Security definer because enquiries grants UPDATE on four '
  'graded columns only, and widening that grant would expose the derived ones.';

revoke all on function public.set_ticket_fields(bigint, text, text, uuid, boolean, uuid) from public;
grant execute on function public.set_ticket_fields(bigint, text, text, uuid, boolean, uuid) to authenticated;
