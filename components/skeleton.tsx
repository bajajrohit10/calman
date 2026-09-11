/**
 * Loading skeletons (§13.3).
 *
 * The shell used to wait for every await on a page before painting anything —
 * 0.4 to 0.6 seconds of a blank frame between screens. These don't make the
 * data arrive sooner; they make the wait legible, so a counsellor moving
 * between New Calls and the desk sees the layout land immediately and the rows
 * fill in.
 *
 * Deliberately still: a pulse on a screen somebody stares at for eight hours
 * is worse than nothing, and the point is to be gone in half a second.
 */
export function SkeletonFilters({ fields = 10 }: { fields?: number }) {
  return (
    <div className="rounded-lg border border-line bg-surface shadow-card">
      <div className="flex flex-wrap gap-2 p-2.5">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="flex min-w-[11rem] flex-1 flex-col gap-[3px]">
            <div className="h-[10px] w-16 rounded bg-sunk" />
            <div className="h-[30px] rounded-md border border-line-2 bg-surface-2/60" />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2.5 border-t border-line bg-sunk px-2.5 py-2.5">
        <div className="h-7 w-24 rounded-md bg-line-2" />
        <div className="h-4 w-16 rounded bg-sunk/70" />
        <div className="ml-auto h-4 w-28 rounded bg-sunk/70" />
      </div>
    </div>
  );
}

export function SkeletonTable({
  rows = 8,
  columns = 8,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
      <div className="flex gap-4 border-b border-line-2 bg-surface-2 px-2 py-[9px]">
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className="h-[10px] flex-1 rounded bg-sunk" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b border-line px-2 py-[7px] last:border-b-0">
          {Array.from({ length: columns }).map((_, c) => (
            <div
              key={c}
              className="h-3.5 flex-1 rounded bg-sunk/50"
              // Varied widths so it reads as a table of text rather than a
              // barcode.
              style={{ maxWidth: `${[90, 70, 55, 80, 45, 65, 75, 50][c % 8]}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonPage({
  title,
  description,
  fields = 10,
  columns = 8,
}: {
  title: string;
  description: string;
  fields?: number;
  columns?: number;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-[17px] font-semibold tracking-[-0.015em] text-ink">{title}</h1>
        <p className="mt-0.5 text-[12.5px] text-ink-2">{description}</p>
      </div>
      <SkeletonFilters fields={fields} />
      <SkeletonTable columns={columns} />
    </div>
  );
}
