# Known issues

Things that are understood but not resolved. Fixed issues are removed from this
file — git history is the record of what was.

---

## The 1,000-row response cap

PostgREST caps every response at `max_rows` (1,000 on this project, see
`supabase/config.toml`). The request **succeeds**; the array is simply short.
Nothing in the client tells you it happened.

This is the most dangerous default in the stack, because the failure is silent
and looks like data. A purge script written against it once reported removing
21,000 students while deleting none: the 1,000-uuid `in()` filter it built
exceeded what PostgREST would accept, the error went unchecked, and the same
first thousand rows came back every round.

**The rules:**

| You need | Use |
|---|---|
| a number | `.select("*", { count: "exact", head: true })` — exact regardless of the cap |
| one page | an explicit `limit`, and show the total separately |
| the whole set | `fetchAllRows()` from `lib/paged.ts` |

`fetchAllRows` pages in 500s and reports `truncated` when it hits its ceiling,
so a caller can say so rather than present a fraction of the answer as the
answer.

Two further traps worth naming:

- **RPCs are capped too.** A `returns table` function called through PostgREST
  obeys `max_rows` like any other request, so `p_limit: 2000` returns 1,000.
- **`.in()` has a practical ceiling** well below a thousand values, because the
  filter travels in the URL. Chunk it at a few hundred and check the error.

## Measuring a query the way the app actually runs it

Timing a query as `postgres` — which is what `supabase db query` gives you —
measures the wrong thing, and measures it optimistically. `postgres` bypasses
RLS. Every table in this schema is behind a policy, and the policies are where
the cost is.

Brief 8 measured the Assignment Desk at **62 ms** against a 5,000-enquiry set
as `postgres`. The same page as `authenticated` died at Supabase's 8-second
statement timeout. The gap was `app.is_staff()` in 88 policy expressions, each
re-entered per row, each a lookup against `profiles`.

Two habits, both now baked into the migrations:

1. **Measure under the role and the RLS the app uses.** Prefix the `explain`:

   ```sql
   set local role authenticated;
   set local request.jwt.claims = '{"sub":"<a real profile id>","role":"authenticated"}';
   explain (analyze, costs off) select * from public.recommended_calls(...);
   ```

2. **Wrap parameterless policy helpers in a scalar subquery.** `app.is_staff()`
   in a policy body is a per-row call; `(select app.is_staff())` is an InitPlan
   evaluated once per statement. `STABLE` does not buy the hoist on its own.
   Migration `20260910000027` did this for every existing policy — any new
   policy has to follow the same form.

A related trap sits one level down. A SQL function carrying `SET search_path`
cannot be inlined, so it is planned **generically**, with its parameters opaque
to the planner. Row estimates collapse to defaults, and anything the planner
has no statistics for — a `MATERIALIZED` CTE, a join whose key comes from
another CTE — turns into a nested loop. Three separate instances of this cost
the desk query 1.7s, 6.4s and 1.8M wasted comparisons before they were found.
When a function is slow and its parts are not, reproduce the generic plan:

```sql
set plan_cache_mode = force_generic_plan;
prepare p(<types>) as <the function body, $1..$n for the parameters>;
explain (analyze, costs off) execute p(<nulls>);
```

The `Function Scan` line an `explain` gives you for an RPC hides all of this.

---

## The three enquiry partial indexes were rebuilt non-concurrently

Migration `20260910000030` rebuilds `enquiries_follow_up_queue_idx`,
`enquiries_new_calls_idx` and `enquiries_ticket_queue_idx` with plain DDL,
which takes an `ACCESS EXCLUSIVE` lock on `enquiries` for the duration —
instant at the current size, but blocking writes on a large table. Neither
`supabase db push` nor `supabase db query` can run `CONCURRENTLY`, because both
wrap statements in a transaction and there is no `psql` or node `pg` client on
this project. On a large table, run these by hand first and the migration's
`if not exists` clauses become no-ops:

```sql
drop index concurrently enquiries_follow_up_queue_idx;
create index concurrently enquiries_follow_up_queue_idx
  on public.enquiries (next_follow_up_date)
  where status = 'open' and type = 'purchase' and archived_at is null;

drop index concurrently enquiries_new_calls_idx;
create index concurrently enquiries_new_calls_idx
  on public.enquiries (importance, created_at)
  where status = 'open' and type = 'purchase' and fresh_call_date is null
    and archived_at is null;

drop index concurrently enquiries_ticket_queue_idx;
create index concurrently enquiries_ticket_queue_idx
  on public.enquiries (next_follow_up_date)
  where type = 'after_sale' and status in ('open', 'escalated')
    and archived_at is null;
```

---

## The lag on save and tab switch is contention, not queries

**Status: the contention is fixed (Brief 51). The ~10 s instance stalls are not.**

Counsellors reported a delay saving in Quick Add and switching tabs on My Day
and New Calls. Measured on production as `counsellor.test`, three runs each, on
2026-09-18 between 11:20 and 11:40 IST.

