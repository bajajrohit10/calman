"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { landingPathFor } from "@/lib/accounts/landing";

export type SignInState = { error: string | null };

export async function signIn(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Deliberately not distinguishing "no such account" from "wrong password":
    // that difference tells an outsider which addresses are real.
    return { error: "That email and password combination was not recognised." };
  }

  // §50E.3. Where they land depends on what they are. The profile read has to
  // happen after the sign-in, because before it there is no session to read it
  // with; RLS then returns exactly this user's row and nobody else's.
  const { data: claims } = await supabase.auth.getClaims();
  const userId = typeof claims?.claims?.sub === "string" ? claims.claims.sub : null;
  const { data: profile } = userId
    ? await supabase.from("profiles").select("role").eq("id", userId).maybeSingle()
    : { data: null };

  redirect(landingPathFor(profile?.role));
}
