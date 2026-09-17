/**
 * §50E.2. Initial state for the import form.
 *
 * Separate from actions.ts because a "use server" module may export only
 * async functions. Next builds it without complaint and then hands the client
 * `undefined` for any other export, so the failure arrives at runtime as
 * "cannot read properties of undefined" rather than at compile time. Types are
 * erased and would have been fine; these are real objects, so they live here.
 */

export type ImportPreview = {
  ok: boolean;
  error: string | null;
  missingHeaders: string[];
  tabs: string[];
  tab: string | null;
  modalMonth: string | null;
  monthCounts: Record<string, number>;
  totals: {
    lines: number; draft: number; cancelled: number; deferred: number;
    vendorNull: number; rateNone: number; alreadyImported: number; conversions: number;
  };
  droppedMarkers: Record<string, number>;
  pairedMarkers: Record<string, number>;
  centerArmSplit: Record<string, number>;
  vendorNullNames: Record<string, number>;
  duplicateOrders: string[];
  existingMonth: { month: string; rows: number; paid: number } | null;
};

export const EMPTY_PREVIEW: ImportPreview = {
  ok: false, error: null, missingHeaders: [], tabs: [], tab: null,
  modalMonth: null, monthCounts: {},
  totals: { lines: 0, draft: 0, cancelled: 0, deferred: 0, vendorNull: 0,
            rateNone: 0, alreadyImported: 0, conversions: 0 },
  droppedMarkers: {}, pairedMarkers: {}, centerArmSplit: {},
  vendorNullNames: {}, duplicateOrders: [], existingMonth: null,
};

export type CommitResult = {
  ok: boolean;
  error: string | null;
  inserted: number;
  superseded: number;
  skipped: { order_id: string; status: string }[];
  conversions: number;
  month: string | null;
};

export const EMPTY_COMMIT: CommitResult = {
  ok: false, error: null, inserted: 0, superseded: 0, skipped: [],
  conversions: 0, month: null,
};
