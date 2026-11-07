"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge, Button, ErrorNote, Input, Select, cx } from "@/components/ui";

import { mergeTypedName, promoteTypedName } from "./actions";

export type TypedName = { name: string; leads: number };

/**
 * §89. The names counsellors typed because the list did not have them.
 *
 * The list cannot be complete — a student buys from somebody nobody here has
 * heard of, and refusing to record that would lose the fact altogether. So the
 * picker has an Other box, and this is where what comes out of it gets tidied:
 * promote the ones that turn out to be real competitors, merge the rest into
 * the row they meant.
 *
 * Both actions re-point every lead carrying the name, so each row says how
 * many that is before anybody presses anything.
 */
export function TypedNames({
  rows,
  competitors,
}: {
  rows: TypedName[];
  competitors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [rename, setRename] = useState("");
  const [into, setInto] = useState("");

  function run(fn: () => Promise<{ error: string | null }>) {
    setNote(null);
    start(async () => {
      const res = await fn();
      if (res.error) setNote(res.error);
      else {
        setOpen(null);
        setRename("");
        setInto("");
        router.refresh();
      }
    });
  }

  return (
    <section className="flex flex-col gap-2">
      <div>
        <h3 className="text-[13px] font-semibold text-ink">Typed names</h3>
        <p className="mt-0.5 text-[12px] text-ink-3">
          Names somebody typed into &ldquo;Other&rdquo; rather than picking from the list.
          Promoting one adds it as a competitor; merging moves its leads onto a competitor
          already listed. Either way every lead that named it follows.
        </p>
      </div>

      {note ? <ErrorNote>{note}</ErrorNote> : null}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b border-line-2 bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3">
              <th className="px-2 py-[7px]">Typed name</th>
              <th className="w-[90px] px-2 py-[7px]">Leads</th>
              <th className="px-2 py-[7px]" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.name}
                data-testid={`typed-${r.name}`}
                className="border-b border-line align-top last:border-b-0"
              >
                <td className="px-2 py-[6px] text-ink">{r.name}</td>
                <td className="px-2 py-[6px]">
                  <Badge tone="neutral">{r.leads}</Badge>
                </td>
                <td className="px-2 py-[6px]">
                  {open === r.name ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-end gap-1.5">
                        <Input
                          className="w-[200px]"
                          aria-label="Name for the new competitor"
                          placeholder={r.name}
                          value={rename}
                          onChange={(e) => setRename(e.target.value)}
                        />
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={pending}
                          onClick={() =>
                            run(() => promoteTypedName({ name: r.name, newName: rename }))
                          }
                        >
                          Promote
                        </Button>
                        <span className="text-[11px] text-ink-3">
                          as a new competitor — blank keeps the typed name
                        </span>
                      </div>
                      <div className="flex flex-wrap items-end gap-1.5">
                        <Select
                          className="w-[200px]"
                          aria-label="Merge into"
                          value={into}
                          onChange={(e) => setInto(e.target.value)}
                        >
                          <option value="">Merge into…</option>
                          {competitors.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </Select>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending || !into}
                          onClick={() =>
                            run(() => mergeTypedName({ name: r.name, competitorId: into }))
                          }
                        >
                          Merge
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={() => setOpen(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        setOpen(r.name);
                        setRename("");
                        setInto("");
                      }}
                    >
                      Promote or merge…
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={3} className={cx("px-3 py-6 text-center text-ink-3")}>
                  Nobody has typed a name that is not on the list.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
