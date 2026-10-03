/**
 * Safe Order projections (IMP-023).
 */

import type { CheckoutSnapshot } from "../../shared/checkout";
import {
  serializeMoneyMinor,
  serializeOrderRevision,
  type CustomerOrderDetail,
  type CustomerOrderSummary,
  type Order,
  type OrderLineProjection,
  type OrderMutationResult,
  type OrderOutletSummary,
  type OrderScheduledWindowProjection,
  type WorkforceOrderCustomerVerification,
  type WorkforceOrderDetail,
  type WorkforceOrderSummary,
} from "../../shared/order";
import { moneySummaryFromSnapshot } from "../../shared/order/money-summary";
import { deriveScheduledOperationalCue } from "../../shared/scheduled-fulfilment/operational-cues";
import { presentScheduledWindow } from "../../shared/scheduled-fulfilment/presentation";

function paymentSatisfaction(order: Order) {
  return order.paymentProvenanceKind === "PAYMENT"
    ? ("PAID" as const)
    : ("NO_PAYMENT_REQUIRED" as const);
}

function moneyFromSnapshot(snapshot: {
  grandTotalPaise: bigint;
  currency: string;
}) {
  return Object.freeze({
    grandTotalMinor: serializeMoneyMinor(snapshot.grandTotalPaise),
    currency: "INR" as const,
  });
}

function destinationFromSnapshot(snapshot: CheckoutSnapshot) {
  if (snapshot.fulfilmentMode !== "DELIVERY") return null;
  const dest = snapshot.destination;
  if (dest === null) return null;
  return Object.freeze({
    recipientName: dest.recipientName,
    recipientPhone: dest.recipientPhone,
    addressLine1: dest.addressLine1,
    addressLine2: dest.addressLine2,
    landmark: dest.landmark,
    locality: dest.locality,
    city: dest.city,
    stateCode: dest.stateCode,
    postalCode: dest.postalCode,
    label: dest.label,
  });
}

function pickupLocationFromSnapshot(snapshot: CheckoutSnapshot) {
  if (snapshot.fulfilmentMode !== "PICKUP") return null;
  const pickup = snapshot.pickupLocation;
  if (pickup === null) return null;
  return Object.freeze({
    displayName: pickup.displayName,
    addressLine1: pickup.addressLine1,
    addressLine2: pickup.addressLine2,
    locality: pickup.locality,
    city: pickup.city,
    stateCode: pickup.stateCode,
    postalCode: pickup.postalCode,
    instructions: pickup.instructions,
  });
}

function scheduledWindowProjection(input: {
  fulfilmentTiming?: "ASAP" | "SCHEDULED";
  scheduledWindowStartAt?: Date | null;
  scheduledWindowEndAt?: Date | null;
  scheduledTimezone?: string | null;
}): OrderScheduledWindowProjection | null {
  if (input.fulfilmentTiming !== "SCHEDULED") return null;
  if (!input.scheduledWindowStartAt || !input.scheduledWindowEndAt || !input.scheduledTimezone) {
    return null;
  }
  const presented = presentScheduledWindow({
    startAt: input.scheduledWindowStartAt,
    endAt: input.scheduledWindowEndAt,
    timeZone: input.scheduledTimezone,
  });
  return Object.freeze({
    startAt: presented.startAt,
    endAt: presented.endAt,
    timeZone: presented.timeZone,
    localDate: presented.localDate,
    label: presented.label,
  });
}

function linesFromSnapshot(
  snapshot: CheckoutSnapshot,
): readonly OrderLineProjection[] {
  return Object.freeze(
    snapshot.lines.map((line) =>
      Object.freeze({
        productName: line.productName,
        variantName: line.variantName,
        quantity: line.quantity,
        lineTotalMinor: serializeMoneyMinor(line.lineTotalPaise),
        lineOrigin: line.lineOrigin,
        modifiers: Object.freeze(
          line.modifiers.map((m) =>
            Object.freeze({
              groupName: m.groupName,
              optionName: m.optionName,
              quantity: m.quantity,
            }),
          ),
        ),
      }),
    ),
  );
}

export function toCustomerOrderSummary(
  order: Order,
  outlet: OrderOutletSummary,
  snapshot: {
    grandTotalPaise: bigint;
    currency: string;
    fulfilmentMode: "DELIVERY" | "PICKUP";
    fulfilmentTiming?: "ASAP" | "SCHEDULED";
    scheduledWindowStartAt?: Date | null;
    scheduledWindowEndAt?: Date | null;
    scheduledTimezone?: string | null;
  },
): CustomerOrderSummary {
  const fulfilmentTiming = snapshot.fulfilmentTiming === "SCHEDULED" ? "SCHEDULED" : "ASAP";
  return Object.freeze({
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    revision: serializeOrderRevision(order.revision),
    createdAt: order.createdAt,
    money: moneyFromSnapshot(snapshot),
    paymentSatisfaction: paymentSatisfaction(order),
    outlet,
    fulfilmentMode: snapshot.fulfilmentMode,
    fulfilmentTiming,
    scheduledWindow: scheduledWindowProjection({ ...snapshot, fulfilmentTiming }),
  });
}

