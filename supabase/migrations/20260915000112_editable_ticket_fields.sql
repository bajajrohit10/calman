-- §47.2. "Edit enquiry details" on a ticket lets any staff change the Order
-- ID, the Product, the Teacher and the issue category.
--
-- set_ticket_fields already writes the first three, but only ever coalesce:
-- a null argument means "leave it alone", which is right for the call panel —
-- it sends what the call touched — and wrong for an editor, where clearing a
-- wrong order id has to be possible. So it gains p_replace. One flag rather
-- than a touch flag per column: the editor always sends the whole set, the
-- panel never does, and the two callers differ in exactly that.
--
-- The issue category is not on the enquiry. It is on the call, and the panel
-- reads a ticket's category from the most recent call that carries one. So
-- that is the row this changes. It is an edit to a call, audited by the audit
-- trigger on calls like any other, and it shows up in the Edited column the
-- history already renders — which is the right place for it, because "the
-- category was wrong and somebody fixed it" is a fact about the record rather
-- than a silent state change.
--
-- The institute follows the teacher with nothing written: teachers carry
-- institute_id and every reader joins through it.
create or replace function public.set_ticket_fields(
  p_enquiry_id bigint,
  p_order_id text default null,
  p_product text default null,
  p_teacher_id uuid default null,
  p_touch_escalated boolean default false,
  p_escalated_to uuid default null,
  p_replace boolean default false,
  p_touch_issue boolean default false,
  p_issue_category public.issue_category default null
)
returns void
language plpgsql
security definer
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare
  v_type public.enquiry_type;
  v_call bigint;
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
     set order_id     = case when p_replace then p_order_id
                             else coalesce(p_order_id, order_id) end,
         product_text = case when p_replace then p_product
                             else coalesce(p_product, product_text) end,
         teacher_id   = case when p_replace then p_teacher_id
                             else coalesce(p_teacher_id, teacher_id) end,
         escalated_to = case when p_touch_escalated then p_escalated_to
                             else escalated_to end
   where id = p_enquiry_id;

  if p_touch_issue then
    -- The call the panel would read the category from: the most recent one
    -- carrying a category, falling back to the most recent call at all so a
    -- ticket whose category was never set can still be given one.
    select id into v_call
      from public.calls
     where enquiry_id = p_enquiry_id
     order by (issue_category is not null) desc,
              call_date desc, called_at desc, id desc
     limit 1;

    if v_call is not null then
      update public.calls
         set issue_category = p_issue_category
       where id = v_call
         and issue_category is distinct from p_issue_category;
    end if;
  end if;
end
$function$;

grant execute on function public.set_ticket_fields(
  bigint, text, text, uuid, boolean, uuid, boolean, boolean, public.issue_category
) to authenticated, service_role;

-- The six-argument shape the call panel has been calling since Brief 44 would
-- now sit beside the nine-argument one as a second overload, and PostgREST
-- refuses a call that matches two. The new one has defaults for all three
-- additions, so every existing named call still resolves against it.
drop function if exists public.set_ticket_fields(bigint, text, text, uuid, boolean, uuid);
