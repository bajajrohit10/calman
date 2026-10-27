/**
 * Price check: kinds of vendor options Zeroinfy may decide never to sell,
 * recognised from the option's name. Order matters: the first match wins.
 */
export const OPTION_TYPES = [
  { key: "live_at_home", label: "Live at Home", rx: /live\s*at\s*home/i },
  { key: "live_stream", label: "Live streaming", rx: /live\s*stream/i },
  { key: "pen_drive", label: "Pen drive / USB", rx: /pen\s*drive|\busb\b/i },
  { key: "bookset", label: "Make Your Own Bookset", rx: /make your own book\s*set/i },
  { key: "ebooks", label: "E-Books", rx: /\be\s*-?\s*books?\b/i },
  { key: "language", label: "Language variants (e.g. Fully English, Hindi)", rx: /language|fully english|\bhindi\b/i },
  { key: "without_books", label: "Without books", rx: /without\s*books/i },
  { key: "live_batch", label: "Live / hybrid batches (e.g. 'Live Batch Starting 16th Nov')", rx: /\blive\b|hybrid/i },
] as const;

export type OptionTypeKey = (typeof OPTION_TYPES)[number]["key"];

export function optionType(label: string): (typeof OPTION_TYPES)[number] | null {
  return OPTION_TYPES.find((t) => t.rx.test(label)) ?? null;
}
