/**
 * IMP-036J Tranche 4 measurement writers.
 *
 * Writes T2 tables from cart/checkout/payment command transactions.
 * Missing measurement context must not fail an otherwise valid commercial
 * command. Client timestamps and client monetary values are not authority.
 */
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import {
  cartCheckoutActivationsTable,
  checkoutJourneyFactsTable,
  checkoutJourneyHeadsTable,
  checkoutReviewSurfaceTokensTable,
  commercialCommandOriginsTable,
  commercialCommandResultsTable,
  commercialEvaluationsTable,
} from "../../../platform/database/schema/measurement";
import { checkoutsTable } from "../../../platform/database/schema/checkout";
import {
  paymentAttemptsTable,
  paymentsTable,
} from "../../../platform/database/schema/payment";
import { ordersTable } from "../../../platform/database/schema/order";
import { catalogProductsTable, catalogVariantsTable } from "../../../platform/database/schema/catalog";
import type { DirectPricingQuote } from "../../../shared/pricing";
import { CHARGE_DEFINITION_DELIVERY_ID } from "../../../shared/pricing";
import type { CommercialExplanation } from "../../../shared/promotions";
import { CartError } from "../../../shared/cart";
import { CheckoutError } from "../../../shared/checkout";
import type {
  PersistenceQueryContext,
  PersistenceTransactionContext,
} from "../../persistence/types";
import { loadEffectiveProductContent, loadEffectiveVariantContent } from "../../catalog/revisions";

export type OriginKind =
  | "COUPON_APPLY"
  | "COUPON_REPLACE"
  | "COUPON_REMOVE"
  | "FULFILMENT_CHANGE"
  | "STALE_RECOVERY";

export type CommandSurface = "CART" | "CHECKOUT_REVIEW";

export type CoarseShape =
  | "NONE"
  | "AUTOMATIC_SAVING"
  | "ORDER_SAVING"
  | "DELIVERY_SAVING"
  | "BOTH_SAVINGS"
  | "COMPLIMENTARY_LINE"
  | "COUPON_SELECTED"
  | "COUPON_VALID_NOT_SELECTED"
  | "EQUAL_PAYABLE_SELECTED"
  | "EQUAL_PAYABLE_NOT_SELECTED"
  | "THRESHOLD_PROGRESS";

const COPY_INCLUDED = "Included with your offer";

export function sha256Utf8(value: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(value, "utf8").digest());
}

export function sha256Bytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(value).digest());
}

export function formatPaiseCanonical(paise: bigint): string {
  const hundred = BigInt(100);
  const rupees = paise / hundred;
  const fraction = paise % hundred;
  return `₹${rupees.toString()}.${fraction.toString().padStart(2, "0")}`;
}

function uuidToBytes(id: string): Uint8Array {
  const hex = id.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "bigint") return JSON.stringify(value.toString());
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`)
    .join(",")}}`;
}

export function deriveCoarseShape(input: {
  explanation: CommercialExplanation | null | undefined;
}): CoarseShape {
  const explanation = input.explanation ?? null;
  const complimentaryLine =
    explanation?.complimentary?.competingOffers === "NONE";
  if (complimentaryLine) return "COMPLIMENTARY_LINE";
  const couponClass = explanation?.couponPresentationClass ?? null;
  if (couponClass === "COUPON_EQUAL_PAYABLE_SELECTED") {
    return "EQUAL_PAYABLE_SELECTED";
  }
  if (couponClass === "COUPON_APPLIED") return "COUPON_SELECTED";
  if (couponClass === "COUPON_EQUAL_PAYABLE_NOT_SELECTED") {
    return "EQUAL_PAYABLE_NOT_SELECTED";
  }
  if (couponClass === "COUPON_VALID_NOT_SELECTED") {
    return "COUPON_VALID_NOT_SELECTED";
  }
  const orderSaving = explanation?.merchandiseOrOrderSavingPaise ?? BigInt(0);
  const deliverySaving = explanation?.deliverySavingPaise ?? BigInt(0);
  if (orderSaving > BigInt(0) && deliverySaving > BigInt(0)) {
    return "BOTH_SAVINGS";
  }
  if (deliverySaving > BigInt(0)) return "DELIVERY_SAVING";
  if (orderSaving > BigInt(0)) return "ORDER_SAVING";
  if (explanation?.thresholdProgress) return "THRESHOLD_PROGRESS";
  return "NONE";
}

export function deriveExplanationReasonClass(input: {
  explanation: CommercialExplanation | null | undefined;
  coarseShape: CoarseShape;
}): string {
  const explanation = input.explanation ?? null;
  const couponStatus = explanation?.submittedCouponResult?.status ?? null;
  if (couponStatus === "CUSTOMER_IDENTITY_REQUIRED") {
    return "IDENTITY_REQUIRED";
  }
  if (couponStatus === "INVALID") return "INVALID";
  if (couponStatus === "NOT_APPLICABLE") return "NOT_APPLICABLE";
  if (explanation?.complimentary?.competingOffers === "NONE_CHOSEN") {
    return "COMPLIMENTARY_NONE_CHOSEN";
  }
  const couponClass = explanation?.couponPresentationClass;
  if (couponClass) return couponClass;
  if (input.coarseShape === "NONE") return "NO_OFFER";
  return input.coarseShape;
}

