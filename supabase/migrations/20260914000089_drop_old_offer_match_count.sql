-- §42.1 follow-up. The look-back gave offer_match_count two default arguments,
-- which made it an overload rather than a replacement: a five-argument call now
-- matches both signatures and PostgREST refuses it as ambiguous. The old one
-- goes, since the new one answers its question when both new arguments are
-- null — which is what "no look-back" means.

drop function if exists public.offer_match_count(uuid[], uuid[], uuid[], uuid[], uuid[]);

do $$
begin
  if (select count(*) from pg_proc where proname = 'offer_match_count') <> 1 then
    raise exception 'offer_match_count: expected exactly one signature to remain';
  end if;
end $$;
