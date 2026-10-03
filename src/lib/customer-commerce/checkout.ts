/**
 * Checkout transport wrappers through evaluate (IMP-025).
 */
import { commerceRequest, type CommerceHttpResult } from "./http";
import type {
  CommerceCheckout,
  CommerceCheckoutSnapshot,
  CommerceDestinationInput,
} from "./types";

type CheckoutEnvelope = Readonly<{ ok: true; checkout: CommerceCheckout | null }>;
type EvaluateEnvelope = Readonly<{
  ok: true;
  checkout: CommerceCheckout;
  snapshot: CommerceCheckoutSnapshot;
  evaluationId?: string;
  reviewSurfaceToken?: string;
  quote?: { commercialExplanation?: unknown };
}>;

export async function getActiveCheckout(input: {
  cartId?: string;
  checkoutId?: string;
}): Promise<CommerceHttpResult<{ checkout: CommerceCheckout | null }>> {
  const result = await commerceRequest<CheckoutEnvelope>("/api/v1/checkouts/active", {
    method: "GET",
    query: {
      cartId: input.cartId,
      checkoutId: input.checkoutId,
    },
  });
  if (!result.ok) return result;
  return { ok: true, status: result.status, data: { checkout: result.data.checkout } };
}

export async function startCheckout(input: {
  cartId: string;
  cartActivationId?: string;
}): Promise<CommerceHttpResult<{ checkout: CommerceCheckout }>> {
  const body: Record<string, unknown> = { cartId: input.cartId };
  if (input.cartActivationId) body.cartActivationId = input.cartActivationId;
  const result = await commerceRequest<CheckoutEnvelope>("/api/v1/checkouts", {
    method: "POST",
    body,
  });
  if (!result.ok) return result;
  if (!result.data.checkout) {
    return { ok: false, code: "INVALID_RESPONSE", status: result.status };
  }
  return { ok: true, status: result.status, data: { checkout: result.data.checkout } };
}

export async function setCheckoutDestination(input: {
  checkoutId: string;
  expectedCheckoutRevision: string;
  destination: CommerceDestinationInput;
}): Promise<CommerceHttpResult<{ checkout: CommerceCheckout }>> {
  const result = await commerceRequest<CheckoutEnvelope>(
    `/api/v1/checkouts/${input.checkoutId}/destination`,
    {
      method: "PUT",
      body: {
        expectedCheckoutRevision: input.expectedCheckoutRevision,
        destination: input.destination,
      },
    },
  );
  if (!result.ok) return result;
  if (!result.data.checkout) {
    return { ok: false, code: "INVALID_RESPONSE", status: result.status };
  }
  return { ok: true, status: result.status, data: { checkout: result.data.checkout } };
}

export async function clearCheckoutDestination(input: {
  checkoutId: string;
  expectedCheckoutRevision: string;
}): Promise<CommerceHttpResult<{ checkout: CommerceCheckout }>> {
  const result = await commerceRequest<CheckoutEnvelope>(
    `/api/v1/checkouts/${input.checkoutId}/destination/clear`,
    {
      method: "POST",
      body: { expectedCheckoutRevision: input.expectedCheckoutRevision },
    },
  );
  if (!result.ok) return result;
  if (!result.data.checkout) {
    return { ok: false, code: "INVALID_RESPONSE", status: result.status };
  }
  return { ok: true, status: result.status, data: { checkout: result.data.checkout } };
}

export async function evaluateCheckout(input: {
  checkoutId: string;
  expectedCheckoutRevision: string;
}): Promise<
  CommerceHttpResult<{
    checkout: CommerceCheckout;
    snapshot: CommerceCheckoutSnapshot;
    evaluationId?: string;
    reviewSurfaceToken?: string;
    quote?: { commercialExplanation?: unknown };
  }>
> {
  const result = await commerceRequest<EvaluateEnvelope>(
    `/api/v1/checkouts/${input.checkoutId}/evaluate`,
    {
      method: "POST",
      body: { expectedCheckoutRevision: input.expectedCheckoutRevision },
    },
  );
  if (!result.ok) return result;
  return {
    ok: true,
    status: result.status,
    data: {
      checkout: result.data.checkout,
      snapshot: result.data.snapshot,
      evaluationId: result.data.evaluationId,
      reviewSurfaceToken: result.data.reviewSurfaceToken,
      quote: result.data.quote,
    },
  };
}

