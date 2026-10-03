/**
 * IMP-036J Tranche 6 — WORKFORCE_AUTHORING proof (US-036J-012).
 *
 * Real PostgreSQL. Overlapping transactions for AC-036J-012-06.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

import { serializeSignedCookie } from "better-call";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, inject, it } from "vitest";

import { createMembership, grantRole } from "../../src/server/access-control";
import {
  getWorkforceAuthRuntime,
  WORKFORCE_AUTH_SESSION_COOKIE_NAME,
} from "../../src/server/auth/workforce";
import { loadAuthFoundationConfig } from "../../src/server/auth/shared/config";
import {
  activateModifierGroup,
  activateModifierGroupOption,
  activateModifierOption,
  activateProduct,
  activateVariant,
  activateVariantModifierGroup,
  addModifierOptionToGroup,
  applyModifierGroupToVariant,
  createModifierGroup,
  createModifierOption,
  createProduct,
  createVariant,
} from "../../src/server/catalog";
import { routeOperationsRequest } from "../../src/server/operations/http/router";
import { attachDraftModifierPrice, createDraftPriceBook } from "../../src/server/pricing";
import {
  activateCoupon,
  activatePromotion,
  createCouponDraft,
  createPromotionDraft,
  inspectBrandPromotion,
  retirePromotion,
  setPromotionBenefit,
  setPromotionTargets,
  updatePromotionDraft,
  PromotionAdminError,
} from "../../src/server/promotions";
import { promotionsTable } from "../../src/platform/database/schema/promotions";
import {
  COPY_OP_GIFT_INVALID,
  COPY_OP_RACE,
  COPY_OP_SECOND,
} from "../../src/shared/promotions/operator-copy";
import type { PromotionBenefitConfig } from "../../src/shared/promotions";
import { createEligibleWorkforceUser, principalFor, seedBrandTree } from "./support/access-control-fixtures";
import {
  closeTrackedPersistenceHandles,
  openTrackedApplicationPersistence,
  seedActiveBundleWithComponent,
  seedActiveStandardVariant,
  seedActiveVariantWithModifier,
  uniqueCode,
} from "./support/cart-fixtures";
import {
  createReadyDraftPromotion,
  seedPromotionsHarness,
} from "./support/promotions-fixtures";
import { applyMigrations, withIsolatedTestDatabase } from "./support/test-database";
import type { WebConfig } from "../../src/platform/config";

afterEach(async () => {
  await closeTrackedPersistenceHandles();
});

function adminConnectionInfo() {
  return {
    connectionString: inject("bobaBearTestAdminConnectionString"),
    host: inject("bobaBearTestAdminHost"),
    port: inject("bobaBearTestAdminPort"),
  };
}

function applicationConfig(databaseUrl: string): WebConfig {
  return {
    environment: "test",
    processKind: "web",
    publicOrigin: "http://localhost:3000",
    logLevel: "warn",
    release: null,
    allowUnsafeAdapters: true,
    databaseSslMode: "disable",
    port: 3000,
    databaseUrl,
  };
}

const MERCH = {
  targetType: "all_merchandise" as const,
  productId: null,
  variantId: null,
  chargeDefinitionId: null,
};

function emptyMoneyBenefit(type: PromotionBenefitConfig["benefitType"]): PromotionBenefitConfig {
  return {
    benefitType: type,
    percentageBps: type === "percentage_discount" ? 1000 : null,
    fixedAmountPaise: type === "fixed_amount_discount" ? BigInt(100) : null,
    maximumDiscountPaise: null,
    buyQuantity: null,
    getQuantity: null,
    repeatable: null,
    maximumRewardQuantity: null,
    includeModifiers: false,
    includeBundleDeltas: false,
    complimentaryProductId: null,
    complimentaryVariantId: null,
  };
}

async function retarget(
  harness: Awaited<ReturnType<typeof seedPromotionsHarness>>,
  promotionId: string,
  revision: bigint,
) {
  const actor = harness.brandAdminPrincipal;
  let next = revision;
  next = (
    await harness.persistence.transaction((tx) =>
      setPromotionTargets(tx, {
        actor,
        promotionId,
        expectedPromotionRevision: next,
        targetRole: "qualifier",
        targets: [{ targetRole: "qualifier", ...MERCH }],
      }),
    )
  ).revision;
  next = (
    await harness.persistence.transaction((tx) =>
      setPromotionTargets(tx, {
        actor,
        promotionId,
        expectedPromotionRevision: next,
        targetRole: "benefit",
        targets: [{ targetRole: "benefit", ...MERCH }],
      }),
    )
  ).revision;
  return next;
}

describe("IMP-036J Tranche 6 workforce authoring", () => {
  it("authors automatic and coupon Offers with V1 fields, inspect, retire, gift, auth, CAS, and real concurrent complimentary activation", async () => {
    await withIsolatedTestDatabase(adminConnectionInfo(), async (database) => {
      await applyMigrations(database.connectionString);
      const openHandles: Array<{ close(): Promise<void> }> = [];
      const harness = await seedPromotionsHarness(database.connectionString, openHandles);
      const actor = harness.brandAdminPrincipal;
      const brandId = harness.tree.brand.id;
      const catalog = await seedActiveStandardVariant(harness.persistence, brandId, actor, "t6g");

      const auto = await harness.persistence.transaction(async (tx) => {
        return createPromotionDraft(tx, {
          actor,
          brandId,
          code: uniqueCode("auto"),
          displayName: "Automatic V1",
          scopeType: "brand",
          triggerType: "automatic",
          stackingPolicy: "exclusive",
          startsAt: new Date("2026-01-01T00:00:00Z"),
          endsAt: new Date("2026-12-31T00:00:00Z"),
          firstOrderOnly: true,
          eligibleFulfilmentModes: ["DELIVERY"],
          eligibleFulfilmentTimings: ["ASAP"],
          maximumRedemptions: 50,
          maximumRedemptionsPerCustomer: 2,
          minimumQualifyingAmountPaise: BigInt(10000),
        });
      });
      let autoRev = auto.revision;
      autoRev = (
        await harness.persistence.transaction((tx) =>
          setPromotionBenefit(tx, {
            actor,
            promotionId: auto.id,
            expectedPromotionRevision: autoRev,
            benefit: emptyMoneyBenefit("delivery_fee_waiver"),
          }),
        )
      ).revision;
      autoRev = await retarget(harness, auto.id, autoRev);
      autoRev = (
        await harness.persistence.transaction((tx) =>
          activatePromotion(tx, {
            actor,
            promotionId: auto.id,
            expectedPromotionRevision: autoRev,
          }),
        )
      ).revision;
      const autoInspect = await harness.persistence.withContext((ctx) =>
        inspectBrandPromotion(ctx, { actor, brandId, promotionId: auto.id }),
      );
      expect(autoInspect.promotion.status).toBe("active");
      expect(autoInspect.promotion.firstOrderOnly).toBe(true);
      expect(autoInspect.promotion.eligibleFulfilmentModes).toEqual(["DELIVERY"]);
      expect(autoInspect.promotion.eligibleFulfilmentTimings).toEqual(["ASAP"]);
      expect(autoInspect.promotion.maximumRedemptions).toBe(50);
      expect(autoInspect.promotion.maximumRedemptionsPerCustomer).toBe(2);
      expect(autoInspect.benefit?.benefitType).toBe("delivery_fee_waiver");
      expect(autoInspect.redemptionCounts).toEqual({
        reservedCount: 0,
        consumedCount: 0,
        releasedCount: 0,
        applicationCount: 0,
      });
      const inspectJson = JSON.stringify(autoInspect);
      expect(inspectJson).not.toMatch(/customerId|customer_id|first.order guard|claim row/i);

      const couponPromo = await createReadyDraftPromotion(harness, { triggerType: "coupon" });
      const couponActivatedPromo = await harness.persistence.transaction((tx) =>
        activatePromotion(tx, {
          actor,
          promotionId: couponPromo.id,
          expectedPromotionRevision: couponPromo.revision,
        }),
      );
      const coupon = await harness.persistence.transaction((tx) =>
        createCouponDraft(tx, {
          actor,
          promotionId: couponPromo.id,
          origin: "manual",
          canonicalCode: uniqueCode("C6"),
        }),
      );
      await harness.persistence.transaction((tx) =>
        activateCoupon(tx, {
          actor,
          couponId: coupon.id,
          expectedCouponRevision: coupon.revision,
        }),
      );
      expect(couponActivatedPromo.revision).toBeGreaterThan(couponPromo.revision);

      const historyBefore = await harness.persistence.withContext(async (ctx) => {
        const lines = await ctx.db.execute(
          sql`select count(*)::int as c from app.checkout_snapshot_lines`,
        );
        const orders = await ctx.db.execute(sql`select count(*)::int as c from app.orders`);
        return {
          lines: Number(lines.rows[0]?.c ?? 0),
          orders: Number(orders.rows[0]?.c ?? 0),
        };
      });
      const retired = await harness.persistence.transaction((tx) =>
        retirePromotion(tx, {
          actor,
          promotionId: auto.id,
          expectedPromotionRevision: autoRev,
        }),
      );
      expect(retired.revision).toBeGreaterThan(autoRev);
      const retiredInspect = await harness.persistence.withContext((ctx) =>
        inspectBrandPromotion(ctx, { actor, brandId, promotionId: auto.id }),
      );
      expect(retiredInspect.promotion.status).toBe("retired");
      const historyAfter = await harness.persistence.withContext(async (ctx) => {
        const lines = await ctx.db.execute(
          sql`select count(*)::int as c from app.checkout_snapshot_lines`,
        );
        const orders = await ctx.db.execute(sql`select count(*)::int as c from app.orders`);
        return {
          lines: Number(lines.rows[0]?.c ?? 0),
          orders: Number(orders.rows[0]?.c ?? 0),
        };
      });
      expect(historyAfter).toEqual(historyBefore);

      const giftDraft = await createReadyDraftPromotion(harness);
      const giftOk = await harness.persistence.transaction((tx) =>
        setPromotionBenefit(tx, {
          actor,
          promotionId: giftDraft.id,
          expectedPromotionRevision: giftDraft.revision,
          benefit: {
            ...emptyMoneyBenefit("complimentary_item"),
            complimentaryProductId: catalog.productId,
            complimentaryVariantId: catalog.variantId,
          },
        }),
      );
      const giftActive = await harness.persistence.transaction((tx) =>
        activatePromotion(tx, {
          actor,
          promotionId: giftDraft.id,
          expectedPromotionRevision: giftOk.revision,
        }),
      );
      expect(giftActive.revision).toBeGreaterThan(giftOk.revision);

      const incomplete = await createReadyDraftPromotion(harness);
      await expect(
        harness.persistence.transaction((tx) =>
          setPromotionBenefit(tx, {
            actor,
            promotionId: incomplete.id,
            expectedPromotionRevision: incomplete.revision,
            benefit: emptyMoneyBenefit("complimentary_item"),
          }),
        ),
      ).rejects.toMatchObject({
        code: "PROMOTION_COMPLIMENTARY_INVALID",
        message: COPY_OP_GIFT_INVALID,
        field: "complimentaryProductId",
      });
      const stillDraft = await harness.persistence.withContext((ctx) =>
        inspectBrandPromotion(ctx, { actor, brandId, promotionId: incomplete.id }),
      );
      expect(stillDraft.promotion.status).toBe("draft");

      const bundle = await seedActiveBundleWithComponent(
        harness.persistence,
        brandId,
        actor,
        { codePrefix: "t6b" },
      );
      await expect(
        harness.persistence.transaction((tx) =>
          setPromotionBenefit(tx, {
            actor,
            promotionId: incomplete.id,
            expectedPromotionRevision: stillDraft.promotion.revision,
            benefit: {
              ...emptyMoneyBenefit("complimentary_item"),
              complimentaryProductId: bundle.bundleProductId,
              complimentaryVariantId: bundle.bundleVariantId,
            },
          }),
        ),
      ).rejects.toMatchObject({
        code: "PROMOTION_COMPLIMENTARY_INVALID",
        message: COPY_OP_GIFT_INVALID,
      });

      const requiredChoice = await harness.persistence.transaction(async (tx) => {
        const product = await createProduct(tx, {
          actor,
          brandId,
          code: uniqueCode("req-p"),
          name: "Required choice",
          productKind: "standard",
        });
        const variant = await createVariant(tx, {
          actor,
          productId: product.id,
          code: "default",
          name: "Default",
          isDefault: true,
          isSelectorVisible: false,
        });
        const group = await createModifierGroup(tx, {
          actor,
          brandId,
          code: uniqueCode("req-g"),
          name: "Must pick",
        });
        const option = await createModifierOption(tx, {
          actor,
          brandId,
          code: uniqueCode("req-o"),
          name: "One",
        });
        const binding = await addModifierOptionToGroup(tx, {
          actor,
          modifierGroupId: group.id,
          modifierOptionId: option.id,
          minQuantity: 1,
          maxQuantity: 1,
          defaultQuantity: 1,
        });
        const vmg = await applyModifierGroupToVariant(tx, {
          actor,
          variantId: variant.id,
          modifierGroupId: group.id,
          minTotalQuantity: 1,
          maxTotalQuantity: 1,
        });
        await activateModifierOption(tx, { actor, modifierOptionId: option.id });
        await activateModifierGroupOption(tx, {
          actor,
          modifierGroupOptionId: binding.id,
        });
        await activateModifierGroup(tx, { actor, modifierGroupId: group.id });
        await activateVariantModifierGroup(tx, {
          actor,
          variantModifierGroupId: vmg.id,
        });
        await activateVariant(tx, { actor, variantId: variant.id });
        await activateProduct(tx, { actor, productId: product.id });
        return { productId: product.id, variantId: variant.id };
      });
      await expect(
        harness.persistence.transaction((tx) =>
          setPromotionBenefit(tx, {
            actor,
            promotionId: incomplete.id,
            expectedPromotionRevision: stillDraft.promotion.revision,
            benefit: {
              ...emptyMoneyBenefit("complimentary_item"),
              complimentaryProductId: requiredChoice.productId,
              complimentaryVariantId: requiredChoice.variantId,
            },
          }),
        ),
      ).rejects.toMatchObject({
        code: "PROMOTION_COMPLIMENTARY_INVALID",
        message: COPY_OP_GIFT_INVALID,
      });

      const paidMod = await seedActiveVariantWithModifier(
        harness.persistence,
        brandId,
        actor,
        "t6p",
      );
      await harness.persistence.transaction(async (tx) => {
        const book = await createDraftPriceBook(tx, {
          actor,
          brandId,
          scopeType: "brand",
          code: uniqueCode("pb"),
          name: "T6 paid mod",
          effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        });
        await attachDraftModifierPrice(tx, {
          actor,
          brandId,
          priceBookId: book.id,
          variantModifierGroupId: paidMod.variantModifierGroupId,
          modifierGroupOptionId: paidMod.modifierGroupOptionId,
          priceDeltaPaise: BigInt(500),
          expectedPriceBookRevision: book.revision,
        });
      });
      await expect(
        harness.persistence.transaction((tx) =>
          setPromotionBenefit(tx, {
            actor,
            promotionId: incomplete.id,
            expectedPromotionRevision: stillDraft.promotion.revision,
            benefit: {
              ...emptyMoneyBenefit("complimentary_item"),
              complimentaryProductId: paidMod.productId,
              complimentaryVariantId: paidMod.variantId,
            },
          }),
        ),
      ).rejects.toMatchObject({
        code: "PROMOTION_COMPLIMENTARY_INVALID",
        message: COPY_OP_GIFT_INVALID,
      });

      const secondGift = await createReadyDraftPromotion(harness);
      const secondGiftBenefit = await harness.persistence.transaction((tx) =>
        setPromotionBenefit(tx, {
          actor,
          promotionId: secondGift.id,
          expectedPromotionRevision: secondGift.revision,
          benefit: {
            ...emptyMoneyBenefit("complimentary_item"),
            complimentaryProductId: catalog.productId,
            complimentaryVariantId: catalog.variantId,
          },
        }),
      );
      await expect(
        harness.persistence.transaction((tx) =>
          activatePromotion(tx, {
            actor,
            promotionId: secondGift.id,
            expectedPromotionRevision: secondGiftBenefit.revision,
          }),
        ),
      ).rejects.toMatchObject({
        code: "PROMOTION_COMPLIMENTARY_ACTIVE_CONFLICT",
        message: COPY_OP_SECOND,
      });
      const existingStill = await harness.persistence.withContext((ctx) =>
        inspectBrandPromotion(ctx, { actor, brandId, promotionId: giftDraft.id }),
      );
      expect(existingStill.promotion.status).toBe("active");
      const activeCount = await harness.persistence.withContext(async (ctx) => {
        const rows = await ctx.db
          .select({ id: promotionsTable.id })
          .from(promotionsTable)
          .where(eq(promotionsTable.status, "active"));
        return rows.filter((row) => row.id === giftDraft.id || row.id === secondGift.id).length;
      });
      expect(activeCount).toBe(1);
      const secondStillDraft = await harness.persistence.withContext((ctx) =>
        inspectBrandPromotion(ctx, { actor, brandId, promotionId: secondGift.id }),
      );
      expect(secondStillDraft.promotion.status).toBe("draft");

      await harness.persistence.transaction((tx) =>
        retirePromotion(tx, {
          actor,
          promotionId: giftDraft.id,
          expectedPromotionRevision: existingStill.promotion.revision,
        }),
      );

      const raceACatalog = catalog;
      const raceBCatalog = await seedActiveStandardVariant(
        harness.persistence,
        brandId,
        actor,
        "t6r",
      );
      const raceA = await createReadyDraftPromotion(harness);
      const raceB = await createReadyDraftPromotion(harness);
      const raceARev = (
        await harness.persistence.transaction((tx) =>
          setPromotionBenefit(tx, {
            actor,
            promotionId: raceA.id,
            expectedPromotionRevision: raceA.revision,
            benefit: {
              ...emptyMoneyBenefit("complimentary_item"),
              complimentaryProductId: raceACatalog.productId,
              complimentaryVariantId: raceACatalog.variantId,
            },
          }),
        )
      ).revision;
      const raceBRev = (
        await harness.persistence.transaction((tx) =>
          setPromotionBenefit(tx, {
            actor,
            promotionId: raceB.id,
            expectedPromotionRevision: raceB.revision,
            benefit: {
              ...emptyMoneyBenefit("complimentary_item"),
              complimentaryProductId: raceBCatalog.productId,
              complimentaryVariantId: raceBCatalog.variantId,
            },
          }),
        )
      ).revision;

      const persistenceA = openTrackedApplicationPersistence(database.connectionString);
      const persistenceB = openTrackedApplicationPersistence(database.connectionString);
      let arrived = 0;
      let release!: () => void;
      const bothHeld = new Promise<void>((resolve) => {
        release = resolve;
      });
      const waitPeer = async () => {
        arrived += 1;
        if (arrived === 2) release();
        await bothHeld;
      };
      const overlapping = await Promise.allSettled([
        persistenceA.transaction((tx) =>
          activatePromotion(tx, {
            actor,
            promotionId: raceA.id,
            expectedPromotionRevision: raceARev,
            afterAuthoringLocksHeld: waitPeer,
          }),
        ),
        persistenceB.transaction((tx) =>
          activatePromotion(tx, {
            actor,
            promotionId: raceB.id,
            expectedPromotionRevision: raceBRev,
            afterAuthoringLocksHeld: waitPeer,
          }),
        ),
      ]);
      const wins = overlapping.filter((r) => r.status === "fulfilled");
      const losses = overlapping.filter((r) => r.status === "rejected");
      expect(wins.length).toBe(1);
      expect(losses.length).toBe(1);
      const loss = losses[0] as PromiseRejectedResult;
      expect(loss.reason).toBeInstanceOf(PromotionAdminError);
      expect(loss.reason).toMatchObject({
        code: "PROMOTION_COMPLIMENTARY_ACTIVATION_RACE",
        message: COPY_OP_RACE,
      });
      const raced = await harness.persistence.withContext(async (ctx) => {
        const rows = await ctx.db
          .select({
            id: promotionsTable.id,
            status: promotionsTable.status,
          })
          .from(promotionsTable)
          .where(eq(promotionsTable.complimentaryItem, true));
        return rows.filter((row) => row.status === "active");
      });
      expect(raced.length).toBe(1);
      const audits = await harness.persistence.withContext(async (ctx) => {
        const result = await ctx.db.execute(sql`
          select resource_id, action
          from app.promotion_audit_events
          where action = 'promotion.activated'
            and resource_id in (${raceA.id}::uuid, ${raceB.id}::uuid)
        `);
        return result.rows as Array<{ resource_id: string; action: string }>;
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]?.resource_id).toBe(raced[0]?.id);
      await persistenceA.close();
      await persistenceB.close();

      await expect(
        harness.persistence.transaction((tx) =>
          updatePromotionDraft(tx, {
            actor,
            promotionId: incomplete.id,
            expectedPromotionRevision: BigInt(1),
            displayName: "stale",
          }),
        ),
      ).rejects.toMatchObject({ code: "PROMOTION_STALE_REVISION" });

      const kitchen = await createEligibleWorkforceUser(harness.persistence);
      await harness.persistence.transaction(async (tx) => {
        const membership = await createMembership(tx, {
          workforceUserId: kitchen.id,
          scope: {
            scopeType: "outlet",
            brandId,
            organizationId: harness.tree.orgA.id,
            territoryId: harness.tree.terrA.id,
            outletId: harness.tree.outletA.id,
          },
          status: "active",
        });
        await grantRole(tx, { membershipId: membership.id, roleKey: "kitchen_operator" });
      });
      const kitchenActor = principalFor(kitchen.id);
      const deniedDraft = await createReadyDraftPromotion(harness);
      await expect(
        harness.persistence.transaction((tx) =>
          activatePromotion(tx, {
            actor: kitchenActor,
            promotionId: deniedDraft.id,
            expectedPromotionRevision: deniedDraft.revision,
          }),
        ),
      ).rejects.toBeTruthy();
      const unchanged = await harness.persistence.withContext((ctx) =>
        inspectBrandPromotion(ctx, { actor, brandId, promotionId: deniedDraft.id }),
      );
      expect(unchanged.promotion.status).toBe("draft");
      expect(unchanged.promotion.revision).toBe(deniedDraft.revision.toString(10));

      const otherTree = await harness.persistence.transaction((tx) => seedBrandTree(tx, "t6x"));
      const otherAdmin = await createEligibleWorkforceUser(harness.persistence);
      await harness.persistence.transaction(async (tx) => {
        const membership = await createMembership(tx, {
          workforceUserId: otherAdmin.id,
          scope: { scopeType: "brand", brandId: otherTree.brand.id },
          status: "active",
        });
        await grantRole(tx, { membershipId: membership.id, roleKey: "brand_admin" });
      });
      await expect(
        harness.persistence.transaction((tx) =>
          activatePromotion(tx, {
            actor: principalFor(otherAdmin.id),
            brandId: otherTree.brand.id,
            promotionId: deniedDraft.id,
            expectedPromotionRevision: deniedDraft.revision,
          }),
        ),
      ).rejects.toBeTruthy();
      const stillUnchanged = await harness.persistence.withContext((ctx) =>
        inspectBrandPromotion(ctx, { actor, brandId, promotionId: deniedDraft.id }),
      );
      expect(stillUnchanged.promotion.status).toBe("draft");

      const editorSrc = readFileSync(
        path.join(process.cwd(), "src/components/administration/commercial/PromotionsEditor.tsx"),
        "utf8",
      );
      expect(editorSrc).not.toMatch(/evaluateCart|evaluateCheckout|payablePaise/);
      expect(editorSrc).not.toMatch(/gift catalogue|gift picker|gift pool/i);
      const cartSrc = readFileSync(
        path.join(process.cwd(), "src/components/ordering/CartClient.tsx"),
        "utf8",
      );
      expect(cartSrc).not.toContain("COPY_OP_");
      await Promise.all(openHandles.map((handle) => handle.close()));
    });
  });

  it("rejects client-supplied role on activate and writes nothing", async () => {
    await withIsolatedTestDatabase(adminConnectionInfo(), async (database) => {
      await applyMigrations(database.connectionString);
      const openHandles: Array<{ close(): Promise<void> }> = [];
      const harness = await seedPromotionsHarness(database.connectionString, openHandles);
      const draft = await createReadyDraftPromotion(harness);
      const workforce = loadAuthFoundationConfig(
        {
          CUSTOMER_AUTH_SECRET: "t6-customer-auth-secret-32charsxxx",
          CUSTOMER_AUTH_BASE_URL: "http://localhost:3100",
          WORKFORCE_AUTH_SECRET: "t6-workforce-auth-secret-32charsx",
          WORKFORCE_AUTH_BASE_URL: "http://localhost:3200",
        },
        "test",
      ).workforce;
      const runtime = getWorkforceAuthRuntime({
        auth: workforce,
        persistence: applicationConfig(database.connectionString),
      });
      const auth = await runtime.getAuth();
      const adapter = ((await auth.$context) as { internalAdapter: { createSession: (id: string) => Promise<{ token: string }> } })
        .internalAdapter;
      const server = createServer((req, res) => {
        void routeOperationsRequest(
          req,
          res,
          {
            runtime,
            persistence: harness.persistence,
            trustedOrigin: workforce.baseURL.origin,
            stepUpSessionHashSecret: workforce.secret,
          },
          "t6-promotions-http",
        );
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no addr");
      const base = `http://127.0.0.1:${address.port}`;
      const session = await adapter.createSession(harness.brandAdmin.id);
      const cookie = (
        await serializeSignedCookie(
          WORKFORCE_AUTH_SESSION_COOKIE_NAME,
          session.token,
          workforce.secret,
        )
      ).split(";", 1)[0]!;
      const res = await fetch(
        `${base}/api/admin/v1/brands/${harness.tree.brand.id}/promotions/${draft.id}/activate`,
        {
          method: "POST",
          headers: {
            cookie,
            origin: workforce.baseURL.origin,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            expectedPromotionRevision: draft.revision.toString(10),
            role: "brand_admin",
            roles: ["platform_super_admin"],
          }),
        },
      );
      expect(res.status).toBeGreaterThanOrEqual(400);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(false);
      const after = await harness.persistence.withContext((ctx) =>
        inspectBrandPromotion(ctx, {
          actor: harness.brandAdminPrincipal,
          brandId: harness.tree.brand.id,
          promotionId: draft.id,
        }),
      );
      expect(after.promotion.status).toBe("draft");
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      await runtime.close();
      await Promise.all(openHandles.map((handle) => handle.close()));
    });
  });
});
