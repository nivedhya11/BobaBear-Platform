/**
 * Complimentary-item authoring validation (IMP-036J T6).
 *
 * Exact operator-specified Catalog product + variant. Rejects bundles,
 * required customer/modifier choice, positive-price modifier choice, and
 * incomplete or unresolvable identity. Does not author a gift catalogue.
 */
import { and, eq, gt, inArray, ne } from "drizzle-orm";

import {
  catalogBundleGroupsTable,
  catalogProductsTable,
  catalogVariantModifierGroupsTable,
  catalogVariantsTable,
} from "../../platform/database/schema/catalog";
import { priceBookModifierPricesTable } from "../../platform/database/schema/pricing";
import type { PersistenceTransactionContext } from "../persistence/types";
import { assertUuid } from "./assert-role";
import { PromotionAdminError } from "./errors";
import { COPY_OP_GIFT_INVALID } from "../../shared/promotions/operator-copy";

function giftInvalid(field: string): never {
  throw new PromotionAdminError("PROMOTION_COMPLIMENTARY_INVALID", COPY_OP_GIFT_INVALID, {
    field,
  });
}

export async function assertComplimentaryAuthoringSafe(
  context: PersistenceTransactionContext,
  input: {
    brandId: string;
    complimentaryProductId: string | null | undefined;
    complimentaryVariantId: string | null | undefined;
  },
): Promise<{ productId: string; variantId: string }> {
  if (
    typeof input.complimentaryProductId !== "string" ||
    input.complimentaryProductId.length === 0
  ) {
    giftInvalid("complimentaryProductId");
  }
  if (
    typeof input.complimentaryVariantId !== "string" ||
    input.complimentaryVariantId.length === 0
  ) {
    giftInvalid("complimentaryVariantId");
  }
  const productId = assertUuid(input.complimentaryProductId, "complimentaryProductId");
  const variantId = assertUuid(input.complimentaryVariantId, "complimentaryVariantId");

  const [product] = await context.db
    .select()
    .from(catalogProductsTable)
    .where(eq(catalogProductsTable.id, productId))
    .limit(1);
  if (!product || product.brandId !== input.brandId || product.lifecycleStatus !== "active") {
    giftInvalid("complimentaryProductId");
  }
  if (product.productKind === "bundle") {
    giftInvalid("complimentaryProductId");
  }

  const [variant] = await context.db
    .select()
    .from(catalogVariantsTable)
    .where(eq(catalogVariantsTable.id, variantId))
    .limit(1);
  if (
    !variant ||
    variant.brandId !== input.brandId ||
    variant.productId !== productId ||
    variant.lifecycleStatus !== "active"
  ) {
    giftInvalid("complimentaryVariantId");
  }
  if (variant.productKind === "bundle") {
    giftInvalid("complimentaryVariantId");
  }

  const bundleGroups = await context.db
    .select({ id: catalogBundleGroupsTable.id })
    .from(catalogBundleGroupsTable)
    .where(
      and(
        eq(catalogBundleGroupsTable.bundleVariantId, variantId),
        ne(catalogBundleGroupsTable.lifecycleStatus, "retired"),
      ),
    )
    .limit(1);
  if (bundleGroups[0]) {
    giftInvalid("complimentaryVariantId");
  }

  const modifierLinks = await context.db
    .select()
    .from(catalogVariantModifierGroupsTable)
    .where(
      and(
        eq(catalogVariantModifierGroupsTable.variantId, variantId),
        ne(catalogVariantModifierGroupsTable.lifecycleStatus, "retired"),
      ),
    );
  if (modifierLinks.some((link) => link.minTotalQuantity >= 1)) {
    giftInvalid("complimentaryVariantId");
  }
  if (modifierLinks.length > 0) {
    const linkIds = modifierLinks.map((link) => link.id);
    const paid = await context.db
      .select({ id: priceBookModifierPricesTable.id })
      .from(priceBookModifierPricesTable)
      .where(
        and(
          inArray(priceBookModifierPricesTable.variantModifierGroupId, linkIds),
          gt(priceBookModifierPricesTable.priceDeltaPaise, BigInt(0)),
        ),
      )
      .limit(1);
    if (paid[0]) {
      giftInvalid("complimentaryVariantId");
    }
  }

  return { productId, variantId };
}
