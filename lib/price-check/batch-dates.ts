/**
 * Price check: batch dates written in variant names, e.g. Zeroinfy
 * "Nov 26 (AFM May 2026 | Audit Sep 2026)" → May 2026, Sep 2026 (the leading
 * "Nov 26" is the exam attempt, not a batch); BB "AFM: Batch Started from 12th
 * May 2026, Audit: Batch Starting from 1st Sep 2026" → May 2026, Sep 2026.
 * Used to check links by batch name, never by price.
 */

const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const DRX = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s'’,-]*(20\d\d|\d\d)\b/gi;
const key = (y: string, m: string) => `${2000 + (Number(y) % 100)}-${String(MON[m.toLowerCase().slice(0, 3)]).padStart(2, "0")}`;

export function ziBatchDates(variantTitle: string | null): Set<string> {
  const out = new Set<string>();
  for (const seg of (variantTitle ?? "").split(" / ")) {
    const s = seg.trim();
    for (const m of s.matchAll(DRX)) {
      // A segment that starts with a month-year is the attempt ("May 27 and onwards"),
      // unless it reads like a batch ("Dec 25 Batch", "June 2025 Recordings").
      if (m.index === 0 && !/^\s*(record|batch|live)/i.test(s.slice(m[0].length, m[0].length + 25))) continue;
      out.add(key(m[2], m[1]));
    }
  }
  return out;
}

export function vendorBatchDates(label: string | null): Set<string> {
  const out = new Set<string>();
  for (const part of (label ?? "").split(/,\s*(?=[A-Za-z .&/()-]+:)/)) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    if (/^(exam|exams|attempt)$/i.test(part.slice(0, i).trim())) continue;
    for (const m of part.slice(i + 1).matchAll(DRX)) out.add(key(m[2], m[1]));
  }
  return out;
}

export const covers = (big: Set<string>, small: Set<string>) => small.size > 0 && [...small].every((d) => big.has(d));

export function fmtDates(ds: Set<string>): string {
  const N = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return [...ds]
    .sort()
    .map((d) => `${N[Number(d.slice(5)) - 1]} ${d.slice(0, 4)}`)
    .join(", ");
}
