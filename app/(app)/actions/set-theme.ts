"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

/**
 * Switch the signed-in person's palette (§43.2).
 *
 * The write is one database function that can only reach the theme column —
 * a self-service update policy on profiles would also have exposed `role`,
 * which is not a thing anybody should be able to set about themselves.
 *
 * revalidatePath("/", "layout") rather than a router.refresh(): the theme is
 * stamped on <html> by the root layout, so it is the layout that has to be
 * re-rendered, not the page inside it.
 */
export async function setTheme(theme: "dark" | "light"): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_theme", {
    p_theme: theme,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { error: null };
}
