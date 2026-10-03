/**
 * §81.3. Every number an insight rule turns on, in one place.
 *
 * These are judgements, not facts: each one is the line between "worth a
 * manager's attention this week" and "noise". They live together so the set can
 * be re-tuned as one decision — a threshold buried in the rule that uses it is a
 * threshold nobody revisits — and each carries why it is where it is, measured
 * against the data that existed when it was set (30 days to 3 Oct 2026: 476
 * leads, 21.2% team conversion, 382 of them teacher-tagged).
 *
 * A rule that cannot fire is worse than no rule, so where a threshold would have
 * excluded every row on real data it is said so below.
 */

/** A row needs this many enquiries before any rule will judge its rate. */
export const MIN_ENQUIRIES_FOR_RATE = 20;

/**
 * "Low conversion" means below half the team's own average, not below a fixed
 * percentage. The team sat at 21.2%, so the line was 10.6% — a figure that moves
 * with the business rather than needing an edit every quarter.
 */
export const LOW_CONVERSION_FRACTION_OF_TEAM = 0.5;

/**
 * Competitor pressure: a quarter of the decided outcomes went elsewhere.
 *
 * Measured against *decided* outcomes (won + the four lost columns) rather than
 * all enquiries, because a teacher with eighty leads still in progress has not
 * lost them — counting those in the denominator would hide real pressure behind
 * a pile of open work.
 */
export const COMPETITOR_SHARE = 0.25;

/** A term is "rising" on both a proportion and a floor, so one extra lead on a base of one is not news. */
export const RISING_GROWTH = 0.5;
export const RISING_MIN_ENQUIRIES = 15;

/** A fall worth saying out loud, among the teachers big enough to matter. */
export const FALLING_DROP = 0.3;
export const FALLING_TOP_N = 10;

/*
 * §82.3. Two thresholds stood here, for a support-drag rule that read ticket
 * counts beside conversion rates. Both are gone with the rule: a ticket count in
 * a conversion report invited a causal reading nothing here supports, and the
 * Support reports answer the question with the context it needs.
 */

/**
 * Tagging gap. Teacher tags were missing on 19.7% of leads and terms on ~27%, so
 * 20% catches the term problem now and the teacher one the moment it slips.
 */
export const DATA_GAP_SHARE = 0.2;

/**
 * §82.4. The best-converting product line, on two floors rather than one.
 *
 * "Product" here is the product_text a counsellor transcribes, because that is
 * the only place the *offer* survives — "Audit Full Course" and "Audit Fast
 * Track" tag to the same teacher and the same subject and sell at different
 * rates, which is the whole point of the card.
 *
 * Set at twenty first, which was wrong: the busiest single string carries eight
 * enquiries over thirty days, so the rule could never fire. Five enquiries *and*
 * two sales instead — the second floor is what stops one lucky sale on a string
 * nobody else typed becoming a campaign recommendation. Both want raising as
 * these strings accumulate; the comment is here so the next person knows the
 * numbers are provisional rather than considered.
 */
export const BEST_PRODUCT_MIN_ENQUIRIES = 5;
export const BEST_PRODUCT_MIN_SALES = 2;

/**
 * §82.4. Where leads go silent: a course and subject needs this many enquiries
 * before its no-response share means anything. Fifteen, as the brief set it.
 */
export const SILENT_MIN_ENQUIRIES = 15;

/**
 * §81 decision. Any sale with no amount understates revenue, so the floor is one
 * — this is a data-entry fix, not a trend. Sixteen of 123 won items in the last
 * 30 days carry no amount.
 */
export const MISSING_AMOUNT_MIN = 1;

/**
 * §81 decision. Students going quiet after follow-ups: max_followups was 83 of
 * 204 losses (40.7%) over 30 days, so 35% fires on today's data and would stop
 * firing if follow-up timing improved — which is the point of the card.
 */
export const NO_RESPONSE_SHARE = 0.35;

/**
 * At most this many cards. §82.4 cut it from eight to five: eight filled the
 * screen above the numbers they were about, and the sixth to eighth were never
 * the ones anybody acted on.
 */
export const MAX_INSIGHT_CARDS = 5;

/**
 * …and at most this many from any one rule.
 *
 * Found by building it: support drag fired on five institutes at once and filled
 * the whole panel, pushing out the four other rules that had something to say.
 * A panel of eight cards all making the same point is a list, and the thing it
 * displaced is the thing the manager had not already noticed. Two keeps the
 * worst offenders visible and leaves room for everything else.
 */
export const MAX_CARDS_PER_KIND = 2;
