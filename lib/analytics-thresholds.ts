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

/**
 * Tickets per ten sales. Three is the point where after-sale work stops looking
 * like the ordinary cost of selling: at 30 days the worst institute sat at 4.4
 * and the median was under one, so this separates them without flagging the
 * whole list.
 */
export const SUPPORT_DRAG_PER_10_SALES = 3;

/**
 * …and only where there were enough sales for a per-ten rate to mean anything.
 *
 * Without a floor the rule fires hardest on the smallest institutes: one sale
 * and one ticket is "10 per 10 sales", which read as a crisis and was a
 * rounding error. Five sales is the point where the ratio stops being an
 * artefact of the denominator. Measured: without this, five institutes fired and
 * three of them had two sales or fewer.
 */
export const SUPPORT_DRAG_MIN_SALES = 5;

/**
 * Tagging gap. Teacher tags were missing on 19.7% of leads and terms on ~27%, so
 * 20% catches the term problem now and the teacher one the moment it slips.
 */
export const DATA_GAP_SHARE = 0.2;

/** Fast movers: the best conversion among rows with enough leads to trust it. */
export const FAST_MOVER_MIN_ENQUIRIES = 10;

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

/** At most this many cards, so the panel stays a summary rather than a list. */
export const MAX_INSIGHT_CARDS = 8;

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
