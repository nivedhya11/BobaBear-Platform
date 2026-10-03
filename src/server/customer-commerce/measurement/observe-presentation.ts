/**
 * IMP-036J Tranche 5 — committed presentation observation write.
 * Does not set price, revision, or payable.
 */
import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { cartsTable } from "../../../platform/database/schema/cart";
import { checkoutsTable } from "../../../platform/database/schema/checkout";
import {
  cartCheckoutActivationsTable,
  checkoutJourneyFactsTable,
  checkoutReviewSurfaceTokensTable,
  commercialEvaluationsTable,
  commercialPresentationObservationsTable,
  offerResultViewsTable,
} from "../../../platform/database/schema/measurement";
import { CartError } from "../../../shared/cart";
import { assertUuid } from "../../../shared/cart";
import { CHECKOUT_NON_TERMINAL_STATUSES } from "../../../shared/checkout";
import { guestVerifiersEqual, hashGuestToken } from "../../cart/guest-credential";
import { isUniqueViolation } from "../../checkout/assert-role";
import type { CartAccess } from "../../cart";
import type { Persistence } from "../../persistence/types";
import {
  compareCommercialPresentation,
  OBSERVED_COMPONENT_KINDS,
  type ObservedComponent,
  type ObservedComponentKind,
  type PresentationSurface,
} from "./compare-presentation";
import {
  allocateJourneyFact,
  derivePresentationClass,
  findCommandResult,
  sha256Utf8,
  type CoarseShape,
} from "./writers";

const OBSERVATION_SHAPES = new Set([
  "NONE",
  "AUTOMATIC_SAVING",
  "ORDER_SAVING",
  "DELIVERY_SAVING",
  "BOTH_SAVINGS",
  "COMPLIMENTARY_LINE",
  "COUPON_SELECTED",
  "COUPON_VALID_NOT_SELECTED",
  "EQUAL_PAYABLE_SELECTED",
  "EQUAL_PAYABLE_NOT_SELECTED",
  "THRESHOLD_PROGRESS",
]);

export const COMMERCE_OBSERVATION_FIELDS = [
  "evaluationId",
  "reviewSurfaceToken",
  "components",
  "progressPresent",
  "progressRemainingPaise",
  "observedCoarseShape",
  "observedComplimentaryPresent",
  "observedComplimentaryLineSha256",
  "sourceCommandId",
  "cartActivationId",
] as const;

export const CART_CHECKOUT_ACTIVATION_FIELDS = ["brandId", "activationId"] as const;

function bytesToHex(value: Uint8Array | Buffer | null | undefined): string | null {
  if (!value) return null;
  return Buffer.from(value).toString("hex");
}

function parseHexSha256(value: unknown): Uint8Array | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new CartError("CART_INVALID_INPUT", "Invalid complimentary digest.", {
      field: "observedComplimentaryLineSha256",
    });
  }
  return new Uint8Array(Buffer.from(value, "hex"));
}

function parseComponent(raw: unknown): ObservedComponent {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new CartError("CART_INVALID_INPUT", "Invalid observation component.", {
      field: "components",
    });
  }
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind;
  if (
    typeof kind !== "string" ||
    !OBSERVED_COMPONENT_KINDS.includes(kind as ObservedComponentKind)
  ) {
    throw new CartError("CART_INVALID_INPUT", "Invalid observation component kind.", {
      field: "components",
    });
  }
  if (typeof obj.present !== "boolean") {
    throw new CartError("CART_INVALID_INPUT", "Invalid observation component presence.", {
      field: "components",
    });
  }
  if (typeof obj.amountPaise !== "string" || !/^-?\d+$/.test(obj.amountPaise)) {
    throw new CartError("CART_INVALID_INPUT", "Invalid observation component amount.", {
      field: "components",
    });
  }
  return Object.freeze({
    kind: kind as ObservedComponentKind,
    present: obj.present,
    amountPaise: obj.amountPaise,
  });
}

function expectedComponentsFromJson(raw: unknown): ObservedComponent[] {
  if (!Array.isArray(raw)) return [];
  const rows: ObservedComponent[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const kind = obj.kind;
    if (
      typeof kind !== "string" ||
      !OBSERVED_COMPONENT_KINDS.includes(kind as ObservedComponentKind)
    ) {
      continue;
    }
    const present = obj.present === true;
    const amountPaise =
      typeof obj.amountPaise === "string"
        ? obj.amountPaise
        : typeof obj.amountPaise === "number"
          ? String(obj.amountPaise)
          : "0";
    rows.push({ kind: kind as ObservedComponentKind, present, amountPaise });
  }
  return rows;
}

function denyNotFound(): never {
  throw new CartError("CART_NOT_FOUND", "Cart not found.");
}

