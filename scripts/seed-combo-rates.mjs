// §50D.3. Seed the combo grid from the August combo actuals.
//
// The figures come from the Combo columns of the draft commission grid, which
// the earlier passes could not use: "Combo" is not a product type, so those
// cells had nowhere to go until combos became a second grid keyed by level and
// type. The percentages are transcribed from the brief rather than re-read
// from the sheet, because the team has since decided which of them are agreed
// and which are still observations.
//
// The flagged rows here carry their real percentage, unlike the §50C single
// placeholders which are 0%. The flag alone keeps resolve_rate off them, so
// the observed figure can sit in the row where somebody will see it while
// still not being paid against.
//
// Dry run by default. Pass --write to insert.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const WRITE = process.argv.includes("--write");
const EFFECTIVE_FROM = "2026-08-01";
const NOTE = "Seeded from Aug 26 combo actuals — team to confirm";

const LIVE = [
  ["BB Virtuals", "CA Final", "Full", 15],
  ["BB Virtuals", "CA Final", "FT", 15],
  ["BB Virtuals", "CA Final", "EO", 15],
  ["BB Virtuals", "CA Inter", "Full", 18],
  ["Vsmart Academy", "CA Final", "Full", 18],
  ["Zeroinfy Kolkata - BB", "CA Final", "Full", 18],
  ["CA Akshansh Garg", "CA Final", "Full", 15],
  ["CA Nitin Guru", "CA Inter", "Full", 35],
];

const FLAGGED = [
  ["BB Virtuals", "CA Foundation", "Full", 18],
  ["Vsmart Academy", "CA Final", "EO", 21.4],
  ["Vsmart Academy", "CA Inter", "Full", 22],
  ["Zeroinfy Kolkata - BB", "CA Inter", "Full", 21],
  ["Ranjan Periwal Classes", "CMA Inter", "Full", 25],
  ["CA Siddharth Agarwal", "CA Inter", "Full", 20],
  ["CA Abhishek Bansal", "CA Inter", "Full", 30],
  ["CA Ashish Kalra", "CA Inter", "Full", 30],
  ["CA Harshad Jaju", "CA Inter", "EO", 30],
  ["CA Namit Arora", "CA Inter", "Full", 15],
  ["CA Nikkhil Gupta", "CMA Final", "Full", 30],
  ["CA Parveen Sharma", "CA Inter", "Full", 20],
  ["CA Pratik Jagati", "CA Final", "FT", 22],
  ["EKATVAM", "CA Final", "Full", 17.5],
  ["Fast Education", "CA Inter", "Full", 18],
];

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split("\n")
    .filter(l => l.includes("=") && !l.trim().startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false }, db: { schema: "accounts" } });

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

const { data: existing, error: eErr } = await db
  .from("rate_grid").select("vendor_id, level, product_type").eq("sale_kind", "combo");
if (eErr) throw eErr;
const have = new Set(existing.map(r => `${r.vendor_id}|${r.level}|${r.product_type}`));

const rows = [], unresolved = [], duplicates = [];
for (const [list, flagged] of [[LIVE, false], [FLAGGED, true]]) {
  for (const [name, level, type, pct] of list) {
    const vendor = byName.get(key(name));
    if (!vendor) { unresolved.push(`${name} — ${level} ${type} ${pct}%`); continue; }
    if (have.has(`${vendor.id}|${level}|${type}`)) {
      duplicates.push(`${vendor.name} ${level} ${type}`); continue;
    }
    rows.push({
      vendor_id: vendor.id, sale_kind: "combo", level, product_type: type,
      pct, effective_from: EFFECTIVE_FROM, effective_to: null, state_scope: null,
      needs_review: flagged, note: NOTE,
      _name: vendor.name, _sheet: name,
    });
  }
}

const pad = (s, n) => String(s).padEnd(n);
const live = rows.filter(r => !r.needs_review);
const flag = rows.filter(r => r.needs_review);

console.log(`\n=== LIVE (needs_review false): ${live.length} ===`);
for (const r of live)
  console.log(`   ${pad(r._name, 26)} ${pad(r.level, 14)} ${pad(r.product_type, 5)} ${String(r.pct).padStart(5)}%`);
console.log(`\n=== FLAGGED (needs_review true, real pct): ${flag.length} ===`);
for (const r of flag)
  console.log(`   ${pad(r._name, 26)} ${pad(r.level, 14)} ${pad(r.product_type, 5)} ${String(r.pct).padStart(5)}%`);
console.log(`\n=== UNRESOLVED NAMES: ${unresolved.length} ===`);
for (const u of unresolved) console.log(`   ${u}`);
console.log(`\n=== ALREADY PRESENT: ${duplicates.length} ===`);
for (const d of duplicates) console.log(`   ${d}`);

if (!WRITE) { console.log("\nDry run. Pass --write to insert.\n"); process.exit(0); }
if (!rows.length) { console.log("\nNothing to insert.\n"); process.exit(0); }

const payload = rows.map(r => ({
  vendor_id: r.vendor_id, sale_kind: r.sale_kind, level: r.level,
  product_type: r.product_type, pct: r.pct, effective_from: r.effective_from,
  effective_to: r.effective_to, state_scope: r.state_scope,
  needs_review: r.needs_review, note: r.note,
}));
const { data: ins, error } = await db.from("rate_grid").insert(payload).select("id");
if (error) { console.error("\nINSERT FAILED:", error.message); process.exit(1); }
console.log(`\nInserted ${ins.length} combo rows — ${live.length} live, ${flag.length} flagged.\n`);
