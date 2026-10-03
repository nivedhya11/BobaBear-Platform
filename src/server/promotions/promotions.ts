/**
 * Promotion draft administration + activation (IMP-016).
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";

import {
  catalogProductsTable,
  catalogVariantsTable,
} from "../../platform/database/schema/catalog";
import {
  promotionBenefitsTable,
  promotionsTable,
  promotionTargetsTable,
} from "../../platform/database/schema/promotions";
import { chargeDefinitionsTable } from "../../platform/database/schema/pricing";
import { lockBrandRowForUpdate } from "../organization/brands";
import {
  computePromotionConfigurationFingerprint,
  type PromotionBenefitConfig,
  type PromotionScopeType,
  type PromotionTargetConfig,
  type PromotionTriggerType,
  type PromotionStackingPolicy,
  type PromotionBenefitType,
  type PromotionTargetType,
  type PromotionTargetRole,
  type FulfilmentMode,
  type FulfilmentTiming,
  FULFILMENT_MODES,
  FULFILMENT_TIMINGS,
  COPY_OP_RACE,
  COPY_OP_SECOND,
  validateBogoConfiguration,
  assertNoAmbiguousMerchandiseTargets,
  assertBogoTargetRelationship,
} from "../../shared/promotions";
import { requireWorkforcePrincipal } from "../access-control/principal";
import type { PersistenceQueryContext, PersistenceTransactionContext } from "../persistence/types";
import { assertTransactionContext, assertUuid, isUniqueViolation } from "./assert-role";
import { insertPromotionAuditEvent } from "./audit";
import { assertComplimentaryAuthoringSafe } from "./complimentary-authoring";
import {
  requirePromotionManageForScope,
  requirePromotionsActivate,
  requirePromotionsRead,
} from "./authorize-promotions";
import { PromotionAdminError, PromotionNotFoundError, PromotionValidationError } from "./errors";

async function loadPromotionRow(context: PersistenceQueryContext, id: string) {
  const rows = await context.db
    .select()
    .from(promotionsTable)
    .where(eq(promotionsTable.id, id))
    .limit(1);
  return rows[0] ?? null;
}

function stalePromotionRevision(): never {
  throw new PromotionAdminError(
    "PROMOTION_STALE_REVISION",
    "expectedPromotionRevision does not match current Promotion revision; no mutation effect.",
  );
}

export function parseExpectedPromotionRevision(
  value: unknown,
  field = "expectedPromotionRevision",
): bigint {
  if (typeof value === "bigint") {
    if (value <= BigInt(0)) {
      throw new PromotionValidationError(`${field} must be > 0.`);
    }
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value) && value !== "0" && !/^0\d+/.test(value)) {
    const parsed = BigInt(value);
    if (parsed <= BigInt(0)) {
      throw new PromotionValidationError(`${field} must be > 0.`);
    }
    return parsed;
  }
  throw new PromotionValidationError(`${field} must be a positive integer.`);
}

async function lockPromotionAfterBrand(
  context: PersistenceTransactionContext,
  promotionId: string,
) {
  const id = assertUuid(promotionId, "promotionId");
  const peek = await context.db
    .select({ brandId: promotionsTable.brandId })
    .from(promotionsTable)
    .where(eq(promotionsTable.id, id))
    .limit(1);
  if (!peek[0]) return null;
  await lockBrandRowForUpdate(context, peek[0].brandId);
  return lockPromotionRow(context, id);
}

async function lockPromotionRow(context: PersistenceTransactionContext, id: string) {
  const rows = await context.db
    .select()
    .from(promotionsTable)
    .where(eq(promotionsTable.id, id))
    .for("update")
    .limit(1);
  return rows[0] ?? null;
}

async function advancePromotionRevision(
  context: PersistenceTransactionContext,
  row: typeof promotionsTable.$inferSelect,
  expected: bigint,
  extra: Record<string, unknown>,
  now: Date,
): Promise<bigint> {
  if (row.revision !== expected) stalePromotionRevision();
  const next = row.revision + BigInt(1);
  const updated = await context.db
    .update(promotionsTable)
    .set({
      revision: next,
      updatedAt: now,
      ...extra,
    })
    .where(and(eq(promotionsTable.id, row.id), eq(promotionsTable.revision, expected)))
    .returning({ revision: promotionsTable.revision });
  if (!updated[0]) stalePromotionRevision();
  return next;
}

function assertDraft(row: { status: string; activatedAt: Date | null }) {
  if (row.status !== "draft" || row.activatedAt !== null) {
    throw new PromotionAdminError("PROMOTION_NOT_DRAFT", "Promotion is not a mutable draft.");
  }
}

function assertPathBrandMatchesPromotion(
  row: typeof promotionsTable.$inferSelect | null,
  pathBrandId: string | undefined,
): asserts row is typeof promotionsTable.$inferSelect {
  if (!row) throw new PromotionNotFoundError("promotion");
  if (pathBrandId && row.brandId !== assertUuid(pathBrandId, "brandId")) {
    throw new PromotionNotFoundError("promotion");
  }
}

function validateScopeShape(input: {
  scopeType: PromotionScopeType;
  territoryId?: string | null;
  organizationId?: string | null;
  outletId?: string | null;
}) {
  const t = input.territoryId ?? null;
  const o = input.organizationId ?? null;
  const out = input.outletId ?? null;
  const ok =
    (input.scopeType === "brand" && !t && !o && !out) ||
    (input.scopeType === "territory" && t && !o && !out) ||
    (input.scopeType === "organization" && o && !t && !out) ||
    (input.scopeType === "outlet" && out && !t && !o);
  if (!ok) {
    throw new PromotionAdminError("PROMOTION_SCOPE_INVALID", "Promotion scope shape is invalid.");
  }
}

function normalizeEligibilityList<T extends string>(
  values: readonly T[] | null | undefined,
  allowed: readonly T[],
  field: string,
): T[] | null | undefined {
  if (values === undefined) return undefined;
  if (values === null) return null;
  if (values.length === 0) {
    throw new PromotionValidationError(`${field} must be null or a non-empty subset.`);
  }
  const unique = [...new Set(values)];
  for (const value of unique) {
    if (!allowed.includes(value)) {
      throw new PromotionValidationError(`${field} contains an unsupported value.`);
    }
  }
  return unique;
}

function normalizePositiveCap(
  value: number | null | undefined,
  field: string,
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PromotionValidationError(`${field} must be null or an integer greater than 0.`);
  }
  return value;
}

export async function createPromotionDraft(
  context: PersistenceTransactionContext,
  input: {
    actor: unknown;
    brandId: string;
    code: string;
    displayName: string;
    scopeType: PromotionScopeType;
    territoryId?: string | null;
    organizationId?: string | null;
    outletId?: string | null;
    triggerType: PromotionTriggerType;
    stackingPolicy?: PromotionStackingPolicy;
    priority?: number;
    startsAt: Date;
    endsAt?: Date | null;
    minimumQualifyingAmountPaise?: bigint | null;
    minimumItemQuantity?: number | null;
    firstOrderOnly?: boolean;
    eligibleFulfilmentModes?: readonly FulfilmentMode[] | null;
    eligibleFulfilmentTimings?: readonly FulfilmentTiming[] | null;
    maximumRedemptions?: number | null;
    maximumRedemptionsPerCustomer?: number | null;
  },
): Promise<{ id: string; revision: bigint }> {
  assertTransactionContext(context, "createPromotionDraft");
  const brandId = assertUuid(input.brandId, "brandId");
  validateScopeShape(input);
  if (input.endsAt && input.endsAt <= input.startsAt) {
    throw new PromotionAdminError("PROMOTION_TIME_WINDOW_INVALID", "endsAt must be after startsAt.");
  }
  await requirePromotionManageForScope(context, input.actor, {
    brandId,
    scopeType: input.scopeType,
    territoryId: input.territoryId,
    organizationId: input.organizationId,
    outletId: input.outletId,
  });
  const principal = requireWorkforcePrincipal(input.actor);
  const id = randomUUID();
  const now = new Date();
  try {
    await context.db.insert(promotionsTable).values({
      id,
      brandId,
      code: input.code,
      displayName: input.displayName,
      scopeType: input.scopeType,
      territoryId: input.territoryId ?? null,
      organizationId: input.organizationId ?? null,
      outletId: input.outletId ?? null,
      salesChannel: "direct",
      status: "draft",
      triggerType: input.triggerType,
      stackingPolicy: input.stackingPolicy ?? "exclusive",
      priority: input.priority ?? 0,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      minimumQualifyingAmountPaise: input.minimumQualifyingAmountPaise ?? null,
      minimumItemQuantity: input.minimumItemQuantity ?? null,
      firstOrderOnly: input.firstOrderOnly === true,
      eligibleFulfilmentModes:
        normalizeEligibilityList(
          input.eligibleFulfilmentModes,
          FULFILMENT_MODES,
          "eligibleFulfilmentModes",
        ) ?? null,
      eligibleFulfilmentTimings:
        normalizeEligibilityList(
          input.eligibleFulfilmentTimings,
          FULFILMENT_TIMINGS,
          "eligibleFulfilmentTimings",
        ) ?? null,
      maximumRedemptions: normalizePositiveCap(input.maximumRedemptions, "maximumRedemptions") ?? null,
      maximumRedemptionsPerCustomer:
        normalizePositiveCap(
          input.maximumRedemptionsPerCustomer,
          "maximumRedemptionsPerCustomer",
        ) ?? null,
      complimentaryItem: false,
      configurationFingerprint: null,
      revision: BigInt(1),
      activatedAt: null,
      activatedByWorkforceUserId: null,
      retiredAt: null,
      retiredByWorkforceUserId: null,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PromotionAdminError("conflict", "Promotion code already exists for brand.");
    }
    throw error;
  }

  await insertPromotionAuditEvent(context, {
    actorWorkforceUserId: principal.workforceUserId,
    permissionKey: "promotions.manage",
    action: "promotion.created",
    resourceType: "promotion",
    resourceId: id,
    brandId,
    territoryId: input.territoryId ?? null,
    organizationId: input.organizationId ?? null,
    outletId: input.outletId ?? null,
    metadata: { code: input.code, scopeType: input.scopeType, revision: "1" },
  });
  return { id, revision: BigInt(1) };
}

export async function updatePromotionDraft(
  context: PersistenceTransactionContext,
  input: {
    actor: unknown;
    brandId?: string;
    promotionId: string;
    expectedPromotionRevision: bigint | number | string;
    displayName?: string;
    stackingPolicy?: PromotionStackingPolicy;
    priority?: number;
    startsAt?: Date;
    endsAt?: Date | null;
    minimumQualifyingAmountPaise?: bigint | null;
    minimumItemQuantity?: number | null;
    firstOrderOnly?: boolean;
    eligibleFulfilmentModes?: readonly FulfilmentMode[] | null;
    eligibleFulfilmentTimings?: readonly FulfilmentTiming[] | null;
    maximumRedemptions?: number | null;
    maximumRedemptionsPerCustomer?: number | null;
  },
): Promise<{ revision: bigint }> {
  assertTransactionContext(context, "updatePromotionDraft");
  const expected = parseExpectedPromotionRevision(input.expectedPromotionRevision);
  const row = await lockPromotionRow(context, assertUuid(input.promotionId, "promotionId"));
  assertPathBrandMatchesPromotion(row, input.brandId);
  await requirePromotionManageForScope(context, input.actor, {
    brandId: row.brandId,
    scopeType: row.scopeType as PromotionScopeType,
    territoryId: row.territoryId,
    organizationId: row.organizationId,
    outletId: row.outletId,
  });
  if (row.revision !== expected) stalePromotionRevision();
  assertDraft(row);
  const principal = requireWorkforcePrincipal(input.actor);
  const startsAt = input.startsAt ?? row.startsAt;
  const endsAt = input.endsAt !== undefined ? input.endsAt : row.endsAt;
  if (endsAt && endsAt <= startsAt) {
    throw new PromotionAdminError("PROMOTION_TIME_WINDOW_INVALID", "endsAt must be after startsAt.");
  }
  const now = new Date();
  const revision = await advancePromotionRevision(
    context,
    row,
    expected,
    {
      displayName: input.displayName ?? row.displayName,
      stackingPolicy: input.stackingPolicy ?? row.stackingPolicy,
      priority: input.priority ?? row.priority,
      startsAt,
      endsAt,
      minimumQualifyingAmountPaise:
        input.minimumQualifyingAmountPaise !== undefined
          ? input.minimumQualifyingAmountPaise
          : row.minimumQualifyingAmountPaise,
      minimumItemQuantity:
        input.minimumItemQuantity !== undefined
          ? input.minimumItemQuantity
          : row.minimumItemQuantity,
      firstOrderOnly: input.firstOrderOnly !== undefined ? input.firstOrderOnly : row.firstOrderOnly,
      eligibleFulfilmentModes:
        input.eligibleFulfilmentModes !== undefined
          ? (normalizeEligibilityList(
              input.eligibleFulfilmentModes,
              FULFILMENT_MODES,
              "eligibleFulfilmentModes",
            ) ?? null)
          : row.eligibleFulfilmentModes,
      eligibleFulfilmentTimings:
        input.eligibleFulfilmentTimings !== undefined
          ? (normalizeEligibilityList(
              input.eligibleFulfilmentTimings,
              FULFILMENT_TIMINGS,
              "eligibleFulfilmentTimings",
            ) ?? null)
          : row.eligibleFulfilmentTimings,
      maximumRedemptions:
        input.maximumRedemptions !== undefined
          ? (normalizePositiveCap(input.maximumRedemptions, "maximumRedemptions") ?? null)
          : row.maximumRedemptions,
      maximumRedemptionsPerCustomer:
        input.maximumRedemptionsPerCustomer !== undefined
          ? (normalizePositiveCap(
              input.maximumRedemptionsPerCustomer,
              "maximumRedemptionsPerCustomer",
            ) ?? null)
          : row.maximumRedemptionsPerCustomer,
    },
    now,
  );

  await insertPromotionAuditEvent(context, {
    actorWorkforceUserId: principal.workforceUserId,
    permissionKey: "promotions.manage",
    action: "promotion.updated",
    resourceType: "promotion",
    resourceId: row.id,
    brandId: row.brandId,
    metadata: { updated: true, revision: revision.toString(10) },
  });
  return { revision };
}

export async function deletePromotionDraft(
  context: PersistenceTransactionContext,
  input: {
    actor: unknown;
    brandId?: string;
    promotionId: string;
    expectedPromotionRevision: bigint | number | string;
  },
): Promise<void> {
  assertTransactionContext(context, "deletePromotionDraft");
  const expected = parseExpectedPromotionRevision(input.expectedPromotionRevision);
  const row = await lockPromotionRow(context, assertUuid(input.promotionId, "promotionId"));
  assertPathBrandMatchesPromotion(row, input.brandId);
  await requirePromotionManageForScope(context, input.actor, {
    brandId: row.brandId,
    scopeType: row.scopeType as PromotionScopeType,
    territoryId: row.territoryId,
    organizationId: row.organizationId,
    outletId: row.outletId,
  });
  if (row.revision !== expected) stalePromotionRevision();
  if (row.activatedAt !== null || row.status !== "draft") {
    throw new PromotionAdminError("PROMOTION_NOT_DRAFT", "Ever-active promotions cannot be deleted.");
  }
  const principal = requireWorkforcePrincipal(input.actor);
  await context.db.delete(promotionsTable).where(eq(promotionsTable.id, row.id));
  await insertPromotionAuditEvent(context, {
    actorWorkforceUserId: principal.workforceUserId,
    permissionKey: "promotions.manage",
    action: "promotion.deleted",
    resourceType: "promotion",
    resourceId: row.id,
    brandId: row.brandId,
    metadata: { deleted: true },
  });
}

export async function setPromotionBenefit(
  context: PersistenceTransactionContext,
  input: {
    actor: unknown;
    brandId?: string;
    promotionId: string;
    expectedPromotionRevision: bigint | number | string;
    benefit: PromotionBenefitConfig;
  },
): Promise<{ revision: bigint }> {
  assertTransactionContext(context, "setPromotionBenefit");
  const expected = parseExpectedPromotionRevision(input.expectedPromotionRevision);
  const row = await lockPromotionRow(context, assertUuid(input.promotionId, "promotionId"));
  assertPathBrandMatchesPromotion(row, input.brandId);
  await requirePromotionManageForScope(context, input.actor, {
    brandId: row.brandId,
    scopeType: row.scopeType as PromotionScopeType,
    territoryId: row.territoryId,
    organizationId: row.organizationId,
    outletId: row.outletId,
  });
  if (row.revision !== expected) stalePromotionRevision();
  assertDraft(row);
  const b = input.benefit;
  let complimentaryProductId: string | null = null;
  let complimentaryVariantId: string | null = null;
  let complimentaryItem = false;
  if (b.benefitType === "percentage_discount") {
    if (b.percentageBps === null || b.percentageBps <= 0 || b.percentageBps > 10000) {
      throw new PromotionAdminError("PROMOTION_BENEFIT_INVALID", "Invalid percentage_bps.");
    }
  } else if (b.benefitType === "fixed_amount_discount") {
    if (b.fixedAmountPaise === null || b.fixedAmountPaise <= BigInt(0)) {
      throw new PromotionAdminError("PROMOTION_BENEFIT_INVALID", "Invalid fixed_amount_paise.");
    }
  } else if (b.benefitType === "buy_x_get_y") {
    if (!b.buyQuantity || !b.getQuantity || b.repeatable === null) {
      throw new PromotionAdminError("PROMOTION_BENEFIT_INVALID", "Invalid BOGO fields.");
    }
  } else if (b.benefitType === "delivery_fee_waiver") {
    if (
      b.percentageBps !== null ||
      b.fixedAmountPaise !== null ||
      b.buyQuantity !== null ||
      b.getQuantity !== null ||
      b.includeModifiers === true ||
      b.includeBundleDeltas === true
    ) {
      throw new PromotionAdminError("PROMOTION_BENEFIT_INVALID", "Invalid delivery_fee_waiver fields.");
    }
  } else if (b.benefitType === "complimentary_item") {
    const bound = await assertComplimentaryAuthoringSafe(context, {
      brandId: row.brandId,
      complimentaryProductId: b.complimentaryProductId,
      complimentaryVariantId: b.complimentaryVariantId,
    });
    complimentaryProductId = bound.productId;
    complimentaryVariantId = bound.variantId;
    complimentaryItem = true;
    if (b.includeModifiers === true || b.includeBundleDeltas === true) {
      throw new PromotionAdminError("PROMOTION_BENEFIT_INVALID", "Invalid complimentary_item fields.");
    }
  } else {
    throw new PromotionAdminError("PROMOTION_BENEFIT_INVALID", "Unsupported benefit type.");
  }
  const now = new Date();
  const existing = await context.db
    .select()
    .from(promotionBenefitsTable)
    .where(eq(promotionBenefitsTable.promotionId, row.id))
    .limit(1);
  const values = {
    benefitType: b.benefitType,
    percentageBps: b.benefitType === "percentage_discount" ? b.percentageBps : null,
    fixedAmountPaise: b.benefitType === "fixed_amount_discount" ? b.fixedAmountPaise : null,
    maximumDiscountPaise: b.benefitType === "percentage_discount" || b.benefitType === "fixed_amount_discount"
      ? b.maximumDiscountPaise
      : null,
    buyQuantity: b.benefitType === "buy_x_get_y" ? b.buyQuantity : null,
    getQuantity: b.benefitType === "buy_x_get_y" ? b.getQuantity : null,
    repeatable: b.benefitType === "buy_x_get_y" ? b.repeatable : null,
    maximumRewardQuantity: b.benefitType === "buy_x_get_y" ? b.maximumRewardQuantity : null,
    includeModifiers: complimentaryItem || b.benefitType === "delivery_fee_waiver" ? false : b.includeModifiers,
    includeBundleDeltas:
      complimentaryItem || b.benefitType === "delivery_fee_waiver" ? false : b.includeBundleDeltas,
    complimentaryProductId,
    complimentaryVariantId,
    updatedAt: now,
  };
  if (existing[0]) {
    await context.db
      .update(promotionBenefitsTable)
      .set(values)
      .where(eq(promotionBenefitsTable.id, existing[0].id));
  } else {
    await context.db.insert(promotionBenefitsTable).values({
      id: randomUUID(),
      promotionId: row.id,
      ...values,
      createdAt: now,
    });
  }
  const revision = await advancePromotionRevision(
    context,
    row,
    expected,
    { complimentaryItem },
    now,
  );
  const principal = requireWorkforcePrincipal(input.actor);
  await insertPromotionAuditEvent(context, {
    actorWorkforceUserId: principal.workforceUserId,
    permissionKey: "promotions.manage",
    action: "promotion.updated",
    resourceType: "promotion",
    resourceId: row.id,
    brandId: row.brandId,
    metadata: { benefit: true, revision: revision.toString(10) },
  });
  return { revision };
}

export async function setPromotionTargets(
  context: PersistenceTransactionContext,
  input: {
    actor: unknown;
    brandId?: string;
    promotionId: string;
    expectedPromotionRevision: bigint | number | string;
    targetRole: PromotionTargetRole;
    targets: readonly PromotionTargetConfig[];
  },
): Promise<{ revision: bigint }> {
  assertTransactionContext(context, "setPromotionTargets");
  const expected = parseExpectedPromotionRevision(input.expectedPromotionRevision);
  const row = await lockPromotionRow(context, assertUuid(input.promotionId, "promotionId"));
  assertPathBrandMatchesPromotion(row, input.brandId);
  await requirePromotionManageForScope(context, input.actor, {
    brandId: row.brandId,
    scopeType: row.scopeType as PromotionScopeType,
    territoryId: row.territoryId,
    organizationId: row.organizationId,
    outletId: row.outletId,
  });
  if (row.revision !== expected) stalePromotionRevision();
  assertDraft(row);
  assertNoAmbiguousMerchandiseTargets(input.targets, input.targetRole);
  await context.db
    .delete(promotionTargetsTable)
    .where(
      and(
        eq(promotionTargetsTable.promotionId, row.id),
        eq(promotionTargetsTable.targetRole, input.targetRole),
      ),
    );
  const now = new Date();
  for (const t of input.targets) {
    await context.db.insert(promotionTargetsTable).values({
      id: randomUUID(),
      promotionId: row.id,
      targetRole: input.targetRole,
      targetType: t.targetType,
      productId: t.productId,
      variantId: t.variantId,
      chargeDefinitionId: t.chargeDefinitionId,
      createdAt: now,
    });
  }
  const revision = await advancePromotionRevision(context, row, expected, {}, now);
  const principal = requireWorkforcePrincipal(input.actor);
  await insertPromotionAuditEvent(context, {
    actorWorkforceUserId: principal.workforceUserId,
    permissionKey: "promotions.manage",
    action: "promotion.updated",
    resourceType: "promotion",
    resourceId: row.id,
    brandId: row.brandId,
    metadata: { targets: true, targetRole: input.targetRole, revision: revision.toString(10) },
  });
  return { revision };
}

async function assertTargetBrandOwnership(
  context: PersistenceTransactionContext,
  brandId: string,
  targets: readonly PromotionTargetConfig[],
) {
  for (const t of targets) {
    if (t.targetType === "product" && t.productId) {
      const rows = await context.db
        .select()
        .from(catalogProductsTable)
        .where(eq(catalogProductsTable.id, t.productId))
        .limit(1);
      if (!rows[0] || rows[0].brandId !== brandId) {
        throw new PromotionAdminError(
          "PROMOTION_TARGET_BRAND_MISMATCH",
          "Product target does not belong to promotion brand.",
        );
      }
    }
    if (t.targetType === "variant" && t.variantId) {
      const rows = await context.db
        .select()
        .from(catalogVariantsTable)
        .where(eq(catalogVariantsTable.id, t.variantId))
        .limit(1);
      if (!rows[0] || rows[0].brandId !== brandId) {
        throw new PromotionAdminError(
          "PROMOTION_TARGET_BRAND_MISMATCH",
          "Variant target does not belong to promotion brand.",
        );
      }
    }
    if (t.targetType === "charge" && t.chargeDefinitionId) {
      const rows = await context.db
        .select()
        .from(chargeDefinitionsTable)
        .where(eq(chargeDefinitionsTable.id, t.chargeDefinitionId))
        .limit(1);
      if (!rows[0]) {
        throw new PromotionValidationError("Charge definition not found.");
      }
    }
  }
}

export async function activatePromotion(
  context: PersistenceTransactionContext,
  input: {
    actor: unknown;
    brandId?: string;
    promotionId: string;
    expectedPromotionRevision: bigint | number | string;
    /**
     * After authoring locks are held and before the status update.
     * Tests use this to overlap two complimentary activations. Production omits it.
     */
    afterAuthoringLocksHeld?: () => Promise<void>;
  },
): Promise<{ revision: bigint }> {
  assertTransactionContext(context, "activatePromotion");
  const expected = parseExpectedPromotionRevision(input.expectedPromotionRevision);
  const promotionId = assertUuid(input.promotionId, "promotionId");
  const peek = await context.db
    .select({ complimentaryItem: promotionsTable.complimentaryItem })
    .from(promotionsTable)
    .where(eq(promotionsTable.id, promotionId))
    .limit(1);
  const row = peek[0]?.complimentaryItem
    ? await lockPromotionRow(context, promotionId)
    : await lockPromotionAfterBrand(context, promotionId);
  assertPathBrandMatchesPromotion(row, input.brandId);
  await requirePromotionsActivate(context, input.actor, row.brandId);
  // Still require manage scope for lower-scope governance visibility
  await requirePromotionManageForScope(context, input.actor, {
    brandId: row.brandId,
    scopeType: row.scopeType as PromotionScopeType,
    territoryId: row.territoryId,
    organizationId: row.organizationId,
    outletId: row.outletId,
  });
  if (row.revision !== expected) stalePromotionRevision();
  if (row.status === "active") {
    throw new PromotionAdminError("PROMOTION_ALREADY_ACTIVE", "Promotion is already active.");
  }
  if (row.status === "retired") {
    throw new PromotionAdminError("PROMOTION_RETIRED", "Retired promotions cannot activate.");
  }
  assertDraft(row);

  const benefits = await context.db
    .select()
    .from(promotionBenefitsTable)
    .where(eq(promotionBenefitsTable.promotionId, row.id))
    .limit(1);
  const benefitRow = benefits[0];
  if (!benefitRow) {
    throw new PromotionAdminError("PROMOTION_BENEFIT_INVALID", "Benefit required before activation.");
  }
  const isComplimentaryBenefit = benefitRow.benefitType === "complimentary_item";
  if (row.complimentaryItem !== isComplimentaryBenefit) {
    throw new PromotionAdminError(
      "PROMOTION_BENEFIT_INVALID",
      "Complimentary flag must match the benefit type before activation.",
    );
  }
  if (isComplimentaryBenefit) {
    await assertComplimentaryAuthoringSafe(context, {
      brandId: row.brandId,
      complimentaryProductId: benefitRow.complimentaryProductId,
      complimentaryVariantId: benefitRow.complimentaryVariantId,
    });
    const activeComplimentary = await context.db
      .select({ count: sql<number>`count(*)::int` })
      .from(promotionsTable)
      .where(
        and(
          eq(promotionsTable.brandId, row.brandId),
          eq(promotionsTable.status, "active"),
          eq(promotionsTable.complimentaryItem, true),
        ),
      );
    if ((activeComplimentary[0]?.count ?? 0) >= 1) {
      throw new PromotionAdminError(
        "PROMOTION_COMPLIMENTARY_ACTIVE_CONFLICT",
        COPY_OP_SECOND,
      );
    }
  }
  const targets = await context.db
    .select()
    .from(promotionTargetsTable)
    .where(eq(promotionTargetsTable.promotionId, row.id));
  const qualifierTargets = targets.filter((t) => t.targetRole === "qualifier");
  const benefitTargets = targets.filter((t) => t.targetRole === "benefit");
  if (qualifierTargets.length < 1) {
    throw new PromotionAdminError(
      "PROMOTION_QUALIFIER_TARGET_REQUIRED",
      "At least one qualifier target is required.",
    );
  }
  if (benefitTargets.length < 1) {
    throw new PromotionAdminError(
      "PROMOTION_BENEFIT_TARGET_REQUIRED",
      "At least one benefit target is required.",
    );
  }

  const toConfig = (t: (typeof targets)[number]): PromotionTargetConfig => ({
    targetRole: t.targetRole as PromotionTargetRole,
    targetType: t.targetType as PromotionTargetType,
    productId: t.productId,
    variantId: t.variantId,
    chargeDefinitionId: t.chargeDefinitionId,
  });
  const qConfigs = qualifierTargets.map(toConfig);
  const bConfigs = benefitTargets.map(toConfig);
  assertNoAmbiguousMerchandiseTargets(qConfigs, "qualifier");
  assertNoAmbiguousMerchandiseTargets(bConfigs, "benefit");
  await assertTargetBrandOwnership(context, row.brandId, [...qConfigs, ...bConfigs]);

  const benefit: PromotionBenefitConfig = {
    benefitType: benefitRow.benefitType as PromotionBenefitType,
    percentageBps: benefitRow.percentageBps,
    fixedAmountPaise: benefitRow.fixedAmountPaise,
    maximumDiscountPaise: benefitRow.maximumDiscountPaise,
    buyQuantity: benefitRow.buyQuantity,
    getQuantity: benefitRow.getQuantity,
    repeatable: benefitRow.repeatable,
    maximumRewardQuantity: benefitRow.maximumRewardQuantity,
    includeModifiers: benefitRow.includeModifiers,
    includeBundleDeltas: benefitRow.includeBundleDeltas,
    complimentaryProductId: benefitRow.complimentaryProductId ?? null,
    complimentaryVariantId: benefitRow.complimentaryVariantId ?? null,
  };

  if (benefit.benefitType === "buy_x_get_y") {
    assertBogoTargetRelationship(qConfigs, bConfigs);
    validateBogoConfiguration({
      id: row.id,
      brandId: row.brandId,
      code: row.code,
      displayName: row.displayName,
      scopeType: row.scopeType as PromotionScopeType,
      territoryId: row.territoryId,
      organizationId: row.organizationId,
      outletId: row.outletId,
      salesChannel: "direct",
      status: "draft",
      triggerType: row.triggerType as PromotionTriggerType,
      stackingPolicy: row.stackingPolicy as PromotionStackingPolicy,
      priority: row.priority,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      minimumQualifyingAmountPaise: row.minimumQualifyingAmountPaise,
      minimumItemQuantity: row.minimumItemQuantity,
      configurationFingerprint: null,
      benefit,
      qualifierTargets: qConfigs,
      benefitTargets: bConfigs,
    });
  }

  const fingerprint = computePromotionConfigurationFingerprint({
    brandId: row.brandId,
    code: row.code,
    displayName: row.displayName,
    scopeType: row.scopeType,
    territoryId: row.territoryId,
    organizationId: row.organizationId,
    outletId: row.outletId,
    salesChannel: row.salesChannel,
    triggerType: row.triggerType,
    stackingPolicy: row.stackingPolicy,
    priority: row.priority,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    minimumQualifyingAmountPaise:
      row.minimumQualifyingAmountPaise === null
        ? null
        : row.minimumQualifyingAmountPaise.toString(),
    minimumItemQuantity: row.minimumItemQuantity,
    firstOrderOnly: row.firstOrderOnly,
    eligibleFulfilmentModes: row.eligibleFulfilmentModes,
    eligibleFulfilmentTimings: row.eligibleFulfilmentTimings,
    maximumRedemptions: row.maximumRedemptions,
    maximumRedemptionsPerCustomer: row.maximumRedemptionsPerCustomer,
    benefit,
    qualifierTargets: qConfigs,
    benefitTargets: bConfigs,
  });

  if (input.afterAuthoringLocksHeld) {
    await input.afterAuthoringLocksHeld();
  }

  const principal = requireWorkforcePrincipal(input.actor);
  const now = new Date();
  let revision: bigint;
  try {
    revision = await advancePromotionRevision(
      context,
      row,
      expected,
      {
        status: "active",
        activatedAt: now,
        activatedByWorkforceUserId: principal.workforceUserId,
        configurationFingerprint: fingerprint,
      },
      now,
    );
  } catch (error) {
    if (isComplimentaryBenefit && isUniqueViolation(error)) {
      throw new PromotionAdminError("PROMOTION_COMPLIMENTARY_ACTIVATION_RACE", COPY_OP_RACE);
    }
    throw error;
  }

  await insertPromotionAuditEvent(context, {
    actorWorkforceUserId: principal.workforceUserId,
    permissionKey: "promotions.activate",
    action: "promotion.activated",
    resourceType: "promotion",
    resourceId: row.id,
    brandId: row.brandId,
    territoryId: row.territoryId,
    organizationId: row.organizationId,
    outletId: row.outletId,
    configurationFingerprint: fingerprint,
    metadata: { activated: true, revision: revision.toString(10) },
  });
  return { revision };
}

