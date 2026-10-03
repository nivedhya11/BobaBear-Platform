/**
 * Map server commercial explanation + quote fields to customer presentation.
 * Does not calculate eligibility, savings, or payable.
 */

import { formatPaise } from "@/components/ordering/format-money";
import {
  copyAppliedReason,
  copyThreshold,
  IMP036J_COPY,
} from "@/components/ordering/imp036j-copy";

export type CouponPresentationClass =
  | "COUPON_APPLIED"
  | "COUPON_VALID_NOT_SELECTED"
  | "COUPON_EQUAL_PAYABLE_SELECTED"
  | "COUPON_EQUAL_PAYABLE_NOT_SELECTED";

export type WireCommercialExplanation = Readonly<{
  couponPresentationClass: CouponPresentationClass | null;
  merchandiseOrOrderSavingPaise: string;
  deliverySavingPaise: string;
  totalSavedPaise: string;
  grandTotalPaise: string;
  thresholdProgress: Readonly<{
    remainingAmountPaise: string | null;
    remainingItemQuantity: number | null;
    displayName: string;
    benefitType: string;
  }> | null;
  complimentary:
    | Readonly<{
        competingOffers: "NONE";
        productId: string;
        variantId: string;
        quantity: 1;
        merchandiseChargePaise: "0" | 0;
        itemName?: string;
      }>
    | Readonly<{ competingOffers: "NONE_CHOSEN" }>
    | null;
  submittedCouponResult: Readonly<{
    status: string;
    reasonCode: string;
    canonicalCode: string | null;
  }> | null;
}>;

export type OfferStatusTone = "polite" | "alert";

