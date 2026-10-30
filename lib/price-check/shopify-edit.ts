import "server-only";

import { adminQuery } from "@/lib/price-check/shopify";

/**
 * Price check: reading one Zeroinfy listing's options/variants and adding
 * variants to it (a new BB batch). Writes need write_products.
 */

export type ShopifyOption = { id: string; name: string; position: number; values: string[]; valueIds: Record<string, string> };
export type ShopifyVariant = {
  id: number;
  title: string;
  price: number;
  compareAtPrice: number | null;
  selected: Record<string, string>;
  inventoryPolicy: string;
  taxable: boolean;
  tracked: boolean;
  requiresShipping: boolean;
};
export type ShopifyProductForEdit = {
  id: number;
  title: string;
  handle: string;
  options: ShopifyOption[];
  variants: ShopifyVariant[];
};

const gid = (id: number) => `gid://shopify/Product/${id}`;
const num = (g: string) => Number(g.split("/").pop());

type VariantNode = {
  id: string;
  title: string;
  price: string;
  compareAtPrice: string | null;
  inventoryPolicy: string;
  taxable: boolean;
  selectedOptions: { name: string; value: string }[];
  inventoryItem: { tracked: boolean; requiresShipping: boolean } | null;
};

export async function getProductForEdit(productId: number): Promise<ShopifyProductForEdit> {
  const variants: VariantNode[] = [];
  let after: string | null = null;
  let head: { title: string; handle: string; options: { id: string; name: string; position: number; optionValues: { id: string; name: string }[] }[] } | null = null;
  for (let page = 0; page < 20; page++) {
    const data: {
      product: {
        title: string;
        handle: string;
        options: { id: string; name: string; position: number; optionValues: { id: string; name: string }[] }[];
        variants: { nodes: VariantNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
      } | null;
    } = await adminQuery(
      `query P($id: ID!, $after: String) {
        product(id: $id) {
          title handle
          options { id name position optionValues { id name } }
          variants(first: 250, after: $after) {
            nodes { id title price compareAtPrice inventoryPolicy taxable
              selectedOptions { name value } inventoryItem { tracked requiresShipping } }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { id: gid(productId), after },
    );
    if (!data.product) throw new Error("That product is no longer on Shopify.");
    head = data.product;
    variants.push(...data.product.variants.nodes);
    if (!data.product.variants.pageInfo.hasNextPage) break;
    after = data.product.variants.pageInfo.endCursor;
  }
  return {
    id: productId,
    title: head!.title,
    handle: head!.handle,
    options: head!.options
      .map((o) => ({
        id: o.id,
        name: o.name,
        position: o.position,
        values: o.optionValues.map((v) => v.name),
        valueIds: Object.fromEntries(o.optionValues.map((v) => [v.name, v.id])),
      }))
      .sort((a, b) => a.position - b.position),
    variants: variants.map((v) => ({
      id: num(v.id),
      title: v.title,
      price: Number(v.price),
      compareAtPrice: v.compareAtPrice == null ? null : Number(v.compareAtPrice),
      selected: Object.fromEntries(v.selectedOptions.map((o) => [o.name, o.value])),
      inventoryPolicy: v.inventoryPolicy,
      taxable: v.taxable,
      tracked: v.inventoryItem?.tracked ?? false,
      requiresShipping: v.inventoryItem?.requiresShipping ?? false,
    })),
  };
}

type UserError = { field: string[] | null; message: string };
const errText = (e: UserError[]) => e.map((x) => x.message).join("; ");

/** Add a new option to the product; every existing variant takes `existingValue`. */
export async function addOption(productId: number, name: string, existingValue: string, position?: number): Promise<void> {
  const data: { productOptionsCreate: { userErrors: UserError[] } } = await adminQuery(
    `mutation O($id: ID!, $options: [OptionCreateInput!]!) {
      productOptionsCreate(productId: $id, options: $options, variantStrategy: LEAVE_AS_IS) {
        userErrors { field message }
      }
    }`,
    { id: gid(productId), options: [{ name, values: [{ name: existingValue }], ...(position ? { position } : {}) }] },
  );
  if (data.productOptionsCreate.userErrors.length) throw new Error(`Shopify: ${errText(data.productOptionsCreate.userErrors)}`);
}

export type NewVariant = {
  options: Record<string, string>; // every product option → value (new values are created)
  price: number;
  compareAtPrice: number | null;
  inventoryPolicy: string;
  taxable: boolean;
  tracked: boolean;
  requiresShipping: boolean;
};

export async function createVariants(
  productId: number,
  vs: NewVariant[],
): Promise<{ id: number; title: string; selected: Record<string, string> }[]> {
  const data: {
    productVariantsBulkCreate: {
      productVariants: { id: string; title: string; selectedOptions: { name: string; value: string }[] }[] | null;
      userErrors: UserError[];
    };
  } = await adminQuery(
    `mutation V($id: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $id, variants: $variants) {
        productVariants { id title selectedOptions { name value } }
        userErrors { field message }
      }
    }`,
    {
      id: gid(productId),
      variants: vs.map((v) => ({
        optionValues: Object.entries(v.options).map(([optionName, name]) => ({ optionName, name })),
        price: v.price.toFixed(2),
        compareAtPrice: v.compareAtPrice == null ? null : v.compareAtPrice.toFixed(2),
        inventoryPolicy: v.inventoryPolicy,
        taxable: v.taxable,
        inventoryItem: { tracked: v.tracked, requiresShipping: v.requiresShipping },
      })),
    },
  );
  const r = data.productVariantsBulkCreate;
  if (r.userErrors.length) throw new Error(`Shopify: ${errText(r.userErrors)}`);
  return (r.productVariants ?? []).map((v) => ({
    id: num(v.id),
    title: v.title,
    selected: Object.fromEntries((v.selectedOptions ?? []).map((o) => [o.name, o.value])),
  }));
}

/** Set price / compare-at on existing variants of one product. */
export async function updatePrices(
  productId: number,
  items: { variantId: number; price: number; compareAtPrice: number | null }[],
): Promise<void> {
  const data: { productVariantsBulkUpdate: { userErrors: UserError[] } } = await adminQuery(
    `mutation U($id: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $id, variants: $variants) { userErrors { field message } }
    }`,
    {
      id: gid(productId),
      variants: items.map((i) => ({
        id: `gid://shopify/ProductVariant/${i.variantId}`,
        price: i.price.toFixed(2),
        compareAtPrice: i.compareAtPrice == null ? null : i.compareAtPrice.toFixed(2),
      })),
    },
  );
  if (data.productVariantsBulkUpdate.userErrors.length) throw new Error(`Shopify: ${errText(data.productVariantsBulkUpdate.userErrors)}`);
}

