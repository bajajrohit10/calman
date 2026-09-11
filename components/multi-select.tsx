"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Input, cx } from "@/components/ui";
import {
  countLabel,
  isEmptyOption,
  orderOptions,
  type FacetMap,
} from "@/lib/facet-shape";

export type MultiOption = { id: string; name: string };

/**
 * A compact multi-select: a button the same height as the single-select fields
 * beside it, which opens a searchable checkbox list.
 *
 * It replaces the native `<select multiple size={5}>` the filter bars used to
 * carry. That control was five rows tall, so a filter grid containing one had
 * to work around it, and picking a second teacher out of seventy-odd meant
 * ctrl-clicking in a scrolling box — which also silently dropped the
 * selection on a mis-click.
 *
 * The form underneath is unchanged: the chosen values are rendered as hidden
 * inputs sharing one name, so a GET submit still produces repeated query
 * params and every parser behind it keeps working.
 */
export function MultiSelect({
  name,
  facet,
  options,
  values,
  facets,
  anyLabel = "Any",
}: {
  name: string;
  /** Facet key for the counts; omit where the screen has no facets. */
  facet?: string;
  options: MultiOption[];
  values: string[];
  facets?: FacetMap;
  anyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(values);
  const [cursor, setCursor] = useState(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const counts = facet ? facets?.byFacet[facet] : undefined;

  // Busiest first, as everywhere else; sort_order breaks ties (§11.1).
  const ordered = useMemo(() => orderOptions(options, counts), [options, counts]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter((o) => o.name.toLowerCase().includes(q));
  }, [ordered, query]);

  // Escape and outside click both close without touching the selection —
  // closing is not cancelling, the checkboxes have already taken effect.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o.name])), [options]);

  const label =
    selected.length === 0
      ? anyLabel
      : selected.length === 1
        ? (byId.get(selected[0]) ?? "1 selected")
        : `${byId.get(selected[0]) ?? "1"}, +${selected.length - 1}`;

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((v) => v !== id) : [...s, id]));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!visible.length) return;
      setCursor((c) => {
        const next = e.key === "ArrowDown" ? c + 1 : c - 1;
        return (next + visible.length) % visible.length;
      });
    } else if (e.key === " " || e.key === "Spacebar") {
      // Space toggles the row under the cursor rather than typing into the
      // search box — the search box handles its own spaces below.
      if (visible[cursor]) {
        e.preventDefault();
        toggle(visible[cursor].id);
      }
    } else if (e.key === "Enter") {
      // Apply: close the popover and let the surrounding form submit.
      e.preventDefault();
      setOpen(false);
    } else if (
      e.key.length === 1 &&
      e.key !== " " &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      document.activeElement !== searchRef.current
    ) {
      // Start typing anywhere and it goes to the search box, character
      // included — the keypress fired here, so it has to be carried over by
      // hand rather than left to bubble.
      e.preventDefault();
      setQuery((q) => q + e.key);
      setCursor(0);
      searchRef.current?.focus();
    }
  }

  return (
    <div ref={rootRef} className="relative">
      {/* What the form actually submits: one repeated key, exactly as a native
          multi-select would have produced. */}
      {selected.map((v) => (
        <input key={v} type="hidden" name={name} value={v} />
      ))}

      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen((o) => !o);
          setCursor(0);
          // Focus the panel, not the search box: the brief's keyboard contract
          // is that Space toggles the row under the cursor, and a focused text
          // input would swallow it. Typing a letter hands focus to the search
          // box and carries the character across, so searching still costs no
          // extra click.
          window.setTimeout(() => panelRef.current?.focus(), 0);
        }}
        className={cx(
          "flex h-8 w-full items-center justify-between gap-2 rounded-md border px-2.5 text-left text-[13px]",
          "border-line-2 bg-surface hover:border-ink-3",
          selected.length ? "text-ink" : "text-ink-3",
        )}
      >
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-[10px] text-ink-3">▾</span>
      </button>

      {open ? (
        <div
          ref={panelRef}
          tabIndex={-1}
          className="absolute z-30 mt-1 w-[min(22rem,80vw)] rounded-md border border-line-2 bg-surface p-2 shadow-lg outline-none"
          onKeyDown={onKeyDown}
        >
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            placeholder="Search…"
            aria-label={`Search ${name}`}
            // Space belongs to the search box while it has focus; the list
            // handles its own via the cursor.
            onKeyDown={(e) => {
              if (e.key === " ") e.stopPropagation();
            }}
          />

          <div className="mt-1.5 flex items-center gap-2 text-[11.5px]">
            <button
              type="button"
              className="text-ink-2 underline-offset-2 hover:underline"
              onClick={() =>
                setSelected((s) => [
                  ...new Set([...s, ...visible.map((o) => o.id)]),
                ])
              }
            >
              Select all in view
            </button>
            <button
              type="button"
              className="text-ink-2 underline-offset-2 hover:underline"
              onClick={() => setSelected([])}
            >
              Clear
            </button>
            <span className="ml-auto text-ink-3">
              {selected.length} selected
            </span>
          </div>

          <ul
            id={listId}
            role="listbox"
            aria-multiselectable
            className="mt-1.5 max-h-56 overflow-auto"
          >
            {visible.map((o, i) => {
              const checked = selected.includes(o.id);
              const empty = facet ? isEmptyOption(facet, o.id, facets) : false;
              return (
                <li key={o.id}>
                  <label
                    role="option"
                    aria-selected={checked}
                    onMouseEnter={() => setCursor(i)}
                    className={cx(
                      "flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[12.5px]",
                      i === cursor ? "bg-accent-soft" : "",
                      empty ? "text-ink-3" : "text-ink-2",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(o.id)}
                    />
                    <span className="truncate">
                      {facet && facets
                        ? countLabel(o.name, facet, counts?.[o.id])
                        : o.name}
                    </span>
                  </label>
                </li>
              );
            })}
            {visible.length === 0 ? (
              <li className="px-1.5 py-2 text-[12px] text-ink-3">
                Nothing matches “{query}”.
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
