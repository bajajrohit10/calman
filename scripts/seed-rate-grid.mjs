// §50B.3. Seed accounts.rate_grid from the August actuals.
//
// Reads the "Draft Commission Grid" tab, where each cell reads "P% (n/t)":
// n rows agreed on P out of t rows for that vendor/level/type. Only clean,
// well-evidenced cells are seeded — n = t and t >= 3 — because a cell where
// the rows disagree is a question for a human, not a rate to apply silently.
//
// Dry run by default. Pass --write to insert.
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const WRITE = process.argv.includes("--write");
const FILE = "docs/reference/accounts/Draft_Commission_Grid_Aug26.xlsx";
const EFFECTIVE_FROM = "2026-08-01";
const MIN_ROWS = 3;

// The brief's product_type list. "Combo" is a column in the sheet but not a
// product type: a combo's rate lives in combo_rates and is keyed by the
// product title, which this sheet does not carry.
const TYPES = new Set(["Full", "EO", "FT", "Rapid", "Others", "Books"]);
const LEVELS = new Set(["CA Final", "CA Inter", "CA Foundation", "CMA Final",
  "CMA Inter", "CMA Foundation", "CS", "ACCA", "CFA", "Other"]);

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n")
    .filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false }, db: { schema: "accounts" } });

/* ------------------------------------------------------------- the sheet -- */
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(FILE);
const ws = wb.getWorksheet("Draft Commission Grid");
const txt = v => v == null ? "" : (typeof v === "object" ? String(v.result ?? v.text ?? "") : String(v));

const headers = [];
for (let c = 3; c <= ws.columnCount; c++) {
  const h = txt(ws.getRow(3).getCell(c).value).replace(/\s+/g, " ").trim();
  if (!h) continue;
  // The header is "<level words> <type>" — the type is the last word.
  const at = h.lastIndexOf(" ");
  headers.push({ col: c, header: h, level: h.slice(0, at), type: h.slice(at + 1) });
}

/* ----------------------------------------------------------- the vendors -- */
const { data: vendors, error: vErr } = await db.from("vendors").select("id, name");
if (vErr) throw vErr;
const { data: aliases, error: aErr } = await db.from("vendor_aliases").select("vendor_id, alias");
if (aErr) throw aErr;

const key = s => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const byName = new Map();
for (const v of vendors) byName.set(key(v.name), v);
for (const a of aliases) {
  const v = vendors.find(x => x.id === a.vendor_id);
  if (v && !byName.has(key(a.alias))) byName.set(key(a.alias), v);
}

/* ------------------------------------------------------------- the cells -- */
const CELL = /^([\d.]+)%\s*\((\d+)\/(\d+)\)$/;
const inserts = [], skipped = [], unresolved = new Map(), combos = [], malformed = [];

for (let r = 4; r <= ws.rowCount; r++) {
  const name = txt(ws.getRow(r).getCell(1).value).trim();
  if (!name) continue;
  const vendor = byName.get(key(name));

  for (const h of headers) {
    const raw = txt(ws.getRow(r).getCell(h.col).value).trim();
    if (!raw) continue;

    const m = CELL.exec(raw);
    if (!m) { malformed.push({ name, header: h.header, raw }); continue; }
    const [, pctS, nS, tS] = m;
    const pct = Number(pctS), n = Number(nS), t = Number(tS);

    if (!TYPES.has(h.type)) { combos.push({ name, header: h.header, raw }); continue; }
    if (!LEVELS.has(h.level)) { skipped.push({ name, header: h.header, raw, why: `unknown level "${h.level}"` }); continue; }
    if (!vendor) {
      if (!unresolved.has(name)) unresolved.set(name, []);
      unresolved.get(name).push(`${h.header} ${raw}`);
      continue;
    }
    if (n !== t) { skipped.push({ name, header: h.header, raw, why: `mixed (${n} of ${t} agreed)` }); continue; }
    if (t < MIN_ROWS) { skipped.push({ name, header: h.header, raw, why: `only ${t} row${t === 1 ? "" : "s"}` }); continue; }

    inserts.push({ vendor_id: vendor.id, level: h.level, product_type: h.type, pct,
      effective_from: EFFECTIVE_FROM, effective_to: null,
      note: `Seeded from Aug 26 actuals (${n} rows), verify`,
      _name: vendor.name, _sheetName: name });
  }
}

/* ------------------------------------------------------------- the report -- */
const pad = (s, n) => String(s).padEnd(n);
console.log(`\n=== WOULD INSERT: ${inserts.length} rate_grid rows ===`);
for (const i of inserts.slice(0, 200))
  console.log(`   ${pad(i._name, 34)} ${pad(i.level, 14)} ${pad(i.product_type, 7)} ${String(i.pct).padStart(5)}%  ${i.note}`);

console.log(`\n=== UNRESOLVED VENDORS: ${unresolved.size} ===`);
for (const [n, cells] of unresolved) console.log(`   ${pad(n, 36)} (${cells.length} cell${cells.length === 1 ? "" : "s"}) ${cells.join("; ")}`);

console.log(`\n=== SKIPPED CELLS (enter by hand): ${skipped.length} ===`);
for (const s of skipped) console.log(`   ${pad(s.name, 34)} ${pad(s.header, 20)} ${pad(s.raw, 18)} ${s.why}`);

console.log(`\n=== COMBO COLUMNS (not a product_type; belong in combo_rates): ${combos.length} ===`);
for (const c of combos) console.log(`   ${pad(c.name, 34)} ${pad(c.header, 20)} ${c.raw}`);

if (malformed.length) {
  console.log(`\n=== UNPARSEABLE CELLS: ${malformed.length} ===`);
  for (const m of malformed) console.log(`   ${pad(m.name, 34)} ${pad(m.header, 20)} ${JSON.stringify(m.raw)}`);
}

console.log(`\nsheet cells seen: ${inserts.length + skipped.length + combos.length + malformed.length + [...unresolved.values()].reduce((a, b) => a + b.length, 0)}`);

if (!WRITE) { console.log("\nDry run. Pass --write to insert.\n"); process.exit(0); }

const payload = inserts.map((i) => ({
  vendor_id: i.vendor_id, level: i.level, product_type: i.product_type,
  pct: i.pct, effective_from: i.effective_from, effective_to: i.effective_to,
  note: i.note,
}));
const { data: ins, error } = await db.from("rate_grid").insert(payload).select("id");
if (error) { console.error("\nINSERT FAILED:", error.message); process.exit(1); }
console.log(`\nInserted ${ins.length} rate_grid rows.\n`);