On an idle instance, nothing is slow:

| Flow | Wall | Server | Client |
|---|---|---|---|
| Quick Add, save 5 rows | 565 / 651 / 787 ms | 478–603 ms | 5–19 ms |
| My Day, New Calls → Assigned → Tickets | 250–366 ms | 106–244 ms | 6–20 ms |
| New Calls, Video → Books → Unknown | 274–864 ms | 259–849 ms | 5–15 ms |
| Enquiries, Today → This week | 258–328 ms | 239–296 ms | 12–32 ms |

Thirty sequential RSC fetches of `/my-day?tab=assigned` gave p50 241 ms, p90
280 ms, max 860 ms, with no outlier. Every RPC behind these screens runs in
13–37 ms under `authenticated` with RLS on, all from shared buffers
(`enquiries_table` 20.6 ms, `recommended_calls` 36.5 ms, `recommended_facets`
37.4 ms, `tickets_list` 32.5 ms, `new_calls_pool` 13.3 ms,
`enquiries_called_by_facets` 13.3 ms). No index was lost to the recent
migrations: nothing in these paths reaches a sequential scan.

**What is slow is the same request while the instance is busy.** Every page
load fires **14 router prefetches**: the seven routes a counsellor's sidebar
links to (`/my-day`, `/new-calls`, `/quick-add`, `/import`, `/tickets`,
`/enquiries`, `/reports`), each fetched twice, in two waves. Each is a full
server render of that route with its real queries. They land 1.3–1.9 s after
load, which is exactly when somebody clicks. Reproducing that burst and timing
one ordinary request inside it:

| Run | Same request, idle | With 14 prefetches in flight |
|---|---|---|
| 1 | ~240 ms | **1,381 ms** |
| 2 | ~240 ms | **40,031 ms** |
| 3 | ~240 ms | **1,785 ms** |

Three separate ≈10.5 s events were also caught in ordinary use — a
`domContentLoaded` of 10,504 ms on a load whose TTFB was 120 ms, a My Day tab
switch whose response ended at 10,556 ms, and a New Calls tab whose response
ended at 10,488 ms — all with a fast first byte and a slow body, which is what
waiting for an instance looks like from the browser.

A click that lands before hydration was **lost, not delayed**: it fired no
request at all and the tab did not move. With a load that streams for ten
seconds, that window was ten seconds wide, and the counsellor's second and
third clicks were the ones that counted. Fixed in Brief 51 — every tab control
on My Day, New Calls and Enquiries is now a real `<a href>` carrying the URL
state, so a click before hydration is a navigation the browser handles.

**Checked and cleared:**