export async function retirePromotion(
  context: PersistenceTransactionContext,
  input: {
    actor: unknown;
    brandId?: string;
    promotionId: string;
    expectedPromotionRevision: bigint | number | string;
  },
): Promise<{ revision: bigint }> {
  assertTransactionContext(context, "retirePromotion");
  const expected = parseExpectedPromotionRevision(input.expectedPromotionRevision);
  const row = await lockPromotionAfterBrand(context, input.promotionId);
  assertPathBrandMatchesPromotion(row, input.brandId);
  await requirePromotionsActivate(context, input.actor, row.brandId);
  if (row.revision !== expected) stalePromotionRevision();
  if (row.status !== "active") {
    throw new PromotionAdminError("invalid_state", "Only active promotions can be retired.");
  }
  const principal = requireWorkforcePrincipal(input.actor);
  const now = new Date();
  const revision = await advancePromotionRevision(
    context,
    row,
    expected,
    {
      status: "retired",
      retiredAt: now,
      retiredByWorkforceUserId: principal.workforceUserId,
    },
    now,
  );
  await insertPromotionAuditEvent(context, {
    actorWorkforceUserId: principal.workforceUserId,
    permissionKey: "promotions.activate",
    action: "promotion.retired",
    resourceType: "promotion",
    resourceId: row.id,
    brandId: row.brandId,
    configurationFingerprint: row.configurationFingerprint,
    metadata: { retired: true, revision: revision.toString(10) },
  });
  return { revision };
}

