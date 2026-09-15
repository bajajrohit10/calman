-- §47.3. What "Not interested — don't call" does.
--
-- It loses the lead, with its own reason, and then nothing else is special
-- about it. That is the whole point: the brief asks for it to be "treated
-- exactly like any other lost lead afterwards", so re-enquiry opens a new
-- enquiry with no warning and the offer views include it — both of which are
-- already true of every lost lead and neither of which needs a line of code
-- here. The only way to get that for free is to make it genuinely lost rather
-- than a fourth state that merely looks like it.
--
-- 'closed' is left alone. It stays what §4.7 made it: wrong number, the one
-- close that flags an import.

-- 1. The outcome is legal on a purchase enquiry.
alter table public.calls drop constraint if exists outcome_matches_type;

alter table public.calls add constraint outcome_matches_type check (
  (
    enquiry_type = 'purchase'::public.enquiry_type
    and outcome = any (array[
      'follow_up'::public.call_outcome,
      'call_back'::public.call_outcome,
      'purchased'::public.call_outcome,
      'competitor'::public.call_outcome,
      'not_interested'::public.call_outcome,
      'closed'::public.call_outcome
    ])
  )
  or (
    enquiry_type = 'after_sale'::public.enquiry_type
    and outcome = any (array[
      'noted'::public.call_outcome,
      'working'::public.call_outcome,
      'escalated'::public.call_outcome,
      'pending_institute'::public.call_outcome,
      'resolved'::public.call_outcome
    ])
  )
);

-- 2. recompute_enquiry learns the branch.
--
-- Patched by text substitution rather than restated in full: the function is
-- 150 lines that several briefs have edited, and pasting a copy here would
-- silently revert whatever landed between this file being written and it being
-- run. The raise makes a missed match loud instead of quiet.
do $$
declare
  src text;
  patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'recompute_enquiry';

  patched := replace(
    src,
    '  elsif v_last.outcome = ''competitor'' then',
    '  elsif v_last.outcome = ''not_interested'' then' || E'\n' ||
    '    -- §47.3. The student said no. Lost, with the reason they gave, and' || E'\n' ||
    '    -- from here indistinguishable from any other lost lead.' || E'\n' ||
    '    v_status := ''lost'';' || E'\n' ||
    '    v_lost := ''not_interested'';' || E'\n' ||
    '    v_next := null;' || E'\n' ||
    E'\n' ||
    '  elsif v_last.outcome = ''competitor'' then'
  );

  if patched = src then
    raise exception 'recompute_enquiry: competitor branch not found; not patched';
  end if;

  execute patched;
end $$;
