"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, CELL, ErrorNote, Input, Select, TABLE_HEAD_ROW, cx } from "@/components/ui";
import type { EdportalVariant } from "@/lib/price-check/edportal";

import {
  addToShopify,
  addVendorProductByUrl,
  editVariant,
  markOwnOption,
  loadWorkbench,
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
function rulePrice(vendorPrice: number | null): number {
  if (vendorPrice == null) return 0;
  return vendorPrice; // Same as BB (offer ended 27 Oct 2026); see lib/price-check/rules.ts
}

function splitOpt(o: string): [string, string] {
  const i = o.indexOf(": ");
  return i < 0 ? ["", o] : [o.slice(0, i).trim(), o.slice(i + 2).trim()];
}

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
        vp.variants.map((v) => ({ key: `${vp.slug}|${v.id}`, vp, v, label: `${v.title} — ${rupees(v.price)}` })),
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
                      {allOptions.map((o) => (
                        <option key={o.key} value={o.key}>
                          {data.vendors.length > 1 ? `${o.vp.title ?? o.vp.slug}: ` : ""}
                          {o.label}
                        </option>
                      ))}
                      <option value="__own">★ Zeroinfy-only option (BB doesn&apos;t sell it — e.g. without books) — keep, don&apos;t check price</option>
                    </Select>
                  ) : (
                    <span className="text-ink-3">Not linked yet</span>
                  )}
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
                <span className="text-ink-2">{g.title}</span>
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
        <AddForm
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