export function derivePresentationClass(input: {
  coarseShape: CoarseShape;
  staleRecovery: boolean;
  reasonClass: string;
}): string {
  if (
    input.staleRecovery &&
    input.reasonClass !== "COMPLIMENTARY_ITEM_UNAVAILABLE"
  ) {
    return "CHANGED_TOTAL_RECOVERY";
  }
  switch (input.coarseShape) {
    case "COMPLIMENTARY_LINE":
      return "COMPLIMENTARY_ITEM";
    case "EQUAL_PAYABLE_SELECTED":
      return "EQUAL_PAYABLE_SELECTED";
    case "COUPON_SELECTED":
      return "COUPON_SELECTED";
    case "EQUAL_PAYABLE_NOT_SELECTED":
      return "EQUAL_PAYABLE_NOT_SELECTED";
    case "COUPON_VALID_NOT_SELECTED":
      return "COUPON_VALID_NOT_SELECTED";
    case "THRESHOLD_PROGRESS":
      return "THRESHOLD_PROGRESS";
    case "ORDER_SAVING":
    case "DELIVERY_SAVING":
    case "BOTH_SAVINGS":
      return "AUTOMATIC_SAVING";
    default:
      return "NO_OFFER";
  }
}

export async function projectedComplimentaryLineSha256(
  context: PersistenceQueryContext,
  explanation: CommercialExplanation | null | undefined,
): Promise<{
  variantId: string | null;
  digest: Uint8Array | null;
}> {
  const gift = explanation?.complimentary;
  if (!gift || gift.competingOffers !== "NONE") {
    return { variantId: null, digest: null };
  }
  const variantRows = await context.db
    .select()
    .from(catalogVariantsTable)
    .where(eq(catalogVariantsTable.id, gift.variantId))
    .limit(1);
  const variant = variantRows[0];
  if (!variant) return { variantId: gift.variantId, digest: null };
  const productRows = await context.db
    .select()
    .from(catalogProductsTable)
    .where(eq(catalogProductsTable.id, variant.productId))
    .limit(1);
  const product = productRows[0];
  if (!product) return { variantId: gift.variantId, digest: null };
  const productContent = await loadEffectiveProductContent(context, product);
  const variantContent = await loadEffectiveVariantContent(context, variant);
  const itemName = (
    variantContent?.name ||
    productContent?.name ||
    ""
  ).trim();
  if (!itemName) return { variantId: gift.variantId, digest: null };
  const canonical = `${itemName}\n${COPY_INCLUDED}\n${formatPaiseCanonical(BigInt(0))}`;
  return { variantId: gift.variantId, digest: sha256Utf8(canonical) };
}

function expectedComponents(input: {
  surfaceScope: "CART" | "CHECKOUT";
  quote: DirectPricingQuote;
  explanation: CommercialExplanation | null | undefined;
}): readonly Record<string, unknown>[] {
  const explanation = input.explanation ?? null;
  const orderSaving = explanation?.merchandiseOrOrderSavingPaise ?? BigInt(0);
  const deliverySaving = explanation?.deliverySavingPaise ?? BigInt(0);
  const totalSaved = explanation?.totalSavedPaise ?? BigInt(0);
  const deliveryCharge =
    input.quote.chargeLines.find(
      (line) => line.chargeDefinitionId === CHARGE_DEFINITION_DELIVERY_ID,
    )?.amountPaise ?? BigInt(0);
  const estimatedSubtotal =
    input.quote.basePaise +
    input.quote.modifierAdjustmentsPaise +
    input.quote.bundleAdjustmentsPaise;
  const progress = explanation?.thresholdProgress ?? null;
  const progressPresent = progress !== null;
  const progressRemaining = progress?.remainingAmountPaise ?? null;
  const payable = input.quote.grandTotalPaise;
  return [
    {
      kind: "ORDER_SAVING",
      present: orderSaving > BigInt(0),
      amountPaise: orderSaving > BigInt(0) ? orderSaving.toString() : "0",
    },
    {
      kind: "DELIVERY_SAVING",
      present: deliverySaving > BigInt(0),
      amountPaise: deliverySaving > BigInt(0) ? deliverySaving.toString() : "0",
    },
    {
      kind: "TOTAL_SAVED",
      present: totalSaved > BigInt(0),
      amountPaise: totalSaved > BigInt(0) ? totalSaved.toString() : "0",
    },
    {
      kind: "ESTIMATED_SUBTOTAL",
      present: input.surfaceScope === "CART",
      amountPaise:
        input.surfaceScope === "CART" ? estimatedSubtotal.toString() : "0",
    },
    {
      kind: "TOTAL_PAYABLE",
      present: input.surfaceScope === "CHECKOUT",
      amountPaise:
        input.surfaceScope === "CHECKOUT" ? payable.toString() : "0",
    },
    {
      kind: "CURRENT_CHECKOUT_TOTAL",
      present: input.surfaceScope === "CHECKOUT",
      amountPaise:
        input.surfaceScope === "CHECKOUT" ? payable.toString() : "0",
    },
    {
      kind: "DELIVERY_CHARGE",
      present: deliveryCharge > BigInt(0),
      amountPaise: deliveryCharge > BigInt(0) ? deliveryCharge.toString() : "0",
    },
    {
      kind: "PROGRESS",
      present: progressPresent,
      amountPaise: progressRemaining !== null ? progressRemaining.toString() : "0",
    },
  ];
}

