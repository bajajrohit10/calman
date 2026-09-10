-- Expose app.supersede_enquiry to the Data API.
--
-- PostgREST serves only the schemas listed in config.toml (`public`,
-- `graphql_public`), and the rest of `app.*` is deliberately unreachable from
-- it — those are the internals of the state machine. This is the one routine
-- the application genuinely has to call, so it gets a thin wrapper in `public`
-- rather than the whole schema being published.
--
-- The wrapper is SECURITY INVOKER on purpose: it grants no authority of its
-- own, and the definer function behind it does its own app.is_staff() check.

create or replace function public.supersede_enquiry(p_enquiry_id bigint)
returns void
language sql
security invoker
set search_path = ''
as $$
  select app.supersede_enquiry(p_enquiry_id);
$$;

comment on function public.supersede_enquiry(bigint) is
  'Data API wrapper for app.supersede_enquiry (§5.1): closes an open purchase '
  'enquiry with close_reason = superseded.';

revoke all on function public.supersede_enquiry(bigint) from public;
grant execute on function public.supersede_enquiry(bigint) to authenticated;