export async function getPromotion(context: PersistenceQueryContext, promotionId: string) {
  return loadPromotionRow(context, assertUuid(promotionId, "promotionId"));
}

export async function getPromotionForActor(
  context: PersistenceQueryContext,
  actor: unknown,
  promotionId: string,
) {
  const row = await loadPromotionRow(context, assertUuid(promotionId, "promotionId"));
  if (!row) return null;
  await requirePromotionsRead(context, actor, row.brandId);
  const [benefit] = await context.db
    .select()
    .from(promotionBenefitsTable)
    .where(eq(promotionBenefitsTable.promotionId, row.id))
    .limit(1);
  const targets = await context.db
    .select()
    .from(promotionTargetsTable)
    .where(eq(promotionTargetsTable.promotionId, row.id));
  return { promotion: row, benefit: benefit ?? null, targets };
}

export async function listPromotions(
  context: PersistenceQueryContext,
  actor: unknown,
  brandId: string,
) {
  await requirePromotionsRead(context, actor, brandId);
  return context.db
    .select()
    .from(promotionsTable)
    .where(eq(promotionsTable.brandId, assertUuid(brandId, "brandId")));
}

export async function loadPromotionDefinitionByIds(
  context: PersistenceQueryContext,
  ids: readonly string[],
) {
  if (ids.length === 0) return [];
  const rows = await context.db
    .select()
    .from(promotionsTable)
    .where(inArray(promotionsTable.id, [...ids]));
  return rows;
}
