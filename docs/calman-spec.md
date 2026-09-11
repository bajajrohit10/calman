# Calman — Zeroinfy Counselling CRM

Project specification v1.1 · 10 Sep 2026 · schema decisions incorporated (see §10)
Replaces the "Zeroinfy Calman Calling" Google Sheet (New Calls / Follow Up Sheets / Data tabs).

---

## 1. Purpose

A lead-management and call-tracking tool for the Zeroinfy counselling team (5 counsellors today). Every phone number has one permanent history; every enquiry has an unlimited chain of calls; admin assigns each day's calls; the system recommends who to call and in what order; everything is filterable and exportable.

Desktop only. No mobile UI.

---

## 2. Roles

| Capability | Super Admin | Manager | Counsellor | Ticket Team |
|---|---|---|---|---|
| See all enquiries and history | ✓ | ✓ | ✓ | ✓ |
| Quick add, log calls on any enquiry (Purchase and After Sale) | ✓ | ✓ | ✓ | ✓ |
| Bulk import | ✓ | ✓ | ✓ | ✓ |
| Export (any table, current filters) | ✓ | ✓ | ✓ | ✓ |
| Reports, My Day, recommended list | ✓ | ✓ | ✓ | ✓ |
| Edit own entries | ✓ | ✓ | same day only | same day only |
| Edit anyone's entries | ✓ | ✓ | — | — |
| Delete entries | never | never | never | never |
| Assign / reassign calls, create campaigns | ✓ | ✓ | — | — |
| Master lists, templates, holidays, offers | ✓ | ✓ | — | — |
| Create logins | ✓ | ✓ | — | — |
| Dismiss overdue report | ✓ | ✓ | — | — |
| Code / deployment / env vars | ✓ | — | — | — |