/** Delete variants (e.g. options for exams that have passed). */
export async function deleteVariants(productId: number, variantIds: number[]): Promise<void> {
  const data: { productVariantsBulkDelete: { userErrors: UserError[] } } = await adminQuery(
    `mutation D($id: ID!, $v: [ID!]!) { productVariantsBulkDelete(productId: $id, variantsIds: $v) { userErrors { field message } } }`,
    { id: gid(productId), v: variantIds.map((v) => `gid://shopify/ProductVariant/${v}`) },
  );
  if (data.productVariantsBulkDelete.userErrors.length) throw new Error(`Shopify: ${errText(data.productVariantsBulkDelete.userErrors)}`);
}

/** Change one variant: price, compare-at, and/or its option values (e.g. May-26 → May-27). */
export async function updateVariant(
  productId: number,
  variantId: number,
  change: { price?: number; compareAtPrice?: number | null; options?: Record<string, string> },
): Promise<void> {
  const v: Record<string, unknown> = { id: `gid://shopify/ProductVariant/${variantId}` };
  if (change.price != null) v.price = change.price.toFixed(2);
  if (change.compareAtPrice !== undefined) v.compareAtPrice = change.compareAtPrice == null ? null : change.compareAtPrice.toFixed(2);
  if (change.options) v.optionValues = Object.entries(change.options).map(([optionName, name]) => ({ optionName, name }));
  const data: { productVariantsBulkUpdate: { userErrors: UserError[] } } = await adminQuery(
    `mutation U($id: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $id, variants: $variants) { userErrors { field message } }
    }`,
    { id: gid(productId), variants: [v] },
  );
  if (data.productVariantsBulkUpdate.userErrors.length) throw new Error(`Shopify: ${errText(data.productVariantsBulkUpdate.userErrors)}`);
}

/** Rename an option value for every variant that uses it (e.g. "May-26" → "May-27"). */
export async function renameOptionValue(productId: number, optionId: string, valueId: string, name: string): Promise<void> {
  const data: { productOptionUpdate: { userErrors: UserError[] } } = await adminQuery(
    `mutation R($id: ID!, $o: OptionUpdateInput!, $v: [OptionValueUpdateInput!]) {
      productOptionUpdate(productId: $id, option: $o, optionValuesToUpdate: $v) { userErrors { field message } }
    }`,
    { id: gid(productId), o: { id: optionId }, v: [{ id: valueId, name }] },
  );
  if (data.productOptionUpdate.userErrors.length) throw new Error(`Shopify: ${errText(data.productOptionUpdate.userErrors)}`);
}

/** Delete an option that no longer tells variants apart (it has one value left). */
export async function deleteOption(productId: number, optionId: string): Promise<void> {
  const data: { productOptionsDelete: { userErrors: UserError[] } } = await adminQuery(
    `mutation X($id: ID!, $o: [ID!]!) { productOptionsDelete(productId: $id, options: $o, strategy: DEFAULT) { userErrors { field message } } }`,
    { id: gid(productId), o: [optionId] },
  );
  if (data.productOptionsDelete.userErrors.length) throw new Error(`Shopify: ${errText(data.productOptionsDelete.userErrors)}`);
}

/** A listing's description (HTML), as it is on Shopify now. */
export async function getDescription(productId: number): Promise<{ title: string; handle: string; html: string }> {
  const data: { product: { title: string; handle: string; descriptionHtml: string } | null } = await adminQuery(
    `query D($id: ID!) { product(id: $id) { title handle descriptionHtml } }`,
    { id: gid(productId) },
  );
  if (!data.product) throw new Error("That product is no longer on Shopify.");
  return { title: data.product.title, handle: data.product.handle, html: data.product.descriptionHtml ?? "" };
}

/** Replace a listing's description. */
export async function setDescription(productId: number, html: string): Promise<void> {
  const data: { productUpdate: { userErrors: UserError[] } } = await adminQuery(
    `mutation S($p: ProductUpdateInput!) { productUpdate(product: $p) { userErrors { field message } } }`,
    { p: { id: gid(productId), descriptionHtml: html } },
  );
  if (data.productUpdate.userErrors.length) throw new Error(`Shopify: ${errText(data.productUpdate.userErrors)}`);
}
