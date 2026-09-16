#!/usr/bin/env node
// Fill interests from product text for enquiries that have none (§49.2).
//
//   node scripts/backfill-auto-interests.mjs           # report only
//   node scripts/backfill-auto-interests.mjs --write   # actually write
//
// Reports by default and writes only when told to. This adds rows to a live
// table on the strength of a parser, and "run it and see" is not a thing to
// offer for that — the dry run prints exactly what would be created so it can
// be read before it exists.
//
// Only enquiries with product text and *no* interest lines at all are touched.
// One human line means a person has thought about the lead, and the parser has
// nothing to add to that.
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseProductText } from "../lib/product-parser.ts";

const WRITE = process.argv.includes("--write");

function loadEnv() {
  const out = {};
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      out[m[1].replace(/^NEXT_PUBLIC_/, "")] = m[2].trim();
    }
  } catch {
    /* fall through to real environment variables */
  }
  return { ...out, ...process.env };
}

const env = loadEnv();
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const page = async (table, select, tweak = (q) => q) => {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await tweak(db.from(table).select(select)).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
};

const [courses, subjects, contents, terms, teachers] = await Promise.all([
  page("courses", "id, name", (q) => q.eq("is_active", true)),
  page("subjects", "id, name, course_id", (q) => q.eq("is_active", true)),
  page("contents", "id, name", (q) => q.eq("is_active", true)),
  page("terms", "id, name", (q) => q.eq("is_active", true)),
  page("teachers", "id, name", (q) => q.eq("is_active", true)),
]);
const masters = { courses, subjects, contents, terms, teachers };

const enquiries = await page("enquiries", "id, product_text, term_id", (q) =>
  q.eq("type", "purchase").not("product_text", "is", null),
);
const withLines = new Set(
  (await page("enquiry_items", "enquiry_id")).map((r) => r.enquiry_id),
);
const candidates = enquiries.filter((e) => !withLines.has(e.id) && (e.product_text ?? "").trim());

console.log(`purchase enquiries with product text : ${enquiries.length}`);
console.log(`  already have interest lines         : ${enquiries.length - candidates.length}`);
console.log(`  candidates for auto-fill            : ${candidates.length}`);

const rows = [];
const termUpdates = [];
let noLines = 0;
for (const e of candidates) {
  let added = 0;
  for (const p of parseProductText(e.product_text, masters)) {
    for (const line of p.lines) {
      if (!line.teacherId && !line.courseId && !line.subjectId && !line.contentId) continue;
      if (line.subjectId && !line.courseId) continue;
      rows.push({
        enquiry_id: e.id,
        teacher_id: line.teacherId,
        course_id: line.courseId,
        subject_id: line.subjectId,
        content_id: line.contentId,
        status: "open",
        is_auto: true,
      });
      added++;
    }
    if (p.termId && !e.term_id) termUpdates.push({ id: e.id, term_id: p.termId });
  }
  if (!added) noLines++;
}

console.log(`  would create lines                  : ${rows.length}`);
console.log(`  would set a term on                 : ${termUpdates.length}`);
console.log(`  candidates the parser read nothing from: ${noLines}`);

if (!WRITE) {
  console.log("\nDry run. Pass --write to apply.");
  process.exit(0);
}

for (let i = 0; i < rows.length; i += 500) {
  const { error } = await db.from("enquiry_items").insert(rows.slice(i, i + 500));
  if (error) {
    console.error("insert failed:", error.message);
    process.exit(1);
  }
}
for (const u of termUpdates) {
  await db.from("enquiries").update({ term_id: u.term_id }).eq("id", u.id).is("term_id", null);
}
console.log(`\nwrote ${rows.length} lines and ${termUpdates.length} terms.`);
