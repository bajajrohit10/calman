/**
 * §50E.3. Initial state for the inline line actions.
 *
 * Outside actions.ts because a "use server" module may export only async
 * functions. Next compiles a stray object export without complaint and hands
 * the client `undefined`, so useActionState is initialised with nothing and
 * the row fails at runtime with a minified React error that names neither the
 * export nor the file. This is the third time in this module; the sweep that
 * found it is `grep "^export const"` across every "use server" file.
 */

export type LineActionState = { ok: boolean; error: string | null };

export const EMPTY_LINE_STATE: LineActionState = { ok: false, error: null };