Counsellor and Ticket Team currently have identical permissions; the role is a label for reporting and for default views (Ticket Team's My Day defaults to After Sale / escalated). If they later need to diverge, the role column already exists.

---

## 3. Data model

Three levels: **Student (phone) → Enquiry → Call**, plus **Enquiry Items** for teacher/subject interests.

### students
- `mobile` — unique, exactly 10 digits, first digit 6/7/8/9. Normalised on entry (strip +91, 0 prefix, spaces, dashes). **The only mandatory field in the system.**
- `name` — optional

### enquiries
- `student_id`
- `type` — `purchase` | `after_sale`
- `source_id` → sources master (AC = Abandoned Checkout, Indv WhatsApp, Knowlarity, Interakt, Vsmart, …)
- `product_text` — free text; the raw product title as imported (counsellor structures it into items when they call)
- `term_id` → terms master — exam attempt (May-26, Sep-26, Jan-27 …); one per enquiry; editable any time
- `importance` — A: Yes + PLI (top) · B: Yes + No PLI · C: Not Sure · D: No
  - **PLI is derived from `importance = A`**; there is no separate PLI field. Known simplification — revisit if a B lead can also be issued a price list.
- `lead_verification` — competitor discount proof: Yes with proof · Yes without proof · No. Held on the enquiry, not per item.
- `status`
  - purchase: `open` | `won` | `lost` | `closed`
  - after_sale: `open` | `escalated` | `closed`
- `lost_reason` — `competitor` | `max_followups` | `dropped`
- `close_reason` — `wrong_number` | `superseded`. **Only `wrong_number` is flagged on future imports.**
- `next_follow_up_date` — on an after-sale enquiry this is a reminder date only (§4.5)
- `created_at`, `created_by`, `closed_at`
- Auto-number ID
- **Derived columns, maintained by trigger and never written by the application:** `fresh_call_date`, `follow_up_slots_used`, `last_slot_date`, `top_content_priority`. The last is the best (lowest) content priority across the enquiry's open items, so the §6 recommended list can sort without joining.

### enquiry_items (one row per teacher + subject interest)
- `enquiry_id`, `teacher_id`, `course_id`, `subject_id`, `content_id`
- `status` — `open` | `won` | `competitor` | `closed`
- `order_id` (text), `amount` (optional)
- A student asking BB for DT and IDT = two items. Same teacher, two subjects = two items.
- Teacher-wise won/lost analytics run on this table, not on the enquiry.

### calls
- `enquiry_id`, `called_at`, `called_by`
- `outcome`
  - purchase: `follow_up` (spoke) | `call_back` (no pickup) | `purchased` | `competitor` | `closed` (wrong number)
  - after_sale: `noted` | `escalated` | `resolved` — which set the enquiry status to `open` | `escalated` | `closed` respectively
- `discussion` — one note per call
- `next_follow_up_date` — on an after-sale call this is a reminder date and does **not** put the enquiry into any follow-up queue
- `whatsapp_sent` — set when the WhatsApp button is used
- After-sale calls additionally: `issue_category` (video access, book delivery, refund, wrong course, other), `order_id`

### assignments
- `enquiry_id`, `date`, `counsellor_id`, `bucket` (`follow_up` | `fresh` | `campaign` | `call_back` | `offer`), `assigned_by`
- Assignment is per day. Tomorrow's follow-up on the same enquiry may go to someone else. Each call records who actually made it.

### Master tables (all soft-delete: `is_active`; deleted options stay on historical rows)
sources · teachers · courses · subjects (belongs to course) · contents (Full, FT, EO, Test Series, Books — with a `priority` order) · terms · whatsapp_templates · holidays

### offers
- `name`, `start_date`, `end_date`, `reminder_days` (default 5), multi-select of teacher / course / subject / content

### import_batches, import_rows
- Every import keeps a row-level log: imported / duplicate-updated / duplicate-new-enquiry / skipped (with reason). Skipped rows can later be reopened or ignored by a counsellor.

### audit_log
- Every insert/update on enquiries, items, calls, assignments: who, when, old value, new value.

### overdue_dismissals
- Admin dismissals of the overdue report, by date.

---

## 4. Lifecycle rules

### Purchase enquiry
1. Created via bulk import (morning) or the quick-add form (when the phone rings).
2. Fresh call → outcome. Then follow-ups.
3. **Follow-up slots.** A follow-up slot = one calendar day (IST) on which the enquiry was called, **after** the fresh-call day. The fresh-call day itself never consumes a slot, so a lead gets one fresh day plus three follow-up days — four calling days at most. Two or more calls on the same day, in any combination, count as one slot. Limit: 3 slots. When the 3rd slot ends with outcome `follow_up` or `call_back`, the enquiry automatically becomes `lost` (reason `max_followups`). Three separate days of `call_back` with no answer therefore lose the lead.
4. **Slot state is derived, not latched.** The whole state machine is recomputed from the enquiry's calls on every call insert, update or delete. A later call on the same day can therefore bring an enquiry back out of `lost` — a `call_back` at 11am on the 3rd slot day marks it lost, and getting through at 4pm returns it to `open` (or `won`). Reports always show current status only; there is no "was lost briefly" state to account for.
5. `purchased` → counsellor ticks which items were bought, enters one order ID (amount optional). Untied items default to "continue follow-up"; counsellor may close them instead. While any item is still `open`, the enquiry stays `open`. Once no open items remain it resolves:
   - at least one item `won` → enquiry `won`;
   - otherwise any item `competitor` → `lost` (reason `competitor`);
   - otherwise → `lost` (reason `dropped`).
   - A `purchased` call on an enquiry that has no items at all → `won`.
6. `competitor` → enquiry `lost` (reason competitor), never re-enters any queue.
7. `closed` → wrong number: `close_reason = wrong_number`. Stored, never queued; future imports of that number are flagged in the import report.
8. **Reopen:** a lost/closed number that calls again gets a **new enquiry** under the same student. History screen shows old and new enquiries stacked.
9. **Supersede.** "Open new enquiry (close previous)" in §5.1 closes the old enquiry with `close_reason = superseded`. A superseded enquiry is *not* a wrong number and is never flagged on import. It is also the one status the trigger will not recompute — it was closed by a human decision, not by call history.

### After-sale enquiry
- `noted` → the counsellor is working it; enquiry stays `open`. Solved immediately → `resolved` → enquiry `closed`.
- Cannot solve → `escalated`; visible to everyone, worked by Ticket Team.
- An after-sale call may set `next_follow_up_date` as a **reminder**. It does not create a follow-up queue entry.
- After-sale enquiries **never** appear in the §6 recommended list, in any follow-up bucket, or in funnel analytics. They appear only on the Tickets screen (§5.11).

### Overdue
- A follow-up not called on its date is **flagged overdue and computed forward at read time** — the stored `next_follow_up_date` is never rewritten. `overdue = next_follow_up_date < today (IST)`; the queue position is `next_working_day(greatest(next_follow_up_date, today))`. This keeps the original date, which is what §6 sorts by ("oldest follow-up date first"), and needs no nightly job.
- **Working days:** Saturday is a working day. Only Sundays and the admin-managed holiday list are skipped.
- A follow-up date chosen on a Sunday or a holiday is snapped forward to the next working day **when it is written**, so the stored date is always a working day. Adding a holiday later does not retrospectively re-snap dates already stored.
- The daily overdue report can be dismissed by admin/manager (items still roll forward).

---

## 5. Screens

### 5.1 Quick Add (phone rings)
Single box: type a mobile number. Live lookup as you type.
- New number → creates student + enquiry, opens the call-logging panel.
- Existing number → shows full history immediately and asks: **Open new enquiry (close previous)** or **Update existing enquiry**. Closing the previous enquiry sets `close_reason = superseded`, never `wrong_number`.

### 5.2 Student History
One page per number: name, all enquiries (old and new, stacked), every call under each with who/when/outcome/note, WhatsApp sends, assignments. Nothing is ever hidden here.

### 5.3 Call Logging (must be fast — 100–300 calls/day)
One note box + one outcome dropdown + follow-up date picker + WhatsApp button. That's it for 90% of calls.
- Outcome applies to all items automatically.
- Outcome = `purchased` → item checklist + order ID appears inline.
- "Edit interests" link opens the items table only when needed (add a teacher/subject line).
- Keyboard-first: Tab through fields, Enter to save, next lead loads.

### 5.4 My Day (counsellor)
Their assigned list for today, grouped by bucket in recommended order (§6). Each row opens call logging in a side panel without leaving the list.

### 5.5 Assignment Desk (admin/manager)
Left: the day's full recommended list with filters (emp, teacher, course, subject, term, content, importance, source, date range, discussion-contains). Right: counsellors with today's counts. Multi-select rows → assign. Bulk reassign one counsellor's whole day to another in one action (leave cover).

**Campaign filter:** build any filter (e.g. Teacher = Bhanwar Borana, Course = CA Final, Content = Full, enquired in last 30 days, status open) → assign the result to a counsellor with a date. Not saved; built fresh each time.

### 5.6 Enquiries table
Every column filterable, discussion has a "contains" filter, sortable, paginated, export CSV/XLSX of the current filtered view.

### 5.7 Bulk Import
Upload CSV/XLSX → map columns → normalise numbers → de-duplicate within the file → review table:
| Number | Status in Calman | Options |
|---|---|---|
| new | — | import |
| existing open enquiry | history preview | Update existing / New enquiry (close old) / Ignore |
| existing closed (wrong number) | flagged | Import anyway / Ignore |
Imported leads land in the unassigned pool. The import report is kept; skipped rows stay actionable.

### 5.8 Reports
- **Daily counsellor report** (per counsellor, per day): Calls made · Fresh handled · Follow-ups done · Call backs · Purchased (count + amount) · Competitor · Closed · PLI issued · Overdue carried forward.
- **Team summary**: same columns totalled, day/week/month.
- **Overdue report**: dismissable.
- All exportable.

### 5.9 Settings
Master lists (add/edit/deactivate), WhatsApp templates, holidays, offers, users and roles.

### 5.10 WhatsApp button
Choose a template → placeholders `{name}`, `{course}` auto-filled from the enquiry → editable preview → opens WhatsApp Web (`wa.me/91<number>?text=…`) in the browser where WhatsApp Web is logged in → logs `whatsapp_sent` on the call. Templates are an unbounded master list managed in Settings; the picker surfaces the first three.

### 5.11 Tickets (after-sale)
The only place after-sale enquiries are worked. Lists `open` and `escalated` after-sale enquiries, sortable by reminder date (`next_follow_up_date`), filterable by issue category, counsellor and date range. Ticket Team's My Day links here by default. After-sale work never enters the recommended list or an assignment bucket.

---

## 6. Recommended call list — ordering

Buckets, in order:
1. **Today's follow-ups** (including rolled-over overdue, flagged)
2. **Offer-expiry leads** — open enquiries matching an offer whose end date is within `reminder_days`
3. **Fresh unassigned** — today's imports and quick-adds not yet called
4. **Campaign lists** — admin-built ad-hoc filters
5. **Today's call backs** — always last (done in the evening)

Within every bucket, sort by: Importance (A → D), then Content priority (Full → FT → EO → Test Series → Books), then oldest follow-up date first.

Purchase enquiries only. After-sale enquiries never appear in any of these buckets — they live on the Tickets screen (§5.11).

Admin sees the whole list and assigns from it; each counsellor sees only their assigned slice.

---

## 7. Analytics (Phase 2, but the schema supports it from day one)

- **Teacher-wise**: pick date range, optionally course and content → table of every teacher with enquiries, won, lost, won %. Click a teacher → the number list with details, toggle open-only / include won-lost, exportable, and assignable from that screen.
- **Offer performance**: enquiries reached vs converted during an offer window.
- **Source-wise conversion**, **counsellor-wise conversion**, **funnel** (fresh → 1st → 2nd → 3rd → won/lost).
- Visual, chart-led ("catchy"): cards + bar/line charts, not just tables.

---

## 8. Non-functional

- **No lag.** Server-side pagination on every table; indexes on `students.mobile`, `enquiries.next_follow_up_date`, `enquiries.status`, `assignments (date, counsellor_id)`, `calls.enquiry_id`; lists virtualised; call logging saves optimistically.
- Validation of the mobile rule in the browser, in the API and as a DB constraint.
- RLS on every table from the first migration — no world-writable window (lesson from the Library).
- Audit log via DB trigger, not application code, so nothing is missed. Covers `enquiries`, `enquiry_items`, `calls`, `assignments`, `students` and `profiles`. Derived columns are excluded from the change test, so trigger churn does not bury human edits.
  - `auth.uid()` is null for service-role work, so server-side scripts must `set local app.actor = '<uuid>'`. The log records which path the actor came from.
- Timezone: IST throughout. Timestamps are stored as `timestamptz`; the IST calendar day is materialised as `calls.call_date` by trigger, because `timezone('Asia/Kolkata', …)` is `stable`, not `immutable`, and so cannot be a generated column.
- Stack: Next.js (App Router) + Supabase (Postgres, Auth, RLS) + Vercel.
- Deployment: `calman.zeroinfy.in`; new Supabase project (Mumbai), repo `bajajrohit10/calman`, Vercel team Zeroinfy.
- No self-signup. Accounts created by Super Admin / Manager.

---

## 9. Phases

**Phase 1 (working product)**
Login + 4 roles · student/enquiry/item/call model with duplicate detection · quick add + history screen · call logging · bulk import with review table · export everywhere · assignment desk with filters and campaign filter · recommended list + My Day · daily counsellor report + team summary · overdue rollover + report · master data settings · WhatsApp button · audit trigger.

**Phase 2**
Offers + expiry bucket · teacher-wise analytics · other analytics dashboards · audit trail viewer · holiday calendar · daily summary email to admin.

**Offer targeting, design note (Brief 10).** `institutes` exists as a master
list from Brief 10, and `teachers.institute_id` links a teacher to one
(optional; null until the teacher→institute sheet is loaded by
`scripts/seed-institutes.mjs`). An offer already targets teachers, courses,
subjects and contents through four sibling join tables — `offer_teachers`,
`offer_courses`, `offer_subjects`, `offer_contents` — and institutes join that
set unchanged:

```sql
create table public.offer_institutes (
  offer_id     uuid not null references public.offers (id) on delete cascade,
  institute_id uuid not null references public.institutes (id),
  primary key (offer_id, institute_id)
);
```

An enquiry matches an institute-targeted offer the same way the §5.5 institute
filter resolves it: through its **open** interest lines to the line's teacher
to that teacher's institute. A teacher with no institute matches no
institute-targeted offer, which is the right default — an offer aimed at a
body should not leak to faculty nobody has placed yet. No offer code exists
today; this note only fixes the shape so it is not re-litigated.

---

## 10. Decisions log

The §4.3 slot rule and fourteen other open points were settled on 10 Sep 2026, before the first migration. Recorded here so the spec and the schema agree.

**Settled**

| # | Point | Decision |
|---|---|---|
| 1 | Slot rule | Confirmed as formalised in §4.3. Fresh day never counts; 1 fresh + 3 follow-up days. Three days of `call_back` = lost. Same-day revival accepted — state is purely derived (§4.4). |
| 2 | "Edit own, same day" vs the workflow | Logging a call on any enquiry is open to all staff and drives status/dates through the trigger. "Edit own, same day only" governs only manual correction of fields the person typed. |
| 3 | Who ticks items purchased | Any staff member may update `enquiry_items`; the audit log is the control, not a permission check. |
| 4 | After-sale outcomes | Renamed `noted` / `escalated` / `resolved`. Reminder dates allowed; no §6 bucket; Tickets screen added as §5.11. |
| 5 | Overloaded `closed` | Split into `close_reason` = `wrong_number` \| `superseded`. Only `wrong_number` is flagged on import. |
| 6 | "Won when no open items remain" | Corrected: `won` needs at least one won item, else `lost` with reason `competitor` or `dropped` (§4.5). |
| 7 | PLI | Derived from `importance = A` for now. Known simplification, flagged in §3. |
| 8 | Assignments vs "never delete" | An assignment is a schedule, not a record. Admin may delete one; the audit log keeps the trail. |
| 9 | One counsellor per enquiry per day | Yes — `unique (enquiry_id, date)`. |
| 10 | Multiple open enquiries per student | Allowed. No partial unique index. |
| 11 | `lead_verification` | Stays on the enquiry, not the item. |
| 12 | Working days | Saturday is a working day. Only Sundays and the holiday list are skipped. |
| 13 | `term` | Master list; `term_id` foreign key. |
| 14 | Mandatory fields | Mobile only. Source, term, importance and lead verification are all nullable. |
| 15 | WhatsApp templates | Unbounded list in Settings; picker shows the first three. |

**Still open**

- The §3 source list ends in "…" — `sources` is seeded with the five named values only (AC, Indv WhatsApp, Knowlarity, Interakt, Vsmart). Add the rest in Settings.
- Teachers, courses and subjects are not enumerated anywhere in this spec. The seed carries only the examples the spec itself names (Bhanwar Borana; CA Final; DT, IDT) so the schema can be exercised — the real lists have to come from you.

---
---

# Claude Code — Brief 1 (paste as-is)

Project: Calman, a counselling CRM for Zeroinfy. Full spec is in `docs/calman-spec.md` (I will add it to the repo). Stack: Next.js App Router + Supabase + Vercel, same as the ca-study-planner project.

Do these three things. Investigate and report before building where noted. Do not run `supabase db push` unless I say so.

**1. Scaffold the repo.**
New Next.js (App Router, TypeScript, Tailwind) app in the current folder. Supabase client setup (browser + server), env vars `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Copy `docs/calman-spec.md` into the repo. Commit.

**2. Investigate and report — do not build yet.** Read §3, §4 and §8 of the spec, then write me a short report covering:
- Your proposed Postgres schema (tables, key columns, constraints, indexes) as SQL.
- How you would implement the follow-up slot rule (§4.3) and the auto-lost transition — DB trigger, or application logic — and why.
- Your proposed RLS policy structure for the 4 roles, table by table.
- The audit-log trigger design.
- Anything in the spec that is ambiguous or contradictory.
Stop after the report and wait for my answers.

**3. After I approve the report:** write the first migration (all tables, constraints, indexes, RLS policies, audit trigger, the mobile-number check constraint), plus a seed script for the master lists with the values in §3. Tell me explicitly which parts you could not test locally rather than marking them as passed.
