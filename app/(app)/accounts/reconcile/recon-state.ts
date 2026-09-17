/** §50F.3-4. Form state for the reconcile screen's writes. */
export type ReconActionState = { ok: boolean; error: string | null; message: string | null };
export const EMPTY_RECON_STATE: ReconActionState = { ok: false, error: null, message: null };
