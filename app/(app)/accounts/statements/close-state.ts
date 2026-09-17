/** §50G.3. Form state for closing a vendor's month. */
export type CloseState = { ok: boolean; error: string | null; message: string | null };
export const EMPTY_CLOSE_STATE: CloseState = { ok: false, error: null, message: null };
