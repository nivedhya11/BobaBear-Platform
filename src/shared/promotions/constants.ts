/**
 * IMP-016 promotion / coupon constants (browser-safe).
 */

export const PROMOTION_STATUSES = ["draft", "active", "retired"] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

export const PROMOTION_TRIGGER_TYPES = ["automatic", "coupon"] as const;
export type PromotionTriggerType = (typeof PROMOTION_TRIGGER_TYPES)[number];

export const PROMOTION_STACKING_POLICIES = ["exclusive", "combinable"] as const;
export type PromotionStackingPolicy = (typeof PROMOTION_STACKING_POLICIES)[number];

export const PROMOTION_SCOPE_TYPES = [
  "brand",
  "territory",
  "organization",
  "outlet",
] as const;
export type PromotionScopeType = (typeof PROMOTION_SCOPE_TYPES)[number];

export const PROMOTION_BENEFIT_TYPES = [
  "percentage_discount",
  "fixed_amount_discount",
  "buy_x_get_y",
  "delivery_fee_waiver",
  "complimentary_item",
] as const;
export type PromotionBenefitType = (typeof PROMOTION_BENEFIT_TYPES)[number];

export const PROMOTION_SLOT_CLASSES = [
  "PRIMARY_MERCHANDISE_OR_ORDER",
  "DELIVERY_INCENTIVE",
] as const;
export type PromotionSlotClass = (typeof PROMOTION_SLOT_CLASSES)[number];

export const FULFILMENT_MODES = ["DELIVERY", "PICKUP"] as const;
export type FulfilmentMode = (typeof FULFILMENT_MODES)[number];

export const FULFILMENT_TIMINGS = ["ASAP", "SCHEDULED"] as const;
export type FulfilmentTiming = (typeof FULFILMENT_TIMINGS)[number];

/** Server-owned coupon presentation classes (LANG-1 projects sentences). */
export const COUPON_PRESENTATION_CLASSES = [
  "COUPON_APPLIED",
  "COUPON_VALID_NOT_SELECTED",
  "COUPON_EQUAL_PAYABLE_SELECTED",
  "COUPON_EQUAL_PAYABLE_NOT_SELECTED",
] as const;
export type CouponPresentationClass = (typeof COUPON_PRESENTATION_CLASSES)[number];

/**
 * Injected by the evaluation caller (T4 supplies the purchase-existence query).
 * T3 classifies first-order Offers against this status and does not query orders/payments.
 */
export const FIRST_ORDER_PURCHASE_STATUSES = [
  "NO_PRIOR_PURCHASE",
  "HAS_PRIOR_PURCHASE",
  "UNAVAILABLE",
] as const;
export type FirstOrderPurchaseStatus = (typeof FIRST_ORDER_PURCHASE_STATUSES)[number];

export const PROMOTION_TARGET_ROLES = ["qualifier", "benefit"] as const;
export type PromotionTargetRole = (typeof PROMOTION_TARGET_ROLES)[number];

export const PROMOTION_TARGET_TYPES = [
  "all_merchandise",
  "product",
  "variant",
  "charge",
] as const;
export type PromotionTargetType = (typeof PROMOTION_TARGET_TYPES)[number];

export const COUPON_STATUSES = ["draft", "active", "disabled", "retired"] as const;
export type CouponStatus = (typeof COUPON_STATUSES)[number];

export const COUPON_ORIGINS = ["manual", "generated"] as const;
export type CouponOrigin = (typeof COUPON_ORIGINS)[number];

export const PROMOTION_SALES_CHANNEL = "direct" as const;

export const COUPON_OUTCOME_STATUSES = [
  "APPLIED",
  "VALID_BUT_NOT_SELECTED",
  "NOT_APPLICABLE",
  "INVALID",
  "CUSTOMER_IDENTITY_REQUIRED",
  "REDEMPTION_ENFORCEMENT_UNAVAILABLE",
] as const;
export type CouponOutcomeStatus = (typeof COUPON_OUTCOME_STATUSES)[number];

