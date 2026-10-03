/**
 * Order domain types (IMP-023).
 */

import type {
  OrderCancellationReasonCode,
  OrderCartFinalizationDisposition,
  OrderCustomerPaymentSatisfaction,
  OrderMaterializationDisposition,
  OrderPaymentProvenanceKind,
  OrderRecoveryDisposition,
  OrderStatus,
} from "./constants";
import type { OrderMoneySummary } from "./money-summary";

export type OrderPolicy = Readonly<{
  /** Bounded Order-number collision retries before fail-closed. */
  orderNumberMaxAttempts: number;
  /** Bounded recovery discovery batch size. */
  recoveryBatchSize: number;
}>;

export type OrderClock = Readonly<{
  now: () => Date;
}>;

/** Internal Order aggregate (not a public transport projection). */
export type Order = Readonly<{
  id: string;
  orderNumber: string;
  checkoutId: string;
  checkoutSnapshotId: string;
  paymentProvenanceKind: OrderPaymentProvenanceKind;
  paymentId: string | null;
  status: OrderStatus;
  revision: bigint;
  createdAt: Date;
  updatedAt: Date;
  acceptedAt: Date | null;
  acceptedByWorkforceUserId: string | null;
  fulfilledAt: Date | null;
  fulfilledByWorkforceUserId: string | null;
  cancelledAt: Date | null;
  cancelledByWorkforceUserId: string | null;
  cancelledByCustomerAuthUserId: string | null;
  cancellationReasonCode: OrderCancellationReasonCode | null;
}>;

export type OrderMoney = Readonly<{
  /** Exact integer paise as decimal string. */
  grandTotalMinor: string;
  currency: "INR";
}>;

export type OrderOutletSummary = Readonly<{
  outletId: string;
  brandId: string;
  code: string;
  name: string;
}>;

