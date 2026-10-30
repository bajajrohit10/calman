import "server-only";

/**
 * A single call to Claude (Anthropic Messages API), for drafting text a person
 * then checks. Server only.
 *
 *   ANTHROPIC_API_KEY   required for AI drafts; without it the features that use
 *                       this fall back to manual editing.
 *   ANTHROPIC_MODEL     optional, default claude-sonnet-5-5.
 */

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function askClaude(system: string, user: string, maxTokens = 4000): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("AI drafting is not set up (ANTHROPIC_API_KEY is missing in Vercel).");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Claude answered HTTP ${res.status}${t ? `: ${t.slice(0, 300)}` : ""}`);
  }
  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
}

/** The first JSON object in a reply (tolerates ```json fences and prose around it). */
export function parseJsonReply<T>(text: string): T {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e < s) throw new Error("The AI reply had no JSON in it.");
  return JSON.parse(text.slice(s, e + 1)) as T;
}
