#!/usr/bin/env node
// Link teachers to institutes from a two-column spreadsheet.
//
//   node scripts/seed-institutes.mjs [path/to/file.xlsx]
//
// Defaults to the first .xlsx in docs/reference/. The sheet needs two columns
// headed Teacher and Institute (case and surrounding spaces are ignored); any
// other columns are ignored.
//
// What it does:
//   * creates every institute named in the file that does not exist yet
//     (matched case-insensitively, so "Vsmart" and "VSMART" stay one row);
//   * links each teacher by EXACT name match, after trimming and collapsing
//     internal whitespace — deliberately exact, because teacher-wise analytics
//     run on these names and a fuzzy match that silently picks the wrong
//     "Aggarwal" corrupts them quietly;
//   * prints, and does not guess at, every row it could not match.
//
// Re-runnable. A teacher already pointing at the right institute is left
// alone; one pointing somewhere else is reported rather than overwritten,
// unless --force is passed.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

const FORCE = process.argv.includes("--force");
const DRY = process.argv.includes("--dry-run");

function env() {
  const raw = readFileSync(".env.local", "utf8");
  return Object.fromEntries(
    raw
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
}

function findFile() {
  const explicit = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (explicit) return explicit;

  const dir = "docs/reference";
  let entries;
  try {
    entries = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".xlsx"));
  } catch {
    fail(`No file given and ${dir}/ does not exist.`);
  }
  if (!entries.length) fail(`No .xlsx found in ${dir}/. Pass the path explicitly.`);
  if (entries.length > 1) {
    fail(
      `${entries.length} .xlsx files in ${dir}/ — pass the one you mean:\n` +
        entries.map((e) => `    ${join(dir, e)}`).join("\n"),
    );
  }
  return join(dir, entries[0]);
}

function fail(message) {
  console.error(`\n  Error: ${message}\n`);
  process.exit(1);
}

/** Trim and collapse internal whitespace; nothing else. */
const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

async function readSheet(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  if (!ws) fail("That workbook has no sheets.");

  const header = (ws.getRow(1).values ?? []).map((v) => norm(v).toLowerCase());
  const teacherCol = header.findIndex((h) => h === "teacher");
  const instituteCol = header.findIndex((h) => h === "institute");
  if (teacherCol === -1 || instituteCol === -1) {
    fail(
      `The first row must have columns "Teacher" and "Institute". Found: ${header
        .filter(Boolean)
        .join(", ") || "(nothing)"}`,
    );
  }

  const rows = [];
  for (let n = 2; n <= ws.rowCount; n += 1) {
    const r = ws.getRow(n);
    const teacher = norm(r.getCell(teacherCol).value);
    const institute = norm(r.getCell(instituteCol).value);
    if (!teacher && !institute) continue;
    rows.push({ n, teacher, institute });
  }
  return rows;
}

const e = env();
const db = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY);

const path = findFile();
const rows = await readSheet(path);
console.log(`\n  ${path}: ${rows.length} data rows\n`);

// ---- existing state -------------------------------------------------------
const { data: teachers, error: te } = await db
  .from("teachers")
  .select("id, name, institute_id, is_active");
if (te) fail(`Could not read teachers: ${te.message}`);

const { data: institutes, error: ie } = await db.from("institutes").select("id, name");
if (ie) fail(`Could not read institutes: ${ie.message}`);

const teacherByName = new Map(teachers.map((t) => [norm(t.name), t]));
const instituteByName = new Map(institutes.map((i) => [norm(i.name).toLowerCase(), i]));

// ---- create the missing institutes ---------------------------------------
// Deduped case-insensitively, keeping the first spelling the sheet used:
// "Vsmart Academy" and "VSMART ACADEMY" are one institute, and the unique
// index on lower(name) would reject the second anyway.
const wanted = new Map();
for (const r of rows) {
  if (r.institute) wanted.set(r.institute.toLowerCase(), r.institute);
}
const missing = [...wanted.entries()]
  .filter(([key]) => !instituteByName.has(key))
  .map(([, name]) => name);

if (missing.length) {
  console.log(`  Creating ${missing.length} institute(s): ${missing.join(", ")}`);
  if (!DRY) {
    const { data: made, error } = await db
      .from("institutes")
      .insert(missing.map((name) => ({ name })))
      .select("id, name");
    if (error) fail(`Could not create institutes: ${error.message}`);
    for (const i of made) instituteByName.set(norm(i.name).toLowerCase(), i);
  }
} else {
  console.log("  Every institute in the file already exists.");
}

// ---- link the teachers ----------------------------------------------------
const unmatchedTeacher = [];
const conflicts = [];
const updates = [];
let alreadyRight = 0;

for (const row of rows) {
  if (!row.teacher) {
    unmatchedTeacher.push({ ...row, why: "blank teacher name" });
    continue;
  }
  const teacher = teacherByName.get(row.teacher);
  if (!teacher) {
    unmatchedTeacher.push({ ...row, why: "no teacher with that exact name" });
    continue;
  }
  if (!row.institute) {
    unmatchedTeacher.push({ ...row, why: "blank institute" });
    continue;
  }
  const institute = instituteByName.get(row.institute.toLowerCase());
  if (!institute) {
    // Only reachable under --dry-run, where nothing was created.
    unmatchedTeacher.push({ ...row, why: "institute not created (dry run)" });
    continue;
  }
  if (teacher.institute_id === institute.id) {
    alreadyRight += 1;
    continue;
  }
  if (teacher.institute_id && !FORCE) {
    conflicts.push({
      ...row,
      current: institutes.find((i) => i.id === teacher.institute_id)?.name ?? "(unknown)",
    });
    continue;
  }
  updates.push({ id: teacher.id, institute_id: institute.id, name: teacher.name });
}

if (updates.length && !DRY) {
  // One statement per row: 73 teachers is nothing, and a single failure
  // naming its teacher beats a bulk upsert that rolls the lot back.
  for (const u of updates) {
    const { error } = await db
      .from("teachers")
      .update({ institute_id: u.institute_id })
      .eq("id", u.id);
    if (error) fail(`Could not link ${u.name}: ${error.message}`);
  }
}

// ---- report ---------------------------------------------------------------
console.log(`
  Linked          ${DRY ? `${updates.length} (dry run, nothing written)` : updates.length}
  Already correct ${alreadyRight}
  Could not match ${unmatchedTeacher.length}
  Conflicts       ${conflicts.length}${FORCE ? " (overwritten)" : ""}
`);

if (unmatchedTeacher.length) {
  console.log("  Could not match — fix the spelling in the sheet or in Settings → Teachers:");
  for (const r of unmatchedTeacher) {
    console.log(`    row ${String(r.n).padStart(4)}  ${r.teacher || "(blank)"} → ${r.institute || "(blank)"}   [${r.why}]`);
  }
  console.log("");
}

if (conflicts.length && !FORCE) {
  console.log("  Already linked elsewhere — re-run with --force to overwrite:");
  for (const r of conflicts) {
    console.log(`    row ${String(r.n).padStart(4)}  ${r.teacher}: ${r.current} → ${r.institute}`);
  }
  console.log("");
}

const unusedTeachers = teachers.filter(
  (t) => t.is_active && !rows.some((r) => r.teacher === norm(t.name)),
);
if (unusedTeachers.length) {
  console.log(`  ${unusedTeachers.length} active teacher(s) are not in the sheet at all:`);
  console.log(`    ${unusedTeachers.map((t) => t.name).join(", ")}\n`);
}
