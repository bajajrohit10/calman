"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, CELL, ErrorNote, Input, Select, TABLE_HEAD_ROW, cx } from "@/components/ui";
import type { EdportalVariant } from "@/lib/price-check/edportal";

import { draftFromVendor, finalLayout } from "@/lib/price-check/zeroinfy-format";

import {
  addVariantsFromVendor,
  addVendorProductByUrl,
  editVariant,
  markOwnOption,
  loadWorkbench,
  removeOption,
  removeOptionValue,
  removeVariants,
  renameValue,
  retargetLink,
  type VendorProduct,
  type Workbench as WB,
} from "./workbench-actions";
import { ignoreGap } from "./gap-actions";
import { setKeepPrice } from "./todo-actions";

/**
 * "Batches & options" panel on a Links product card: re-point a variant at
 * another vendor option, and add vendor batches the listing doesn't sell.
 */

const rupees = (n: number | null | undefined) => (n == null ? "—" : `₹${n.toLocaleString("en-IN")}`);

/** Default Zeroinfy price from the general BB offer rule; the person checks it against the site's instructions. */
/**
 * A BB option as people read it: its option values ("DT: Batch 2 (Live Oct 2026) · IDT: Batch 1 (Recorded June 2026)"),
 * not BB's variant title, which repeats the product name and gets cut off in a dropdown.
 */
function optionText(v: EdportalVariant): string {
  const parts = v.options.map((o) => o.trim()).filter((o) => o && !/^:\s*$/.test(o));
  return parts.length ? parts.join(" · ") : v.title;
}

// Default Zeroinfy price = BB's price (offer ended 27 Oct 2026), compare-at = BB's MRP; see lib/price-check/rules.ts.

