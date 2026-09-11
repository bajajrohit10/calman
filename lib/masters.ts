import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * The master lists, fetched once and cached.
 *
 * Every filter bar and every item editor needs all of these, and they were
 * being re-read on each navigation: eight round trips of ~100ms each, in
 * parallel but still 162ms on the critical path of a page that renders in
 * ~600ms. They change when somebody edits Settings, which is roughly monthly.
 *
 * Held in module memory rather than unstable_cache(), which cannot be used
 * here: the Supabase client reads cookies to get the caller's session, and
 * Next refuses `cookies()` inside a cache scope — "Accessing Dynamic data
 * sources inside a cache scope is not supported". The alternative was reading
 * these with the service role, and putting that key on a hot request path to
 * save a round trip on reference data is not a trade worth making.
 *
 * So: the first request after a cold start pays for the reads and every
 * request for the next minute does not, with the caller's own RLS deciding
 * what lands in the cache. The lists are identical for every staff role, so
 * one shared copy is correct.
 *
 * Settings clears it on write. On a serverless host each instance holds its
 * own copy, so an edit can take up to TTL_MS to appear on an instance that did
 * not serve the write — acceptable for a list edited monthly, and the reason
 * the TTL is a minute rather than an hour.
 */
export type Master = { id: string; name: string };
export type SubjectMaster = Master & { course_id: string };

export type Masters = {
  teachers: Master[];
  institutes: Master[];
  courses: Master[];
  subjects: SubjectMaster[];
  contents: Master[];
  terms: Master[];
  sources: Master[];
};

async function readMasters(): Promise<Masters> {
  const supabase = await createClient();
  const [teachers, institutes, courses, subjects, contents, terms, sources] =
    await Promise.all([
      supabase.from("teachers").select("id, name").eq("is_active", true).order("name"),
      supabase.from("institutes").select("id, name").eq("is_active", true).order("name"),
      supabase
        .from("courses")
        .select("id, name")
        .eq("is_active", true)
        .order("sort_order")
        .order("name"),
      supabase
        .from("subjects")
        .select("id, name, course_id")
        .eq("is_active", true)
        .order("sort_order")
        .order("name"),
      supabase.from("contents").select("id, name").eq("is_active", true).order("priority"),
      supabase.from("terms").select("id, name").eq("is_active", true).order("sort_order"),
      supabase.from("sources").select("id, name").eq("is_active", true).order("name"),
    ]);

  return {
    teachers: teachers.data ?? [],
    institutes: institutes.data ?? [],
    courses: courses.data ?? [],
    subjects: (subjects.data ?? []) as SubjectMaster[],
    contents: contents.data ?? [],
    terms: terms.data ?? [],
    sources: sources.data ?? [],
  };
}

const TTL_MS = 60_000;

let cache: { at: number; data: Masters } | null = null;

/** Called by the master-list actions so an edit shows up immediately. */
export function clearMasters() {
  cache = null;
}

export async function loadMasters(): Promise<Masters> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const data = await readMasters();
  cache = { at: Date.now(), data };
  return data;
}