export type CommercePickupOption = Readonly<{
  outletId: string;
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

type PickupOptionsEnvelope = Readonly<{
  ok: true;
  outlets: readonly CommercePickupOption[];
  selectionPolicy: "UNAVAILABLE" | "AUTO_SELECT" | "CUSTOMER_SELECT";
}>;

export async function listCheckoutPickupOptions(input: {
  checkoutId: string;
}): Promise<
  CommerceHttpResult<{
    outlets: readonly CommercePickupOption[];
    selectionPolicy: "UNAVAILABLE" | "AUTO_SELECT" | "CUSTOMER_SELECT";
  }>
> {
  const result = await commerceRequest<PickupOptionsEnvelope>(
    `/api/v1/checkouts/${input.checkoutId}/pickup-options`,
    { method: "GET" },
  );
  if (!result.ok) return result;
  return {
    ok: true,
    status: result.status,
    data: {
      outlets: result.data.outlets,
      selectionPolicy: result.data.selectionPolicy,
    },
  };
}

export async function setCheckoutFulfilment(input: {
  checkoutId: string;
  expectedCheckoutRevision: string;
  fulfilmentMode: "DELIVERY" | "PICKUP";
  pickupOutletId?: string | null;
}): Promise<CommerceHttpResult<{ checkout: CommerceCheckout }>> {
  const body: Record<string, unknown> = {
    expectedCheckoutRevision: input.expectedCheckoutRevision,
    fulfilmentMode: input.fulfilmentMode,
  };
  if (input.pickupOutletId !== undefined) {
    body.pickupOutletId = input.pickupOutletId;
  }
  const result = await commerceRequest<CheckoutEnvelope>(
    `/api/v1/checkouts/${input.checkoutId}/fulfilment`,
    {
      method: "POST",
      body,
    },
  );
  if (!result.ok) return result;
  if (!result.data.checkout) {
    return { ok: false, code: "INVALID_RESPONSE", status: result.status };
  }
  return { ok: true, status: result.status, data: { checkout: result.data.checkout } };
}

export type CommerceScheduledWindow = Readonly<{
  startAt: string;
  endAt: string;
  localDate: string;
  day: "TODAY" | "TOMORROW";
  timeZone: string;
  label: string;
}>;

export type CommerceScheduledWindows = Readonly<{
  availability: "AVAILABLE" | "NO_TIMES" | "DESTINATION_REQUIRED" | "OUTLET_REQUIRED" | "UNAVAILABLE";
  message: string | null;
  timeZone: string | null;
  todayLocalDate: string | null;
  tomorrowLocalDate: string | null;
  cancellationCutoffMinutes: number | null;
  windows: readonly CommerceScheduledWindow[];
}>;

export async function listCheckoutScheduledWindows(input: {
  checkoutId: string;
}): Promise<CommerceHttpResult<CommerceScheduledWindows>> {
  const result = await commerceRequest<CommerceScheduledWindows & { ok: true }>(
    `/api/v1/checkouts/${input.checkoutId}/scheduled-windows`,
    { method: "GET" },
  );
  if (!result.ok) return result;
  return {
    ok: true,
    status: result.status,
    data: {
      availability: result.data.availability,
      message: result.data.message,
      timeZone: result.data.timeZone,
      todayLocalDate: result.data.todayLocalDate,
      tomorrowLocalDate: result.data.tomorrowLocalDate,
      cancellationCutoffMinutes: result.data.cancellationCutoffMinutes,
      windows: result.data.windows,
    },
  };
}

export async function setCheckoutFulfilmentTiming(input: {
  checkoutId: string;
  expectedCheckoutRevision: string;
  fulfilmentTiming: "ASAP" | "SCHEDULED";
  scheduledWindowStartAt?: string | null;
  scheduledWindowEndAt?: string | null;
}): Promise<CommerceHttpResult<{ checkout: CommerceCheckout }>> {
  const body: Record<string, unknown> = {
    expectedCheckoutRevision: input.expectedCheckoutRevision,
    fulfilmentTiming: input.fulfilmentTiming,
  };
  if (input.fulfilmentTiming === "SCHEDULED") {
    body.scheduledWindowStartAt = input.scheduledWindowStartAt;
    body.scheduledWindowEndAt = input.scheduledWindowEndAt;
  }
  const result = await commerceRequest<CheckoutEnvelope>(
    `/api/v1/checkouts/${input.checkoutId}/fulfilment-timing`,
    { method: "POST", body },
  );
  if (!result.ok) return result;
  if (!result.data.checkout) {
    return { ok: false, code: "INVALID_RESPONSE", status: result.status };
  }
  return { ok: true, status: result.status, data: { checkout: result.data.checkout } };
}
