/**
 * Typed Admin client for Promotions + Coupons authoring (IMP-036F F6B).
 */
import { adminRequest } from "./http";

export type PromotionStatus = "draft" | "active" | "retired";
export type CouponStatus = "draft" | "active" | "disabled" | "retired";

export type Promotion = Readonly<{
  id: string;
  brandId: string;
  code: string;
  displayName: string;
  scopeType: string;
  territoryId: string | null;
  organizationId: string | null;
  outletId: string | null;
  salesChannel: string;
  status: PromotionStatus;
  triggerType: "automatic" | "coupon";
  stackingPolicy: string;
  priority: number;
  startsAt: string;
  endsAt: string | null;
  minimumQualifyingAmountPaise: string | null;
  minimumItemQuantity: number | null;
  firstOrderOnly: boolean;
  eligibleFulfilmentModes: readonly string[] | null;
  eligibleFulfilmentTimings: readonly string[] | null;
  maximumRedemptions: number | null;
  maximumRedemptionsPerCustomer: number | null;
  complimentaryItem: boolean;
  revision: string;
  supportedLifecycleStates: readonly ["draft", "active", "retired"];
}>;

export type Coupon = Readonly<{
  id: string;
  promotionId: string;
  canonicalCode: string;
  origin: "manual" | "generated";
  status: CouponStatus;
  startsAt: string | null;
  endsAt: string | null;
  maximumRedemptions: number | null;
  maximumRedemptionsPerCustomer: number | null;
  revision: string;
  supportedLifecycleStates: readonly ["draft", "active", "disabled", "retired"];
}>;

function brandPromotions(brandId: string) {
  return `/api/admin/v1/brands/${brandId}/promotions`;
}

export function listPromotions(brandId: string) {
  return adminRequest<{ ok: true; promotions: Promotion[] }>(brandPromotions(brandId));
}

export type PromotionTargetType = "all_merchandise" | "product" | "variant" | "charge";
export type PromotionTargetRole = "qualifier" | "benefit";

export type PromotionTarget = Readonly<{
  targetType: PromotionTargetType;
  productId: string | null;
  variantId: string | null;
  chargeDefinitionId: string | null;
}>;

export function getPromotion(brandId: string, promotionId: string) {
  return adminRequest<{
    ok: true;
    promotion: Promotion;
    benefit: unknown;
    qualifierTargets: readonly PromotionTarget[];
    benefitTargets: readonly PromotionTarget[];
    redemptionCounts: Readonly<{
      reservedCount: number;
      consumedCount: number;
      releasedCount: number;
      applicationCount: number;
    }>;
  }>(`${brandPromotions(brandId)}/${promotionId}`);
}

export function createPromotion(
  brandId: string,
  body: Readonly<{
    code: string;
    displayName: string;
    scopeType: string;
    triggerType: "automatic" | "coupon";
    startsAt: string;
    territoryId?: string;
    organizationId?: string;
    outletId?: string;
    stackingPolicy?: string;
    priority?: number;
    endsAt?: string | null;
    minimumQualifyingAmountPaise?: string | null;
    minimumItemQuantity?: number;
    firstOrderOnly?: boolean;
    eligibleFulfilmentModes?: readonly string[] | null;
    eligibleFulfilmentTimings?: readonly string[] | null;
    maximumRedemptions?: number | null;
    maximumRedemptionsPerCustomer?: number | null;
  }>,
) {
  return adminRequest<{ ok: true; promotion: Readonly<{ id: string; revision: string }> }>(
    brandPromotions(brandId),
    { method: "POST", body },
  );
}

export function savePromotionDraft(
  brandId: string,
  promotionId: string,
  body: Readonly<{
    expectedPromotionRevision: string;
    displayName?: string;
    stackingPolicy?: string;
    priority?: number;
    startsAt?: string;
    endsAt?: string | null;
    minimumQualifyingAmountPaise?: string | null;
    minimumItemQuantity?: number;
    firstOrderOnly?: boolean;
    eligibleFulfilmentModes?: readonly string[] | null;
    eligibleFulfilmentTimings?: readonly string[] | null;
    maximumRedemptions?: number | null;
    maximumRedemptionsPerCustomer?: number | null;
  }>,
) {
  return adminRequest<{ ok: true; revision: string }>(
    `${brandPromotions(brandId)}/${promotionId}/draft`,
    { method: "POST", body },
  );
}

export function savePromotionBenefit(
  brandId: string,
  promotionId: string,
  body: Readonly<{
    expectedPromotionRevision: string;
    benefitType:
      | "percentage_discount"
      | "fixed_amount_discount"
      | "buy_x_get_y"
      | "delivery_fee_waiver"
      | "complimentary_item";
    percentageBps?: number;
    fixedAmountPaise?: string;
    maximumDiscountPaise?: string;
    buyQuantity?: number;
    getQuantity?: number;
    repeatable?: boolean;
    maximumRewardQuantity?: number;
    includeModifiers?: boolean;
    includeBundleDeltas?: boolean;
    complimentaryProductId?: string | null;
    complimentaryVariantId?: string | null;
  }>,
) {
  return adminRequest<{ ok: true; revision: string }>(
    `${brandPromotions(brandId)}/${promotionId}/benefit`,
    { method: "POST", body },
  );
}

