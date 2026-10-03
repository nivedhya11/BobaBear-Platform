/**
 * IMP-036J Design Readiness COPY-* customer sentences.
 * Presentation only. Not commercial authority.
 */

export const IMP036J_COPY = Object.freeze({
  APPLIED_AUTO: "Offer applied.",
  APPLIED_REASON_PREFIX: "Offer applied. You reached ",
  COUPON_LABEL: "Coupon",
  COUPON_HINT: "Enter a code you already have.",
  APPLY: "Apply",
  CHECKING: "Checking this coupon",
  APPLIED_COUPON: "Coupon applied.",
  CHANGE: "Change",
  REMOVE: "Remove",
  INVALID: "That code isn't valid. Check it and try again.",
  EXPIRED: "This coupon has expired.",
  INAPPLICABLE: "This coupon doesn't apply to this order.",
  INAPPLICABLE_DELIVERY: "This coupon doesn't apply to this order. It applies to delivery orders.",
  INAPPLICABLE_PICKUP: "This coupon doesn't apply to this order. It applies to pickup orders.",
  SIGN_IN: "Sign in to use this coupon.",
  SIGN_IN_ACTION: "Sign in",
  RETRY_CODE: "Enter your coupon again.",
  STRICT_KEEP:
    "This coupon is valid. It doesn't improve your total, so we kept the better amount.",
  EQUAL_SELECTED: "Coupon applied. Your total stays the same.",
  EQUAL_KEPT: "This coupon is valid. It doesn't change your total.",
  EQUAL_KEPT_OFFER:
    "This coupon is valid. It doesn't change your total. Your current offer stays applied.",
  DROPPED: "This offer no longer applies.",
  DELIVERY_SAVING_ROW: "Delivery saving",
  ORDER_SAVING_ROW: "Order saving",
  TOTAL_SAVED_ROW: "Total saved",
  ESTIMATED_SUBTOTAL: "Estimated subtotal",
  CART_NOT_FINAL: "Delivery and the full total are confirmed at checkout.",
  CURRENT_CHECKOUT_TOTAL: "Current total",
  TOTAL_PAYABLE: "Total payable",
  DELIVERY_ROW: "Delivery",
  INCLUDED: "Included with your offer",
  STALE: "Your total changed before payment. Review the updated amount.",
  GIFT_GONE: "That included item is no longer available. Your total has been updated.",
  GIFT_CONFLICT: "An included item can't be added to this order.",
  RETRY: "We couldn't check this coupon. Try again.",
  RETRY_ACTION: "Try again",
  UPDATING: "Updating your total",
  CHECKING_TOTAL: "Checking your total",
  CONTINUE: "Checkout",
  CONTINUE_PAY: "Continue to payment",
  GLOBAL_CAP: "This offer has been fully used.",
  PERSONAL_CAP: "You've already used this offer.",
  PRICE_SUMMARY: "Price summary",
  BETTER_PRICE: "better price",
});

export function copyPurchased(amountText: string): string {
  return `You saved ${amountText} on this order.`;
}

export function copyThreshold(amountText: string, benefit: string): string {
  return `Add ${amountText} more to unlock ${benefit}.`;
}

export function copyAppliedReason(threshold: string): string {
  return `Offer applied. You reached ${threshold}.`;
}
