/**
 * IMP-036J Tranche 5 — CUSTOMER_PRESENTATION named proof (observation + sealed truth).
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { applyCartCoupon, evaluateCart } from "../../src/server/cart";
import { evaluateCheckout } from "../../src/server/checkout";
import { persistCommerceObservation } from "../../src/server/customer-commerce/measurement/observe-presentation";
import { CartError } from "../../src/shared/cart";
import { retirePromotion } from "../../src/server/promotions";
import { TEST_INSIDE_COORDS } from "./support/serviceability-fixtures";
import { seedRecognizedCoupon, uniqueCode } from "./support/cart-fixtures";
import {
  bringCheckoutToReady,
  CHECKOUT_POLICY,
  closeTrackedPersistenceHandles,
  FIXED_NOW,
  withCheckoutReadyHarness,
} from "./support/payment-fixtures";

afterEach(async () => {
  await closeTrackedPersistenceHandles();
});

const checkoutOpts = {
  clock: { now: () => new Date(FIXED_NOW.getTime()) },
  policy: CHECKOUT_POLICY,
};

const loc = { location: { coordinates: TEST_INSIDE_COORDS } };

async function loadExpected(persistence: Parameters<typeof evaluateCart>[0], evaluationId: string) {
  return persistence.withContext(async (ctx) => {
    const r = await ctx.db.execute(sql`
      select
        expected_components,
        expected_coarse_shape,
        expected_total_saved_paise::text as saved,
        expected_progress_present,
        expected_progress_remaining_paise::text as remaining
      from app.commercial_evaluations
      where evaluation_id = ${evaluationId}::uuid
    `);
    return r.rows[0] as {
      expected_components: readonly Record<string, unknown>[];
      expected_coarse_shape: string;
      saved: string;
      expected_progress_present: boolean;
      remaining: string | null;
    };
  });
}

function componentsFromExpected(rows: readonly Record<string, unknown>[]) {
  return rows.map((row) => ({
    kind: String(row.kind),
    present: row.present === true,
    amountPaise: String(row.amountPaise ?? "0"),
  }));
}

describe("IMP-036J Tranche 5 customer presentation observation", () => {
  it("posts Cart and Review observations, rejects prohibited fields, and retries idempotently", async () => {
    await withCheckoutReadyHarness(async (h) => {
      const access = {
        kind: "customer" as const,
        actor: h.actors.customerA,
        brandId: h.actors.tree.brand.id,
      };
      const cartEval = await evaluateCart(h.persistence, access, loc);
      expect(cartEval.status).toBe("COMPLETE");
      expect(cartEval.evaluationId).toBeTruthy();
      const evaluationId = cartEval.evaluationId!;
      const stored = await loadExpected(h.persistence, evaluationId);
      const body = {
        evaluationId,
        components: componentsFromExpected(stored.expected_components),
        progressPresent: stored.expected_progress_present,
        progressRemainingPaise: stored.expected_progress_present ? stored.remaining : null,
        observedCoarseShape: stored.expected_coarse_shape,
        observedComplimentaryPresent: false,
        observedComplimentaryLineSha256: null,
      };

      const first = await persistCommerceObservation(h.persistence, access, body);
      expect(first.surface).toBe("CART");
      expect(first.reusedExisting).toBe(false);

      const retry = await persistCommerceObservation(h.persistence, access, body);
      expect(retry.reusedExisting).toBe(true);

      const count = async () =>
        h.persistence.withContext(async (ctx) => {
          const r = await ctx.db.execute(sql`
            select count(*)::text as c
            from app.commercial_presentation_observations
            where evaluation_id = ${evaluationId}::uuid
          `);
          return Number(r.rows[0]?.c ?? "0");
        });
      expect(await count()).toBe(1);

      const prohibited = [
        { surface: "CART" },
        { integrityPass: true },
        { expectedDescriptor: { total: "1" } },
        { couponCode: "SAVE10" },
        { complimentaryVariantId: randomUUID() },
        { itemLine: "Taro Milk Tea" },
        { clientTimestamp: "2026-01-01T00:00:00.000Z" },
        { paymentSecret: "rzp_live_secret" },
      ];
      for (const extra of prohibited) {
        await expect(
          persistCommerceObservation(h.persistence, access, { ...body, ...extra }),
        ).rejects.toBeInstanceOf(CartError);
      }
      expect(await count()).toBe(1);

      const ready = await bringCheckoutToReady(
        h.persistence,
        h.actors.customerA,
        h.cartId,
        h.addressId,
      );
      const reviewed = await evaluateCheckout(
        h.persistence,
        h.actors.customerA,
        {
          checkoutId: ready.checkoutId,
          expectedCheckoutRevision: ready.revision,
        },
        checkoutOpts,
      );
      expect(reviewed.evaluationId).toBeTruthy();
      const reviewStored = await loadExpected(h.persistence, reviewed.evaluationId!);
      const review = await persistCommerceObservation(h.persistence, access, {
        evaluationId: reviewed.evaluationId!,
        reviewSurfaceToken: reviewed.reviewSurfaceToken,
        components: componentsFromExpected(reviewStored.expected_components),
        progressPresent: reviewStored.expected_progress_present,
        progressRemainingPaise: reviewStored.expected_progress_present
          ? reviewStored.remaining
          : null,
        observedCoarseShape: reviewStored.expected_coarse_shape,
        observedComplimentaryPresent: false,
        observedComplimentaryLineSha256: null,
      });
      expect(review.surface).toBe("CHECKOUT_REVIEW");
    });
  });

  it("records server mismatch flags without changing payable", async () => {
    await withCheckoutReadyHarness(async (h) => {
      const access = {
        kind: "customer" as const,
        actor: h.actors.customerA,
        brandId: h.actors.tree.brand.id,
      };
      const coupon = await seedRecognizedCoupon(
        h.persistence,
        h.actors.tree.brand.id,
        h.actors.brandAdminActor,
        uniqueCode("T5"),
      );
      const cart = await evaluateCart(h.persistence, access, loc);
      await applyCartCoupon(h.persistence, access, {
        couponCode: coupon.canonicalCode,
        expectedRevision: cart.cartRevision,
        sourceCommandId: randomUUID(),
      });
      const after = await evaluateCart(h.persistence, access, loc);
      expect(after.evaluationId).toBeTruthy();
      const payableBefore = String(
        (after.quote as { grandTotalPaise?: bigint } | undefined)?.grandTotalPaise ?? "",
      );
      const stored = await loadExpected(h.persistence, after.evaluationId!);
      const mutated = componentsFromExpected(stored.expected_components).map((row) => {
        if (row.kind === "ORDER_SAVING") return { ...row, present: true, amountPaise: "800" };
        if (row.kind === "TOTAL_SAVED") return { ...row, present: true, amountPaise: "4000" };
        if (row.kind === "DELIVERY_SAVING") return { ...row, present: true, amountPaise: "8000" };
        return row;
      });
      const observed = await persistCommerceObservation(h.persistence, access, {
        evaluationId: after.evaluationId!,
        components: mutated,
        progressPresent: stored.expected_progress_present,
        progressRemainingPaise: stored.expected_progress_present ? stored.remaining : null,
        observedCoarseShape: stored.expected_coarse_shape,
        observedComplimentaryPresent: false,
        observedComplimentaryLineSha256: null,
      });
      expect(observed.serverPresentationMatch).toBe(false);
      expect(observed.mismatchFlags.length).toBeGreaterThan(0);
      const payableAfter = await evaluateCart(h.persistence, access, loc);
      expect(String((payableAfter.quote as { grandTotalPaise?: bigint }).grandTotalPaise)).toBe(
        payableBefore,
      );
    });
  });

  it("keeps sealed purchased snapshot totals after a live Promotion is retired", async () => {
    await withCheckoutReadyHarness(async (h) => {
      const ready = await bringCheckoutToReady(
        h.persistence,
        h.actors.customerA,
        h.cartId,
        h.addressId,
      );
      const before = await h.persistence.withContext(async (ctx) => {
        const r = await ctx.db.execute(sql`
          select grand_total_paise::text as grand, promotion_discount_paise::text as saved
          from app.checkout_snapshots
          where id = ${ready.snapshotId}::uuid
        `);
        return r.rows[0] as { grand: string; saved: string };
      });
      const promotions = await h.persistence.withContext(async (ctx) => {
        const r = await ctx.db.execute(sql`
          select distinct promotion_id::text as id
          from app.checkout_snapshot_promotion_effects
          where snapshot_id = ${ready.snapshotId}::uuid
        `);
        return r.rows.map((row) => row.id as string);
      });
      for (const promotionId of promotions) {
        const revision = await h.persistence.withContext(async (ctx) => {
          const r = await ctx.db.execute(sql`
            select revision::text as revision
            from app.promotions
            where id = ${promotionId}::uuid
          `);
          return BigInt(String(r.rows[0]?.revision ?? "0"));
        });
        await h.persistence.transaction(async (tx) => {
          await retirePromotion(tx, {
            actor: h.actors.brandAdminActor,
            promotionId,
            expectedPromotionRevision: revision,
          });
        });
      }
      const after = await h.persistence.withContext(async (ctx) => {
        const r = await ctx.db.execute(sql`
          select grand_total_paise::text as grand, promotion_discount_paise::text as saved
          from app.checkout_snapshots
          where id = ${ready.snapshotId}::uuid
        `);
        return r.rows[0] as { grand: string; saved: string };
      });
      expect(after).toEqual(before);
    });
  });
});
