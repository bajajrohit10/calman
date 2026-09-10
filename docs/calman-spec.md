# Calman — Zeroinfy Counselling CRM

Project specification v1 · 10 Sep 2026
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
- `term` — exam attempt (May-26, Sep-26, Jan-27 …); one per enquiry; editable any time
- `importance` — A: Yes + PLI (top) · B: Yes + No PLI · C: Not Sure · D: No
- `lead_verification` — competitor discount proof: Yes with proof · Yes without proof · No
- `status`
  - purchase: `open` | `won` | `lost` | `closed`
  - after_sale: `open` | `escalated` | `closed`
- `lost_reason` — `competitor` | `max_followups`
- `next_follow_up_date`
- `created_at`, `created_by`, `closed_at`
- Auto-number ID

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
  - after_sale: `open` | `escalated` | `closed`
- `discussion` — one note per call
- `next_follow_up_date`
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
3. **Follow-up slots:** a follow-up slot = one calendar day on which the enquiry was called, after the fresh-call day. Two or more call-backs on the same day = one slot. Limit: 3 slots. When the 3rd slot ends with outcome `follow_up` or `call_back`, the enquiry automatically becomes `lost` (reason `max_followups`).
4. `purchased` → counsellor ticks which items were bought, enters one order ID (amount optional). Untied items default to "continue follow-up"; counsellor may close them instead. Enquiry becomes `won` when no open items remain.
5. `competitor` → enquiry `lost` (reason competitor), never re-enters any queue.
6. `closed` → wrong number; stored, never queued; future imports of that number are flagged in the import report.
7. **Reopen:** a lost/closed number that calls again gets a **new enquiry** under the same student. History screen shows old and new enquiries stacked.

### After-sale enquiry
- `open` → counsellor tries to solve and closes immediately if possible → `closed`.
- Cannot solve → `escalated`; visible to everyone, worked by Ticket Team.
- Never appears in follow-up queues or funnel analytics.

### Overdue
- A follow-up not called on its date rolls to the next working day automatically and is flagged overdue. The daily overdue report can be dismissed by admin/manager (items still roll forward).
- Follow-up dates landing on a holiday/Sunday move to the next working day (admin-managed holiday list).

---

## 5. Screens

### 5.1 Quick Add (phone rings)
Single box: type a mobile number. Live lookup as you type.
- New number → creates student + enquiry, opens the call-logging panel.
- Existing number → shows full history immediately and asks: **Open new enquiry (close previous)** or **Update existing enquiry**.

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
Choose template 1/2/3 → placeholders `{name}`, `{course}` auto-filled from the enquiry → editable preview → opens WhatsApp Web (`wa.me/91<number>?text=…`) in the browser where WhatsApp Web is logged in → logs `whatsapp_sent` on the call.

---

## 6. Recommended call list — ordering

Buckets, in order:
1. **Today's follow-ups** (including rolled-over overdue, flagged)
2. **Offer-expiry leads** — open enquiries matching an offer whose end date is within `reminder_days`
3. **Fresh unassigned** — today's imports and quick-adds not yet called
4. **Campaign lists** — admin-built ad-hoc filters
5. **Today's call backs** — always last (done in the evening)

Within every bucket, sort by: Importance (A → D), then Content priority (Full → FT → EO → Test Series → Books), then oldest follow-up date first.

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
- Audit log via DB trigger, not application code, so nothing is missed.
- Timezone: IST throughout.
- Stack: Next.js (App Router) + Supabase (Postgres, Auth, RLS) + Vercel.
- Deployment: `calman.zeroinfy.in`; new Supabase project (Mumbai), repo `bajajrohit10/calman`, Vercel team Zeroinfy.
- No self-signup. Accounts created by Super Admin / Manager.

---

## 9. Phases

**Phase 1 (working product)**
Login + 4 roles · student/enquiry/item/call model with duplicate detection · quick add + history screen · call logging · bulk import with review table · export everywhere · assignment desk with filters and campaign filter · recommended list + My Day · daily counsellor report + team summary · overdue rollover + report · master data settings · WhatsApp button · audit trigger.

**Phase 2**
Offers + expiry bucket · teacher-wise analytics · other analytics dashboards · audit trail viewer · holiday calendar · daily summary email to admin.

---

## 10. Open point to confirm

The follow-up slot rule in §4.3 is my formalisation of "3rd follow-up is the limit, same-day call-backs count once". Confirm before the schema is built, because the auto-lost trigger depends on it.

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
