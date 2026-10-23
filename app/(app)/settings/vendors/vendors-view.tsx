"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge, Button, CARD, CELL, ErrorNote, Input, Select, TABLE_HEAD_ROW, Textarea, cx } from "@/components/ui";
import type { ReadResult } from "@/lib/price-check/readers";

import {
  addAlias,
  addExclusion,
  addSite,
  removeAlias,
  removeExclusion,
  testRead,
  updateSite,
  type SitePatch,
} from "./actions";

export type SiteRow = {
  id: string;
  name: string;
  website_url: string;
  read_method: string;
  platform_key: string | null;
  price_basis: string;
  status: string;
  notes: string | null;
  instructions: string | null;
  is_active: boolean;
  last_checked_at: string | null;
  last_check_result: string | null;
};
export type AliasRow = { id: string; vendor_site_id: string; shopify_vendor: string };
export type ExclusionRow = { id: string; shopify_vendor: string; reason: string | null };
type ShopifyVendor = { name: string; netSales6m: number | null };

const METHOD_LABELS: Record<string, string> = {
  edportal_feed: "Course-platform feed (BB-style)",
  shopify_feed: "Shopify product feed",
  vsmart_page: "Vsmart page data",
  letscommerce_page: "Let's Commerce page data",
  manual: "Manual — prices typed in",
};
const BASIS_LABELS: Record<string, string> = {
  listed: "Price as listed",
  after_auto_coupon: "After auto-applied coupon",
};
const STATUS_TONE: Record<string, "ok" | "danger" | "warn" | "neutral"> = {
  working: "ok",
  blocked: "danger",
  needs_review: "warn",
  manual: "neutral",
};
const STATUS_LABELS: Record<string, string> = {
  working: "Working",
  blocked: "Blocked",
  needs_review: "Needs review",
  manual: "Manual",
};

const LABEL = "text-[10px] font-semibold uppercase tracking-[0.045em] text-ink-3";

function rupees(n: number | null | undefined): string {
  if (n == null) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
function lakhs(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return rupees(Math.round(n));
}

export function VendorsView({
  sites,
  aliases,
  exclusions,
  shopifyVendors,
  shopifyNote,
  error,
}: {
  sites: SiteRow[];
  aliases: AliasRow[];
  exclusions: ExclusionRow[];
  shopifyVendors: ShopifyVendor[] | null;
  shopifyNote: string | null;
  error: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  function run(fn: () => Promise<{ error: string | null }>) {
    setNote(null);
    start(async () => {
      const res = await fn();
      if (res.error) setNote(res.error);
      else router.refresh();
    });
  }

  const assigned = useMemo(() => new Set(aliases.map((a) => a.shopify_vendor.toLowerCase())), [aliases]);
  const excluded = useMemo(() => new Set(exclusions.map((e) => e.shopify_vendor.toLowerCase())), [exclusions]);
  const unassigned = useMemo(
    () =>
      (shopifyVendors ?? []).filter(
        (v) => !assigned.has(v.name.toLowerCase()) && !excluded.has(v.name.toLowerCase()),
      ),
    [shopifyVendors, assigned, excluded],
  );
  const knownNames = useMemo(() => new Set((shopifyVendors ?? []).map((v) => v.name.toLowerCase())), [shopifyVendors]);

  return (
    <div className="flex flex-col gap-4">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {note ? <ErrorNote>{note}</ErrorNote> : null}
      {shopifyNote ? (
        <div className="rounded-md border border-warn/35 bg-warn-soft px-3 py-2 text-[12.5px] text-warn">{shopifyNote}</div>
      ) : null}

      <datalist id="shopify-vendor-names">
        {(shopifyVendors ?? []).map((v) => (
          <option key={v.name} value={v.name} />
        ))}
      </datalist>

      {sites.map((site) => (
        <SiteCard
          key={site.id}
          site={site}
          aliases={aliases.filter((a) => a.vendor_site_id === site.id)}
          knownNames={shopifyVendors ? knownNames : null}
          pending={pending}
          run={run}
        />
      ))}

      <form
        className={cx(CARD, "flex flex-wrap items-end gap-2 p-3")}
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addSite({ name: newName, website_url: newUrl }));
          setNewName("");
          setNewUrl("");
        }}
      >
        <label className="flex min-w-[200px] flex-col gap-[3px]">
          <span className={LABEL}>New site name</span>
          <Input value={newName} placeholder="e.g. Ultimate CA" onChange={(e) => setNewName(e.target.value)} />
        </label>
        <label className="flex min-w-[260px] flex-1 flex-col gap-[3px]">
          <span className={LABEL}>Website</span>
          <Input value={newUrl} placeholder="https://…" onChange={(e) => setNewUrl(e.target.value)} />
        </label>
        <Button type="submit" variant="primary" disabled={pending || !newName.trim() || !newUrl.trim()}>
          Add site
        </Button>
      </form>

      <Unassigned
        rows={unassigned}
        sites={sites}
        available={shopifyVendors !== null}
        pending={pending}
        run={run}
      />

      <div className={CARD}>
        <div className="border-b border-line px-3 py-2 text-[13px] font-semibold text-ink">
          Not price-checked ({exclusions.length})
        </div>
        {exclusions.length ? (
          <table className="w-full text-[12.5px]">
            <tbody>
              {exclusions.map((x) => (
                <tr key={x.id} className="border-b border-line last:border-0">
                  <td className={cx(CELL, "font-medium text-ink")}>{x.shopify_vendor}</td>
                  <td className={cx(CELL, "text-ink-2")}>{x.reason ?? ""}</td>
                  <td className={cx(CELL, "text-right")}>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => removeExclusion(x.id))}>
                      Check it again
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="px-3 py-2 text-[12.5px] text-ink-3">Every vendor name is either assigned or waiting.</p>
        )}
      </div>
    </div>
  );
}

