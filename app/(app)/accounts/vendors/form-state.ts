/** §6.3. Form state for the vendor editor. */
export type VendorEditState = { ok: boolean; error: string | null; message: string | null };
export const EMPTY_VENDOR_STATE: VendorEditState = { ok: false, error: null, message: null };
