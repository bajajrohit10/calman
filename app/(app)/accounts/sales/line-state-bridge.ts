/**
 * §50F.3. The two inline line corrections, re-exported for the reconcile
 * screen.
 *
 * The brief asks for override % and no-remittance reason to be reachable from
 * a reconcile row as well as a sales row. They are the same actions, not
 * copies: how remittance is recomputed after a correction is a rule, and a
 * second implementation of it would be a second answer waiting to disagree.
 */
export { setOverride, setNoRemittance } from "./actions";
export { EMPTY_LINE_STATE, type LineActionState } from "./line-state";
