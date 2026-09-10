/**
 * The {course} substitution for §5.10.
 *
 * Plain module, not part of the client component: the student history page
 * renders on the server and needs to call this, and a function exported from a
 * "use client" file cannot be invoked from a Server Component.
 */
export function courseTextFor(
  items: {
    teacher: string | null;
    course: string | null;
    subject: string | null;
    content: string | null;
  }[],
  productText: string | null,
): string {
  const lines = items
    .map((i) => {
      const tail = [i.course, i.subject, i.content].filter(Boolean).join(" ");
      if (i.teacher && tail) return `${i.teacher} – ${tail}`;
      return i.teacher ?? tail;
    })
    .filter((s): s is string => Boolean(s));

  // Falls back to the raw product title, which is all a freshly imported lead
  // has until someone structures it into items.
  return lines.length ? lines.join(", ") : (productText ?? "").trim();
}
