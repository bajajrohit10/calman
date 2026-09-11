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
