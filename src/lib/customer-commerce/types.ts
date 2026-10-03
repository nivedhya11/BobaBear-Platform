/**
 * Browser-side wire types for customer-commerce (IMP-025).
 *
 * Revisions and money amounts arrive as decimal strings (D-360 bigint rule).
 * Dates arrive as ISO strings. These types describe transport JSON only.
 */

import type { CartBundleSelection, CartModifierSelection } from "@/shared/cart/types";

export type CommerceCartLine = Readonly<{
  id: string;
  variantId: string;
  quantity: number;
  modifiers: readonly CartModifierSelection[];
  bundleSelections: readonly CartBundleSelection[];
}>;

export type CommerceCart = Readonly<{
  id: string;
  brandId: string;
  ownerMode: "guest" | "customer";
  revision: string;
  manualCouponCode: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  lines: readonly CommerceCartLine[];
}>;

export type CommerceCartEvaluation = Readonly<{
  cartId: string;
  cartRevision: string;
  evaluatedAt: string;
  status: string;
  selectedOutletId?: string;
  problems?: readonly Readonly<{ cartLineId: string; code: string }>[];
  quote?: unknown;
  evaluationId?: string;
  serviceabilityReason?: string;
}>;

export type CommerceAddress = Readonly<{
  id: string;
  recipientName: string;
  recipientPhone: string;
  addressLine1: string;
  addressLine2: string | null;
  landmark: string | null;
  locality: string | null;
  city: string;
  stateCode: string;
  postalCode: string;
  coordinates: Readonly<{ latitude: string; longitude: string }> | null;
  label: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type CommerceAddressCreateInput = Readonly<{
  recipientName: string;
  recipientPhone: string;
  addressLine1: string;
  addressLine2?: string | null;
  landmark?: string | null;
  locality?: string | null;
  city: string;
  stateCode: string;
  postalCode: string;
  coordinates?: Readonly<{ latitude: string; longitude: string }> | null;
  label?: string | null;
  makeDefault?: boolean;
}>;

export type CommerceAddressUpdateInput = Readonly<{
  recipientName?: string;
  recipientPhone?: string;
  addressLine1?: string;
  addressLine2?: string | null;
  landmark?: string | null;
  locality?: string | null;
  city?: string;
  stateCode?: string;
  postalCode?: string;
  coordinates?: Readonly<{ latitude: string; longitude: string }> | null;
  label?: string | null;
}>;

export type CommerceProfile = Readonly<{
  id: string;
  givenName: string;
  familyName: string | null;
  email: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type CommerceProfileCreateInput = Readonly<{
  givenName: string;
  familyName?: string | null;
  email?: string | null;
}>;

export type CommerceProfileUpdateInput = Readonly<{
  givenName?: string | null;
  familyName?: string | null;
  email?: string | null;
}>;

export type CommerceServiceabilityStatus =
  | "SERVICEABLE"
  | "NOT_SERVICEABLE"
  | "TEMPORARILY_UNAVAILABLE"
  | "INDETERMINATE";

export type CommerceServiceabilityDecision = Readonly<{
  status: CommerceServiceabilityStatus;
  evaluatedAt: string;
  selectedOutletId?: string;
  reason?: string;
}>;

export type CommerceServiceabilityEvaluateInput = Readonly<{
  brandId: string;
  location: Readonly<{
    postalCode?: string;
    coordinates: Readonly<{ latitude: string; longitude: string }>;
  }>;
}>;

export type CommerceCheckoutDestination = Readonly<{
  destinationKind: "SAVED_ADDRESS" | "ONE_TIME_ADDRESS";
  sourceSavedAddressId: string | null;
  recipientName: string;
  recipientPhone: string;
  addressLine1: string;
  addressLine2: string | null;
  landmark: string | null;
  locality: string | null;
  city: string;
  stateCode: string;
  postalCode: string;
  coordinates: Readonly<{ latitude: string; longitude: string }> | null;
  label: string | null;
}>;

export type CommerceCheckoutPickupLocation = Readonly<{
  displayName: string;
  addressLine1: string;
  addressLine2: string | null;
  locality: string | null;
  city: string;
  stateCode: string;
  postalCode: string;
  instructions: string;
  coordinates: Readonly<{ latitude: string; longitude: string }> | null;
}>;

export type CommerceCheckoutSnapshot = Readonly<{
  id: string;
  checkoutId: string;
  checkoutRevision: string;
  sourceCartRevision: string;
  selectedOutletId: string;
  evaluatedAt: string;
  fulfilmentMode: "DELIVERY" | "PICKUP";
  fulfilmentTiming?: "ASAP" | "SCHEDULED";
  scheduledWindowStartAt?: string | null;
  scheduledWindowEndAt?: string | null;
  scheduledTimezone?: string | null;
  scheduledCancellationCutoffMinutes?: number | null;
  serviceabilityEvaluatedAt: string | null;
  currency: string;
  basePaise: string;
  chargesPaise: string;
  prePromotionSubtotalPaise: string;
  promotionDiscountPaise: string;
  taxablePaise: string;
  taxPaise: string;
  grandTotalPaise: string;
  taxInclusionMode: string;
  destination: CommerceCheckoutDestination | null;
  pickupLocation: CommerceCheckoutPickupLocation | null;
  lines: readonly unknown[];
  charges: readonly unknown[];
  promotionEffects: readonly unknown[];
  taxComponents: readonly unknown[];
}>;

export type CommerceCheckout = Readonly<{
  id: string;
  customerAuthUserId: string;
  brandId: string;
  cartId: string;
  sourceCartRevision: string;
  revision: string;
  status: string;
  expiresAt: string;
  fulfilmentMode: "DELIVERY" | "PICKUP";
  fulfilmentTiming?: "ASAP" | "SCHEDULED";
  scheduledWindowStartAt?: string | null;
  scheduledWindowEndAt?: string | null;
  pickupOutletId: string | null;
  activeSnapshotId: string | null;
  createdAt: string;
  updatedAt: string;
  destination: CommerceCheckoutDestination | null;
  activeSnapshot: CommerceCheckoutSnapshot | null;
}>;

export type SavedAddressDestinationInput = Readonly<{
  kind: "SAVED_ADDRESS";
  savedAddressId: string;
}>;

export type OneTimeAddressDestinationInput = Readonly<{
  kind: "ONE_TIME_ADDRESS";
  recipientName: string;
  recipientPhone: string;
  addressLine1: string;
  addressLine2?: string | null;
  landmark?: string | null;
  locality?: string | null;
  city: string;
  stateCode: string;
  postalCode: string;
  coordinates?: Readonly<{ latitude: string; longitude: string }> | null;
  label?: string | null;
}>;

export type CommerceDestinationInput =
  | SavedAddressDestinationInput
  | OneTimeAddressDestinationInput;

export type CartReconciliationResolution = "KEEP_GUEST" | "KEEP_CUSTOMER";

export type CommercePaymentMethodIntent = "upi" | "card" | "netbanking";

export type CommercePaymentStatus =
  | "OPEN"
  | "PROCESSING"
  | "SUCCEEDED"
  | "SUPERSEDED"
  | "CANCELLED"
  | "EXPIRED"
  | string;

export type CommercePaymentAttemptStatus =
  | "CREATED"
  | "PENDING"
  | "INDETERMINATE"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | string;

export type CommerceClientAction = Readonly<{
  kind: string;
  payload: Readonly<Record<string, string>>;
}>;

export type CommercePayment = Readonly<{
  id: string;
  checkoutId: string;
  checkoutSnapshotId: string;
  expectedAmountPaise: string;
  currency: string;
  status: CommercePaymentStatus;
  createdAt: string;
  updatedAt: string;
  succeededAt: string | null;
  cancelledAt: string | null;
  expiredAt: string | null;
  supersededAt: string | null;
}>;

export type CommercePaymentAttempt = Readonly<{
  id: string;
  paymentId: string;
  attemptOrdinal: string;
  provider: string;
  methodIntent: string;
  providerExecutionIdentity: string;
  status: CommercePaymentAttemptStatus;
  createdAt: string;
  updatedAt: string;
  pendingAt: string | null;
  indeterminateAt: string | null;
  succeededAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
}>;

export type CommercePaymentStartResult = Readonly<{
  kind: "payment_started";
  payment: CommercePayment;
  attempt: CommercePaymentAttempt;
  checkoutId: string;
  checkoutRevision: string;
  clientAction?: CommerceClientAction;
}>;

export type CommercePaymentState = Readonly<{
  payment: CommercePayment | null;
  attempt: CommercePaymentAttempt | null;
  attempts: readonly CommercePaymentAttempt[];
  checkoutId: string;
  checkoutStatus: string;
  checkoutRevision: string;
  zeroPayableCompleted: boolean;
  clientAction?: CommerceClientAction;
}>;

export type CommerceZeroPayableResult = Readonly<{
  kind: "zero_payable_completed";
  checkoutId: string;
  checkoutRevision: string;
  snapshotId: string;
}>;

export type CommerceOrderStatus = "PLACED" | "ACCEPTED" | "FULFILLED" | "CANCELLED";

export type CommerceOrderMoney = Readonly<{
  grandTotalMinor: string;
  currency: string;
}>;

export type CommerceOrderOutlet = Readonly<{
  outletId: string;
  brandId: string;
  code: string;
  name: string;
}>;

export type CommerceOrderSummary = Readonly<{
  orderId: string;
  orderNumber: string;
  status: string;
  revision: string;
  createdAt: string;
  money: CommerceOrderMoney;
  paymentSatisfaction: string;
  outlet: CommerceOrderOutlet;
  fulfilmentMode: "DELIVERY" | "PICKUP";
  fulfilmentTiming?: "ASAP" | "SCHEDULED";
  scheduledWindow?: Readonly<{
    startAt: string;
    endAt: string;
    timeZone: string;
    localDate: string;
    label: string;
  }> | null;
}>;

export type CommerceOrderDestination = Readonly<{
  recipientName: string;
  recipientPhone: string;
  addressLine1: string;
  addressLine2: string | null;
  landmark: string | null;
  locality: string | null;
  city: string;
  stateCode: string;
  postalCode: string;
  label: string | null;
}>;

export type CommerceOrderLine = Readonly<{
  productName: string;
  variantName: string;
  quantity: number;
  lineTotalMinor: string;
  lineOrigin?: "cart" | "complimentary_offer";
  modifiers: readonly Readonly<{
    groupName: string;
    optionName: string;
    quantity: number;
  }>[];
}>;

export type CommerceOrderDetail = CommerceOrderSummary &
  Readonly<{
    updatedAt: string;
    acceptedAt: string | null;
    fulfilledAt: string | null;
    cancelledAt: string | null;
    cancellationReasonCode: string | null;
    destination: CommerceOrderDestination | null;
    pickupLocation?: Readonly<{
      displayName: string;
      addressLine1: string;
      addressLine2: string | null;
      locality: string | null;
      city: string;
      stateCode: string;
      postalCode: string;
      instructions: string;
    }> | null;
    lines: readonly CommerceOrderLine[];
    moneySummary: Readonly<{
      prePromotionSubtotalMinor: string;
      promotionDiscountMinor: string;
      charges: readonly Readonly<{
        chargeCode: string;
        name: string;
        amountMinor: string;
      }>[];
      taxMinor: string;
      grandTotalMinor: string;
      currency: "INR";
    }>;
    delivery: Readonly<{
      statusLabel: string;
      providerDisplayName: string | null;
      trackingUrl: string | null;
      lastUpdatedAt: string;
    }> | null;
  }>;

/**
 * Wire projection for Slice-6 order Financial Document listing.
 * Money remains a decimal string of integer paise (never Number).
 */
export type CommerceFinancialDocumentStatutoryType =
  | "TAX_INVOICE"
  | "BILL_OF_SUPPLY"
  | "RECEIPT_VOUCHER"
  | "REFUND_VOUCHER"
  | "CREDIT_NOTE";

export type CommerceFinancialDocumentListItem = Readonly<{
  financialDocumentId: string;
  documentType: CommerceFinancialDocumentStatutoryType | string;
  statutoryDocumentNumber: string;
  issueAt: string;
  grandTotalPaise: string;
  currency: "INR" | string;
  orderId: string | null;
}>;