export type CartAmountKind = "estimated-subtotal" | "current-checkout-total" | "waiting";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function paiseString(value: unknown): string | null {
  if (typeof value === "string" && /^-?\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return null;
}

export function parseCommercialExplanation(
  quote: unknown,
): WireCommercialExplanation | null {
  if (!isRecord(quote)) return null;
  const raw = quote.commercialExplanation;
  if (!isRecord(raw)) return null;
  const order = paiseString(raw.merchandiseOrOrderSavingPaise);
  const delivery = paiseString(raw.deliverySavingPaise);
  const total = paiseString(raw.totalSavedPaise);
  const payable = paiseString(raw.grandTotalPaise);
  if (!order || !delivery || !total || !payable) return null;
  const couponClass = raw.couponPresentationClass;
  const allowed: readonly CouponPresentationClass[] = [
    "COUPON_APPLIED",
    "COUPON_VALID_NOT_SELECTED",
    "COUPON_EQUAL_PAYABLE_SELECTED",
    "COUPON_EQUAL_PAYABLE_NOT_SELECTED",
  ];
  let thresholdProgress: WireCommercialExplanation["thresholdProgress"] = null;
  if (isRecord(raw.thresholdProgress)) {
    const remaining = paiseString(raw.thresholdProgress.remainingAmountPaise);
    const name =
      typeof raw.thresholdProgress.displayName === "string"
        ? raw.thresholdProgress.displayName
        : "";
    const benefitType =
      typeof raw.thresholdProgress.benefitType === "string"
        ? raw.thresholdProgress.benefitType
        : "";
    const qty =
      typeof raw.thresholdProgress.remainingItemQuantity === "number"
        ? raw.thresholdProgress.remainingItemQuantity
        : null;
    if (name.length > 0) {
      thresholdProgress = {
        remainingAmountPaise: remaining,
        remainingItemQuantity: qty,
        displayName: name,
        benefitType,
      };
    }
  }
  let complimentary: WireCommercialExplanation["complimentary"] = null;
  if (isRecord(raw.complimentary)) {
    if (raw.complimentary.competingOffers === "NONE_CHOSEN") {
      complimentary = { competingOffers: "NONE_CHOSEN" };
    } else if (raw.complimentary.competingOffers === "NONE") {
      complimentary = {
        competingOffers: "NONE",
        productId: String(raw.complimentary.productId ?? ""),
        variantId: String(raw.complimentary.variantId ?? ""),
        quantity: 1,
        merchandiseChargePaise: "0",
        itemName:
          typeof raw.complimentary.itemName === "string"
            ? raw.complimentary.itemName
            : undefined,
      };
    }
  }
  let submitted: WireCommercialExplanation["submittedCouponResult"] = null;
  if (isRecord(raw.submittedCouponResult)) {
    submitted = {
      status: String(raw.submittedCouponResult.status ?? ""),
      reasonCode: String(raw.submittedCouponResult.reasonCode ?? ""),
      canonicalCode:
        typeof raw.submittedCouponResult.canonicalCode === "string"
          ? raw.submittedCouponResult.canonicalCode
          : null,
    };
  }
  return {
    couponPresentationClass:
      typeof couponClass === "string" &&
      allowed.includes(couponClass as CouponPresentationClass)
        ? (couponClass as CouponPresentationClass)
        : null,
    merchandiseOrOrderSavingPaise: order,
    deliverySavingPaise: delivery,
    totalSavedPaise: total,
    grandTotalPaise: payable,
    thresholdProgress,
    complimentary,
    submittedCouponResult: submitted,
  };
}

export function merchandiseSubtotalFromQuote(quote: unknown): string | null {
  if (!isRecord(quote)) return null;
  const base = paiseString(quote.basePaise);
  const modifiers = paiseString(quote.modifierAdjustmentsPaise) ?? "0";
  const bundles = paiseString(quote.bundleAdjustmentsPaise) ?? "0";
  if (!base) return null;
  return (BigInt(base) + BigInt(modifiers) + BigInt(bundles)).toString();
}

export function couponStatusCopy(input: {
  explanation: WireCommercialExplanation | null;
  fulfilmentMode?: "DELIVERY" | "PICKUP" | null;
  retainedAutomaticOffer?: boolean;
}): Readonly<{ text: string; tone: OfferStatusTone }> | null {
  const explanation = input.explanation;
  const submitted = explanation?.submittedCouponResult;
  if (submitted?.status === "INVALID") {
    return { text: IMP036J_COPY.INVALID, tone: "alert" };
  }
  if (
    submitted?.reasonCode === "NOT_EFFECTIVE" ||
    submitted?.reasonCode === "RETIRED" ||
    submitted?.reasonCode === "COUPON_EXPIRED"
  ) {
    return { text: IMP036J_COPY.EXPIRED, tone: "alert" };
  }
  if (submitted?.status === "CUSTOMER_IDENTITY_REQUIRED") {
    return { text: IMP036J_COPY.SIGN_IN, tone: "alert" };
  }
  if (
    submitted?.reasonCode === "GLOBAL_CAP_REACHED" ||
    submitted?.reasonCode === "NO_QUALIFYING_CAPACITY"
  ) {
    return { text: IMP036J_COPY.GLOBAL_CAP, tone: "alert" };
  }
  if (submitted?.reasonCode === "PERSONAL_CAP_REACHED") {
    return { text: IMP036J_COPY.PERSONAL_CAP, tone: "alert" };
  }
  if (submitted?.reasonCode === "FULFILMENT_MODE_MISMATCH") {
    if (input.fulfilmentMode === "PICKUP") {
      return { text: IMP036J_COPY.INAPPLICABLE_DELIVERY, tone: "alert" };
    }
    if (input.fulfilmentMode === "DELIVERY") {
      return { text: IMP036J_COPY.INAPPLICABLE_PICKUP, tone: "alert" };
    }
    return { text: IMP036J_COPY.INAPPLICABLE, tone: "alert" };
  }
  if (submitted?.status === "NOT_APPLICABLE") {
    return { text: IMP036J_COPY.INAPPLICABLE, tone: "alert" };
  }
  const couponClass = explanation?.couponPresentationClass;
  if (couponClass === "COUPON_APPLIED") {
    return { text: IMP036J_COPY.APPLIED_COUPON, tone: "polite" };
  }
  if (couponClass === "COUPON_VALID_NOT_SELECTED") {
    return { text: IMP036J_COPY.STRICT_KEEP, tone: "polite" };
  }
  if (couponClass === "COUPON_EQUAL_PAYABLE_SELECTED") {
    return { text: IMP036J_COPY.EQUAL_SELECTED, tone: "polite" };
  }
  if (couponClass === "COUPON_EQUAL_PAYABLE_NOT_SELECTED") {
    return {
      text: input.retainedAutomaticOffer
        ? IMP036J_COPY.EQUAL_KEPT_OFFER
        : IMP036J_COPY.EQUAL_KEPT,
      tone: "polite",
    };
  }
  return null;
}

export function automaticStatusCopy(
  explanation: WireCommercialExplanation | null,
): Readonly<{ text: string; tone: OfferStatusTone }> | null {
  if (!explanation) return null;
  if (explanation.couponPresentationClass) return null;
  const order = BigInt(explanation.merchandiseOrOrderSavingPaise);
  const delivery = BigInt(explanation.deliverySavingPaise);
  const threshold = explanation.thresholdProgress;
  if (order > BigInt(0) || delivery > BigInt(0)) {
    if (threshold && threshold.displayName.length > 0 && BigInt(explanation.totalSavedPaise) > BigInt(0)) {
      return { text: copyAppliedReason(threshold.displayName), tone: "polite" };
    }
    return { text: IMP036J_COPY.APPLIED_AUTO, tone: "polite" };
  }
  return null;
}

export function thresholdCopy(
  explanation: WireCommercialExplanation | null,
): string | null {
  const progress = explanation?.thresholdProgress;
  if (!progress) return null;
  if (progress.remainingAmountPaise === null || progress.remainingAmountPaise.length === 0) {
    return null;
  }
  if (progress.displayName.length === 0) return null;
  return copyThreshold(formatPaise(progress.remainingAmountPaise), progress.displayName);
}

export function canReuseCheckoutEvaluation(input: {
  checkout: Readonly<{
    fulfilmentMode: string;
    sourceCartRevision: string;
    activeSnapshot: unknown;
  }> | null;
  cartRevision: string;
}): boolean {
  if (!input.checkout) return false;
  if (input.checkout.fulfilmentMode !== "DELIVERY" && input.checkout.fulfilmentMode !== "PICKUP") {
    return false;
  }
  if (input.checkout.sourceCartRevision !== input.cartRevision) return false;
  return input.checkout.activeSnapshot != null;
}

export function observedCoarseShapeFromCommitted(input: {
  complimentaryPresent: boolean;
  statusText: string | null;
  orderSavingPresent: boolean;
  deliverySavingPresent: boolean;
  thresholdPresent: boolean;
}): string {
  if (input.complimentaryPresent) return "COMPLIMENTARY_LINE";
  const status = input.statusText ?? "";
  if (status === IMP036J_COPY.EQUAL_SELECTED) return "EQUAL_PAYABLE_SELECTED";
  if (status === IMP036J_COPY.APPLIED_COUPON) return "COUPON_SELECTED";
  if (status === IMP036J_COPY.EQUAL_KEPT || status === IMP036J_COPY.EQUAL_KEPT_OFFER) {
    return "EQUAL_PAYABLE_NOT_SELECTED";
  }
  if (status === IMP036J_COPY.STRICT_KEEP) return "COUPON_VALID_NOT_SELECTED";
  if (input.orderSavingPresent && input.deliverySavingPresent) return "BOTH_SAVINGS";
  if (input.deliverySavingPresent) return "DELIVERY_SAVING";
  if (input.orderSavingPresent) return "ORDER_SAVING";
  if (status === IMP036J_COPY.APPLIED_AUTO || status.startsWith(IMP036J_COPY.APPLIED_REASON_PREFIX)) {
    return "AUTOMATIC_SAVING";
  }
  if (input.thresholdPresent) return "THRESHOLD_PROGRESS";
  return "NONE";
}