- Supabase has not paused or restarted. `pg_postmaster_start_time()` is
  2026-09-10 11:31 UTC — the project's own creation — and `supabase projects
  list` reports `ACTIVE_HEALTHY`.
- The keep-warm route is deployed and answering (401 in 240–347 ms, which is
  itself a warm instance; `CRON_SECRET` is set, so it cannot be called by hand).

**Not verified:** whether the Vercel cron actually fired this week. That needs
the Vercel cron log or CLI, neither of which is available from here.

**The Brief 46 baseline is not in this file.** It is in the commit message of
095d849: warm ≈120 ms TTFB, a cold start 534 ms, one stall at 8.1 s. The warm
figure still holds exactly — 62–120 ms TTFB across every measurement above.
What has grown since is the number of requests each page load fires at that
instance.

### What was done (Brief 51), and what it moved

**Why each route was fetched twice.** Nothing is duplicated — there is one
sidebar, one `<Link>` per route. In Next 16 a single `<Link>` issues *two*
prefetches: a segment-tree request carrying `next-router-segment-prefetch:
/_tree`, and a full RSC request carrying `next-router-state-tree`. Both come
back `x-vercel-cache: MISS` against `x-matched-path: /my-day.rsc`, so both run
the page. `prefetch={false}` stops both, which is why the cause and the symptom
happen to have the same fix.

**Why turning it off costs nothing.** Every route here is dynamic, and since
Next 15 `staleTimes.dynamic` defaults to **0 seconds** — a prefetched payload
for a dynamic route is stale the moment it lands. Measured: with all fourteen
prefetches complete, clicking a rail link still fired a full request, 241 ms to
first byte. The prefetches bought nothing.

**Requests per page load, before → after:**

| Page | Server renders on load, before | After |
|---|---|---|
| My Day | 14 | 0 |
| New Calls | 14 | 0 |
| Enquiries | 15 (13 rail + 2 quick-range) | 0 |

The last one on My Day was not a prefetch: the URL-sync effect's first run
`router.replace`d a bare `/my-day` into `?tab=…&view=…&sub=…`, a full server
render to write down what the server had just decided. It now skips its first
run.

**The flows, idle instance, three runs each:**

| Flow | Before | After |
|---|---|---|
| Quick Add, save 5 rows | 565 / 651 / 787 ms | 625 / 416 / 462 ms |
| My Day tabs | 250–366 ms | 235–908 ms (median 243) |
| New Calls tabs | 274–864 ms | 243–715 ms (one 10.5 s stall) |
| Enquiries Today → week | 258–328 ms | 210–261 ms |
| A click 1.5 s after load | 1,381 / 40,031 / 1,785 ms | 511 / 273 / 267 ms |

That last row is the whole of it. Before, a click landing in the window the
burst occupied was 5× to 170× slower than the same click on a quiet instance.
After, there are no requests in that window at all — measured as zero, three
runs — and the click costs what any other click costs.

### What is left: the ~10 s instance stall

Unchanged by any of this, because it was never the prefetches. Four were seen
across the post-fix runs (11.1 s, 11.0 s, 10.5 s, 7.7 s), against three in the
same volume of pre-fix runs. Every one has a fast first byte (62–120 ms) and a
slow body, and every one is the first request after an idle gap or against a
fresh deployment — an instance being started, which is what Brief 46 measured
at 534 ms to 8.1 s and which has evidently grown.

Nothing in the app causes it and nothing in the app can fix it. The remaining
levers are Vercel function concurrency and a keep-warm cron holding more than
one instance, both of which cost money and both of which Brief 51 ruled out of
scope. The honest statement is that a counsellor returning to Calman after a
quiet half hour will wait about ten seconds, once, and everything after that is
a quarter of a second.

**Still not verified:** whether the Vercel cron actually fires. That needs the
Vercel cron log or CLI, neither available from here.

## Deliberate audit gaps

The audit log is meant to be complete. There is exactly one place it is not,
and this is it.

**`app.purge_archived()` suppresses the audit rows for a purged enquiry's
children** — `calls`, `enquiry_items`, `assignments`, `whatsapp_sends`,
`import_rows` — and the `enquiries` UPDATE rows that
`app.recompute_enquiry()` fires while those children are being deleted.

Why: without it, purging grows the log instead of shrinking it. A measured
purge of 99 enquiries wrote 189 audit rows where the intent is 100. The extra
89 were 75 recompute updates on rows about to be deleted, and 14 assignment
deletes — all of them churn about data that is being destroyed on purpose and
is itemised elsewhere.

**What is never suppressed:**

- the `enquiries` DELETE row, one per purged enquiry, carrying full `old_data`
  — so a purged enquiry is still reconstructable from the log alone;
- the batch summary row (`table_name = 'archive_batches'`, `action = 'delete'`)
  listing the enquiry ids and the count of every child type destroyed.

**Two guards, both required** (`audit.log_change`):

1. `current_setting('app.purging')` is `'on'`, and
2. `PG_CONTEXT` shows `app.purge_archived` in the current call stack.

Setting the GUC from anywhere else does nothing — verified by setting it by
hand outside the function, deleting a call, and confirming the audit row was
still written. Both conditions have to hold, so the gap cannot be opened by a
stray `set_config` or by a future function that happens to reuse the name.

`app.purge_archived()` is itself `super_admin` only, and refuses to run unless
the caller passes the exact count of archived enquiries about to be destroyed.

---

## Import: a Commit click that did not register

**Status: unreproduced. Watch for it during the pilot.**

During the 3,000-row import test, one click on **Commit the import** did
nothing: the panel stayed on the review step, no progress bar appeared, no
error was shown, and no `import_batches` row was created. Clicking the same
button again immediately afterwards worked normally and completed in 17
seconds.

What is known:

- The click handler ran — an instrumentation mark set immediately before
  `.click()` was recorded.
- The stage never advanced to `committing`, so `commit()` either did not run or
  returned before its first `setStage`.
- No console error, no network error, and no orphan batch was left behind, so
  nothing was half-written.
- It has happened once, on a 3,000-row review table, and has not recurred on
  any smaller run.

Because no batch was created, the failure mode is *safe* — it loses a click,
not data. If it recurs, the things worth capturing are whether the review table
was large, and whether the browser tab had been left idle before the click.

## Reports: PLI issued is inflated by historical test imports

**Status: cosmetic, historical only. Will not recur.**

"PLI issued" counts audit rows where an enquiry's importance became `a`. Bulk
imports are excluded by checking whether an `import_rows` row points at the
enquiry — but that check needs the import log to still exist. The Brief 5 test
imports were purged *including* their `import_rows`, so several thousand
audit rows from those runs now look like human decisions and are attributed to
`counsellor.test`.

Two consequences worth knowing:

- The figure is right for anything imported from here on, because real imports
  keep their `import_rows` — §5.7 exists to preserve them.
- `audit_log` was deliberately not cleaned. It is an append-only record of who
  did what, and deleting from it to tidy a metric is a worse trade than the
  noise.

If the pilot's numbers need to start clean, the honest fix is a dated cutoff in
the report rather than deleting audit history.
