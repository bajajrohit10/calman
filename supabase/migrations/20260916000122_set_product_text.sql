-- §49.2. The first-call form edits the product text of a purchase lead.
--
-- It needs its own door. The column grant on enquiries covers four graded
-- columns and product_text is not one of them, and set_ticket_fields — the
-- existing security-definer route to it — refuses anything that is not a
-- ticket, on purpose: its whole contract is "these are a ticket's fields".
-- Widening that to mean "a ticket's fields, or sometimes one field of a lead"
-- would make it a function nobody can describe.
--
-- So: one function, one column, either type of enquiry. Staff only, like its
-- neighbours, and it reads the request for nothing else.
create or replace function public.set_product_text(
  p_enquiry_id bigint,
  p_product text
)
returns void
language plpgsql
security definer
set search_path to 'public', 'app', 'pg_temp'
as $function$
declare
  v_exists boolean;
begin
  if not app.is_staff() then
    raise exception 'Not allowed.';
  end if;

  select true into v_exists from public.enquiries where id = p_enquiry_id;
  if v_exists is null then
    raise exception 'No such enquiry %', p_enquiry_id;
  end if;

  -- Trimmed to null rather than stored as an empty string: "not recorded" has
  -- one representation everywhere else in this schema and should here too.
  -- The before-write trigger re-derives call_type from the new text (§47.5).
  update public.enquiries
     set product_text = nullif(btrim(coalesce(p_product, '')), '')
   where id = p_enquiry_id;
end
$function$;

grant execute on function public.set_product_text(bigint, text)
  to authenticated, service_role;
