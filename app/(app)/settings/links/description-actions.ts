"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";

import { aiConfigured, askClaude, parseJsonReply } from "@/lib/ai/claude";
import { isAdmin, requireUser } from "@/lib/auth";
import { applyEdits, changedLines, checkRewrite, decode, encode, sectionOf, segments, splitInfo, type Edit } from "@/lib/price-check/description";
import { getDescription, getProductForEdit, setDescription } from "@/lib/price-check/shopify-edit";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

/**
 * Price check: bringing a listing's description in line with its variants —
 * only the attempt / batch-recording text changes, the format stays as it is.
 *
 *  - draftDescription: read the description, mark the pieces of text that state
 *    an attempt or a recording, and (when AI is set up) suggest new text for the
 *    ones that no longer match the listing's variants and their BB options.
 *  - saveDescription: a super admin applies the checked changes on Shopify; the
 *    old description is kept in shopify_change_log.
 *  - revertDescription: put back the description from before a change.
 */

const PATH = "/settings/links";
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

export type DescSegment = { i: number; text: string; section: string; suggestion: string | null; why: string | null };
export type DescVersion = { id: string; at: string; who: string | null; action: string; changes: number; current: boolean };
export type DescDraft = {
  title: string;
  handle: string;
  html: string;
  hash: string;
  segments: DescSegment[];
  aiAvailable: boolean;
  aiNote: string | null;
  aiError: string | null;
  facts: string;
  history: DescVersion[];
  canWrite: boolean;
};

async function admin() {
  const viewer = await requireUser();
  if (!viewer.profile || !isAdmin(viewer.profile.role)) return null;
  return viewer;
}

/** What the listing sells now: its variants and the BB options they resell. */
async function factsFor(supabase: Awaited<ReturnType<typeof createClient>>, productId: number): Promise<string> {
  const p = await getProductForEdit(productId);
  const { data: links } = await supabase
    .from("vendor_variant_links")
    .select("shopify_variant_id, vendor_product_title, vendor_variant_label, status")
    .eq("shopify_product_id", productId);
  const byV = new Map((links ?? []).map((l) => [Number(l.shopify_variant_id), l]));
  const lines = [
    `Listing: ${p.title}`,
    `Options: ${p.options.map((o) => `${o.name} = ${o.values.join(" | ")}`).join("; ")}`,
    "Variants sold now (Zeroinfy variant → BB product : BB option):",
    ...p.variants.map((v) => {
      const l = byV.get(v.id);
      const bb = l && l.status === "approved" && l.vendor_variant_label ? ` → ${l.vendor_product_title ?? "BB"} : ${l.vendor_variant_label}` : "";
      return `- ${v.title} (₹${v.price})${bb}`;
    }),
  ];
  return lines.join("\n");
}

const SYSTEM = `You update Zeroinfy (an Indian CA-exam course store) product descriptions so the ATTEMPT and BATCH RECORDING details match what the listing sells now.
You get the listing's current variants (the source of truth, with the BB Virtuals course options they resell) and the description cut into numbered text pieces.
Rules:
- Change ONLY pieces that state an exam attempt (e.g. "May 26", "Nov 26 and onwards", "beneficial for May 21 attempt") or a batch recording / batch date / live-batch schedule that no longer matches the variants.
- Keep each piece's wording, capitalisation, punctuation, separators and leading/trailing spaces; replace just the outdated part. Never add HTML. Never merge or split pieces.
- Do not touch hours, validity, views, books, prices, faculty, links, phone numbers or anything else.
- When the variants sell several attempts or batches, list them the way the description already lists things (e.g. "DT: June 2026" style lines stay one per piece).
- If a piece is outdated but you can't tell the right text from the facts, leave it unchanged and say so in "note".
Reply with JSON only: {"edits":[{"i":<piece number>,"text":"<new full text of that piece>","why":"<short reason>"}],"note":"<anything the person should check, or empty>"}`;