function authorizeCartRow(
  access: CartAccess,
  row: typeof cartsTable.$inferSelect,
): void {
  if (access.kind === "customer") {
    if (row.customerAuthUserId !== access.actor.authUserId) denyNotFound();
    return;
  }
  if (!row.guestCredentialVerifier || !access.guestToken) denyNotFound();
  if (!guestVerifiersEqual(row.guestCredentialVerifier, access.guestToken)) {
    denyNotFound();
  }
}

export async function recordCartCheckoutActivationForAccess(
  persistence: Persistence,
  access: CartAccess,
  activationId: string,
): Promise<void> {
  assertUuid(activationId, "activationId");
  const cart = await persistence.withContext(async (ctx) => {
    if (access.kind === "customer") {
      const rows = await ctx.db
        .select()
        .from(cartsTable)
        .where(
          and(
            eq(cartsTable.brandId, access.brandId),
            eq(cartsTable.customerAuthUserId, access.actor.authUserId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    }
    if (!access.guestToken) denyNotFound();
    const verifier = hashGuestToken(access.guestToken);
    const rows = await ctx.db
      .select()
      .from(cartsTable)
      .where(
        and(
          eq(cartsTable.brandId, access.brandId),
          eq(cartsTable.guestCredentialVerifier, verifier),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  });
  if (!cart) denyNotFound();
  const { recordCartCheckoutActivation } = await import("./writers");
  await persistence.transaction(async (tx) => {
    await recordCartCheckoutActivation({
      context: tx,
      activationId,
      cartId: cart.id,
    });
  });
}

export async function persistCommerceObservation(
  persistence: Persistence,
  access: CartAccess,
  body: Readonly<Record<string, unknown>>,
): Promise<Readonly<{
  evaluationId: string;
  surface: PresentationSurface;
  serverPresentationMatch: boolean | null;
  mismatchFlags: readonly string[];
  reusedExisting: boolean;
}>> {
  const prohibited = [
    "surface",
    "integrityPass",
    "serverPresentationMatch",
    "mismatchFlags",
    "expectedComponents",
    "expectedDescriptor",
    "expectedCoarseShape",
    "couponCode",
    "coupon",
    "complimentaryVariantId",
    "complimentaryLine",
    "plaintextComplimentaryLine",
    "itemLine",
    "occurredAt",
    "clientTimestamp",
    "timestamp",
    "paymentSecret",
    "eligibilityReason",
    "presentationClass",
  ] as const;
  for (const key of Object.keys(body)) {
    if (
      prohibited.includes(key as (typeof prohibited)[number]) ||
      !COMMERCE_OBSERVATION_FIELDS.includes(
        key as (typeof COMMERCE_OBSERVATION_FIELDS)[number],
      )
    ) {
      throw new CartError("CART_INVALID_INPUT", "Observation field is not allowed.", {
        field: key,
      });
    }
  }
  const evaluationId =
    typeof body.evaluationId === "string" ? body.evaluationId : "";
  assertUuid(evaluationId, "evaluationId");
  const progressPresent = body.progressPresent;
  if (typeof progressPresent !== "boolean") {
    throw new CartError("CART_INVALID_INPUT", "progressPresent is required.", {
      field: "progressPresent",
    });
  }
  const observedComplimentaryPresent = body.observedComplimentaryPresent;
  if (typeof observedComplimentaryPresent !== "boolean") {
    throw new CartError(
      "CART_INVALID_INPUT",
      "observedComplimentaryPresent is required.",
      { field: "observedComplimentaryPresent" },
    );
  }
  const observedCoarseShape = body.observedCoarseShape;
  if (
    typeof observedCoarseShape !== "string" ||
    !OBSERVATION_SHAPES.has(observedCoarseShape)
  ) {
    throw new CartError("CART_INVALID_INPUT", "Invalid observed coarse shape.", {
      field: "observedCoarseShape",
    });
  }
  if (!Array.isArray(body.components)) {
    throw new CartError("CART_INVALID_INPUT", "components must be an array.", {
      field: "components",
    });
  }
  const components = Object.freeze(body.components.map(parseComponent));
  const progressRemainingPaise =
    body.progressRemainingPaise === null || body.progressRemainingPaise === undefined
      ? null
      : typeof body.progressRemainingPaise === "string" &&
          /^\d+$/.test(body.progressRemainingPaise)
        ? body.progressRemainingPaise
        : (() => {
            throw new CartError("CART_INVALID_INPUT", "Invalid progress remaining.", {
              field: "progressRemainingPaise",
            });
          })();
  if (progressPresent === true && progressRemainingPaise === null) {
    throw new CartError("CART_INVALID_INPUT", "Progress remaining required.", {
      field: "progressRemainingPaise",
    });
  }
  if (progressPresent === false && progressRemainingPaise !== null) {
    throw new CartError("CART_INVALID_INPUT", "Progress remaining must be empty.", {
      field: "progressRemainingPaise",
    });
  }
  const complimentaryBytes = parseHexSha256(body.observedComplimentaryLineSha256 ?? null);
  if (observedComplimentaryPresent === true && !complimentaryBytes) {
    throw new CartError("CART_INVALID_INPUT", "Complimentary digest required.", {
      field: "observedComplimentaryLineSha256",
    });
  }
  if (observedComplimentaryPresent === false && complimentaryBytes) {
    throw new CartError("CART_INVALID_INPUT", "Complimentary digest must be empty.", {
      field: "observedComplimentaryLineSha256",
    });
  }
  const reviewSurfaceToken =
    body.reviewSurfaceToken === null || body.reviewSurfaceToken === undefined
      ? null
      : typeof body.reviewSurfaceToken === "string" && body.reviewSurfaceToken.length > 0
        ? body.reviewSurfaceToken
        : (() => {
            throw new CartError("CART_INVALID_INPUT", "Invalid review surface token.", {
              field: "reviewSurfaceToken",
            });
          })();
  const sourceCommandId =
    body.sourceCommandId === null || body.sourceCommandId === undefined
      ? null
      : (assertUuid(String(body.sourceCommandId), "sourceCommandId"),
        String(body.sourceCommandId));
  const cartActivationId =
    body.cartActivationId === null || body.cartActivationId === undefined
      ? null
      : (assertUuid(String(body.cartActivationId), "cartActivationId"),
        String(body.cartActivationId));

  return persistence.transaction(async (tx) => {
    const evaluationRows = await tx.db
      .select()
      .from(commercialEvaluationsTable)
      .where(eq(commercialEvaluationsTable.evaluationId, evaluationId))
      .limit(1)
      .for("update");
    const evaluation = evaluationRows[0];
    if (!evaluation) denyNotFound();

    const cartRow = await tx.db
      .select()
      .from(cartsTable)
      .where(eq(cartsTable.id, evaluation.cartId))
      .limit(1)
      .for("update");
    if (!cartRow[0]) denyNotFound();
    authorizeCartRow(access, cartRow[0]);

    if (sourceCommandId) {
      const command = await findCommandResult(tx, sourceCommandId);
      if (!command || command.cartId !== evaluation.cartId) denyNotFound();
    }

    let surface: PresentationSurface = "CART";
    if (reviewSurfaceToken) {
      const digest = sha256Utf8(reviewSurfaceToken);
      const tokenRows = await tx.db
        .select()
        .from(checkoutReviewSurfaceTokensTable)
        .where(eq(checkoutReviewSurfaceTokensTable.tokenSha256, digest))
        .limit(1);
      const token = tokenRows[0];
      if (!token || token.cartId !== evaluation.cartId) {
        throw new CartError("CART_INVALID_INPUT", "Invalid review surface token.", {
          field: "reviewSurfaceToken",
        });
      }
      const checkoutRows = await tx.db
        .select()
        .from(checkoutsTable)
        .where(eq(checkoutsTable.id, token.checkoutId))
        .limit(1)
        .for("update");
      const checkout = checkoutRows[0];
      if (
        !checkout ||
        checkout.cartId !== evaluation.cartId ||
        !CHECKOUT_NON_TERMINAL_STATUSES.includes(
          checkout.status as (typeof CHECKOUT_NON_TERMINAL_STATUSES)[number],
        ) ||
        evaluation.checkoutId !== checkout.id
      ) {
        throw new CartError("CART_INVALID_INPUT", "Invalid review surface token.", {
          field: "reviewSurfaceToken",
        });
      }
      surface = "CHECKOUT_REVIEW";
    }

    if (evaluation.surfaceScope === "CART" && surface === "CHECKOUT_REVIEW") {
      throw new CartError("CART_INVALID_INPUT", "Invalid review surface token.", {
        field: "reviewSurfaceToken",
      });
    }

    const existingObservation = await tx.db
      .select()
      .from(commercialPresentationObservationsTable)
      .where(
        and(
          eq(commercialPresentationObservationsTable.evaluationId, evaluationId),
          eq(commercialPresentationObservationsTable.surface, surface),
        ),
      )
      .limit(1);
    const comparison = compareCommercialPresentation({
      surface,
      expected: {
        surfaceScope: evaluation.surfaceScope as "CART" | "CHECKOUT",
        expectedComponents: expectedComponentsFromJson(evaluation.expectedComponents),
        expectedTotalSavedPaise: evaluation.expectedTotalSavedPaise.toString(),
        expectedProgressPresent: evaluation.expectedProgressPresent,
        expectedProgressRemainingPaise:
          evaluation.expectedProgressRemainingPaise?.toString() ?? null,
        expectedCoarseShape: evaluation.expectedCoarseShape,
        projectedComplimentaryLineSha256Hex: bytesToHex(
          evaluation.projectedComplimentaryLineSha256,
        ),
        expectedComplimentaryPresent: evaluation.projectedComplimentaryLineSha256 != null,
        serverExplanationIntegrity: evaluation.serverExplanationIntegrity,
      },
      observed: {
        components,
        progressPresent,
        progressRemainingPaise,
        observedCoarseShape,
        observedComplimentaryPresent,
        observedComplimentaryLineSha256Hex: complimentaryBytes
          ? Buffer.from(complimentaryBytes).toString("hex")
          : null,
      },
    });

    let reusedExisting = false;
    if (existingObservation[0]) {
      reusedExisting = true;
    } else {
      try {
        await tx.db.insert(commercialPresentationObservationsTable).values({
          evaluationId,
          surface,
          observedComponents: components,
          observedProgressPresent: progressPresent,
          observedProgressRemainingPaise: progressRemainingPaise
            ? BigInt(progressRemainingPaise)
            : null,
          observedCoarseShape,
          observedComplimentaryPresent,
          observedComplimentaryLineSha256: complimentaryBytes,
          serverPresentationMatch: comparison.serverPresentationMatch,
          mismatchFlags: [...comparison.mismatchFlags],
          occurredAt: sql`clock_timestamp()` as unknown as Date,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        reusedExisting = true;
      }
      if (!reusedExisting) {
        await tx.db
          .insert(offerResultViewsTable)
          .values({
            evaluationId,
            surface,
            occurredAt: sql`clock_timestamp()` as unknown as Date,
          })
          .onConflictDoNothing();
      }
    }

    if (surface === "CHECKOUT_REVIEW" && evaluation.checkoutJourneyKey) {
      await allocateJourneyFact({
        context: tx,
        journeyKey: evaluation.checkoutJourneyKey,
        factKind: "REVIEW_PRESENTED",
        idempotencyKey: sha256Utf8(
          `${evaluation.checkoutJourneyKey}:${evaluationId}`,
        ),
        evaluationId,
        presentationClass: derivePresentationClass({
          coarseShape: evaluation.expectedCoarseShape as CoarseShape,
          staleRecovery: evaluation.explanationReasonClass === "CHANGED_TOTAL_RECOVERY",
          reasonClass: evaluation.explanationReasonClass,
        }),
        coarseOutcome: evaluation.expectedCoarseShape,
        rejectIfClosed: false,
      });
    }

    if (surface === "CHECKOUT_REVIEW" && cartActivationId && evaluation.checkoutJourneyKey) {
      const activationRows = await tx.db
        .select()
        .from(cartCheckoutActivationsTable)
        .where(eq(cartCheckoutActivationsTable.activationId, cartActivationId))
        .limit(1);
      const activation = activationRows[0];
      if (
        activation &&
        activation.cartId === evaluation.cartId &&
        activation.checkoutJourneyKey === evaluation.checkoutJourneyKey
      ) {
        const presented = await tx.db
          .select()
          .from(checkoutJourneyFactsTable)
          .where(
            and(
              eq(
                checkoutJourneyFactsTable.checkoutJourneyKey,
                evaluation.checkoutJourneyKey,
              ),
              eq(checkoutJourneyFactsTable.factKind, "REVIEW_PRESENTED"),
              eq(checkoutJourneyFactsTable.evaluationId, evaluationId),
            ),
          )
          .limit(1);
        const watermark = activation.watermarkSequence ?? BigInt(-1);
        const presentedSequence = presented[0]?.journeySequence ?? BigInt(-1);
        if (presentedSequence > watermark) {
          const factId = await allocateJourneyFact({
            context: tx,
            journeyKey: evaluation.checkoutJourneyKey,
            factKind: "CART_REVIEW_REACH",
            idempotencyKey: sha256Utf8(cartActivationId),
            evaluationId,
            activationId: cartActivationId,
            rejectIfClosed: false,
          });
          await tx.db
            .update(cartCheckoutActivationsTable)
            .set({ reviewReachFactId: factId })
            .where(eq(cartCheckoutActivationsTable.activationId, cartActivationId));
        }
      }
    }

    const stored = await tx.db
      .select()
      .from(commercialPresentationObservationsTable)
      .where(
        and(
          eq(commercialPresentationObservationsTable.evaluationId, evaluationId),
          eq(commercialPresentationObservationsTable.surface, surface),
        ),
      )
      .limit(1);
    const row = stored[0];
    if (!row) denyNotFound();
    return Object.freeze({
      evaluationId,
      surface,
      serverPresentationMatch: row.serverPresentationMatch,
      mismatchFlags: Object.freeze(row.mismatchFlags ?? []),
      reusedExisting,
    });
  });
}
