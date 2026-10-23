"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, CELL, ErrorNote, Input, Select, TABLE_HEAD_ROW, cx } from "@/components/ui";
import type { EdportalVariant } from "@/lib/price-check/edportal";

import { addToShopify, loadWorkbench, retargetLink, type VendorProduct, type Workbench as WB } from "./workbench-actions";

/**
 * "Batches & options" panel on a Links product card: re-point a variant at
 * another vendor option, and add vendor batches the listing doesn't sell.
 */

const rupees = (n: number | null | undefined) => (n == null ? "—" : `₹${n.toLocaleString("en-IN")}`);

/** Default Zeroinfy price from the general BB offer rule; the person checks it against the site's instructions. */
function rulePrice(vendorPrice: number | null): number {
  if (vendorPrice == null) return 0;
  return vendorPrice > 4000 ? vendorPrice - 500 : vendorPrice;
}

function splitOpt(o: string): [string, string] {
  const i = o.indexOf(": ");
  return i < 0 ? ["", o] : [o.slice(0, i).trim(), o.slice(i + 2).trim()];
}

export function Workbench({ productId, onClose }: { productId: number; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<WB | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState<{ vp: VendorProduct; v: EdportalVariant } | null>(null);
  // The list behind the panel is refreshed only on Close: an approved product
  // drops out of the "AI suggested" list, which would unmount this panel mid-task.
  const [dirty, setDirty] = useState(false);
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
        <Button size="sm" variant="ghost" className="ml-auto" onClick={close}>
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

      <table className="w-full text-[12px]">
        <thead>
          <tr className={TABLE_HEAD_ROW}>
            <th className={CELL}>Zeroinfy variant</th>
            <th className={CELL}>Price</th>
            <th className={CELL}>Linked vendor option</th>
          </tr>
        </thead>
        <tbody>
          {data.product.variants.map((v) => {
            const link = linkByVariant.get(v.id);
            const current = link ? `${link.vendor_product_slug}|${link.vendor_variant_id}` : "";
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
                      value={allOptions.some((o) => o.key === current) ? current : ""}
                      disabled={pending || !allOptions.length}
                      onChange={(e) => {
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
                      {allOptions.some((o) => o.key === current) ? null : <option value="">{link.vendor_variant_label ?? "— (not on vendor site any more)"}</option>}
                      {allOptions.map((o) => (
                        <option key={o.key} value={o.key}>
                          {data.vendors.length > 1 ? `${o.vp.title ?? o.vp.slug}: ` : ""}
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <span className="text-ink-3">Not linked yet</span>
                  )}
                  {link && link.status !== "approved" ? <span className="ml-1 text-[11px] text-ink-3">({link.status})</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {data.vendors.map((vp) => {
        const gaps = vp.variants.filter((v) => !linkedIds.has(`${vp.slug}|${v.id}`));
        if (!gaps.length) return null;
        return (
          <div key={vp.slug} className="flex flex-col gap-1">
            <div className="text-[12px] font-semibold text-warn">
              {vp.siteName} sells {gaps.length === 1 ? "an option" : `${gaps.length} options`} you don&apos;t — {vp.title ?? vp.slug}
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
  const guessExisting = p.options.find((o) => /batch/i.test(o.name)) ?? p.options.find((o) => /attempt/i.test(o.name)) ?? p.options[0];
  const [kind, setKind] = useState<"new" | "existing">(canNew ? "new" : "existing");
  const [optName, setOptName] = useState(diff.keys.length ? `${diff.keys.join(" & ")} Batch` : "Batch");
  const [existingOpt, setExistingOpt] = useState(guessExisting?.name ?? "");
  const [existingValue, setExistingValue] = useState(diff.oldVals.join(" | ") || "Current batch");
  const [newValue, setNewValue] = useState(diff.newVals.join(" | ") || gap.title);
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
        <span className="text-ink-3">Default: vendor price − ₹500 above ₹4,000. Check the rules below.</span>
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