function SiteCard({
  site,
  aliases,
  knownNames,
  pending,
  run,
}: {
  site: SiteRow;
  aliases: AliasRow[];
  knownNames: Set<string> | null;
  pending: boolean;
  run: (fn: () => Promise<{ error: string | null }>) => void;
}) {
  const [alias, setAlias] = useState("");
  const [testUrl, setTestUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ReadResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const router = useRouter();

  const save = (patch: SitePatch) => run(() => updateSite(site.id, patch));

  async function doTest() {
    setTesting(true);
    setResult(null);
    setTestError(null);
    try {
      const res = await testRead(site.id, testUrl);
      if (res.error) setTestError(res.error);
      setResult(res.result);
      router.refresh();
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className={cx(CARD, "flex flex-col gap-3 p-3", !site.is_active && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[14px] font-semibold text-ink">{site.name}</h2>
        <Badge tone={STATUS_TONE[site.status] ?? "neutral"} dot>
          {STATUS_LABELS[site.status] ?? site.status}
        </Badge>
        {!site.is_active ? <Badge>Inactive</Badge> : null}
        <a href={site.website_url} target="_blank" rel="noreferrer" className="text-[12px] text-accent hover:underline">
          {site.website_url.replace(/^https?:\/\//, "")}
        </a>
        <span className="ml-auto text-[11.5px] text-ink-3">
          {site.last_checked_at
            ? `Last checked ${new Date(site.last_checked_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}: ${site.last_check_result ?? ""}`
            : "Never checked"}
        </span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
        <label className="flex flex-col gap-[3px]">
          <span className={LABEL}>Name</span>
          <Input defaultValue={site.name} onBlur={(e) => e.target.value !== site.name && save({ name: e.target.value })} />
        </label>
        <label className="flex flex-col gap-[3px]">
          <span className={LABEL}>Website</span>
          <Input
            defaultValue={site.website_url}
            onBlur={(e) => e.target.value !== site.website_url && save({ website_url: e.target.value })}
          />
        </label>
        <label className="flex flex-col gap-[3px]">
          <span className={LABEL}>Read method</span>
          <Select value={site.read_method} disabled={pending} onChange={(e) => save({ read_method: e.target.value })}>
            {Object.entries(METHOD_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </label>
        {site.read_method === "edportal_feed" ? (
          <label className="flex flex-col gap-[3px]">
            <span className={LABEL}>Platform key</span>
            <Input
              defaultValue={site.platform_key ?? ""}
              placeholder="e.g. onr"
              onBlur={(e) => e.target.value !== (site.platform_key ?? "") && save({ platform_key: e.target.value })}
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-[3px]">
          <span className={LABEL}>Vendor price is</span>
          <Select value={site.price_basis} disabled={pending} onChange={(e) => save({ price_basis: e.target.value })}>
            {Object.entries(BASIS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-[3px]">
          <span className={LABEL}>Status</span>
          <Select value={site.status} disabled={pending} onChange={(e) => save({ status: e.target.value })}>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-end gap-2 pb-1 text-[12.5px] text-ink-2">
          <input
            type="checkbox"
            checked={site.is_active}
            disabled={pending}
            onChange={(e) => save({ is_active: e.target.checked })}
          />
          Active
        </label>
      </div>

      {/* The owner's rules for this vendor, in plain words. Kept above the
          technical notes because it is the one the team reads while matching. */}
      <label className="flex flex-col gap-[3px]">
        <span className={LABEL}>Pricing &amp; matching instructions</span>
        <Textarea
          rows={Math.min(8, Math.max(3, (site.instructions ?? "").split("\n").length + 1))}
          defaultValue={site.instructions ?? ""}
          placeholder="Special rules for this vendor — e.g. offer amount, products kept at vendor price, exceptions…"
          className="bg-warn-soft/40"
          onBlur={(e) => e.target.value !== (site.instructions ?? "") && save({ instructions: e.target.value })}
        />
        <span className="text-[11px] text-ink-3">Saved when you click outside the box.</span>
      </label>

      <label className="flex flex-col gap-[3px]">
        <span className={LABEL}>Technical notes</span>
        <Textarea
          rows={2}
          defaultValue={site.notes ?? ""}
          onBlur={(e) => e.target.value !== (site.notes ?? "") && save({ notes: e.target.value })}
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className={LABEL}>Shopify vendor names on this site ({aliases.length})</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {aliases.map((a) => {
            const unknown = knownNames && !knownNames.has(a.shopify_vendor.toLowerCase());
            return (
              <span
                key={a.id}
                title={unknown ? "No Shopify product currently uses this exact vendor name" : undefined}
                className={cx(
                  "inline-flex items-center gap-1 rounded border px-1.5 py-[1px] text-[12px]",
                  unknown ? "border-warn/40 bg-warn-soft text-warn" : "border-line-2 bg-surface-2 text-ink",
                )}
              >
                {a.shopify_vendor}
                <button
                  type="button"
                  aria-label={`Remove ${a.shopify_vendor}`}
                  className="text-ink-3 hover:text-danger disabled:opacity-50"
                  disabled={pending}
                  onClick={() => run(() => removeAlias(a.id))}
                >
                  ×
                </button>
              </span>
            );
          })}
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => addAlias(site.id, alias));
              setAlias("");
            }}
          >
            <Input
              list="shopify-vendor-names"
              className="h-[26px] w-[220px]"
              value={alias}
              placeholder="Add a vendor name…"
              onChange={(e) => setAlias(e.target.value)}
            />
            <Button size="sm" type="submit" disabled={pending || !alias.trim()}>
              Add
            </Button>
          </form>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-line pt-2">
        <span className={LABEL}>Test read — paste one product URL from this site</span>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void doTest();
          }}
        >
          <Input
            className="min-w-[320px] flex-1"
            value={testUrl}
            placeholder={`${site.website_url}/…`}
            onChange={(e) => setTestUrl(e.target.value)}
          />
          <Button type="submit" disabled={testing || !testUrl.trim()}>
            {testing ? "Reading…" : "Test read"}
          </Button>
        </form>
        {testError ? <ErrorNote>{testError}</ErrorNote> : null}
        {result ? <TestResult result={result} /> : null}
      </div>
    </section>
  );
}

function TestResult({ result }: { result: ReadResult }) {
  if (!result.ok) {
    return (
      <div className="rounded-md border border-danger/35 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
        Could not read a price: {result.reason}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-ok/35 bg-ok-soft/40 p-2">
      <div className="text-[12.5px] font-medium text-ink">{result.title}</div>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className={TABLE_HEAD_ROW}>
            <th className={CELL}>Option</th>
            <th className={cx(CELL, "text-right")}>Vendor price</th>
            <th className={cx(CELL, "text-right")}>MRP / before coupon</th>
            <th className={CELL}>How</th>
          </tr>
        </thead>
        <tbody>
          {result.variants.map((v, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              <td className={cx(CELL, "max-w-[360px] truncate")} title={v.label}>
                {v.label}
              </td>
              <td className={cx(CELL, "text-right font-semibold tabular-nums")}>{rupees(v.price)}</td>
              <td className={cx(CELL, "text-right tabular-nums text-ink-2")}>{rupees(v.mrp)}</td>
              <td className={cx(CELL, "text-ink-3")}>{v.derivation ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.notes.map((n, i) => (
        <p key={i} className="text-[11.5px] text-warn">
          {n}
        </p>
      ))}
      <p className="text-[11.5px] text-ink-3">Compare these with the vendor&apos;s page before trusting the method. Nothing is saved except that the site was checked.</p>
    </div>
  );
}

function Unassigned({
  rows,
  sites,
  available,
  pending,
  run,
}: {
  rows: ShopifyVendor[];
  sites: SiteRow[];
  available: boolean;
  pending: boolean;
  run: (fn: () => Promise<{ error: string | null }>) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [target, setTarget] = useState<Record<string, string>>({});
  const shown = showAll ? rows : rows.slice(0, 25);

  return (
    <div className={CARD}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-[13px] font-semibold text-ink">
          Unassigned vendor names {available ? `(${rows.length})` : ""}
        </span>
        <span className="text-[11.5px] text-ink-3">Sorted by Shopify net sales, last 6 months</span>
      </div>
      {!available ? (
        <p className="px-3 py-2 text-[12.5px] text-ink-3">Appears once Shopify is connected.</p>
      ) : rows.length === 0 ? (
        <p className="px-3 py-2 text-[12.5px] text-ink-3">Every Shopify vendor name is assigned to a site or excluded.</p>
      ) : (
        <>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className={TABLE_HEAD_ROW}>
                <th className={CELL}>Shopify vendor</th>
                <th className={cx(CELL, "text-right")}>Net sales, 6 months</th>
                <th className={CELL}>Assign to site</th>
                <th className={CELL} />
              </tr>
            </thead>
            <tbody>
              {shown.map((v) => (
                <tr key={v.name} className="border-b border-line last:border-0">
                  <td className={cx(CELL, "font-medium text-ink")}>{v.name}</td>
                  <td className={cx(CELL, "text-right tabular-nums")}>{lakhs(v.netSales6m)}</td>
                  <td className={CELL}>
                    <div className="flex items-center gap-1">
                      <Select
                        className="h-[26px] w-[220px]"
                        value={target[v.name] ?? ""}
                        onChange={(e) => setTarget((t) => ({ ...t, [v.name]: e.target.value }))}
                      >
                        <option value="">Choose a site…</option>
                        {sites.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                      <Button
                        size="sm"
                        disabled={pending || !target[v.name]}
                        onClick={() => run(() => addAlias(target[v.name], v.name))}
                      >
                        Assign
                      </Button>
                    </div>
                  </td>
                  <td className={cx(CELL, "text-right")}>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => run(() => addExclusion(v.name, ""))}
                    >
                      Don&apos;t check
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 25 ? (
            <div className="px-3 py-2">
              <Button size="sm" variant="ghost" onClick={() => setShowAll((s) => !s)}>
                {showAll ? "Show top 25" : `Show all ${rows.length}`}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
