/** §50G.1. Form state, outside the "use server" module by necessity. */
export type AdjState = { ok: boolean; error: string | null; message: string | null };
export const EMPTY_ADJ_STATE: AdjState = { ok: false, error: null, message: null };
