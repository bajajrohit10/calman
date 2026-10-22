/**
 * §88. What Claude needs to know to query Calman correctly.
 *
 * Served as the MCP server's instructions and by the describe_data tool. Kept
 * to the rules that change an answer — the ones a careful analyst would get
 * wrong from the column names alone. When a rule here changes in a migration,
 * change it here too.
 */
export const CALMAN_GUIDE = `
# Calman — Zeroinfy's counselling CRM

Calman records every sales lead (a phone call, WhatsApp, abandoned Shopify checkout…) the
counselling team works, every call they make, and every sale they close. Zeroinfy sells CA / CMA /
CS / ACCA / CFA video lectures and books from many teachers (faculties) and institutes on its
Shopify store zeroinfy.in. All times are stored in UTC; the business runs on IST (Asia/Kolkata) —
convert with \`(ts at time zone 'Asia/Kolkata')::date\` before grouping by day.

## Core model
- students: one row per unique 10-digit mobile (\`mobile\`, no +91). A student has many enquiries.
- enquiries: a lead. \`type\` = 'purchase' (sales lead) or 'after_sale' (support ticket handled by
  counsellors). Key fields: source_id → sources, term_id → terms (exam attempt e.g. "Nov-26"),
  importance (a = Yes+PLI i.e. payment link issued, b = Yes no PLI, c = not sure, d = no),
  status, lost_reason, close_reason, product_text (raw Shopify product title / what they asked
  about), follow_up_slots_used (0–3), next_follow_up_date, call_type (derived: book / video / unknown),
  arrived_at (when the lead really arrived — for abandoned checkouts, the checkout time),
  re_enquired_at (came back again), reopened_via_offer_id, archived_at.
- enquiry_items: the line items of a lead — teacher_id, course_id, subject_id, content_id, each
  with its own status (open / won / competitor / closed). On a sale: status = 'won', won_at,
  order_id (Shopify order number), amount (₹, optional). is_auto = filled by the product-text parser
  and not yet checked by a counsellor.
- calls: every call. called_at, call_date, called_by → profiles (counsellor), outcome, discussion
  (the counsellor's note), next_follow_up_date, order_id (on a 'purchased' call), is_offer_call,
  assignment_bucket, credited_to (who the sale is credited to when not the caller; null = caller).
- assignments: who must call which enquiry on which date (unique per enquiry + date). bucket =
  fresh / follow_up / call_back / offer / campaign; label names a campaign list.
- enquiry_sources: every time a lead came in from a source (a lead can arrive several times);
  checkout_ref = the Shopify abandoned-checkout id for AC leads.
- whatsapp_sends: WhatsApp template messages sent to a lead.
- offers (+ offer_teachers / offer_institutes / offer_courses / offer_subjects / offer_contents):
  time-boxed discounts. A lead matches when ≥1 open item satisfies every target dimension given.
  During the window (end_date − reminder_days … end_date) matching leads surface as Offer calls.
  Offer calls do not use up follow-up slots. offer_performance(ids) gives reach / calls / wins.
- Master lists: sources, teachers (institute_id → institutes), courses, subjects (course_id),
  contents (Full, FT, EO, Test Series, Books — \`priority\` 1 = most valuable), terms, holidays.
- profiles: staff. role = super_admin / manager / counsellor / ticket_team / accounts.
- audit_log: every change, with actor_id and old/new data.
- support.tickets / support.events: the after-sale support desk (order problems, book delivery…).
- accounts.*: monthly sales & remittance to teachers/vendors (super admin only).
  accounts.sales_lines is the authoritative monthly sales sheet: order_id, order_date, contact
  (mobile), faculty_name, course_title, list_price, actual_received, payment_option.

## Status rules (enforced by database triggers)
- enquiry status: open → working → won / lost / closed (purchase); escalated / pending_institute
  are after-sale states. An enquiry is **won** if ≥1 item is won. It is **lost** with lost_reason
  competitor (bought elsewhere), max_followups (3 follow-up days with no result), dropped, or
  not_interested. **closed** has close_reason wrong_number, superseded (replaced by a newer
  enquiry for the same number), converted, handed_to_support, resolved.
- Follow-up slots: the first (fresh) call day never counts; each later day with a follow_up /
  call_back outcome uses one slot, max 3. Several call-backs on one day count once.
- call outcomes: purchase → follow_up (talked, call again), call_back (didn't pick up), purchased,
  competitor, closed (wrong number), not_interested, ticket_raised. After-sale → noted, working,
  escalated, pending_institute, resolved.
- Sunday and rows in holidays are non-working days; Saturday works.

## How to count like Calman's own Analytics page
- A **lead** is a purchase enquiry, not archived, excluding closed ones with close_reason
  handed_to_support or superseded. Date it by arrival:
  \`(coalesce(e.arrived_at, e.created_at) at time zone 'Asia/Kolkata')::date\`.
- **Purchased / conversion** = status 'won'. Conversion % = won ÷ closed leads (won + lost +
  closed-wrong-number) for a settled cohort, or won ÷ all leads for a raw rate — say which.
- **Revenue** = sum(enquiry_items.amount) where status = 'won'. Amount is optional, so revenue in
  Calman undercounts; for true revenue join order_id to Shopify orders or accounts.sales_lines.
- **Sales credit** goes to coalesce(calls.credited_to, calls.called_by) on the 'purchased' call.
- Ready-made functions that return exactly what the Analytics and Reports screens show (call with
  run_sql, e.g. \`select * from public.analytics_by_teacher('2026-10-01','2026-10-21')\`):
  analytics_by_teacher / analytics_by_institute / analytics_by_course (p_from, p_to, then optional
  p_course_id, p_subject_id, p_source_ids uuid[], p_counsellor_id, p_term_id, p_cmp_from, p_cmp_to),
  analytics_products(p_from, p_to), analytics_scope(...) → jsonb totals,
  call_report(p_from, p_to, p_counsellor_id, p_grain 'day'|'counsellor'), offer_performance(uuid[]),
  my_day_team(p_date). Use named arguments (p_from => …) to skip optional ones.
- Query public.live_enquiries instead of enquiries to exclude archived rows automatically.

## Joining with other Zeroinfy data
- **Shopify orders**: enquiry_items.order_id / calls.order_id hold the Shopify order number as the
  counsellor typed it — compare on the digits only (strip "#", spaces and prefixes) when matching.
  Students can also be matched to Shopify customers by mobile: compare the last 10 digits.
- **Abandoned checkouts**: source "AC" leads came from Shopify abandoned checkouts;
  enquiry_sources.checkout_ref is the checkout id.
- **Google Ads**: Calman stores no gclid / UTM, so ads can only be compared to Calman by date,
  course, teacher or product — correlation, not lead-level attribution.

## Working rules for you (Claude)
- Data includes students' real phone numbers and names. Show them only when the question needs
  them; prefer aggregates.
- Large reads: aggregate in SQL rather than pulling raw rows. run_sql returns at most 1,000 rows.
- Writes (create_offer, set_offer_active, assign_enquiries, unassign_enquiries) change what
  counsellors see tomorrow morning. State exactly what you will do and get the user's go-ahead in
  the conversation before calling one.
`.trim();