export const PROMOTION_ELIGIBILITY_REASON_CODES = [
  "ELIGIBLE",
  "NOT_ELIGIBLE",
  "NOT_EFFECTIVE",
  "SCOPE_MISMATCH",
  "CHANNEL_MISMATCH",
  "MINIMUM_AMOUNT_NOT_MET",
  "MINIMUM_QUANTITY_NOT_MET",
  "NO_QUALIFYING_CAPACITY",
  "RETIRED",
  "NOT_ACTIVE",
  "FULFILMENT_MODE_MISMATCH",
  "FULFILMENT_TIMING_MISMATCH",
  "FULFILMENT_CONTEXT_REQUIRED",
  "FIRST_ORDER_IDENTITY_REQUIRED",
  "FIRST_ORDER_NOT_ELIGIBLE",
  "FIRST_ORDER_PURCHASE_STATUS_UNAVAILABLE",
  "COMPLIMENTARY_UNAVAILABLE",
  "COMPLIMENTARY_VARIANT_REQUIRED",
] as const;
export type PromotionEligibilityReasonCode =
  (typeof PROMOTION_ELIGIBILITY_REASON_CODES)[number];

export const PROMOTION_AUDIT_ACTIONS = [
  "promotion.created",
  "promotion.updated",
  "promotion.deleted",
  "promotion.activated",
  "promotion.retired",
  "coupon.created",
  "coupon.updated",
  "coupon.deleted",
  "coupon.activated",
  "coupon.disabled",
  "coupon.enabled",
  "coupon.retired",
  "brand_promotion_policy.updated",
] as const;
export type PromotionAuditAction = (typeof PROMOTION_AUDIT_ACTIONS)[number];

export const PROMOTION_FATAL_ERROR_CODES = [
  "PROMOTION_CONFIGURATION_INVALID",
  "PROMOTION_CONTEXT_INVALID",
  "PROMOTION_ALLOCATION_INCONSISTENT",
  "PROMOTION_MONEY_OVERFLOW",
] as const;
export type PromotionFatalErrorCode = (typeof PROMOTION_FATAL_ERROR_CODES)[number];

export const PROMOTION_ADMIN_ERROR_CODES = [
  "PROMOTION_NOT_DRAFT",
  "PROMOTION_SCOPE_INVALID",
  "PROMOTION_SCOPE_NOT_DELEGATED",
  "PROMOTION_TIME_WINDOW_INVALID",
  "PROMOTION_BENEFIT_INVALID",
  "PROMOTION_QUALIFIER_TARGET_REQUIRED",
  "PROMOTION_BENEFIT_TARGET_REQUIRED",
  "PROMOTION_TARGET_BRAND_MISMATCH",
  "PROMOTION_TARGET_AMBIGUOUS",
  "PROMOTION_BOGO_STACKING_INVALID",
  "PROMOTION_BOGO_TARGET_OVERLAP_INVALID",
  "PROMOTION_ALREADY_ACTIVE",
  "PROMOTION_RETIRED",
  "PROMOTION_STALE_REVISION",
  "PROMOTION_COMPLIMENTARY_INVALID",
  "PROMOTION_COMPLIMENTARY_ACTIVE_CONFLICT",
  "PROMOTION_COMPLIMENTARY_ACTIVATION_RACE",
  "PROMOTION_NOT_FOUND",
  "COUPON_CODE_INVALID",
  "COUPON_CODE_CONFLICT",
  "COUPON_WINDOW_INVALID",
  "COUPON_PROMOTION_NOT_ACTIVE",
  "COUPON_NOT_DRAFT",
  "COUPON_NOT_FOUND",
  "COUPON_IMMUTABLE",
  "COUPON_STALE_REVISION",
  "validation",
  "not_found",
  "conflict",
  "invalid_state",
] as const;
export type PromotionAdminErrorCode = (typeof PROMOTION_ADMIN_ERROR_CODES)[number];
