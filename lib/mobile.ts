/**
 * The mobile rule, in one place (§3, §8).
 *
 * The same rule is enforced three times — here for the browser, again in the
 * server action, and finally by the `mobile_is_10_digit_indian` CHECK on
 * students. This module is the first two; the database is the one that counts.
 *
 * Client-safe: no "server-only" import, because Quick Add normalises on every
 * keystroke in the browser.
 */

/**
 * Strip everything the caller might type or paste around a 10-digit number:
 * spaces, dashes, brackets, dots, a +91 or 91 country code, and a leading 0.
 *
 * Deliberately tolerant, because this runs on every keystroke: a half-typed
 * number just normalises to a short string and fails `isValidMobile` until it
 * is complete.
 */
export function normaliseMobile(raw: string): string {
  let digits = (raw ?? "").replace(/\D+/g, "");

  // +91 / 0091 / 91 prefix, only when what follows could be a real number.
  if (digits.length > 10 && digits.startsWith("0091")) digits = digits.slice(4);
  if (digits.length > 10 && digits.startsWith("91")) digits = digits.slice(2);

  // A single leading zero, the other common way it gets dialled.
  while (digits.length > 10 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  return digits.slice(0, 10);
}

/** Exactly 10 digits, first digit 6-9. */
export function isValidMobile(normalised: string): boolean {
  return /^[6-9][0-9]{9}$/.test(normalised);
}

/**
 * Why a normalised number is not yet usable, for inline help under the box.
 * Returns null once it is valid, and null while it is still obviously
 * mid-typing, so the counsellor is not scolded on the first keystroke.
 */
export function mobileHint(normalised: string): string | null {
  if (normalised.length === 0) return null;
  if (isValidMobile(normalised)) return null;
  if (normalised.length < 10) return `${10 - normalised.length} more digit${normalised.length === 9 ? "" : "s"}`;
  return "An Indian mobile number starts with 6, 7, 8 or 9.";
}

/** 9876543210 → 98765 43210, for display only. Never stored this way. */
export function formatMobile(mobile: string): string {
  return isValidMobile(mobile) ? `${mobile.slice(0, 5)} ${mobile.slice(5)}` : mobile;
}