export function computeResultFingerprint(input: {
  surfaceScope: "CART" | "CHECKOUT";
  quote: DirectPricingQuote;
  explanation: CommercialExplanation | null | undefined;
  coarseShape: CoarseShape;
  reasonClass: string;
  complimentaryVariantId: string | null;
  projectedComplimentaryLineSha256: Uint8Array | null;
}): Uint8Array {
  const explanation = input.explanation ?? null;
  const orderSaving = explanation?.merchandiseOrOrderSavingPaise ?? BigInt(0);
  const deliverySaving = explanation?.deliverySavingPaise ?? BigInt(0);
  const totalSaved = explanation?.totalSavedPaise ?? BigInt(0);
  const deliveryCharge =
    input.quote.chargeLines.find(
      (line) => line.chargeDefinitionId === CHARGE_DEFINITION_DELIVERY_ID,
    )?.amountPaise ?? BigInt(0);
  const estimatedSubtotal =
    input.quote.basePaise +
    input.quote.modifierAdjustmentsPaise +
    input.quote.bundleAdjustmentsPaise;
  const progress = explanation?.thresholdProgress ?? null;
  const payload = {
    ORDER_SAVING: orderSaving.toString(),
    DELIVERY_SAVING: deliverySaving.toString(),
    TOTAL_SAVED: totalSaved.toString(),
    ESTIMATED_SUBTOTAL:
      input.surfaceScope === "CART" ? estimatedSubtotal.toString() : null,
    TOTAL_PAYABLE:
      input.surfaceScope === "CHECKOUT"
        ? input.quote.grandTotalPaise.toString()
        : null,
    CURRENT_CHECKOUT_TOTAL:
      input.surfaceScope === "CHECKOUT"
        ? input.quote.grandTotalPaise.toString()
        : null,
    DELIVERY_CHARGE: deliveryCharge.toString(),
    PROGRESS: progress?.remainingAmountPaise?.toString() ?? null,
    progressPresent: progress !== null,
    progressRemainingPaise: progress?.remainingAmountPaise?.toString() ?? null,
    expected_coarse_shape: input.coarseShape,
    explanation_reason_class: input.reasonClass,
    complimentaryPresent:
      explanation?.complimentary?.competingOffers === "NONE",
    complimentary_variant_id: input.complimentaryVariantId,
    projected_complimentary_line_sha256: input.projectedComplimentaryLineSha256
      ? Buffer.from(input.projectedComplimentaryLineSha256).toString("hex")
      : null,
  };
  return sha256Utf8(canonicalJson(payload));
}

export async function nextCartOriginOrdinal(
  context: PersistenceTransactionContext,
  cartId: string,
): Promise<bigint> {
  const rows = await context.db
    .select({
      max: sql<string>`coalesce(max(${commercialCommandOriginsTable.cartOriginOrdinal}), 0)`,
    })
    .from(commercialCommandOriginsTable)
    .where(eq(commercialCommandOriginsTable.cartId, cartId));
  return BigInt(rows[0]?.max ?? "0") + BigInt(1);
}

export async function findCommandOrigin(
  context: PersistenceQueryContext,
  sourceCommandId: string,
): Promise<typeof commercialCommandOriginsTable.$inferSelect | null> {
  const rows = await context.db
    .select()
    .from(commercialCommandOriginsTable)
    .where(eq(commercialCommandOriginsTable.sourceCommandId, sourceCommandId))
    .limit(1);
  return rows[0] ?? null;
}

export async function findCommandResult(
  context: PersistenceQueryContext,
  sourceCommandId: string,
): Promise<typeof commercialCommandResultsTable.$inferSelect | null> {
  const rows = await context.db
    .select()
    .from(commercialCommandResultsTable)
    .where(eq(commercialCommandResultsTable.sourceCommandId, sourceCommandId))
    .limit(1);
  return rows[0] ?? null;
}

export type CommandIdClaim =
  | Readonly<{ kind: "fresh" }>
  | Readonly<{
      kind: "replay";
      result: typeof commercialCommandResultsTable.$inferSelect;
    }>;

export async function assertCommandIdForCart(
  context: PersistenceTransactionContext,
  sourceCommandId: string,
  cartId: string,
): Promise<CommandIdClaim> {
  const existing = await findCommandResult(context, sourceCommandId);
  if (!existing) return { kind: "fresh" };
  if (existing.cartId !== cartId) {
    throw new CartError(
      "CART_CONFLICT",
      "Command cannot be replayed against a different Cart.",
      { field: "sourceCommandId" },
    );
  }
  return { kind: "replay", result: existing };
}

export async function insertCommandOrigin(input: {
  context: PersistenceTransactionContext;
  sourceCommandId: string;
  originKind: OriginKind;
  cartId: string;
  checkoutId: string | null;
  checkoutJourneyKey: string | null;
}): Promise<void> {
  const ordinal = await nextCartOriginOrdinal(input.context, input.cartId);
  await input.context.db.insert(commercialCommandOriginsTable).values({
    sourceCommandId: input.sourceCommandId,
    originKind: input.originKind,
    cartId: input.cartId,
    checkoutId: input.checkoutId,
    checkoutJourneyKey: input.checkoutJourneyKey,
    cartOriginOrdinal: ordinal,
    resolvedChangeFactId: null,
    resolution: null,
  });
}

export async function insertCommandResult(input: {
  context: PersistenceTransactionContext;
  sourceCommandId: string;
  cartId: string;
  surface: CommandSurface;
  coarseOutcome: string;
  payableChangedVsValidAlternative: boolean | null;
  checkoutJourneyKey: string | null;
}): Promise<void> {
  await input.context.db.insert(commercialCommandResultsTable).values({
    sourceCommandId: input.sourceCommandId,
    cartId: input.cartId,
    surface: input.surface,
    coarseOutcome: input.coarseOutcome,
    payableChangedVsValidAlternative: input.payableChangedVsValidAlternative,
    occurredAt: sql`clock_timestamp()` as unknown as Date,
    checkoutJourneyKey: input.checkoutJourneyKey,
  });
}

const NON_TERMINAL_CHECKOUT_STATUSES = [
  "DRAFT",
  "READY_FOR_PAYMENT",
  "PAYMENT_PENDING",
] as const;

function isNonTerminalCheckoutStatus(status: string | null | undefined): boolean {
  return (
    status === "DRAFT" ||
    status === "READY_FOR_PAYMENT" ||
    status === "PAYMENT_PENDING"
  );
}

