-- §50A (out of band). Close a live hole found while testing the accounts RLS
-- boundary. This touches the public schema, which Brief 50A fenced off; the
-- fence was there to stop the accounts module destabilising the counselling
-- product, and leaving this open is the larger risk. It removes privileges
-- only — nothing is granted, no definition changes.
--
-- What was wrong. `live_enquiries` and `offer_matches` are views owned by
-- postgres with security_invoker off, so they read their base tables as the
-- owner and RLS never runs. They also carried PostgreSQL's default grant to
-- `anon` and `authenticated`. `anon` is the key published in the browser
-- bundle at calman.zeroinfy.in, so the net effect was that the public internet
-- could SELECT, UPDATE and DELETE every live enquiry through the view while
-- the base table correctly answered 401. Verified against production: an
-- unauthenticated GET returned all 94 rows, and UPDATE/DELETE passed the
-- privilege check (200, empty result on a WHERE that matched nothing).
-- An unfiltered DELETE would have taken the lead table with it.
--
-- Nothing legitimate loses anything. No client writes through a view; the app
-- writes to base tables and security-definer functions. The only application
-- read is offer_matches in components/call-log/actions.ts, which runs with a
-- signed-in user's token and keeps its SELECT. The SQL functions that read
-- live_enquiries are security definer and were never using these grants.
--
-- This is containment, not the whole fix: `authenticated` keeps SELECT, so any
-- signed-in role still reads both views with RLS bypassed. Closing that means
-- setting security_invoker on, which changes what staff see and belongs in its
-- own decision.
revoke all on public.live_enquiries from anon;
revoke all on public.offer_matches  from anon;

-- No caller writes through either view; keep the read that one does use.
revoke insert, update, delete, truncate, references, trigger
  on public.live_enquiries from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.offer_matches  from authenticated;

notify pgrst, 'reload schema';
