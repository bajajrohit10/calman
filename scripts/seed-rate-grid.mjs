// §50C(d). Seed accounts.rate_grid from the August actuals — every cell.
//
// The first pass (§50B.3) took only the cells the sheet was confident about:
// every row agreed and there were at least three of them. That left 162 cells
// with nothing in Calman at all, which reads as "no rate has been discussed"
// when the truth is "a rate was observed and nobody has confirmed it".
//
// This pass seeds all of them. A cell the sheet is confident about gets its
// real percentage and is live. Every other cell — rows disagreed, too few
// rows, or the vendor only just got created — gets 0% with needs_review set
// and the observed figure preserved in the note, so the team can see what
// August actually did without anything being paid against it. resolve_rate
// skips flagged rows, so those lines come back 'none' and land on the Unknown
// tab, which is where an unagreed rate belongs.
//
// Cells that already have a rate_grid row for the same vendor, level and type
// are left alone, so this is safe to re-run.
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
// product type: a combo's rate is keyed by the product title in combo_rates,
// and this sheet carries no title, only a vendor × level aggregate. Those
// cells are reported rather than seeded — a rate_grid row typed "Combo" could
// never be matched by the importer, which flags combos and keys them.
const TYPES = new Set(["Full", "EO", "FT", "Rapid", "Others", "Books"]);
const LEVELS = new Set(["CA Final", "CA Inter", "CA Foundation", "CMA Final",
  "CMA Inter", "CMA Foundation", "CS", "ACCA", "CFA", "Other"]);

// §50C(d). The sheet's "Zeroinfy Kolkata" is the BB arm.
const NAME_OVERRIDES = new Map([["zeroinfy kolkata", "Zeroinfy Kolkata - BB"]]);

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
for (const [from, to] of NAME_OVERRIDES) {
  const v = vendors.find(x => x.name === to);
  if (v) byName.set(key(from), v);
}

/* --------------------------------------------------- what already exists -- */
const { data: existing, error: eErr } = await db
  .from("rate_grid").select("vendor_id, level, product_type");
if (eErr) throw eErr;
const have = new Set(existing.map(r => `${r.vendor_id}|${r.level}|${r.product_type}`));

/* ------------------------------------------------------------- the cells -- */
const CELL = /^([\d.]+)%\s*\((\d+)\/(\d+)\)$/;
const live = [], flagged = [], already = [], combos = [], unresolved = new Map(), malformed = [];
let seen = 0;

for (let r = 4; r <= ws.rowCount; r++) {
  const name = txt(ws.getRow(r).getCell(1).value).trim();
  if (!name) continue;
  const vendor = byName.get(key(name));

  for (const h of headers) {
    const raw = txt(ws.getRow(r).getCell(h.col).value).trim();
    if (!raw) continue;
    seen++;

    const m = CELL.exec(raw);
    if (!m) { malformed.push({ name, header: h.header, raw }); continue; }
    const [, pctS, nS, tS] = m;
    const pct = Number(pctS), n = Number(nS), t = Number(tS);

    if (!TYPES.has(h.type)) { combos.push({ name, header: h.header, raw }); continue; }
    if (!LEVELS.has(h.level)) { combos.push({ name, header: h.header, raw, why: `level "${h.level}"` }); continue; }
    if (!vendor) {
      if (!unresolved.has(name)) unresolved.set(name, []);
      unresolved.get(name).push(`${h.header} ${raw}`);
      continue;
    }
    if (have.has(`${vendor.id}|${h.level}|${h.type}`)) {
      already.push({ name: vendor.name, header: h.header, raw });
      continue;
    }

    const clean = n === t && t >= MIN_ROWS;
    const row = {
      vendor_id: vendor.id, level: h.level, product_type: h.type,
      effective_from: EFFECTIVE_FROM, effective_to: null, state_scope: null,
      pct: clean ? pct : 0,
      needs_review: !clean,
      note: clean
        ? `Seeded from Aug 26 actuals (${n} rows), verify`
        : `Aug 26 seed: ${pctS}% seen in ${n}/${t} rows — team to confirm`,
    };
    (clean ? live : flagged).push({ ...row, _name: vendor.name, _sheet: name });
  }
}

/* ------------------------------------------------------------- the report -- */
const pad = (s, n) => String(s).padEnd(n);

console.log(`\n=== WOULD INSERT LIVE (real %, not flagged): ${live.length} ===`);
for (const i of live)
  console.log(`   ${pad(i._name, 32)} ${pad(i.level, 14)} ${pad(i.product_type, 7)} ${String(i.pct).padStart(5)}%`);

console.log(`\n=== WOULD INSERT FLAGGED (0%, needs_review): ${flagged.length} ===`);
for (const i of flagged)
  console.log(`   ${pad(i._name, 32)} ${pad(i.level, 14)} ${pad(i.product_type, 7)}  ${i.note}`);

console.log(`\n=== ALREADY PRESENT, left alone: ${already.length} ===`);

console.log(`\n=== STILL UNRESOLVED: ${unresolved.size} name(s) ===`);
for (const [n, cells] of unresolved)
  console.log(`   ${pad(n, 30)} (${cells.length}) ${cells.join("; ")}`);

console.log(`\n=== COMBO COLUMNS, not seeded: ${combos.length} ===`);
for (const c of combos) console.log(`   ${pad(c.name, 30)} ${pad(c.header, 22)} ${c.raw}`);

if (malformed.length) {
  console.log(`\n=== UNPARSEABLE: ${malformed.length} ===`);
  for (const m of malformed) console.log(`   ${pad(m.name, 30)} ${pad(m.header, 22)} ${JSON.stringify(m.raw)}`);
}

const accounted = live.length + flagged.length + already.length + combos.length +
  malformed.length + [...unresolved.values()].reduce((a, b) => a + b.length, 0);
console.log(`\ncells seen: ${seen}   accounted for: ${accounted}`);

if (!WRITE) { console.log("\nDry run. Pass --write to insert.\n"); process.exit(0); }

const payload = [...live, ...flagged].map((i) => ({
  vendor_id: i.vendor_id, level: i.level, product_type: i.product_type,
  pct: i.pct, effective_from: i.effective_from, effective_to: i.effective_to,
  note: i.note, needs_review: i.needs_review,
}));
if (!payload.length) { console.log("Nothing to insert.\n"); process.exit(0); }

const { data: ins, error } = await db.from("rate_grid").insert(payload).select("id");
if (error) { console.error("\nINSERT FAILED:", error.message); process.exit(1); }
console.log(`\nInserted ${ins.length} rate_grid rows — ${live.length} live, ${flagged.length} flagged.\n`);
