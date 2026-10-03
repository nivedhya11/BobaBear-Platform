/**
 * Deterministic promotion configuration fingerprint (IMP-016).
 */
import { createHash } from "node:crypto";

import type { PromotionBenefitConfig, PromotionTargetConfig } from "./types";

export type FingerprintPromotionInput = Readonly<{
  brandId: string;
  code: string;
  displayName: string;
  scopeType: string;
  territoryId: string | null;
  organizationId: string | null;
  outletId: string | null;
  salesChannel: string;
  triggerType: string;
  stackingPolicy: string;
  priority: number;
  startsAt: string;
  endsAt: string | null;
  minimumQualifyingAmountPaise: string | null;
  minimumItemQuantity: number | null;
  firstOrderOnly?: boolean;
  eligibleFulfilmentModes?: readonly string[] | null;
  eligibleFulfilmentTimings?: readonly string[] | null;
  maximumRedemptions?: number | null;
  maximumRedemptionsPerCustomer?: number | null;
  benefit: PromotionBenefitConfig;
  qualifierTargets: readonly PromotionTargetConfig[];
  benefitTargets: readonly PromotionTargetConfig[];
}>;

function targetSortKey(t: PromotionTargetConfig): string {
  return [
    t.targetRole,
    t.targetType,
    t.productId ?? "",
    t.variantId ?? "",
    t.chargeDefinitionId ?? "",
  ].join("|");
}

function serializeBenefit(b: PromotionBenefitConfig): Record<string, unknown> {
  return {
    benefitType: b.benefitType,
    percentageBps: b.percentageBps,
    fixedAmountPaise:
      b.fixedAmountPaise === null || b.fixedAmountPaise === undefined
        ? null
        : b.fixedAmountPaise.toString(),
    maximumDiscountPaise:
      b.maximumDiscountPaise === null || b.maximumDiscountPaise === undefined
        ? null
        : b.maximumDiscountPaise.toString(),
    buyQuantity: b.buyQuantity,
    getQuantity: b.getQuantity,
    repeatable: b.repeatable,
    maximumRewardQuantity: b.maximumRewardQuantity,
    includeModifiers: b.includeModifiers,
    includeBundleDeltas: b.includeBundleDeltas,
    complimentaryProductId: b.complimentaryProductId ?? null,
    complimentaryVariantId: b.complimentaryVariantId ?? null,
  };
}

function serializeTarget(t: PromotionTargetConfig): Record<string, unknown> {
  return {
    targetRole: t.targetRole,
    targetType: t.targetType,
    productId: t.productId,
    variantId: t.variantId,
    chargeDefinitionId: t.chargeDefinitionId,
  };
}

export function computePromotionConfigurationFingerprint(
  input: FingerprintPromotionInput,
): string {
  const qualifierTargets = [...input.qualifierTargets]
    .sort((a, b) => targetSortKey(a).localeCompare(targetSortKey(b)))
    .map(serializeTarget);
  const benefitTargets = [...input.benefitTargets]
    .sort((a, b) => targetSortKey(a).localeCompare(targetSortKey(b)))
    .map(serializeTarget);

  const payload = {
    brandId: input.brandId,
    code: input.code,
    displayName: input.displayName,
    scopeType: input.scopeType,
    territoryId: input.territoryId,
    organizationId: input.organizationId,
    outletId: input.outletId,
    salesChannel: input.salesChannel,
    triggerType: input.triggerType,
    stackingPolicy: input.stackingPolicy,
    priority: input.priority,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    minimumQualifyingAmountPaise: input.minimumQualifyingAmountPaise,
    minimumItemQuantity: input.minimumItemQuantity,
    firstOrderOnly: input.firstOrderOnly === true,
    eligibleFulfilmentModes: input.eligibleFulfilmentModes ?? null,
    eligibleFulfilmentTimings: input.eligibleFulfilmentTimings ?? null,
    maximumRedemptions: input.maximumRedemptions ?? null,
    maximumRedemptionsPerCustomer: input.maximumRedemptionsPerCustomer ?? null,
    benefit: serializeBenefit(input.benefit),
    qualifierTargets,
    benefitTargets,
  };

  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}
