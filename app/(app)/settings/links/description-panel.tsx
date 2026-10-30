"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { Button, ErrorNote, Textarea, cx } from "@/components/ui";
import { applyEdits, encode, pieces } from "@/lib/price-check/description";

import { descriptionVersion, draftDescription, revertDescription, saveDescription, type DescDraft } from "./description-actions";

/**
 * "Description" panel on a Links product card: bring the attempt / batch-recording
 * text in line with the variants. Only those pieces of text change — tables,
 * tabs, styles, links and videos stay exactly as they are. Every save can be undone.
 */
export function DescriptionPanel({ productId, onClose }: { productId: number; onClose: () => void }) {
  const [data, setData] = useState<DescDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [text, setText] = useState<Record<number, string>>({});
  const [use, setUse] = useState<Record<number, boolean>>({});
  const [view, setView] = useState<"after" | "before" | null>("after");
  const [confirm, setConfirm] = useState(false);
  const [undo, setUndo] = useState<{ id: string; changedSince: boolean } | null>(null);
  const [old, setOld] = useState<{ id: string; html: string } | null>(null);

  function load(ai: boolean) {
    start(async () => {
      const r = await draftDescription(productId, ai);
      if (r.error) return setError(r.error);
      setError(null);
      setData(r.data!);
      setText(Object.fromEntries(r.data!.segments.map((s) => [s.i, s.suggestion ?? s.text])));
      setUse(Object.fromEntries(r.data!.segments.map((s) => [s.i, s.suggestion != null])));
    });
  }
  useEffect(() => load(true), [productId]); // eslint-disable-line react-hooks/exhaustive-deps

  const changes = useMemo(
    () => (data?.segments ?? []).filter((s) => use[s.i] && (text[s.i] ?? s.text).trim() !== s.text.trim()).map((s) => ({ i: s.i, text: text[s.i] ?? s.text })),
    [data, use, text],
  );

  // The new description, built the same way the server will (text pieces only).
  const after = useMemo(() => {
    if (!data) return "";
    const ps = pieces(data.html);
    const edits = changes.map((c) => {
      const from = ps[c.i].s;
      return { i: c.i, from, to: from.match(/^\s*/)![0] + encode(c.text.trim()) + from.match(/\s*$/)![0] };
    });
    const r = applyEdits(data.html, edits);
    return r.ok ? r.html : data.html;
  }, [data, changes]);

  if (!data) {
    return (
      <div className="rounded-md border border-line bg-surface-2 p-3 text-[12px] text-ink-3">
        {error ? <ErrorNote>{error}</ErrorNote> : "Reading the description from Shopify and checking it against the variants…"}
      </div>
    );
  }

  const bySection = new Map<string, typeof data.segments>();
  for (const s of data.segments) (bySection.get(s.section || "Top") ?? bySection.set(s.section || "Top", []).get(s.section || "Top")!).push(s);

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-surface-2 p-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold text-ink">Description</span>
        <span className="text-[11.5px] text-ink-3">Only attempt and batch-recording text changes; the layout stays as it is.</span>
        <div className="ml-auto flex items-center gap-1">
          {data.aiAvailable ? (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => (setConfirm(false), load(true))} title="Read the description again and ask AI for fresh suggestions">
              {pending ? "Checking…" : "✨ Suggest again"}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => (setConfirm(false), load(false))}>
            ↻ Check again
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {ok ? <div className="rounded-md border border-ok/35 bg-ok-soft px-3 py-2 text-[12.5px] text-ok">{ok}</div> : null}
      {!data.aiAvailable ? (
        <div className="rounded-md border border-warn/40 px-3 py-2 text-warn">
          AI suggestions are off (ANTHROPIC_API_KEY isn&apos;t set in Vercel). The attempt and recording lines are listed below to edit by hand.
        </div>
      ) : null}
      {data.aiError ? <ErrorNote>AI suggestions failed: {data.aiError}. Edit the lines by hand, or try again.</ErrorNote> : null}
      {data.aiNote ? <div className="rounded-md border border-warn/40 px-3 py-2 text-warn">AI note: {data.aiNote}</div> : null}

      <details className="text-ink-3">
        <summary className="cursor-pointer">What the listing sells now (the description is checked against this)</summary>
        <pre className="mt-1 whitespace-pre-wrap font-sans text-[11.5px]">{data.facts}</pre>
      </details>

      {data.segments.length ? (
        [...bySection.entries()].map(([sec, segs]) => (
          <div key={sec} className="flex flex-col gap-1">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{sec}</div>
            {segs.map((s) => {
              const changed = (text[s.i] ?? s.text).trim() !== s.text.trim();
              return (
                <div key={s.i} className={cx("grid grid-cols-[22px_1fr_1fr] items-start gap-2 rounded px-1 py-1", use[s.i] && changed ? "bg-accent-soft" : "")}>
                  <input type="checkbox" className="mt-1" checked={!!use[s.i]} disabled={!data.canWrite} onChange={(e) => setUse({ ...use, [s.i]: e.target.checked })} />
                  <div className={cx("whitespace-pre-wrap", use[s.i] && changed ? "text-ink-3 line-through" : "text-ink-2")}>{s.text.trim()}</div>
                  <div className="flex flex-col gap-0.5">
                    <Textarea
                      rows={Math.min(4, Math.ceil((text[s.i] ?? s.text).length / 60) || 1)}
                      className="min-h-0 text-[12px]"
                      value={(text[s.i] ?? s.text).trim()}
                      disabled={!data.canWrite}
                      onChange={(e) => {
                        setText({ ...text, [s.i]: e.target.value });
                        setUse({ ...use, [s.i]: true });
                      }}
                    />
                    {s.why ? <span className="text-[11px] text-ink-3">AI: {s.why}</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        ))
      ) : (
        <p className="text-ink-3">No attempt or recording text found in this description.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink-3">Preview:</span>
        <Button size="sm" variant={view === "after" ? "primary" : "ghost"} onClick={() => setView(view === "after" ? null : "after")}>
          With changes
        </Button>
        <Button size="sm" variant={view === "before" ? "primary" : "ghost"} onClick={() => setView(view === "before" ? null : "before")}>
          As it is now
        </Button>
        <a className="text-accent hover:underline" href={`https://zeroinfy.in/products/${data.handle}`} target="_blank" rel="noreferrer">
          Open on zeroinfy.in ↗
        </a>
      </div>
      {view ? <DescFrame html={view === "after" ? after : data.html} /> : null}

      {data.canWrite ? (
        <div className="flex flex-wrap items-center gap-2">
          {confirm ? (
            <>
              <span className="text-ink-2">Change {changes.length} line{changes.length === 1 ? "" : "s"} in the live description on zeroinfy.in? (You can undo it below.)</span>
              <Button
                size="sm"
                variant="primary"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await saveDescription(productId, data.hash, changes);
                    setConfirm(false);
                    if (r.error) setError(r.error);
                    else {
                      setOk(`Description updated on Shopify (${r.count} line${r.count === 1 ? "" : "s"}). Check it on zeroinfy.in — Undo is below if it's not right.`);
                      load(false);
                    }
                  })
                }
              >
                {pending ? "Saving…" : "Yes, update Shopify"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                No
              </Button>
            </>
          ) : (
            <Button size="sm" variant="primary" disabled={pending || !changes.length} onClick={() => setConfirm(true)}>
              Update description ({changes.length} line{changes.length === 1 ? "" : "s"})
            </Button>
          )}
        </div>
      ) : (
        <span className="text-ink-3">A super admin can save these changes.</span>
      )}

      {data.history.length ? (
        <div className="flex flex-col gap-1 border-t border-line pt-2">
          <span className="font-semibold text-ink-2">Earlier changes</span>
          {data.history.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center gap-2">
              <span className="text-ink-3">{new Date(h.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
              <span className="text-ink-2">
                {h.action === "revert_description" ? "Undo" : `${h.changes} line${h.changes === 1 ? "" : "s"} changed`}
                {h.who ? ` by ${h.who}` : ""}
                {h.current ? " (current)" : ""}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  old?.id === h.id
                    ? setOld(null)
                    : start(async () => {
                        const r = await descriptionVersion(h.id);
                        if (r.error) setError(r.error);
                        else setOld({ id: h.id, html: r.before ?? "" });
                      })
                }
              >
                {old?.id === h.id ? "Hide old version" : "See the version before"}
              </Button>
              {data.canWrite ? (
                undo?.id === h.id ? (
                  <>
                    <span className="text-danger">
                      {undo.changedSince ? "The description changed again after this — undoing discards those later edits too. Go ahead?" : "Put back the description from before this change?"}
                    </span>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const r = await revertDescription(h.id, undo.changedSince);
                          if (r.changedSince) return setUndo({ id: h.id, changedSince: true });
                          setUndo(null);
                          if (r.error) setError(r.error);
                          else {
                            setOk("Old description put back on Shopify.");
                            load(false);
                          }
                        })
                      }
                    >
                      Yes, undo
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setUndo(null)}>
                      No
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setUndo({ id: h.id, changedSince: false })}
                  >
                    Undo this
                  </Button>
                )
              ) : null}
              {old?.id === h.id ? <div className="w-full"><DescFrame html={old.html} /></div> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The description rendered in a sandbox (no scripts), roughly as the store shows it. */
function DescFrame({ html }: { html: string }) {
  const doc = `<!doctype html><meta charset="utf-8"><style>body{font:13px/1.5 system-ui,sans-serif;margin:8px;color:#222;background:#fff}table{border-collapse:collapse;margin:6px 0}td{border:1px solid #ddd;padding:4px 8px;vertical-align:top}h5{font-size:14px;margin:14px 0 6px;border-bottom:1px solid #ccc}iframe{max-width:100%}</style>${html}`;
  return <iframe title="Description preview" sandbox="" srcDoc={doc} className="h-[420px] w-full rounded border border-line bg-white" />;
}
