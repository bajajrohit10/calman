/** §50G.1(b). Form state for wallet entries. */
export type WalletState = { ok: boolean; error: string | null; message: string | null };
export const EMPTY_WALLET_STATE: WalletState = { ok: false, error: null, message: null };
