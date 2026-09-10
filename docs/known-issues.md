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
