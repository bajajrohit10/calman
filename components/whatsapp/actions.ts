"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Stage } from "@/lib/whatsapp-text";

export type Template = {
  id: string;
  name: string;
  body: string;
  stage: Stage;
};

/**
 * The active templates, newest picker first. §5.10 says the picker surfaces
 * the first three, so sort_order is what decides which three.
 */
export async function loadTemplates(): Promise<{
  error: string | null;
  templates?: Template[];
}> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("whatsapp_templates")
    .select("id, name, body, stage")
    .eq("is_active", true)
    .order("sort_order");

  if (error) return { error: error.message };
  return { error: null, templates: (data ?? []) as Template[] };
}

/**
 * Record a send (§5.10). Deliberately its own table: the §4.3 slot rule counts
 * distinct call days, and a WhatsApp message must never be one of them.
 */
export async function logWhatsappSend(input: {
  enquiryId: number;
  templateId: string | null;
  messageText: string;
}): Promise<{ error: string | null; mobile?: string }> {
  const viewer = await requireUser();
  if (!viewer.profile) return { error: "Your account is not active." };
  if (!input.messageText.trim()) return { error: "The message is empty." };

  const supabase = await createClient();

  const { data: enquiry, error: findError } = await supabase
    .from("enquiries")
    .select("id, students ( mobile )")
    .eq("id", input.enquiryId)
    .maybeSingle();

  if (findError) return { error: findError.message };
  if (!enquiry) return { error: "That enquiry no longer exists." };

  const { error } = await supabase.from("whatsapp_sends").insert({
    enquiry_id: input.enquiryId,
    template_id: input.templateId,
    message_text: input.messageText.trim(),
    sent_by: viewer.userId!,
  });

  if (error) return { error: `Could not record the send: ${error.message}` };

  const mobile = (enquiry.students as { mobile: string } | null)?.mobile;
  if (mobile) revalidatePath(`/students/${mobile}`);

  return { error: null, mobile };
}
