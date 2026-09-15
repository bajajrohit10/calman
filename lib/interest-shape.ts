/**
 * What makes two interest lines the same line (§47.1).
 *
 * All four columns, not the teacher alone. A student who wants FR and Audit
 * from the same teacher has two interests, and until Brief 47 the editor would
 * not let them be recorded: the teacher typeahead hid any name already used on
 * the lead, so the second line could not be started. That rule was never about
 * duplicates — it was a guess that one teacher meant one line, and the guess
 * was wrong for the most ordinary case there is.
 *
 * So the de-dupe moves down to the whole combination. Two lines naming the
 * same teacher, course, subject and content are the same line and the second
 * is dropped; anything else is a different interest and is kept.
 *
 * A null and an empty string mean the same thing here — "not set" — because
 * the form sends "" and the table stores null, and a shape that told them
 * apart would let the same line be saved twice by going through a different
 * screen.
 */
export type InterestShaped = {
  teacherId?: string | null;
  courseId?: string | null;
  subjectId?: string | null;
  contentId?: string | null;
};

export function interestShape(line: InterestShaped): string {
  return [line.teacherId, line.courseId, line.subjectId, line.contentId]
    .map((v) => v ?? "")
    .join("|");
}

/** The same key, for a row as it comes back from the table. */
export function rowShape(row: {
  teacher_id: string | null;
  course_id: string | null;
  subject_id: string | null;
  content_id: string | null;
}): string {
  return interestShape({
    teacherId: row.teacher_id,
    courseId: row.course_id,
    subjectId: row.subject_id,
    contentId: row.content_id,
  });
}

/**
 * Drop lines that repeat one already present, keeping the first of each.
 *
 * `seen` carries the shapes already on the lead, so a batch is de-duped
 * against the database as well as against itself.
 */
export function dropDuplicateLines<T extends InterestShaped>(
  lines: T[],
  seen: Set<string> = new Set(),
): T[] {
  const kept: T[] = [];
  for (const line of lines) {
    const key = interestShape(line);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
  }
  return kept;
}
