/**
 * §50F.2. Initial state for the payments import form.
 *
 * Its own module because a "use server" file may export only async functions;
 * an object export there compiles and then arrives at the client as undefined.
 */
export type PaymentPreview = {
  ok: boolean;
  error: string | null;
  modalMonth: string | null;
  monthCounts: Record<string, number>;
  totals: {
    paymentTabs: number; orderListTabs: number; metaTabs: number; noHeaderTabs: number;
    payments: number; blankAmount: number; amountTotal: number;
    matched: number; unmatched: number;
  };
  unresolvedTabs: string[];
  noHeaderTabs: { name: string; rows: number }[];
  balanceNotes: { tab: string; note: string }[];
  duplicateOrderIds: { order_id: string; tabs: string[] }[];
  methods: Record<string, number>;
  existingMonth: { month: string; rows: number } | null;
};

export const EMPTY_PAYMENT_PREVIEW: PaymentPreview = {
  ok: false, error: null, modalMonth: null, monthCounts: {},
  totals: { paymentTabs: 0, orderListTabs: 0, metaTabs: 0, noHeaderTabs: 0,
            payments: 0, blankAmount: 0, amountTotal: 0, matched: 0, unmatched: 0 },
  unresolvedTabs: [], noHeaderTabs: [], balanceNotes: [], duplicateOrderIds: [],
  methods: {}, existingMonth: null,
};

export type PaymentCommitResult = {
  ok: boolean; error: string | null;
  inserted: number; duplicatesDropped: number; month: string | null;
};

export const EMPTY_PAYMENT_COMMIT: PaymentCommitResult = {
  ok: false, error: null, inserted: 0, duplicatesDropped: 0, month: null,
};
