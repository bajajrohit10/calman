-- §84.3. An experiment with an end date in the future is still running.
--
-- The first version read `live` as "has no end date", which made the one case the
-- brief actually describes impossible: Rohit sets the end to 21 Oct while today is
-- the 5th, and the card is supposed to say "day 1 of 17". With that definition it
-- said nothing, because an end date existed.
--
-- Two corrections, and they belong together:
--
--   live  = no end date, or an end date that has not arrived.
--   during = start → the earlier of the end date and today. Measuring to a future
--            end would average in days that have not happened, which silently
--            dilutes every rate on the card as soon as somebody plans ahead.
--
-- dayM is the planned length, which only exists once an end date does. So a card
-- reads "day 1 of 17" when the finish is known and "live · day 1" when it is not.
create or replace function public.analytics_experiment_result(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_e      record;
  v_start  date;
  v_end    date;
  v_len    integer;
  v_bfrom  date;
  v_bto    date;
begin
  if not app.is_admin() then
    raise exception 'not authorised to read analytics' using errcode = '42501';
  end if;

  select * into v_e from public.analytics_events where id = p_id;
  if v_e.id is null then return 'null'::jsonb; end if;

  v_start := v_e.start_date;
  v_end   := least(coalesce(v_e.end_date, app.ist_today()), app.ist_today());
  -- A start in the future has no elapsed window at all; one day, so the card can
  -- say "nothing yet" rather than divide by a negative length.
  v_end   := greatest(v_end, v_start);
  v_len   := greatest((v_end - v_start) + 1, 1);
  v_bto   := v_start - 1;
  v_bfrom := v_bto - (v_len - 1);

  return jsonb_build_object(
    'id', v_e.id,
    'note', v_e.note,
    'metricNote', v_e.metric_note,
    'scopeType', v_e.scope_type,
    'scopeId', v_e.scope_id,
    'startDate', v_start,
    'endDate', v_e.end_date,
    'live', v_e.end_date is null or v_e.end_date >= app.ist_today(),
    'dayN', greatest((app.ist_today() - v_start) + 1, 0),
    'dayM', case when v_e.end_date is not null then (v_e.end_date - v_start) + 1 end,
    'beforeFrom', v_bfrom, 'beforeTo', v_bto,
    'duringFrom', v_start, 'duringTo', v_end,
    'before', app.analytics_totals(v_bfrom, v_bto, null, null, null, null, null,
                                   v_e.scope_type, v_e.scope_id, false),
    'during', app.analytics_totals(v_start, v_end, null, null, null, null, null,
                                   v_e.scope_type, v_e.scope_id, false),
    'rest',   case when v_e.scope_type <> 'all'
                   then app.analytics_totals(v_start, v_end, null, null, null, null, null,
                                             v_e.scope_type, v_e.scope_id, true) end,
    'restBefore', case when v_e.scope_type <> 'all'
                   then app.analytics_totals(v_bfrom, v_bto, null, null, null, null, null,
                                             v_e.scope_type, v_e.scope_id, true) end
  );
end;
$function$;

notify pgrst, 'reload schema';