function AddForm({
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

  // The vendor option most of the listing is linked to: what the current variants are.
  const base = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of wb.links) if (l.vendor_product_slug === vp.slug && l.vendor_variant_id) counts.set(l.vendor_variant_id, (counts.get(l.vendor_variant_id) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return vp.variants.find((v) => v.id === top) ?? null;
  }, [wb, vp]);

  // What differs between the missing option and the one already sold.
  const diff = useMemo(() => {
    const b = new Map((base?.options ?? []).map(splitOpt));
    const parts = gap.options.map(splitOpt).filter(([k, v]) => b.get(k) !== v);
    return { keys: parts.map(([k]) => k).filter(Boolean), newVals: parts.map(([, v]) => v), oldVals: parts.map(([k]) => b.get(k) ?? "") };
  }, [base, gap]);

  const canNew = p.options.length < 3;
  // Another attempt of the course: goes into the listing's Attempt option (or a new one).
  const attemptOpt = p.options.find((o) => /attempt/i.test(o.name));
  const isAttempt = vp.sibling;
  const guessExisting = isAttempt
    ? attemptOpt ?? p.options[0]
    : p.options.find((o) => /batch/i.test(o.name)) ?? p.options.find((o) => /attempt/i.test(o.name)) ?? p.options[0];
  const [kind, setKind] = useState<"new" | "existing">(isAttempt ? (attemptOpt || !canNew ? "existing" : "new") : canNew ? "new" : "existing");
  const [optName, setOptName] = useState(isAttempt ? "Attempt" : diff.keys.length ? `${diff.keys.join(" & ")} Batch` : "Batch");
  const [existingOpt, setExistingOpt] = useState(guessExisting?.name ?? "");
  const [existingValue, setExistingValue] = useState(isAttempt ? "Current attempt" : diff.oldVals.join(" | ") || "Current batch");
  const extra = isAttempt && gap.options.length > 1 ? ` (${gap.options.map((o) => o.split(": ").slice(1).join(": ")).join(", ")})` : "";
  const [newValue, setNewValue] = useState(isAttempt ? `${vp.attempts ?? "Next attempt"}${extra}` : diff.newVals.join(" | ") || gap.title);
  const [price, setPrice] = useState(String(rulePrice(gap.price)));
  const [compareAt, setCompareAt] = useState(gap.price != null ? String(gap.price) : "");

  const targetName = kind === "new" ? optName.trim() : existingOpt;
  const others = p.options.filter((o) => o.name !== targetName);
  const [combine, setCombine] = useState<Record<string, string[]>>(() => Object.fromEntries(p.options.map((o) => [o.name, o.values])));
  const count = others.reduce((n, o) => n * (combine[o.name]?.length ?? 0), 1);

  return (
    <div className="flex flex-col gap-2 rounded-md border border-accent/40 bg-surface p-3 text-[12px]">
      <div className="font-semibold text-ink">
        Add to Zeroinfy: {gap.title} <span className="font-normal text-ink-3">({vp.siteName} {rupees(gap.price)})</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1">
          <input type="radio" checked={kind === "new"} disabled={!canNew} onChange={() => setKind("new")} />
          New option on the listing
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={kind === "existing"} onChange={() => setKind("existing")} />
          New value of an existing option
        </label>
        {!canNew ? <span className="text-ink-3">(the listing already has 3 options, Shopify&apos;s maximum)</span> : null}
      </div>

      {kind === "new" ? (
        <div className="grid grid-cols-[170px_1fr] items-center gap-2">
          <span className="text-ink-3">Option name</span>
          <Input className="h-[26px]" value={optName} onChange={(e) => setOptName(e.target.value)} />
          <span className="text-ink-3">Current variants become</span>
          <Input className="h-[26px]" value={existingValue} onChange={(e) => setExistingValue(e.target.value)} />
          <span className="text-ink-3">New batch is called</span>
          <Input className="h-[26px]" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
        </div>
      ) : (
        <div className="grid grid-cols-[170px_1fr] items-center gap-2">
          <span className="text-ink-3">Option</span>
          <Select className="h-[26px]" value={existingOpt} onChange={(e) => setExistingOpt(e.target.value)}>
            {p.options.map((o) => (
              <option key={o.name} value={o.name}>
                {o.name} ({o.values.join(", ")})
              </option>
            ))}
          </Select>
          <span className="text-ink-3">New value</span>
          <Input className="h-[26px]" value={newValue} onChange={(e) => setNewValue(e.target.value)} />
        </div>
      )}

      {others.map((o) => (
        <div key={o.name} className="flex flex-wrap items-center gap-2">
          <span className="w-[170px] text-ink-3">With {o.name}</span>
          {o.values.map((val) => (
            <label key={val} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={combine[o.name]?.includes(val) ?? false}
                onChange={(e) =>
                  setCombine((c) => ({
                    ...c,
                    [o.name]: e.target.checked ? [...(c[o.name] ?? []), val] : (c[o.name] ?? []).filter((x) => x !== val),
                  }))
                }
              />
              {val}
            </label>
          ))}
        </div>
      ))}

      <div className="grid grid-cols-[170px_160px_1fr] items-center gap-2">
        <span className="text-ink-3">Price (each new variant)</span>
        <Input className="h-[26px]" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
        <span className="text-ink-3">Default: same as the BB price.</span>
        <span className="text-ink-3">Compare-at price</span>
        <Input className="h-[26px]" inputMode="numeric" value={compareAt} onChange={(e) => setCompareAt(e.target.value)} />
        <span className="text-ink-3">Default: the vendor&apos;s price.</span>
      </div>

      {wb.instructions.map((i) => (
        <details key={i.site} className="text-ink-3">
          <summary className="cursor-pointer">Pricing rules — {i.site}</summary>
          <pre className="mt-1 whitespace-pre-wrap font-sans">{i.text}</pre>
        </details>
      ))}

      <p className="text-ink-3">
        Creates <b className="text-ink">{count}</b> variant{count === 1 ? "" : "s"} on Shopify
        {kind === "new" ? `, adds the option "${optName.trim()}" (all ${p.variants.length} current variants become "${existingValue.trim()}")` : ""}, and links them to
        this {vp.siteName} option. Stock and tax settings are copied from the matching current variant.
      </p>
      {error ? <ErrorNote>{error}</ErrorNote> : null}

      <div className="flex items-center gap-2">
        {confirm ? (
          <>
            <span className="text-ink-2">This changes the live listing on zeroinfy.in. Go ahead?</span>
            <Button
              size="sm"
              variant="primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await addToShopify({
                    productId: p.id,
                    siteId: vp.siteId,
                    slug: vp.slug,
                    vendorProductTitle: vp.title,
                    vendorVariantId: gap.id,
                    vendorVariantLabel: gap.title,
                    target: kind === "new" ? { kind: "new", option: optName.trim(), existingValue: existingValue.trim() } : { kind: "existing", option: existingOpt },
                    newValue: newValue.trim(),
                    combine,
                    price: Number(price),
                    compareAtPrice: compareAt.trim() ? Number(compareAt) : null,
                  });
                  if (r.error) {
                    setConfirm(false);
                    setError(r.error);
                  } else onDone(r.count ?? 0);
                })
              }
            >
              {pending ? "Working…" : "Yes, change Shopify"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              No
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="primary" disabled={pending || count < 1} onClick={() => setConfirm(true)}>
              Create {count} variant{count === 1 ? "" : "s"} on Shopify
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

/** Rename an option value on every variant (e.g. "May-26" → "May-27"). */
function OptionsEditor({ wb, onDone, onError }: { wb: WB; onDone: (msg: string) => void; onError: (e: string) => void }) {
  const [pending, start] = useTransition();
  const [edit, setEdit] = useState<{ option: string; from: string; to: string } | null>(null);
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
              <button
                key={val}
                type="button"
                title="Rename this value on every variant"
                className="rounded border border-line-2 bg-surface px-2 py-[1px] text-ink-2 hover:bg-surface-2"
                onClick={() => setEdit({ option: o.name, from: val, to: val })}
              >
                {val} ✎
              </button>
            ),
          )}
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