export function toCustomerOrderDetail(
  order: Order,
  outlet: OrderOutletSummary,
  snapshot: CheckoutSnapshot,
  delivery: CustomerOrderDetail["delivery"] = null,
): CustomerOrderDetail {
  return Object.freeze({
    ...toCustomerOrderSummary(order, outlet, snapshot),
    updatedAt: order.updatedAt,
    acceptedAt: order.acceptedAt,
    fulfilledAt: order.fulfilledAt,
    cancelledAt: order.cancelledAt,
    cancellationReasonCode: order.cancellationReasonCode,
    destination: destinationFromSnapshot(snapshot),
    pickupLocation: pickupLocationFromSnapshot(snapshot),
    lines: linesFromSnapshot(snapshot),
    moneySummary: moneySummaryFromSnapshot(snapshot),
    delivery,
  });
}

export function toWorkforceOrderSummary(
  order: Order,
  outlet: OrderOutletSummary,
  snapshot: {
    grandTotalPaise: bigint;
    currency: string;
    fulfilmentMode: "DELIVERY" | "PICKUP";
    fulfilmentTiming?: "ASAP" | "SCHEDULED";
    scheduledWindowStartAt?: Date | null;
    scheduledWindowEndAt?: Date | null;
    scheduledTimezone?: string | null;
  },
  now: Date = new Date(),
): WorkforceOrderSummary {
  const fulfilmentTiming = snapshot.fulfilmentTiming === "SCHEDULED" ? "SCHEDULED" : "ASAP";
  const scheduledWindow = scheduledWindowProjection({ ...snapshot, fulfilmentTiming });
  return Object.freeze({
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    revision: serializeOrderRevision(order.revision),
    createdAt: order.createdAt,
    acceptedAt: order.acceptedAt,
    fulfilledAt: order.fulfilledAt,
    cancelledAt: order.cancelledAt,
    money: moneyFromSnapshot(snapshot),
    outlet,
    fulfilmentMode: snapshot.fulfilmentMode,
    fulfilmentTiming,
    scheduledWindow,
    operationalCue: deriveScheduledOperationalCue({
      fulfilmentTiming,
      windowStartAt: scheduledWindow?.startAt ?? null,
      windowEndAt: scheduledWindow?.endAt ?? null,
      now,
      orderStatus: order.status,
    }),
  });
}

export function toWorkforceOrderDetail(
  order: Order,
  outlet: OrderOutletSummary,
  snapshot: CheckoutSnapshot,
  customer: WorkforceOrderCustomerVerification | null = null,
): WorkforceOrderDetail {
  const isPickup = snapshot.fulfilmentMode === "PICKUP";
  return Object.freeze({
    ...toWorkforceOrderSummary(order, outlet, snapshot),
    updatedAt: order.updatedAt,
    paymentProvenanceKind: order.paymentProvenanceKind,
    acceptedByWorkforceUserId: order.acceptedByWorkforceUserId,
    fulfilledByWorkforceUserId: order.fulfilledByWorkforceUserId,
    cancelledByWorkforceUserId: order.cancelledByWorkforceUserId,
    cancellationReasonCode: order.cancellationReasonCode,
    destination: destinationFromSnapshot(snapshot),
    pickupLocation: pickupLocationFromSnapshot(snapshot),
    // Pickup handover verification only — Delivery uses destination recipient.
    customer: isPickup ? customer : null,
    lines: linesFromSnapshot(snapshot),
  });
}

export function toOrderMutationResult(order: Order): OrderMutationResult {
  const base: OrderMutationResult = {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    revision: serializeOrderRevision(order.revision),
    updatedAt: order.updatedAt,
  };
  if (order.status === "FULFILLED") {
    return Object.freeze({
      ...base,
      acceptedAt: order.acceptedAt,
      fulfilledAt: order.fulfilledAt,
    });
  }
  if (order.status === "CANCELLED") {
    return Object.freeze({
      ...base,
      acceptedAt: order.acceptedAt,
      cancelledAt: order.cancelledAt,
      cancellationReasonCode: order.cancellationReasonCode,
    });
  }
  if (order.status === "ACCEPTED") {
    return Object.freeze({ ...base, acceptedAt: order.acceptedAt });
  }
  return Object.freeze(base);
}

export function outletSummaryFromOutlet(outlet: {
  id: string;
  brandId: string;
  code: string;
  name: string;
}): OrderOutletSummary {
  return Object.freeze({
    outletId: outlet.id,
    brandId: outlet.brandId,
    code: outlet.code,
    name: outlet.name,
  });
}