export function setPromotionTargets(
  brandId: string,
  promotionId: string,
  body: Readonly<{
    expectedPromotionRevision: string;
    targetRole: PromotionTargetRole;
    targets: readonly Readonly<{
      targetType: PromotionTargetType;
      productId?: string | null;
      variantId?: string | null;
      chargeDefinitionId?: string | null;
    }>[];
  }>,
) {
  return adminRequest<{ ok: true; revision: string }>(
    `${brandPromotions(brandId)}/${promotionId}/targets`,
    { method: "POST", body },
  );
}

export function previewPromotionConsequence(
  brandId: string,
  promotionId: string,
  body: Readonly<{ proposedStatus: PromotionStatus }>,
) {
  return adminRequest<{
    ok: true;
    preview: Readonly<{
      promotionId: string;
      brandId: string;
      expectedPromotionRevision: string;
      currentStatus: PromotionStatus;
      proposedStatus: PromotionStatus;
      customerVisibleImplication: string;
      supportedLifecycleStates: readonly ["draft", "active", "retired"];
    }>;
  }>(`${brandPromotions(brandId)}/${promotionId}/consequence-preview`, {
    method: "POST",
    body,
  });
}

export function activatePromotion(
  brandId: string,
  promotionId: string,
  body: Readonly<{ expectedPromotionRevision: string }>,
) {
  return adminRequest<{ ok: true; revision: string }>(
    `${brandPromotions(brandId)}/${promotionId}/activate`,
    { method: "POST", body },
  );
}

export function retirePromotion(
  brandId: string,
  promotionId: string,
  body: Readonly<{ expectedPromotionRevision: string }>,
) {
  return adminRequest<{ ok: true; revision: string }>(
    `${brandPromotions(brandId)}/${promotionId}/retire`,
    { method: "POST", body },
  );
}

export function listCoupons(brandId: string, promotionId: string) {
  return adminRequest<{ ok: true; coupons: Coupon[] }>(
    `${brandPromotions(brandId)}/${promotionId}/coupons`,
  );
}

export function createCoupon(
  brandId: string,
  promotionId: string,
  body: Readonly<{
    origin: "manual" | "generated";
    canonicalCode?: string;
    startsAt?: string;
    endsAt?: string;
    maximumRedemptions?: number;
    maximumRedemptionsPerCustomer?: number;
  }>,
) {
  return adminRequest<{
    ok: true;
    coupon: Readonly<{ id: string; canonicalCode: string; revision: string }>;
  }>(`${brandPromotions(brandId)}/${promotionId}/coupons`, { method: "POST", body });
}

export function previewCouponConsequence(
  brandId: string,
  couponId: string,
  body: Readonly<{ proposedStatus: CouponStatus }>,
) {
  return adminRequest<{
    ok: true;
    preview: Readonly<{
      couponId: string;
      promotionId: string;
      brandId: string;
      canonicalCode: string;
      expectedCouponRevision: string;
      currentStatus: CouponStatus;
      proposedStatus: CouponStatus;
      customerVisibleImplication: string;
      supportedLifecycleStates: readonly ["draft", "active", "disabled", "retired"];
    }>;
  }>(`/api/admin/v1/brands/${brandId}/coupons/${couponId}/consequence-preview`, {
    method: "POST",
    body,
  });
}

export function activateCoupon(
  brandId: string,
  couponId: string,
  body: Readonly<{ expectedCouponRevision: string }>,
) {
  return adminRequest<{ ok: true; revision: string }>(
    `/api/admin/v1/brands/${brandId}/coupons/${couponId}/activate`,
    { method: "POST", body },
  );
}

export function disableCoupon(
  brandId: string,
  couponId: string,
  body: Readonly<{ expectedCouponRevision: string }>,
) {
  return adminRequest<{ ok: true; revision: string }>(
    `/api/admin/v1/brands/${brandId}/coupons/${couponId}/disable`,
    { method: "POST", body },
  );
}

export function enableCoupon(
  brandId: string,
  couponId: string,
  body: Readonly<{ expectedCouponRevision: string }>,
) {
  return adminRequest<{ ok: true; revision: string }>(
    `/api/admin/v1/brands/${brandId}/coupons/${couponId}/enable`,
    { method: "POST", body },
  );
}

export function retireCoupon(
  brandId: string,
  couponId: string,
  body: Readonly<{ expectedCouponRevision: string }>,
) {
  return adminRequest<{ ok: true; revision: string }>(
    `/api/admin/v1/brands/${brandId}/coupons/${couponId}/retire`,
    { method: "POST", body },
  );
}