async function lockCouponCommandCheckoutAttribution(
  context: PersistenceTransactionContext,
  cartId: string,
): Promise<{
  checkoutId: string | null;
  journeyKey: string | null;
  status: string | null;
}> {
  const activeRows = await context.db
    .select({
      id: checkoutsTable.id,
      journeyKey: checkoutsTable.checkoutJourneyKey,
      status: checkoutsTable.status,
    })
    .from(checkoutsTable)
    .where(
      and(
        eq(checkoutsTable.cartId, cartId),
        inArray(checkoutsTable.status, [...NON_TERMINAL_CHECKOUT_STATUSES]),
      ),
    )
    .limit(1)
    .for("update");
  const active = activeRows[0];
  if (active && isNonTerminalCheckoutStatus(active.status)) {
    return {
      checkoutId: active.id,
      journeyKey: active.journeyKey,
      status: active.status,
    };
  }

  const latestRows = await context.db
    .select({
      id: checkoutsTable.id,
      journeyKey: checkoutsTable.checkoutJourneyKey,
      status: checkoutsTable.status,
    })
    .from(checkoutsTable)
    .where(
      and(
        eq(checkoutsTable.cartId, cartId),
        isNotNull(checkoutsTable.cartCausalOrdinal),
      ),
    )
    .orderBy(desc(checkoutsTable.cartCausalOrdinal))
    .limit(1)
    .for("update");
  const latest = latestRows[0];
  if (!latest) {
    return { checkoutId: null, journeyKey: null, status: null };
  }
  if (
    latest.journeyKey &&
    (await isPaymentDrivenExpiredPredecessor(context, latest.id))
  ) {
    return {
      checkoutId: latest.id,
      journeyKey: latest.journeyKey,
      status: latest.status,
    };
  }
  return {
    checkoutId: latest.id,
    journeyKey: null,
    status: latest.status,
  };
}

export async function resolveCouponCommandSurface(
  context: PersistenceTransactionContext,
  cartId: string,
  reviewSurfaceToken: string | null,
): Promise<{
  surface: CommandSurface;
  checkoutId: string | null;
  journeyKey: string | null;
}> {
  const locked = await lockCouponCommandCheckoutAttribution(context, cartId);
  if (
    !reviewSurfaceToken ||
    !locked.checkoutId ||
    !isNonTerminalCheckoutStatus(locked.status)
  ) {
    return {
      surface: "CART",
      checkoutId: locked.checkoutId,
      journeyKey: locked.journeyKey,
    };
  }
  const digest = sha256Utf8(reviewSurfaceToken);
  const tokenRows = await context.db
    .select()
    .from(checkoutReviewSurfaceTokensTable)
    .where(eq(checkoutReviewSurfaceTokensTable.tokenSha256, digest))
    .limit(1);
  const token = tokenRows[0];
  if (
    token &&
    token.cartId === cartId &&
    token.checkoutId === locked.checkoutId
  ) {
    return {
      surface: "CHECKOUT_REVIEW",
      checkoutId: locked.checkoutId,
      journeyKey: locked.journeyKey,
    };
  }
  return {
    surface: "CART",
    checkoutId: locked.checkoutId,
    journeyKey: locked.journeyKey,
  };
}

async function lockJourneyHead(
  context: PersistenceTransactionContext,
  journeyKey: string,
): Promise<{ nextSequence: bigint; closedAt: Date | null }> {
  let rows = await context.db
    .select()
    .from(checkoutJourneyHeadsTable)
    .where(eq(checkoutJourneyHeadsTable.checkoutJourneyKey, journeyKey))
    .for("update");
  if (rows.length === 0) {
    await context.db.insert(checkoutJourneyHeadsTable).values({
      checkoutJourneyKey: journeyKey,
      nextSequence: BigInt(1),
      closedAt: null,
    });
    rows = await context.db
      .select()
      .from(checkoutJourneyHeadsTable)
      .where(eq(checkoutJourneyHeadsTable.checkoutJourneyKey, journeyKey))
      .for("update");
  }
  const head = rows[0]!;
  return { nextSequence: head.nextSequence, closedAt: head.closedAt };
}