export type OrderDestinationProjection = Readonly<{
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

/** IMP-036H — customer-facing pickup location on order detail (tranche C wires fully). */
export type OrderPickupLocationProjection = Readonly<{
  displayName: string;
  addressLine1: string;
  addressLine2: string | null;
  locality: string | null;
  city: string;
  stateCode: string;
  postalCode: string;
  instructions: string;
}>;

export type OrderLineProjection = Readonly<{
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

/**
 * Immutable purchased Scheduled window from the payment-bound Checkout Snapshot.
 * Never reconstructed from current Brand or Outlet configuration.
 */
export type OrderScheduledWindowProjection = Readonly<{
  startAt: Date;
  endAt: Date;
  timeZone: string;
  localDate: string;
  label: string;
}>;

export type CustomerOrderSummary = Readonly<{
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  revision: string;
  createdAt: Date;
  money: OrderMoney;
  paymentSatisfaction: OrderCustomerPaymentSatisfaction;
  outlet: OrderOutletSummary;
  /** IMP-036H — DELIVERY | PICKUP from sealed checkout snapshot. */
  fulfilmentMode: "DELIVERY" | "PICKUP";
  /** IMP-036I — ASAP | SCHEDULED from the sealed Checkout Snapshot. */
  fulfilmentTiming: "ASAP" | "SCHEDULED";
  /** Null for ASAP. Sealed window for SCHEDULED. */
  scheduledWindow: OrderScheduledWindowProjection | null;
}>;

export type CustomerOrderDetail = CustomerOrderSummary &
  Readonly<{
    updatedAt: Date;
    acceptedAt: Date | null;
    fulfilledAt: Date | null;
    cancelledAt: Date | null;
    cancellationReasonCode: OrderCancellationReasonCode | null;
    /** Null when fulfilmentMode is PICKUP. */
    destination: OrderDestinationProjection | null;
    /** Present when fulfilmentMode is PICKUP; otherwise null/absent. */
    pickupLocation?: OrderPickupLocationProjection | null;
    lines: readonly OrderLineProjection[];
    moneySummary: OrderMoneySummary;
    delivery: Readonly<{
      statusLabel: string;
      providerDisplayName: string | null;
      trackingUrl: string | null;
      lastUpdatedAt: Date;
    }> | null;
  }>;

export type WorkforceOrderSummary = Readonly<{
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  revision: string;
  createdAt: Date;
  acceptedAt: Date | null;
  fulfilledAt: Date | null;
  cancelledAt: Date | null;
  money: OrderMoney;
  outlet: OrderOutletSummary;
  /** IMP-036H — DELIVERY | PICKUP from sealed checkout snapshot. */
  fulfilmentMode: "DELIVERY" | "PICKUP";
  /** IMP-036I — ASAP | SCHEDULED from the sealed Checkout Snapshot. */
  fulfilmentTiming: "ASAP" | "SCHEDULED";
  /** Null for ASAP. Sealed window for SCHEDULED. */
  scheduledWindow: OrderScheduledWindowProjection | null;
  /**
   * Derived presentation cue only. Not an Order status.
   * Null for ASAP and for terminal Orders.
   */
  operationalCue: "SCHEDULED" | "DUE_SOON" | "OVERDUE" | null;
}>;

/**
 * IMP-036H FD-036H-23 / AC-036H-039 — minimum customer identity for Pickup
 * handover verification. Projected from Checkout.customerAuthUserId →
 * customer_auth_users (not Snapshot PII, not FD recipients).
 */
export type WorkforceOrderCustomerVerification = Readonly<{
  displayName: string;
  /** Verified phone from customer auth when phoneNumberVerified; otherwise null. */
  verifiedPhoneE164: string | null;
}>;

export type WorkforceOrderDetail = WorkforceOrderSummary &
  Readonly<{
    updatedAt: Date;
    paymentProvenanceKind: OrderPaymentProvenanceKind;
    acceptedByWorkforceUserId: string | null;
    fulfilledByWorkforceUserId: string | null;
    cancelledByWorkforceUserId: string | null;
    cancellationReasonCode: OrderCancellationReasonCode | null;
    /** Null when fulfilmentMode is PICKUP. */
    destination: OrderDestinationProjection | null;
    /** Present when fulfilmentMode is PICKUP; otherwise null/absent. */
    pickupLocation?: OrderPickupLocationProjection | null;
    /**
     * Pickup handover verification identity (AC-036H-039). Present when
     * fulfilmentMode is PICKUP; otherwise null.
     */
    customer: WorkforceOrderCustomerVerification | null;
    lines: readonly OrderLineProjection[];
  }>;

export type OrderMutationResult = Readonly<{
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  revision: string;
  updatedAt: Date;
  acceptedAt?: Date | null;
  fulfilledAt?: Date | null;
  cancelledAt?: Date | null;
  cancellationReasonCode?: OrderCancellationReasonCode | null;
}>;

export type OrderMaterializationResult = Readonly<{
  disposition: OrderMaterializationDisposition;
  order: Order;
  cartFinalization: OrderCartFinalizationDisposition | null;
}>;

export type OrderRecoveryCursor = Readonly<{
  lastCheckoutUpdatedAt: Date;
  lastCheckoutId: string;
}>;

export type OrderRecoveryItemResult = Readonly<{
  checkoutId: string;
  disposition: OrderRecoveryDisposition;
  orderId?: string;
  orderNumber?: string;
}>;

export type OrderRecoveryBatchResult = Readonly<{
  results: readonly OrderRecoveryItemResult[];
  nextCursor: OrderRecoveryCursor | null;
}>;

export type AcceptOrderInput = Readonly<{
  orderId: string;
  expectedOrderRevision: bigint;
}>;

export type FulfilOrderInput = Readonly<{
  orderId: string;
  expectedOrderRevision: bigint;
}>;

export type CancelOrderInput = Readonly<{
  orderId: string;
  expectedOrderRevision: bigint;
  cancellationReasonCode: OrderCancellationReasonCode;
}>;

export type CancelCustomerScheduledOrderInput = Readonly<{
  orderId: string;
  expectedOrderRevision: bigint;
}>;

export type GetCustomerOrderInput = Readonly<{
  orderId: string;
}>;

export type ListCustomerOrdersInput = Readonly<{
  cursor?: string;
  limit?: number;
}>;

export type GetWorkforceOrderInput = Readonly<{
  orderId: string;
}>;

export type SearchWorkforceOrdersInput = Readonly<{
  orderNumber?: string;
  status?: OrderStatus;
  createdFrom?: Date;
  createdTo?: Date;
  brandId?: string;
  outletId?: string;
  cursor?: string;
  limit?: number;
}>;

export type RecoverMissingOrdersBatchInput = Readonly<{
  cursor?: OrderRecoveryCursor;
}>;
