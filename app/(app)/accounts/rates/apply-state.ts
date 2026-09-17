/** §50H.3. Form state for the Apply panel and inline cell edits. */
export type ApplyConfirm = {
  paid: number;
  ready: number;
  from: string;
  pct: string;
  language: string | null;
  sale_kind: "single" | "combo";
  cells: { level: string; product_type: string }[];
};

export type ApplyState = {
  ok: boolean;
  error: string | null;
  message: string | null;
  confirm: ApplyConfirm | null;
};

export const EMPTY_APPLY_STATE: ApplyState = {
  ok: false, error: null, message: null, confirm: null,
};