export function Workbench({
  productId,
  onClose,
  focus,
}: {
  productId: number;
  onClose: () => void;
  /** Open straight on "Add to Zeroinfy" for this vendor option. */
  focus?: { slug: string; variantId: string };
}) {
  const router = useRouter();
  const [data, setData] = useState<WB | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState<{ vp: VendorProduct; v: EdportalVariant } | null>(null);
  // The list behind the panel is refreshed only on Close: an approved product
  // drops out of the "AI suggested" list, which would unmount this panel mid-task.
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const [paste, setPaste] = useState("");
  const close = () => {
    if (dirty) router.refresh();
    onClose();
  };

  function reload() {
    start(async () => {
      const r = await loadWorkbench(productId);
      if (r.error) setError(r.error);
      else {
        setError(null);
        setData(r.data!);
        if (focus) {
          const vp = r.data!.vendors.find((x) => x.slug === focus.slug);
          const v = vp?.variants.find((x) => x.id === focus.variantId);
          if (vp && v) setAdding({ vp, v });
        }
      }
    });
  }
  useEffect(reload, [productId]);

  const linkByVariant = useMemo(() => new Map((data?.links ?? []).map((l) => [l.shopify_variant_id, l])), [data]);
  const allOptions = useMemo(
    () =>
      (data?.vendors ?? []).flatMap((vp) =>
        vp.variants.map((v) => ({ key: `${vp.slug}|${v.id}`, vp, v, label: `${optionText(v)} — ${rupees(v.price)}` })),
      ),
    [data],
  );

  /** Run a change, then re-read the panel. */
  function run(fn: () => Promise<{ error: string | null }>, msg: string) {
    setOk(null);
    start(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else {
        setError(null);
        setOk(msg);
        setDirty(true);
        reload();
      }
    });
  }

  if (!data) {
    return (
      <div className="rounded-md border border-line bg-surface-2 p-3 text-[12px] text-ink-3">
        {error ? <ErrorNote>{error}</ErrorNote> : "Reading the listing from Shopify and the vendor's options…"}
      </div>
    );
  }

  const linkedIds = new Set(data.links.map((l) => `${l.vendor_product_slug}|${l.vendor_variant_id}`));

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-surface-2 p-3">
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] font-semibold text-ink">Batches &amp; options</span>
        <span className="text-[11.5px] text-ink-3">Live from Shopify and the vendor&apos;s site.</span>
        <Button
          size="sm"
          variant="secondary"
          className="ml-auto"
          disabled={pending}
          title="Re-read this listing from Shopify and its BB products from bbvirtuals.com"
          onClick={() => {
            setOk("Refreshed from Shopify and BB.");
            setDirty(true);
            reload();
          }}
        >
          {pending ? "Reading…" : "↻ Refresh"}
        </Button>
        <Button size="sm" variant="ghost" onClick={close}>
          Close
        </Button>
      </div>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {data.canWrite && data.scopes && !data.scopes.includes("write_products") ? (
        <ErrorNote>
          Shopify has not given Calman permission to edit products yet (granted: {data.scopes.join(", ") || "none"}). Adding
          batches will fail until write_products is approved for the app on the store.
        </ErrorNote>
      ) : null}
      {data.canWrite && data.scopes?.includes("write_products") ? (
        <div className="text-[11px] text-ok">Shopify edit permission: granted.</div>
      ) : null}
      {ok ? <div className="rounded-md border border-ok/35 bg-ok-soft px-3 py-2 text-[12.5px] text-ok">{ok}</div> : null}
      {data.vendors.map((vp) =>
        vp.error ? (
          <ErrorNote key={vp.slug}>
            {vp.title ?? vp.slug}: {vp.error}
          </ErrorNote>
        ) : null,
      )}

      {data.canWrite ? (
        <OptionsEditor
          wb={data}
          onDone={(msg) => {
            setOk(msg);
            setDirty(true);
            reload();
          }}
          onError={setError}
        />
      ) : null}

      <form
        className="flex flex-wrap items-center gap-2 text-[12px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!paste.trim()) return;
          setOk(null);
          start(async () => {
            const r = await addVendorProductByUrl(data.product.id, paste);
            if (r.error) setError(r.error);
            else {
              setError(null);
              setPaste("");
              setOk(`Added “${r.title}”. Its options are now in each variant's list below — pick the right one per variant.`);
              setDirty(true);
              reload();
            }
          });
        }}
      >
        <span className="text-ink-2">Right BB product not in the list?</span>
        <Input className="h-[26px] w-[420px] max-w-full" value={paste} placeholder="Paste the BB product link (https://www.bbvirtuals.com/product/…)" onChange={(e) => setPaste(e.target.value)} />
        <Button size="sm" variant="secondary" type="submit" disabled={pending || !paste.trim()}>
          Use this product
        </Button>
      </form>

      <table className="w-full text-[12px]">
        <thead>
          <tr className={TABLE_HEAD_ROW}>
            <th className={CELL}>Zeroinfy variant</th>
            <th className={CELL}>Price</th>
            <th className={CELL}>Linked vendor option</th>
            {data.canWrite ? <th className={CELL} /> : null}
          </tr>
        </thead>
        <tbody>
          {data.product.variants.map((v) => {
            const link = linkByVariant.get(v.id);
            const own = !!link && link.status === "approved" && !link.vendor_variant_id && !!link.vendor_product_slug;
            const current = own ? "__own" : link ? `${link.vendor_product_slug}|${link.vendor_variant_id}` : "";
            return (
              <tr key={v.id} className="border-b border-line last:border-0">
                <td className={cx(CELL, "max-w-[300px]")}>{v.title}</td>
                <td className={cx(CELL, "whitespace-nowrap")}>
                  {rupees(v.price)}
                  {v.compareAtPrice ? <span className="ml-1 text-ink-3 line-through">{rupees(v.compareAtPrice)}</span> : null}
                </td>
                <td className={CELL}>
                  {link ? (
                    <Select
                      className="h-[26px] w-full max-w-[560px]"
                      title={allOptions.find((o) => o.key === current)?.v.title ?? link.vendor_variant_label ?? ""}
                      value={own || allOptions.some((o) => o.key === current) ? current : ""}
                      disabled={pending || !allOptions.length}
                      onChange={(e) => {
                        if (e.target.value === "__own") {
                          const vp = data.vendors.find((x) => x.slug === link.vendor_product_slug) ?? data.vendors.find((x) => !x.sibling) ?? data.vendors[0];
                          if (!vp) return setError("Link a BB product first, so Calman knows which course this option belongs to.");
                          return run(() => markOwnOption(link.id, vp.slug, vp.title), "Kept as a Zeroinfy-only option. Its price won't be checked against BB.");
                        }
                        const o = allOptions.find((x) => x.key === e.target.value);
                        if (!o) return;
                        setOk(null);
                        start(async () => {
                          const r = await retargetLink(link.id, o.vp.slug, o.v.id, o.v.title, o.vp.title);
                          if (r.error) setError(r.error);
                          else {
                            setOk("Link updated and approved. The product stays here until you click Close.");
                            setDirty(true);
                            reload();
                          }
                        });
                      }}
                    >
                      {own || allOptions.some((o) => o.key === current) ? null : <option value="">{link.vendor_variant_label ?? (link.status === "no_match" ? "— not linked: pick the BB option" : "— (not on vendor site any more)")}</option>}
                      {data.vendors.map((vp) => (
                        <optgroup key={vp.slug} label={`${vp.title ?? vp.slug}${vp.sibling && vp.attempts && vp.attempts !== "added by hand" ? ` (${vp.attempts})` : ""}`}>
                          {allOptions
                            .filter((o) => o.vp.slug === vp.slug)
                            .map((o) => (
                              <option key={o.key} value={o.key} title={o.v.title}>
                                {o.label}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                      <option value="__own">★ Zeroinfy-only option (BB doesn&apos;t sell it — e.g. without books) — keep, don&apos;t check price</option>
                    </Select>
                  ) : (
                    <span className="text-ink-3">Not linked yet</span>
                  )}
                  {(() => {
                    const o = allOptions.find((x) => x.key === current);
                    return o ? (
                      <div className="mt-0.5 max-w-[560px] text-[11px] leading-snug text-ink-3">
                        {data.vendors.length > 1 ? <span className="text-ink-2">{o.vp.title ?? o.vp.slug} · </span> : null}
                        {optionText(o.v)}
                      </div>
                    ) : null;
                  })()}
                  {link && link.vendor_variant_id && link.status !== "no_match" ? (
                    <label className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-3" title="For a variant priced differently on purpose, e.g. Google Drive + hard copy linked to BB's Drive-only option">
                      <input
                        type="checkbox"
                        checked={link.keep_price}
                        disabled={pending}
                        onChange={(e) =>
                          run(
                            () => setKeepPrice([link.id], e.target.checked, ""),
                            e.target.checked ? "Our price is kept for this variant — it won't show under Price to fix." : "Price is checked against BB again.",
                          )
                        }
                      />
                      Keep our price (priced differently on purpose — don&apos;t check against BB)
                    </label>
                  ) : null}
                  {link && link.status !== "approved" ? <span className="ml-1 text-[11px] text-ink-3">({link.status === "no_match" ? "not linked" : link.status})</span> : null}
                  {link?.status === "no_match" && link.reason ? <div className="text-[11px] text-ink-3">{link.reason}</div> : null}
                  {editing === v.id ? (
                    <VariantEditor
                      wb={data}
                      variantId={v.id}
                      onCancel={() => setEditing(null)}
                      onDone={(msg) => {
                        setEditing(null);
                        setOk(msg);
                        setDirty(true);
                        reload();
                      }}
                    />
                  ) : null}
                </td>
                {data.canWrite ? (
                  <td className={cx(CELL, "whitespace-nowrap text-right align-top")}>
                    {removing === v.id ? (
                      <>
                        <span className="mr-1 text-danger">Delete on Shopify?</span>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              const r = await removeVariants(data.product.id, [v.id]);
                              setRemoving(null);
                              if (r.error) setError(r.error);
                              else {
                                setOk(`Removed “${v.title}” from the listing.`);
                                setDirty(true);
                                reload();
                              }
                            })
                          }
                        >
                          Yes, delete
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>
                          No
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditing(editing === v.id ? null : v.id)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => setRemoving(v.id)}>
                          Remove
                        </Button>
                      </>
                    )}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>

      {data.vendors.map((vp) => {
        const ignored = new Set(data.ignored);
        const gaps = vp.variants.filter((v) => !linkedIds.has(`${vp.slug}|${v.id}`) && !ignored.has(`${vp.slug}|${v.id}`) && Number(v.price ?? 0) > 0);
        if (!gaps.length) return null;
        return (
          <div key={vp.slug} className="flex flex-col gap-1">
            <div className="text-[12px] font-semibold text-warn">
              {vp.siteName} sells {gaps.length === 1 ? "an option" : `${gaps.length} options`} you don&apos;t — {vp.title ?? vp.slug}
              {vp.sibling ? (vp.attempts === "added by hand" ? " (added from a pasted link)" : ` (another attempt: ${vp.attempts ?? "?"})`) : ""}
            </div>
            {gaps.map((g) => (
              <div key={g.id} className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="text-ink-2" title={g.title}>{optionText(g)}</span>
                <span className="text-ink-3">{rupees(g.price)}</span>
                {data.canWrite ? (
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => setAdding({ vp, v: g })}>
                    Add to Zeroinfy…
                  </Button>
                ) : (
                  <span className="text-[11px] text-ink-3">(a super admin can add it)</span>
                )}
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => ignoreGap(data.product.id, vp.siteId, vp.slug, g.id, ""), `Hidden: Zeroinfy won't sell “${g.title}” on this listing.`)}>
                  We don&apos;t sell this
                </Button>
              </div>
            ))}
          </div>
        );
      })}

      {adding ? (
        <ZAddForm
          wb={data}
          vp={adding.vp}
          gap={adding.v}
          onCancel={() => setAdding(null)}
          onDone={(n) => {
            setAdding(null);
            setOk(`Added ${n} variant${n === 1 ? "" : "s"} on Shopify and linked them.`);
            setDirty(true);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Add BB options to the listing in Zeroinfy's layout: Mode of Delivery → Attempt →
 * batch recording(s). Drafted from the closest option the listing already sells;
 * every value, price and new option can be edited before Shopify is changed.
 */
function ZAddForm({
  wb,
  vp,
  gap,
  onCancel,
  onDone,
}: {
  wb: WB;
  vp: VendorProduct;
  gap: EdportalVariant;
  onCancel: () => void;
  onDone: (n: number) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const p = wb.product;

  // The other BB options of this product the listing doesn't sell: can be added in the same go.
  const gaps = useMemo(() => {
    const linked = new Set(wb.links.map((l) => `${l.vendor_product_slug}|${l.vendor_variant_id}`));
    const ignored = new Set(wb.ignored);
    return vp.variants.filter((v) => v.id === gap.id || (!linked.has(`${vp.slug}|${v.id}`) && !ignored.has(`${vp.slug}|${v.id}`) && Number(v.price ?? 0) > 0));
  }, [wb, vp, gap]);
  const [picked, setPicked] = useState<string[]>([gap.id]);

  const draft = useMemo(
    () =>
      draftFromVendor(
        {
          options: p.options,
          variants: p.variants,
          links: wb.links,
          vendorVariants: new Map(wb.vendors.map((x) => [x.slug, x.variants])),
          slug: vp.slug,
          attempt: vp.sibling && vp.attempts !== "added by hand" ? vp.attempts : null,
        },
        gaps.filter((g) => picked.includes(g.id)),
      ),
    [p, wb, vp, gaps, picked],
  );

  // The person's edits, kept across re-drafts (by BB option key / BB variant id).
  const [optEdit, setOptEdit] = useState<Record<string, { name?: string; currentValue?: string; position?: number; drop?: boolean }>>({});
  const [rowEdit, setRowEdit] = useState<Record<string, { options?: Record<string, string>; price?: string; compareAt?: string }>>({});

  const newOptions = draft.newOptions
    .filter((n) => !optEdit[n.key]?.drop)
    .map((n) => ({ ...n, draftName: n.name, name: optEdit[n.key]?.name ?? n.name, currentValue: optEdit[n.key]?.currentValue ?? n.currentValue, position: optEdit[n.key]?.position ?? n.position }));
  const layout = finalLayout(p.options, newOptions);
  const draftNameOf = (name: string) => newOptions.find((n) => n.name === name)?.draftName ?? name;
  const valuesOf = (name: string) => p.options.find((o) => o.name === name)?.values ?? [];

  const rows = draft.rows.map((r) => {
    const e = rowEdit[r.vendorVariantId] ?? {};
    const options = Object.fromEntries(layout.map((n) => [n, e.options?.[n] ?? r.options[draftNameOf(n)] ?? ""]));
    return {
      ...r,
      options,
      priceText: e.price ?? String(r.price || ""),
      compareText: e.compareAt ?? (r.compareAtPrice != null ? String(r.compareAtPrice) : ""),
    };
  });
  const setRow = (id: string, patch: { options?: Record<string, string>; price?: string; compareAt?: string }) =>
    setRowEdit((x) => ({ ...x, [id]: { ...x[id], ...patch, options: { ...x[id]?.options, ...patch.options } } }));

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await addVariantsFromVendor({
        productId: p.id,
        siteId: vp.siteId,
        slug: vp.slug,
        vendorProductTitle: vp.title,
        newOptions: newOptions.map(({ name, position, currentValue }) => ({ name, position, currentValue })),
        rows: rows.map((x) => ({
          options: x.options,
          price: Number(x.priceText),
          compareAtPrice: x.compareText.trim() ? Number(x.compareText) : null,
          vendorVariantId: x.vendorVariantId,
          vendorVariantLabel: x.vendorVariantLabel,
        })),
      });
      if (r.error) {
        setConfirm(false);
        setError(r.error);
      } else onDone(r.count ?? 0);
    });

  return (
    <div className="flex flex-col gap-2 rounded-md border border-accent/40 bg-surface p-3 text-[12px]">
      <div className="font-semibold text-ink">
        Add to Zeroinfy: {gap.title} <span className="font-normal text-ink-3">({vp.siteName} {rupees(gap.price)})</span>
      </div>
      <p className="text-ink-3">
        Drafted in Zeroinfy&apos;s layout — Mode of Delivery, then Attempt, then batch recording(s) — from the closest option this listing already sells.
        Check every value before going ahead.
      </p>

      {gaps.length > 1 ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-ink-3">BB options to add ({vp.title ?? vp.slug}):</span>
          {gaps.map((g) => (
            <label key={g.id} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={picked.includes(g.id)}
                onChange={(e) => setPicked((x) => (e.target.checked ? [...x, g.id] : x.filter((y) => y !== g.id)))}
              />
              {g.title} <span className="text-ink-3">{rupees(g.price)}</span>
            </label>
          ))}
        </div>
      ) : null}

      {draft.newOptions.length ? (
        <div className="flex flex-col gap-1 rounded border border-line p-2">
          <span className="font-semibold text-ink-2">New option{draft.newOptions.length === 1 ? "" : "s"} on the listing</span>
          {draft.newOptions.map((n) => {
            const e = optEdit[n.key] ?? {};
            const set = (patch: typeof e) => setOptEdit((x) => ({ ...x, [n.key]: { ...x[n.key], ...patch } }));
            return (
              <div key={n.key} className="flex flex-wrap items-center gap-2">
                <span className="text-ink-3">BB&apos;s “{n.key}” varies →</span>
                <Input className="h-[24px] w-[160px]" value={e.name ?? n.name} disabled={e.drop} onChange={(ev) => set({ name: ev.target.value })} />
                <span className="text-ink-3">position</span>
                <Select className="h-[24px] w-[60px]" value={String(e.position ?? n.position)} disabled={e.drop} onChange={(ev) => set({ position: Number(ev.target.value) })}>
                  {[1, 2, 3].slice(0, p.options.length + draft.newOptions.length).map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </Select>
                <span className="text-ink-3">current {p.variants.length} variants become</span>
                <Input className="h-[24px] w-[220px]" value={e.currentValue ?? n.currentValue} disabled={e.drop} onChange={(ev) => set({ currentValue: ev.target.value })} />
                <label className="flex items-center gap-1 text-ink-3">
                  <input type="checkbox" checked={!!e.drop} onChange={(ev) => set({ drop: ev.target.checked })} />
                  don&apos;t add
                </label>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className={TABLE_HEAD_ROW}>
              {layout.map((n) => (
                <th key={n} className={CELL}>
                  {n}
                  {newOptions.some((x) => x.name === n) ? <span className="ml-1 text-accent">(new)</span> : null}
                </th>
              ))}
              <th className={CELL}>Price</th>
              <th className={CELL}>Compare-at</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.vendorVariantId} className="border-b border-line align-top last:border-0">
                {layout.map((n) => (
                  <td key={n} className={CELL}>
                    <Input
                      className={cx("h-[24px] min-w-[140px]", valuesOf(n).includes(r.options[n]) ? "" : "border-accent")}
                      list={`z-${r.vendorVariantId}-${n}`}
                      value={r.options[n]}
                      title={valuesOf(n).includes(r.options[n]) ? "Existing value" : "New value — created on Shopify"}
                      onChange={(e) => setRow(r.vendorVariantId, { options: { [n]: e.target.value } })}
                    />
                    <datalist id={`z-${r.vendorVariantId}-${n}`}>
                      {valuesOf(n).map((x) => (
                        <option key={x} value={x} />
                      ))}
                    </datalist>
                  </td>
                ))}
                <td className={CELL}>
                  <Input className="h-[24px] w-[90px]" inputMode="numeric" value={r.priceText} onChange={(e) => setRow(r.vendorVariantId, { price: e.target.value })} />
                </td>
                <td className={CELL}>
                  <Input className="h-[24px] w-[90px]" inputMode="numeric" value={r.compareText} onChange={(e) => setRow(r.vendorVariantId, { compareAt: e.target.value })} />
                </td>
              </tr>
            ))}
            {rows.map((r) =>
              r.notes.length ? (
                <tr key={`${r.vendorVariantId}-n`}>
                  <td colSpan={layout.length + 2} className="px-2 text-[11px] text-warn">
                    {r.vendorVariantLabel}: {r.notes.join(" ")}
                  </td>
                </tr>
              ) : null,
            )}
          </tbody>
        </table>
      </div>
      <p className="text-ink-3">
        Values outlined in colour are new on Shopify. Price defaults to BB&apos;s price, compare-at to BB&apos;s MRP. Stock and tax settings are copied from
        the closest current variant.
      </p>

      {wb.instructions.map((i) => (
        <details key={i.site} className="text-ink-3">
          <summary className="cursor-pointer">Pricing rules — {i.site}</summary>
          <pre className="mt-1 whitespace-pre-wrap font-sans">{i.text}</pre>
        </details>
      ))}

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="flex flex-wrap items-center gap-2">
        {confirm ? (
          <>
            <span className="text-ink-2">
              Creates {rows.length} variant{rows.length === 1 ? "" : "s"}
              {newOptions.length ? ` and the option${newOptions.length === 1 ? "" : "s"} ${newOptions.map((n) => `"${n.name}"`).join(", ")}` : ""} on the live
              zeroinfy.in listing. Go ahead?
            </span>
            <Button size="sm" variant="primary" disabled={pending} onClick={submit}>
              {pending ? "Working…" : "Yes, change Shopify"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              No
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="primary" disabled={pending || !rows.length} onClick={() => setConfirm(true)}>
              Create {rows.length} variant{rows.length === 1 ? "" : "s"} on Shopify
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** Rename or remove an option value on every variant (e.g. "May-26" → "May-27"); remove a one-value option. */
function OptionsEditor({ wb, onDone, onError }: { wb: WB; onDone: (msg: string) => void; onError: (e: string) => void }) {
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState<{ option: string; from: string; to: string } | null>(null);
  const [drop, setDrop] = useState<{ option: string; value: string } | null>(null);
  return (
    <div className="flex flex-col gap-1 text-[12px]">
      {wb.product.options.map((o) => (
        <div key={o.name} className="flex flex-wrap items-center gap-1">
          <span className="w-[160px] text-ink-3">{o.name}</span>
          {o.values.map((val) =>
            edit && edit.option === o.name && edit.from === val ? (
              <form
                key={val}
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  start(async () => {
                    const r = await renameValue(wb.product.id, o.name, val, edit.to);
                    if (r.error) onError(r.error);
                    else {
                      setEdit(null);
                      onDone(`Renamed “${val}” to “${edit.to.trim()}” on every variant. Pick the BB option for them below.`);
                    }
                  });
                }}
              >
                <Input autoFocus className="h-[24px] w-[220px]" value={edit.to} onChange={(e) => setEdit({ ...edit, to: e.target.value })} />
                <Button size="sm" variant="primary" type="submit" disabled={pending}>
                  Rename on Shopify
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setEdit(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <span key={val} className="inline-flex items-center rounded border border-line-2 bg-surface text-ink-2">
                <button
                  type="button"
                  title="Rename this value on every variant"
                  className="px-2 py-[1px] hover:bg-surface-2"
                  onClick={() => setEdit({ option: o.name, from: val, to: val })}
                >
                  {val} ✎
                </button>
                {o.values.length > 1 ? (
                  drop && drop.option === o.name && drop.value === val ? (
                    <span className="flex items-center gap-1 px-1">
                      <span className="text-danger">Delete its {wb.product.variants.filter((v) => v.selected[o.name] === val).length} variant(s)?</span>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            const r = await removeOptionValue(wb.product.id, o.name, val);
                            setDrop(null);
                            if (r.error) onError(r.error);
                            else onDone(`Removed “${val}” from ${o.name} (${r.count} variant${r.count === 1 ? "" : "s"} deleted on Shopify).`);
                          })
                        }
                      >
                        Yes
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDrop(null)}>
                        No
                      </Button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      title={`Remove “${val}”: deletes every variant with it`}
                      className="border-l border-line-2 px-1.5 py-[1px] text-ink-3 hover:bg-danger-soft hover:text-danger"
                      onClick={() => setDrop({ option: o.name, value: val })}
                    >
                      ✕
                    </button>
                  )
                ) : null}
              </span>
            ),
          )}
          {o.values.length === 1 && wb.product.options.length > 1 ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              title="Only one value left: the option no longer tells variants apart"
              onClick={() =>
                start(async () => {
                  const r = await removeOption(wb.product.id, o.name);
                  if (r.error) onError(r.error);
                  else onDone(`Removed the option ${o.name} from the listing.`);
                })
              }
            >
              Remove option
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Edit one variant: price, compare-at, option values. */
function VariantEditor({ wb, variantId, onCancel, onDone }: { wb: WB; variantId: number; onCancel: () => void; onDone: (msg: string) => void }) {
  const v = wb.product.variants.find((x) => x.id === variantId)!;
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [price, setPrice] = useState(String(v.price));
  const [compareAt, setCompareAt] = useState(v.compareAtPrice != null ? String(v.compareAtPrice) : "");
  const [opts, setOpts] = useState<Record<string, string>>({ ...v.selected });
  return (
    <form
      className="mt-2 flex flex-col gap-1 rounded-md border border-accent/40 bg-surface p-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await editVariant(wb.product.id, variantId, { price: Number(price), compareAtPrice: compareAt.trim() ? Number(compareAt) : null, options: opts });
          if (r.error) setError(r.error);
          else onDone("Variant updated on Shopify.");
        });
      }}
    >
      {wb.product.options.map((o) => (
        <label key={o.name} className="grid grid-cols-[150px_1fr] items-center gap-2">
          <span className="text-ink-3">{o.name}</span>
          <Input className="h-[24px]" list={`opt-${variantId}-${o.name}`} value={opts[o.name] ?? ""} onChange={(e) => setOpts({ ...opts, [o.name]: e.target.value })} />
          <datalist id={`opt-${variantId}-${o.name}`}>
            {o.values.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </label>
      ))}
      <label className="grid grid-cols-[150px_1fr] items-center gap-2">
        <span className="text-ink-3">Price</span>
        <Input className="h-[24px]" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>
      <label className="grid grid-cols-[150px_1fr] items-center gap-2">
        <span className="text-ink-3">Compare-at</span>
        <Input className="h-[24px]" inputMode="numeric" value={compareAt} onChange={(e) => setCompareAt(e.target.value)} />
      </label>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="flex gap-1">
        <Button size="sm" variant="primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save on Shopify"}
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
