/**
 * §81.3, rewritten by §84.1. Every number an insight rule turns on, in one place.
 *
 * These are judgements, not facts: each is the line between "worth a manager's
 * attention this week" and "noise". They live together so the set can be re-tuned
 * as one decision, and each carries why it is where it is, measured against the
 * data that existed when it was set (30 days to 5 Oct 2026: 563 leads, 350 closed,
 * 32% team conversion, 11% of closed lost to a competitor).
 *
 * §84.1 replaced nine rules with three heads. The thresholds that went with the
 * dropped rules — product-text, went-silent, support-drag, the old rising/falling
 * pair — went with them rather than being left here unused.
 */

/** At most this many bullets under each head, so a head stays readable. */
export const HEAD_MAX = 5;

// ---------------------------------------------------------------------------
// Head 1: demand, rising and falling.
// ---------------------------------------------------------------------------

/**
 * A quarter up or down is the point where a change stops looking like a quiet
 * week. Measured on leads, which is the only figure that exists for both windows
 * regardless of how much has closed yet.
 */
export const DEMAND_CHANGE = 0.25;

/**
 * …and only where one side of the comparison has ten leads. Below that a 25%
 * swing is two enquiries, and the list would fill with teachers nobody asked
 * about. "Either period" rather than both, so a teacher who went from twelve to
 * two still appears — that is exactly the fall worth seeing.
 */
export const DEMAND_MIN_ENQUIRIES = 10;

// ---------------------------------------------------------------------------
// Head 2: competitor losses by teacher.
// ---------------------------------------------------------------------------

/**
 * Relative to the team rather than absolute: 11% of closed business goes to a
 * competitor across the whole team, so "high" means high *for here*. Half again
 * is the point where a teacher is visibly worse than the average rather than
 * noisily around it.
 */
export const COMPETITOR_VS_TEAM = 1.5;

/**
 * Five closed calls before the share is allowed to mean anything. One of two
 * closed is 50% and tells you nothing; this is the smallest denominator that is
 * not actively misleading, and it is low on purpose because a teacher losing
 * three of five is worth hearing about early.
 */
export const COMPETITOR_MIN_CLOSED = 5;

// ---------------------------------------------------------------------------
// Head 3: conversion by teacher.
// ---------------------------------------------------------------------------

/**
 * Eight closed calls to be ranked at all. Higher than the competitor floor
 * because this head ranks — a best-three list built on four-call denominators
 * would be a list of lucky weeks.
 */
export const CONVERSION_MIN_CLOSED = 8;

/** Three each way. Five would be most of the teachers who clear the floor. */
export const CONVERSION_TOP_N = 3;

// ---------------------------------------------------------------------------
// The housekeeping line.
// ---------------------------------------------------------------------------

/**
 * Any sale with no amount understates revenue, so the floor is one: this is a
 * data-entry fix, not a trend.
 */
export const MISSING_AMOUNT_MIN = 1;

/**
 * Tagging gap. Teacher tags were missing on about a fifth of leads when this was
 * set, so 20% catches it the moment it slips rather than describing the status quo.
 */
export const DATA_GAP_SHARE = 0.2;

// ---------------------------------------------------------------------------
// §84.3. The experiment card's small-sample guard.
// ---------------------------------------------------------------------------

/**
 * Fewer closed calls than this on either side and the card shows its numbers with
 * a line saying not to read a trend into them.
 *
 * Ten, which is the point where one more sale stops moving the rate by ten points.
 * The numbers are still shown rather than hidden: a manager who started an
 * experiment yesterday wants to see it ticking over, and "too few to read yet" is
 * a more useful thing to say than an empty card.
 */
export const SMALL_SAMPLE_CLOSED = 10;