export async function allocateJourneyFact(input: {
  context: PersistenceTransactionContext;
  journeyKey: string;
  factKind:
    | "REVIEW_PRESENTED"
    | "COUPON_ATTEMPT"
    | "COMMERCIAL_STATE_CHANGE"
    | "CART_REVIEW_REACH"
    | "REVIEW_TO_PAYMENT"
    | "PAYMENT_ATTEMPT"
    | "DIRECT_ORDER_COMPLETION";
  idempotencyKey: Uint8Array;
  evaluationId?: string | null;
  activationId?: string | null;
  resultFingerprint?: Uint8Array | null;
  presentationClass?: string | null;
  coarseOutcome?: string | null;
  rejectIfClosed?: boolean;
}): Promise<string> {
  const existing = await input.context.db
    .select({ factId: checkoutJourneyFactsTable.factId })
    .from(checkoutJourneyFactsTable)
    .where(
      and(
        eq(checkoutJourneyFactsTable.checkoutJourneyKey, input.journeyKey),
        eq(checkoutJourneyFactsTable.factKind, input.factKind),
        eq(checkoutJourneyFactsTable.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0].factId;

  const head = await lockJourneyHead(input.context, input.journeyKey);
  if (head.closedAt && input.rejectIfClosed) {
    throw new CheckoutError(
      "CHECKOUT_STATE_CONFLICT",
      "Closed checkout journey cannot record a new commercial result.",
    );
  }
  const replayAfterClose = await input.context.db
    .select({ factId: checkoutJourneyFactsTable.factId })
    .from(checkoutJourneyFactsTable)
    .where(
      and(
        eq(checkoutJourneyFactsTable.checkoutJourneyKey, input.journeyKey),
        eq(checkoutJourneyFactsTable.factKind, input.factKind),
        eq(checkoutJourneyFactsTable.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (replayAfterClose[0]) return replayAfterClose[0].factId;

  const factId = randomUUID();
  try {
    await input.context.db.insert(checkoutJourneyFactsTable).values({
      factId,
      checkoutJourneyKey: input.journeyKey,
      factKind: input.factKind,
      journeySequence: head.nextSequence,
      occurredAt: sql`clock_timestamp()` as unknown as Date,
      idempotencyKey: input.idempotencyKey,
      evaluationId: input.evaluationId ?? null,
      activationId: input.activationId ?? null,
      resultFingerprint: input.resultFingerprint ?? null,
      presentationClass: input.presentationClass ?? null,
      coarseOutcome: input.coarseOutcome ?? null,
    });
    await input.context.db
      .update(checkoutJourneyHeadsTable)
      .set({ nextSequence: head.nextSequence + BigInt(1) })
      .where(eq(checkoutJourneyHeadsTable.checkoutJourneyKey, input.journeyKey));
    return factId;
  } catch (error) {
    const winner = await input.context.db
      .select({ factId: checkoutJourneyFactsTable.factId })
      .from(checkoutJourneyFactsTable)
      .where(
        and(
          eq(checkoutJourneyFactsTable.checkoutJourneyKey, input.journeyKey),
          eq(checkoutJourneyFactsTable.factKind, input.factKind),
          eq(checkoutJourneyFactsTable.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (winner[0]) return winner[0].factId;
    throw error;
  }
}

export async function writeCouponAttemptFact(input: {
  context: PersistenceTransactionContext;
  journeyKey: string | null;
  surface: CommandSurface;
  sourceCommandId: string;
  coarseOutcome: string;
}): Promise<void> {
  if (input.surface !== "CHECKOUT_REVIEW" || !input.journeyKey) return;
  await allocateJourneyFact({
    context: input.context,
    journeyKey: input.journeyKey,
    factKind: "COUPON_ATTEMPT",
    idempotencyKey: sha256Utf8(input.sourceCommandId),
    coarseOutcome: input.coarseOutcome,
    rejectIfClosed: true,
  });
}

export async function mintReviewSurfaceToken(
  context: PersistenceTransactionContext,
  checkoutId: string,
  cartId: string,
): Promise<string> {
  const token = randomUUID();
  await context.db.insert(checkoutReviewSurfaceTokensTable).values({
    tokenSha256: sha256Utf8(token),
    checkoutId,
    cartId,
  });
  return token;
}

export async function persistCommercialEvaluation(input: {
  context: PersistenceTransactionContext;
  cartId: string;
  checkoutId: string | null;
  checkoutJourneyKey: string | null;
  surfaceScope: "CART" | "CHECKOUT";
  quote: DirectPricingQuote;
}): Promise<{
  evaluationId: string;
  fingerprint: Uint8Array;
  coarseShape: CoarseShape;
  reusedExistingEvaluation: boolean;
}> {
  const explanation = input.quote.commercialExplanation ?? null;
  const coarseShape = deriveCoarseShape({ explanation });
  const reasonClass = deriveExplanationReasonClass({ explanation, coarseShape });
  const complimentary = await projectedComplimentaryLineSha256(
    input.context,
    explanation,
  );
  const fingerprint = computeResultFingerprint({
    surfaceScope: input.surfaceScope,
    quote: input.quote,
    explanation,
    coarseShape,
    reasonClass,
    complimentaryVariantId: complimentary.variantId,
    projectedComplimentaryLineSha256: complimentary.digest,
  });
  const progress = explanation?.thresholdProgress ?? null;
  if (input.checkoutJourneyKey) {
    await ensureJourneyHead(input.context, input.checkoutJourneyKey);
  }
  const latestWhere =
    input.surfaceScope === "CHECKOUT" && input.checkoutId
      ? and(
          eq(commercialEvaluationsTable.checkoutId, input.checkoutId),
          eq(commercialEvaluationsTable.surfaceScope, "CHECKOUT"),
        )
      : and(
          eq(commercialEvaluationsTable.cartId, input.cartId),
          eq(commercialEvaluationsTable.surfaceScope, "CART"),
        );
  const latest = await input.context.db
    .select()
    .from(commercialEvaluationsTable)
    .where(latestWhere)
    .orderBy(desc(commercialEvaluationsTable.occurrenceOrdinal))
    .limit(1);
  const latestRow = latest[0] ?? null;
  if (
    latestRow &&
    Buffer.from(latestRow.resultFingerprint).equals(Buffer.from(fingerprint))
  ) {
    return {
      evaluationId: latestRow.evaluationId,
      fingerprint,
      coarseShape,
      reusedExistingEvaluation: true,
    };
  }
  const maxOrdinal = latestRow?.occurrenceOrdinal ?? BigInt(0);
  const evaluationId = randomUUID();
  const originMax = await input.context.db
    .select({
      max: sql<string>`coalesce(max(${commercialCommandOriginsTable.cartOriginOrdinal}), 0)`,
    })
    .from(commercialCommandOriginsTable)
    .where(eq(commercialCommandOriginsTable.cartId, input.cartId));
  const inclusive = BigInt(originMax[0]?.max ?? "0");
  await input.context.db.insert(commercialEvaluationsTable).values({
    evaluationId,
    cartId: input.cartId,
    checkoutId: input.checkoutId,
    checkoutJourneyKey: input.checkoutJourneyKey,
    surfaceScope: input.surfaceScope,
    resultFingerprint: fingerprint,
    expectedComponents: expectedComponents({
      surfaceScope: input.surfaceScope,
      quote: input.quote,
      explanation,
    }),
    expectedTotalSavedPaise: explanation?.totalSavedPaise ?? BigInt(0),
    expectedProgressPresent: progress !== null,
    expectedProgressRemainingPaise: progress?.remainingAmountPaise ?? null,
    expectedCoarseShape: coarseShape,
    explanationReasonClass: reasonClass,
    complimentaryVariantId: complimentary.variantId,
    projectedComplimentaryLineSha256: complimentary.digest,
    serverExplanationIntegrity: true,
    cartOriginOrdinalInclusive: inclusive > BigInt(0) ? inclusive : null,
    occurrenceOrdinal: maxOrdinal + BigInt(1),
    occurredAt: sql`clock_timestamp()` as unknown as Date,
  });
  return {
    evaluationId,
    fingerprint,
    coarseShape,
    reusedExistingEvaluation: false,
  };
}

function commercialChangeIdempotencyKey(input: {
  journeyKey: string;
  previousEvaluationId: string | null;
  fingerprint: Uint8Array;
}): Uint8Array {
  const parts = [
    uuidToBytes(input.journeyKey),
    new Uint8Array([0]),
    input.previousEvaluationId
      ? uuidToBytes(input.previousEvaluationId)
      : new Uint8Array(16),
    new Uint8Array([0]),
    input.fingerprint,
  ];
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return sha256Bytes(joined);
}

export async function resolveCommercialStateChange(input: {
  context: PersistenceTransactionContext;
  cartId: string;
  checkoutId: string;
  journeyKey: string;
  evaluationId: string;
  fingerprint: Uint8Array;
  reusedExistingEvaluation: boolean;
  closedJourneyRejectNew: boolean;
}): Promise<void> {
  const previous = await input.context.db
    .select()
    .from(commercialEvaluationsTable)
    .where(
      and(
        eq(commercialEvaluationsTable.checkoutId, input.checkoutId),
        eq(commercialEvaluationsTable.surfaceScope, "CHECKOUT"),
      ),
    )
    .orderBy(desc(commercialEvaluationsTable.occurrenceOrdinal))
    .limit(2);
  const current = previous.find((row) => row.evaluationId === input.evaluationId);
  const prior = previous.find((row) => row.evaluationId !== input.evaluationId) ?? null;
  const watermark = input.reusedExistingEvaluation
    ? (current?.cartOriginOrdinalInclusive ?? BigInt(0))
    : (prior?.cartOriginOrdinalInclusive ?? BigInt(0));
  const originMax = await input.context.db
    .select({
      max: sql<string>`coalesce(max(${commercialCommandOriginsTable.cartOriginOrdinal}), 0)`,
    })
    .from(commercialCommandOriginsTable)
    .where(eq(commercialCommandOriginsTable.cartId, input.cartId));
  const greatest = BigInt(originMax[0]?.max ?? "0");
  const unresolved = await input.context.db
    .select()
    .from(commercialCommandOriginsTable)
    .where(
      and(
        eq(commercialCommandOriginsTable.cartId, input.cartId),
        isNull(commercialCommandOriginsTable.resolution),
      ),
    );
  const window = unresolved.filter((origin) => {
    if (origin.resolution !== null) return false;
    if (
      origin.checkoutJourneyKey !== null &&
      origin.checkoutJourneyKey !== input.journeyKey
    ) {
      return false;
    }
    if (origin.cartOriginOrdinal <= watermark) return false;
    if (origin.cartOriginOrdinal > greatest) return false;
    return (
      origin.checkoutJourneyKey === input.journeyKey ||
      origin.checkoutJourneyKey === null ||
      origin.checkoutId === input.checkoutId
    );
  });
  const fingerprintChanged = !input.reusedExistingEvaluation;
  if (!fingerprintChanged) {
    for (const origin of window) {
      await input.context.db
        .update(commercialCommandOriginsTable)
        .set({ resolution: "NO_RESULT_CHANGE" })
        .where(
          eq(
            commercialCommandOriginsTable.sourceCommandId,
            origin.sourceCommandId,
          ),
        );
    }
    if (current) {
      await input.context.db
        .update(commercialEvaluationsTable)
        .set({
          cartOriginOrdinalInclusive: greatest > BigInt(0) ? greatest : null,
        })
        .where(eq(commercialEvaluationsTable.evaluationId, current.evaluationId));
    }
    return;
  }
  if (window.length === 0) return;
  const factId = await allocateJourneyFact({
    context: input.context,
    journeyKey: input.journeyKey,
    factKind: "COMMERCIAL_STATE_CHANGE",
    idempotencyKey: commercialChangeIdempotencyKey({
      journeyKey: input.journeyKey,
      previousEvaluationId: prior?.evaluationId ?? null,
      fingerprint: input.fingerprint,
    }),
    evaluationId: input.evaluationId,
    resultFingerprint: input.fingerprint,
    rejectIfClosed: input.closedJourneyRejectNew,
  });
  for (const origin of window) {
    await input.context.db
      .update(commercialCommandOriginsTable)
      .set({ resolvedChangeFactId: factId, resolution: null })
      .where(
        eq(commercialCommandOriginsTable.sourceCommandId, origin.sourceCommandId),
      );
  }
  await input.context.db
    .update(commercialEvaluationsTable)
    .set({
      cartOriginOrdinalInclusive: greatest > BigInt(0) ? greatest : null,
    })
    .where(eq(commercialEvaluationsTable.evaluationId, input.evaluationId));
}

export async function nextCartCausalOrdinal(
  context: PersistenceTransactionContext,
  cartId: string,
): Promise<bigint> {
  const rows = await context.db
    .select({
      max: sql<string>`coalesce(max(${checkoutsTable.cartCausalOrdinal}), 0)`,
    })
    .from(checkoutsTable)
    .where(eq(checkoutsTable.cartId, cartId));
  return BigInt(rows[0]?.max ?? "0") + BigInt(1);
}

export async function latestCausalCheckout(
  context: PersistenceTransactionContext,
  cartId: string,
  customerAuthUserId: string,
): Promise<typeof checkoutsTable.$inferSelect | null> {
  const rows = await context.db
    .select()
    .from(checkoutsTable)
    .where(
      and(
        eq(checkoutsTable.cartId, cartId),
        eq(checkoutsTable.customerAuthUserId, customerAuthUserId),
      ),
    );
  const ordered = rows.filter((row) => row.cartCausalOrdinal !== null);
  if (ordered.length === 0) return null;
  ordered.sort((a, b) => {
    const left = a.cartCausalOrdinal ?? BigInt(0);
    const right = b.cartCausalOrdinal ?? BigInt(0);
    if (left === right) return 0;
    return left < right ? -1 : 1;
  });
  return ordered[ordered.length - 1] ?? null;
}

export async function isPaymentDrivenExpiredPredecessor(
  context: PersistenceQueryContext,
  checkoutId: string,
): Promise<boolean> {
  const checkoutRows = await context.db
    .select({ status: checkoutsTable.status })
    .from(checkoutsTable)
    .where(eq(checkoutsTable.id, checkoutId))
    .limit(1);
  if (checkoutRows[0]?.status !== "EXPIRED") return false;
  const payments = await context.db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.checkoutId, checkoutId));
  if (payments.some((row) => row.status === "SUCCEEDED")) return false;
  const expiredPayment = payments.find(
    (row) => row.status === "EXPIRED" && row.expiredAt !== null,
  );
  if (!expiredPayment) return false;
  const attempts = await context.db
    .select({ status: paymentAttemptsTable.status })
    .from(paymentAttemptsTable)
    .where(eq(paymentAttemptsTable.paymentId, expiredPayment.id));
  if (
    !attempts.some(
      (row) => row.status === "FAILED" || row.status === "CANCELLED",
    )
  ) {
    return false;
  }
  const orders = await context.db
    .select({ id: ordersTable.id })
    .from(ordersTable)
    .where(eq(ordersTable.checkoutId, checkoutId))
    .limit(1);
  return orders.length === 0;
}

export async function ensureJourneyHead(
  context: PersistenceTransactionContext,
  journeyKey: string,
): Promise<void> {
  await lockJourneyHead(context, journeyKey);
}

export async function stampJourneyOnCheckout(
  context: PersistenceTransactionContext,
  checkoutId: string,
  journeyKey: string,
  cartCausalOrdinal: bigint,
): Promise<void> {
  await context.db
    .update(checkoutsTable)
    .set({
      checkoutJourneyKey: journeyKey,
      cartCausalOrdinal,
    })
    .where(eq(checkoutsTable.id, checkoutId));
}

export async function copyJourneyKeyOntoUnresolvedOrigins(input: {
  context: PersistenceTransactionContext;
  cartId: string;
  journeyKey: string;
  predecessorCheckoutId: string | null;
  mintKind: "first" | "continuable" | "new-boundary";
  closedJourneyKey: string | null;
}): Promise<void> {
  if (input.mintKind === "new-boundary" && input.closedJourneyKey) {
    const closed = await input.context.db
      .select()
      .from(commercialCommandOriginsTable)
      .where(eq(commercialCommandOriginsTable.cartId, input.cartId));
    for (const origin of closed) {
      if (origin.resolution !== null) continue;
      if (origin.resolvedChangeFactId !== null) continue;
      if (
        origin.checkoutJourneyKey === input.closedJourneyKey ||
        origin.checkoutId === input.predecessorCheckoutId
      ) {
        await input.context.db
          .update(commercialCommandOriginsTable)
          .set({ resolution: "JOURNEY_BOUNDARY" })
          .where(
            eq(
              commercialCommandOriginsTable.sourceCommandId,
              origin.sourceCommandId,
            ),
          );
      }
    }
  }
  const unresolved = await input.context.db
    .select()
    .from(commercialCommandOriginsTable)
    .where(
      and(
        eq(commercialCommandOriginsTable.cartId, input.cartId),
        isNull(commercialCommandOriginsTable.resolution),
      ),
    );
  for (const origin of unresolved) {
    if (origin.checkoutJourneyKey === input.journeyKey) continue;
    const copyNullKey =
      origin.checkoutJourneyKey === null &&
      origin.checkoutId === null &&
      origin.resolution === null;
    const copyPredecessor =
      origin.checkoutJourneyKey === null &&
      origin.checkoutId === input.predecessorCheckoutId;
    const copySameKeyNull =
      origin.checkoutJourneyKey === null && origin.checkoutId === null;
    if (input.mintKind === "first" && copyNullKey) {
      await input.context.db
        .update(commercialCommandOriginsTable)
        .set({ checkoutJourneyKey: input.journeyKey })
        .where(
          eq(
            commercialCommandOriginsTable.sourceCommandId,
            origin.sourceCommandId,
          ),
        );
    } else if (
      input.mintKind === "continuable" &&
      (copyPredecessor || copySameKeyNull)
    ) {
      await input.context.db
        .update(commercialCommandOriginsTable)
        .set({ checkoutJourneyKey: input.journeyKey })
        .where(
          eq(
            commercialCommandOriginsTable.sourceCommandId,
            origin.sourceCommandId,
          ),
        );
    } else if (input.mintKind === "new-boundary" && copyNullKey) {
      await input.context.db
        .update(commercialCommandOriginsTable)
        .set({ checkoutJourneyKey: input.journeyKey })
        .where(
          eq(
            commercialCommandOriginsTable.sourceCommandId,
            origin.sourceCommandId,
          ),
        );
    }
  }
}

export async function recordCartCheckoutActivation(input: {
  context: PersistenceTransactionContext;
  activationId: string;
  cartId: string;
}): Promise<void> {
  const existing = await input.context.db
    .select({
      activationId: cartCheckoutActivationsTable.activationId,
      cartId: cartCheckoutActivationsTable.cartId,
    })
    .from(cartCheckoutActivationsTable)
    .where(eq(cartCheckoutActivationsTable.activationId, input.activationId))
    .limit(1);
  if (existing[0]) {
    if (existing[0].cartId !== input.cartId) {
      throw new CartError(
        "CART_CONFLICT",
        "Activation cannot be recorded against a different Cart.",
        { field: "activationId" },
      );
    }
    return;
  }
  try {
    await input.context.db.insert(cartCheckoutActivationsTable).values({
      activationId: input.activationId,
      cartId: input.cartId,
      occurredAt: sql`clock_timestamp()` as unknown as Date,
    });
  } catch {
    const replay = await input.context.db
      .select({ cartId: cartCheckoutActivationsTable.cartId })
      .from(cartCheckoutActivationsTable)
      .where(eq(cartCheckoutActivationsTable.activationId, input.activationId))
      .limit(1);
    if (replay[0]?.cartId === input.cartId) return;
    throw new CartError(
      "CART_CONFLICT",
      "Activation cannot be recorded against a different Cart.",
      { field: "activationId" },
    );
  }
}

export async function associateCartActivation(input: {
  context: PersistenceTransactionContext;
  cartActivationId: string;
  cartId: string;
  checkoutId: string;
  journeyKey: string;
}): Promise<void> {
  const existing = await input.context.db
    .select()
    .from(cartCheckoutActivationsTable)
    .where(eq(cartCheckoutActivationsTable.activationId, input.cartActivationId))
    .limit(1);
  const row = existing[0];
  if (!row) {
    return;
  }
  if (row.cartId !== input.cartId) {
    return;
  }
  const fullyAssociated =
    row.checkoutId !== null &&
    row.checkoutJourneyKey !== null &&
    row.watermarkSequence !== null;
  if (fullyAssociated) {
    return;
  }
  const unassociated =
    row.checkoutId === null &&
    row.checkoutJourneyKey === null &&
    row.watermarkSequence === null;
  if (!unassociated) {
    return;
  }
  const seqRows = await input.context.db
    .select({
      max: sql<string>`coalesce(max(${checkoutJourneyFactsTable.journeySequence}), 0)`,
    })
    .from(checkoutJourneyFactsTable)
    .where(
      eq(checkoutJourneyFactsTable.checkoutJourneyKey, input.journeyKey),
    );
  const watermark = BigInt(seqRows[0]?.max ?? "0");
  await input.context.db
    .update(cartCheckoutActivationsTable)
    .set({
      checkoutJourneyKey: input.journeyKey,
      checkoutId: input.checkoutId,
      watermarkSequence: watermark,
    })
    .where(eq(cartCheckoutActivationsTable.activationId, input.cartActivationId));
}

export async function closeJourney(
  context: PersistenceTransactionContext,
  journeyKey: string | null,
): Promise<void> {
  if (!journeyKey) return;
  await lockJourneyHead(context, journeyKey);
  await context.db
    .update(checkoutJourneyHeadsTable)
    .set({ closedAt: sql`clock_timestamp()` as unknown as Date })
    .where(
      and(
        eq(checkoutJourneyHeadsTable.checkoutJourneyKey, journeyKey),
        isNull(checkoutJourneyHeadsTable.closedAt),
      ),
    );
  await allocateJourneyFact({
    context,
    journeyKey,
    factKind: "DIRECT_ORDER_COMPLETION",
    idempotencyKey: sha256Utf8(journeyKey),
    rejectIfClosed: false,
  });
}

export async function ensureReviewPresentedThenPaymentFacts(input: {
  context: PersistenceTransactionContext;
  journeyKey: string | null;
  checkoutId: string;
  paymentIdempotencyKey: string | null;
  continueSourceCommandId: string | null;
}): Promise<void> {
  if (!input.journeyKey) return;
  const latest = await input.context.db
    .select()
    .from(commercialEvaluationsTable)
    .where(
      and(
        eq(commercialEvaluationsTable.checkoutId, input.checkoutId),
        eq(commercialEvaluationsTable.surfaceScope, "CHECKOUT"),
      ),
    )
    .orderBy(desc(commercialEvaluationsTable.occurrenceOrdinal))
    .limit(1);
  const evaluation = latest[0];
  if (evaluation) {
    const changeFacts = await input.context.db
      .select({ factId: checkoutJourneyFactsTable.factId })
      .from(checkoutJourneyFactsTable)
      .where(
        and(
          eq(
            checkoutJourneyFactsTable.evaluationId,
            evaluation.evaluationId,
          ),
          eq(checkoutJourneyFactsTable.factKind, "COMMERCIAL_STATE_CHANGE"),
        ),
      );
    const changeFactIds = changeFacts.map((row) => row.factId);
    const stale =
      changeFactIds.length === 0
        ? []
        : await input.context.db
            .select({ originKind: commercialCommandOriginsTable.originKind })
            .from(commercialCommandOriginsTable)
            .where(
              inArray(
                commercialCommandOriginsTable.resolvedChangeFactId,
                changeFactIds,
              ),
            );
    const staleRecovery = stale.some((row) => row.originKind === "STALE_RECOVERY");
    const presentationClass = derivePresentationClass({
      coarseShape: evaluation.expectedCoarseShape as CoarseShape,
      staleRecovery,
      reasonClass: evaluation.explanationReasonClass,
    });
    await allocateJourneyFact({
      context: input.context,
      journeyKey: input.journeyKey,
      factKind: "REVIEW_PRESENTED",
      idempotencyKey: sha256Utf8(`${input.journeyKey}:${evaluation.evaluationId}`),
      evaluationId: evaluation.evaluationId,
      presentationClass,
      rejectIfClosed: false,
    });
    if (input.continueSourceCommandId) {
      await allocateJourneyFact({
        context: input.context,
        journeyKey: input.journeyKey,
        factKind: "REVIEW_TO_PAYMENT",
        idempotencyKey: sha256Utf8(input.continueSourceCommandId),
        rejectIfClosed: true,
      });
    }
  }
  if (input.paymentIdempotencyKey) {
    await allocateJourneyFact({
      context: input.context,
      journeyKey: input.journeyKey,
      factKind: "PAYMENT_ATTEMPT",
      idempotencyKey: sha256Utf8(input.paymentIdempotencyKey),
      rejectIfClosed: true,
    });
  }
}