export async function draftDescription(productId: number, useAi: boolean): Promise<{ error: string | null; data?: DescDraft }> {
  const viewer = await admin();
  if (!viewer) return { error: "Only a manager or super admin can do this." };
  const supabase = await createClient();
  let d: { title: string; handle: string; html: string };
  let facts: string;
  try {
    [d, facts] = await Promise.all([getDescription(productId), factsFor(supabase, productId)]);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const secs = sectionOf(d.html);
  const all = segments(d.html);
  const suggestions = new Map<number, { text: string; why: string }>();
  let aiNote: string | null = null;
  let aiError: string | null = null;

  if (useAi && aiConfigured()) {
    // Product Info (and anything before the first tab) is where attempts/recordings live; send every piece there.
    const sendable = all.filter((s) => s.flagged || ["", "product info"].includes((secs.get(s.i) ?? "").toLowerCase()));
    const user = `FACTS\n${facts}\n\nDESCRIPTION PIECES (number: text)\n${sendable.map((s) => `${s.i}: ${JSON.stringify(decode(s.text))}`).join("\n")}`;
    try {
      const reply = parseJsonReply<{ edits?: { i: number; text: string; why?: string }[]; note?: string }>(await askClaude(SYSTEM, user));
      const valid = new Set(sendable.map((s) => s.i));
      for (const e of reply.edits ?? []) {
        if (!valid.has(Number(e.i)) || typeof e.text !== "string") continue;
        const cur = decode(all.find((s) => s.i === Number(e.i))!.text);
        if (e.text === cur || /[<>]/.test(e.text)) continue;
        suggestions.set(Number(e.i), { text: e.text, why: e.why ?? "" });
      }
      aiNote = reply.note?.trim() || null;
    } catch (e) {
      aiError = e instanceof Error ? e.message : String(e);
    }
  }

  const { data: log } = await supabase
    .from("shopify_change_log")
    .select("id, created_at, actor, action, request")
    .eq("shopify_product_id", productId)
    .in("action", ["update_description", "revert_description"])
    .eq("ok", true)
    .order("created_at", { ascending: false })
    .limit(10);
  const actors = [...new Set((log ?? []).map((l) => l.actor).filter(Boolean))] as string[];
  const { data: people } = actors.length ? await supabase.from("profiles").select("id, full_name").in("id", actors) : { data: [] };
  const nameOf = new Map((people ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name]));

  return {
    error: null,
    data: {
      title: d.title,
      handle: d.handle,
      html: d.html,
      hash: hash(d.html),
      segments: all
        .filter((s) => s.flagged || suggestions.has(s.i))
        .map((s) => ({
          i: s.i,
          text: decode(s.text),
          section: secs.get(s.i) ?? "",
          suggestion: suggestions.get(s.i)?.text ?? null,
          why: suggestions.get(s.i)?.why ?? null,
        })),
      aiAvailable: aiConfigured(),
      aiNote,
      aiError,
      facts,
      history: (log ?? []).map((l, k) => {
        const r = (l.request ?? {}) as { after?: string; edits?: unknown[] };
        return {
          id: l.id,
          at: l.created_at,
          who: l.actor ? (nameOf.get(l.actor) ?? null) : null,
          action: l.action,
          changes: Array.isArray(r.edits) ? r.edits.length : 0,
          current: k === 0 && r.after != null && hash(r.after) === hash(d.html),
        };
      }),
      canWrite: viewer.profile!.role === "super_admin",
    },
  };
}

