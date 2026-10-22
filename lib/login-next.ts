/**
 * §88. Where to go after signing in, when the login was interrupting something.
 * Only the Claude connector's consent screen uses this today, and only that
 * path is accepted: an open `next` would turn the login page into a redirector
 * for anyone's phishing link.
 */
export function safeNext(next: unknown): string | null {
  if (typeof next !== "string") return null;
  if (!next.startsWith("/oauth/authorize?") || next.includes("//") || next.includes("\\")) return null;
  return next;
}