/** Apply text changes (piece number → new text) to the description on Shopify. */
export async function saveDescription(
  productId: number,
  readHash: string,
  changes: { i: number; text: string }[],
): Promise<{ error: string | null; count?: number }> {
  const viewer = await requireUser();
  if (viewer.profile?.role !== "super_admin") return { error: "Only a super admin can change Shopify listings." };
  if (!changes.length) return { error: "Nothing to change." };
  const supabase = await createClient();
  let d: { title: string; html: string };
  try {
    d = await getDescription(productId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  if (hash(d.html) !== readHash) return { error: "The description changed on Shopify since you opened it — click “Check again”." };
  const segs = new Map(segments(d.html).map((s) => [s.i, s.text]));
  const edits: Edit[] = [];
  for (const c of changes) {
    const from = segs.get(c.i);
    if (from == null) return { error: "The description changed — click “Check again”." };
    // Keep the piece's own leading/trailing whitespace (it is layout).
    const lead = from.match(/^\s*/)![0];
    const trail = from.match(/\s*$/)![0];
    const to = lead + encode(c.text.trim()) + trail;
    if (to !== from) edits.push({ i: c.i, from, to });
  }
  const r = applyEdits(d.html, edits);
  if (!r.ok) return { error: r.why };
  const req = { before: d.html, after: r.html, edits: edits.map((e) => ({ from: decode(e.from), to: decode(e.to) })) };
  try {
    await setDescription(productId, r.html);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("shopify_change_log").insert({ actor: viewer.userId, shopify_product_id: productId, shopify_product_title: d.title, action: "update_description", request: req as unknown as Json, ok: false, error: msg.slice(0, 2000) });
    return { error: msg };
  }
  const { error } = await supabase
    .from("shopify_change_log")
    .insert({ actor: viewer.userId, shopify_product_id: productId, shopify_product_title: d.title, action: "update_description", request: req as unknown as Json, ok: true });
  revalidatePath(PATH);
  if (error) return { error: `Saved on Shopify, but the old version could not be kept for undo: ${error.message}`, count: edits.length };
  return { error: null, count: edits.length };
}

/** Put back the description from before change `logId`. */
export async function revertDescription(logId: string, force: boolean): Promise<{ error: string | null; changedSince?: boolean }> {
  const viewer = await requireUser();
  if (viewer.profile?.role !== "super_admin") return { error: "Only a super admin can change Shopify listings." };
  const supabase = await createClient();
  const { data: row } = await supabase.from("shopify_change_log").select("shopify_product_id, request, action, ok").eq("id", logId).maybeSingle();
  const req = (row?.request ?? {}) as { before?: string; after?: string };
  if (!row || !row.ok || !["update_description", "revert_description"].includes(row.action) || typeof req.before !== "string") {
    return { error: "That change can't be undone from here." };
  }
  const pid = Number(row.shopify_product_id);
  let d: { title: string; html: string };
  try {
    d = await getDescription(pid);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  if (!force && req.after != null && hash(req.after) !== hash(d.html)) return { error: null, changedSince: true };
  const log = { before: d.html, after: req.before, revertOf: logId, edits: [] };
  try {
    await setDescription(pid, req.before);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("shopify_change_log").insert({ actor: viewer.userId, shopify_product_id: pid, shopify_product_title: d.title, action: "revert_description", request: log as unknown as Json, ok: false, error: msg.slice(0, 2000) });
    return { error: msg };
  }
  await supabase.from("shopify_change_log").insert({ actor: viewer.userId, shopify_product_id: pid, shopify_product_title: d.title, action: "revert_description", request: log as unknown as Json, ok: true });
  revalidatePath(PATH);
  return { error: null };
}

/** The description as it was before / after a logged change, for a side-by-side look. */
export async function descriptionVersion(logId: string): Promise<{ error: string | null; before?: string; after?: string }> {
  if (!(await admin())) return { error: "Only a manager or super admin can do this." };
  const supabase = await createClient();
  const { data } = await supabase.from("shopify_change_log").select("request").eq("id", logId).maybeSingle();
  const r = (data?.request ?? {}) as { before?: string; after?: string };
  return { error: null, before: r.before, after: r.after };
}

/* ------------------------------------------------ AI rewrite of Product Info -- */

const REWRITE = `You maintain product descriptions for Zeroinfy, an Indian CA-exam course store that resells BB Virtuals courses.
You get FACTS (what the listing sells now: its variants and the BB course options they resell — the source of truth) and the PRODUCT INFO part of the description as HTML.
Bring every attempt and batch-recording detail in line with the FACTS, using your judgement:
- Attempts the course is for (e.g. "May 27 and onwards", "Nov 26, May 27 and Nov 27") — in the intro sentence(s) and anywhere else they appear.
- The "Batch Recording" row: one entry per batch the variants sell now, with that batch's recording month / live dates and schedule as the BB options state them. Remove batches that are no longer sold (rows, cells, list items), add batches that are new, renumber "Batch 1/2" if needed.
- Rows that depend on the batch (e.g. validity or views "DT Batch 1: 9 Months") — drop entries for batches no longer sold; keep the rest exactly. If a new batch's validity/views are unknown, don't invent them.
Keep the format EXACTLY: same tags, classes, inline styles, colours, table layout and wording style. Copy an existing row/cell/list item's markup when adding one. Do not change hours, books, prices, links, phone numbers, faculty text or anything not about attempts/batches. Never add new kinds of tags, scripts or styles.
If something is outdated but the FACTS don't say what it should be, leave it and mention it in the note.
Reply in exactly this form:
<<<HTML
(the full updated PRODUCT INFO html)
HTML>>>
CHANGES:
- (one line per change, plain English)
NOTE: (anything the person must check, or "none")`;

export type Rewrite = { hash: string; before: string; after: string; removed: string[]; added: string[]; changes: string[]; note: string | null };

/** Ask Claude to rewrite the Product Info part so its attempts and recordings match the listing. Nothing is saved. */
export async function rewriteDescription(productId: number): Promise<{ error: string | null; data?: Rewrite }> {
  const viewer = await admin();
  if (!viewer) return { error: "Only a manager or super admin can do this." };
  if (!aiConfigured()) return { error: "AI is not set up yet: add ANTHROPIC_API_KEY in Vercel → calman → Settings → Environment Variables, then redeploy." };
  const supabase = await createClient();
  let d: { html: string };
  let facts: string;
  try {
    [d, facts] = await Promise.all([getDescription(productId), factsFor(supabase, productId)]);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const { info, tail } = splitInfo(d.html);
  let reply: string;
  try {
    reply = await askClaude(REWRITE, `FACTS\n${facts}\n\nPRODUCT INFO HTML\n${info}`, 12000);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const m = reply.match(/<<<HTML\s*([\s\S]*?)\s*HTML>>>/);
  if (!m) return { error: "The AI reply wasn't in the expected form — try again." };
  // Keep the section's own trailing whitespace so the join with System is unchanged.
  const newInfo = m[1].trim() + (info.match(/\s*$/)?.[0] ?? "");
  const bad = checkRewrite(info, newInfo);
  if (bad) return { error: `${bad} Nothing was changed — try again, or edit the lines by hand.` };
  const after = newInfo + tail;
  const changes = (reply.split(/CHANGES:/)[1] ?? "").split(/NOTE:/)[0].split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
  const note = (reply.split(/NOTE:/)[1] ?? "").trim();
  const diff = changedLines(d.html, after);
  return {
    error: null,
    data: { hash: hash(d.html), before: d.html, after, removed: diff.removed, added: diff.added, changes, note: note && !/^none\.?$/i.test(note) ? note : null },
  };
}

/** Save a reviewed rewrite on Shopify (only the Product Info part may differ). Old version kept for Undo. */
export async function saveRewrite(productId: number, readHash: string, after: string, changes: string[]): Promise<{ error: string | null }> {
  const viewer = await requireUser();
  if (viewer.profile?.role !== "super_admin") return { error: "Only a super admin can change Shopify listings." };
  const supabase = await createClient();
  let d: { title: string; html: string };
  try {
    d = await getDescription(productId);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  if (hash(d.html) !== readHash) return { error: "The description changed on Shopify since the suggestion was made — ask for a new one." };
  const cur = splitInfo(d.html);
  if (!after.endsWith(cur.tail)) return { error: "Only the Product Info part can change here." };
  const bad = checkRewrite(cur.info, after.slice(0, after.length - cur.tail.length));
  if (bad) return { error: bad };
  const req = { before: d.html, after, edits: changes.map((c) => ({ change: c })), via: "ai_rewrite" };
  try {
    await setDescription(productId, after);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("shopify_change_log").insert({ actor: viewer.userId, shopify_product_id: productId, shopify_product_title: d.title, action: "update_description", request: req as unknown as Json, ok: false, error: msg.slice(0, 2000) });
    return { error: msg };
  }
  const { error } = await supabase
    .from("shopify_change_log")
    .insert({ actor: viewer.userId, shopify_product_id: productId, shopify_product_title: d.title, action: "update_description", request: req as unknown as Json, ok: true });
  revalidatePath(PATH);
  if (error) return { error: `Saved on Shopify, but the old version could not be kept for undo: ${error.message}` };
  return { error: null };
}
