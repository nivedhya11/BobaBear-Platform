/**
 * Cart transport wrappers (IMP-025). No Cart business rules.
 */
import { rememberGuestCartFromMutation, updateGuestCartRevision } from "./guest-token";
import { commerceRequest, type CommerceHttpResult } from "./http";
import type {
  CartReconciliationResolution,
  CommerceCart,
  CommerceCartEvaluation,
} from "./types";
import type {
  CartBundleSelectionInput,
  CartModifierSelectionInput,
} from "@/shared/cart/types";

type CartEnvelope = Readonly<{ ok: true; cart: CommerceCart | null; guestToken?: string }>;
type EvaluationEnvelope = Readonly<{ ok: true }> & CommerceCartEvaluation;

function rememberFromCartResult(
  brandId: string,
  result: CommerceHttpResult<CartEnvelope>,
): CommerceHttpResult<{ cart: CommerceCart; guestToken?: string }> {
  if (!result.ok) return result;
  if (!result.data.cart) {
    return { ok: false, code: "INVALID_RESPONSE", status: result.status };
  }
  rememberGuestCartFromMutation({
    brandId,
    cart: result.data.cart,
    guestToken: result.data.guestToken,
  });
  if (result.data.cart.ownerMode === "guest") {
    updateGuestCartRevision(result.data.cart.revision, result.data.cart.id);
  }
  return {
    ok: true,
    status: result.status,
    data: { cart: result.data.cart, guestToken: result.data.guestToken },
  };
}

export async function getActiveCart(
  brandId: string,
  options: Readonly<{ guestToken?: boolean }> = {},
): Promise<CommerceHttpResult<{ cart: CommerceCart | null }>> {
  const result = await commerceRequest<CartEnvelope>("/api/v1/cart", {
    method: "GET",
    query: { brandId },
    guestToken: options.guestToken ?? true,
  });
  if (!result.ok) return result;
  if (result.data.cart && result.data.cart.ownerMode === "guest") {
    rememberGuestCartFromMutation({ brandId, cart: result.data.cart });
  }
  return { ok: true, status: result.status, data: { cart: result.data.cart } };
}

export async function addCartLine(input: {
  brandId: string;
  variantId: string;
  quantity: number;
  modifiers?: readonly CartModifierSelectionInput[];
  expectedRevision?: string;
}): Promise<CommerceHttpResult<{ cart: CommerceCart; guestToken?: string }>> {
  const body: Record<string, unknown> = {
    brandId: input.brandId,
    variantId: input.variantId,
    quantity: input.quantity,
  };
  if (input.modifiers !== undefined) body.modifiers = input.modifiers;
  if (input.expectedRevision !== undefined) body.expectedRevision = input.expectedRevision;
  const result = await commerceRequest<CartEnvelope>("/api/v1/cart/lines", {
    method: "POST",
    body,
    guestToken: true,
  });
  return rememberFromCartResult(input.brandId, result);
}

export async function setCartLineQuantity(input: {
  brandId: string;
  cartLineId: string;
  quantity: number;
  expectedRevision: string;
}): Promise<CommerceHttpResult<{ cart: CommerceCart }>> {
  const result = await commerceRequest<CartEnvelope>(
    `/api/v1/cart/lines/${input.cartLineId}/quantity`,
    {
      method: "PATCH",
      body: {
        brandId: input.brandId,
        quantity: input.quantity,
        expectedRevision: input.expectedRevision,
      },
      guestToken: true,
    },
  );
  return rememberFromCartResult(input.brandId, result);
}

export async function decrementLatestCartVariant(input: {
  brandId: string;
  variantId: string;
  expectedRevision: string;
}): Promise<CommerceHttpResult<{ cart: CommerceCart }>> {
  const result = await commerceRequest<CartEnvelope>(
    `/api/v1/cart/variants/${input.variantId}/decrement`,
    { method: "POST", body: { brandId: input.brandId, expectedRevision: input.expectedRevision }, guestToken: true },
  );
  return rememberFromCartResult(input.brandId, result);
}

export async function updateCartLineConfiguration(input: {
  brandId: string;
  cartLineId: string;
  variantId: string;
  modifiers: readonly CartModifierSelectionInput[];
  bundleSelections: readonly CartBundleSelectionInput[];
  expectedRevision: string;
}): Promise<CommerceHttpResult<{ cart: CommerceCart }>> {
  const result = await commerceRequest<CartEnvelope>(
    `/api/v1/cart/lines/${input.cartLineId}/configuration`,
    {
      method: "PUT",
      body: {
        brandId: input.brandId,
        variantId: input.variantId,
        modifiers: input.modifiers,
        bundleSelections: input.bundleSelections,
        expectedRevision: input.expectedRevision,
      },
      guestToken: true,
    },
  );
  return rememberFromCartResult(input.brandId, result);
}

export async function removeCartLine(input: {
  brandId: string;
  cartLineId: string;
  expectedRevision: string;
}): Promise<CommerceHttpResult<{ cart: CommerceCart }>> {
  const result = await commerceRequest<CartEnvelope>(
    `/api/v1/cart/lines/${input.cartLineId}/remove`,
    {
      method: "POST",
      body: {
        brandId: input.brandId,
        expectedRevision: input.expectedRevision,
      },
      guestToken: true,
    },
  );
  return rememberFromCartResult(input.brandId, result);
}

export async function clearCart(input: {
  brandId: string;
  expectedRevision: string;
}): Promise<CommerceHttpResult<{ cart: CommerceCart }>> {
  const result = await commerceRequest<CartEnvelope>("/api/v1/cart/clear", {
    method: "POST",
    body: {
      brandId: input.brandId,
      expectedRevision: input.expectedRevision,
    },
    guestToken: true,
  });
  return rememberFromCartResult(input.brandId, result);
}

export async function applyCartCoupon(input: {
  brandId: string;
  couponCode: string;
  expectedRevision: string;
  sourceCommandId: string;
  reviewSurfaceToken?: string | null;
}): Promise<CommerceHttpResult<{ cart: CommerceCart }>> {
  const body: Record<string, unknown> = {
    brandId: input.brandId,
    couponCode: input.couponCode,
    expectedRevision: input.expectedRevision,
    sourceCommandId: input.sourceCommandId,
  };
  if (input.reviewSurfaceToken) body.reviewSurfaceToken = input.reviewSurfaceToken;
  const result = await commerceRequest<CartEnvelope>("/api/v1/cart/coupon", {
    method: "POST",
    body,
    guestToken: true,
  });
  return rememberFromCartResult(input.brandId, result);
}

export async function removeCartCoupon(input: {
  brandId: string;
  expectedRevision: string;
  sourceCommandId: string;
  reviewSurfaceToken?: string | null;
}): Promise<CommerceHttpResult<{ cart: CommerceCart }>> {
  const body: Record<string, unknown> = {
    brandId: input.brandId,
    expectedRevision: input.expectedRevision,
    sourceCommandId: input.sourceCommandId,
  };
  if (input.reviewSurfaceToken) body.reviewSurfaceToken = input.reviewSurfaceToken;
  const result = await commerceRequest<CartEnvelope>("/api/v1/cart/coupon/remove", {
    method: "POST",
    body,
    guestToken: true,
  });
  return rememberFromCartResult(input.brandId, result);
}

export async function recordCartCheckoutActivation(input: {
  brandId: string;
  activationId: string;
}): Promise<CommerceHttpResult<{ ok: true }>> {
  return commerceRequest("/api/v1/cart/checkout-activations", {
    method: "POST",
    body: { brandId: input.brandId, activationId: input.activationId },
    guestToken: true,
  });
}

export async function evaluateCart(input: {
  brandId: string;
  location?: Readonly<{
    postalCode?: string;
    coordinates: Readonly<{ latitude: string; longitude: string }>;
  }>;
}): Promise<CommerceHttpResult<CommerceCartEvaluation>> {
  const body: Record<string, unknown> = { brandId: input.brandId };
  if (input.location) body.location = input.location;
  const result = await commerceRequest<EvaluationEnvelope>("/api/v1/cart/evaluate", {
    method: "POST",
    body,
    guestToken: true,
  });
  if (!result.ok) return result;
  return { ok: true, status: result.status, data: result.data as CommerceCartEvaluation };
}

export async function claimGuestCart(input: {
  brandId: string;
  expectedGuestRevision: string;
}): Promise<CommerceHttpResult<{ cart: CommerceCart }>> {
  const result = await commerceRequest<CartEnvelope>("/api/v1/cart/claim", {
    method: "POST",
    body: {
      brandId: input.brandId,
      expectedGuestRevision: input.expectedGuestRevision,
    },
    guestToken: true,
  });
  return rememberFromCartResult(input.brandId, result);
}

export async function reconcileGuestCart(input: {
  brandId: string;
  expectedGuestRevision: string;
  expectedCustomerRevision: string;
  resolution?: CartReconciliationResolution;
}): Promise<CommerceHttpResult<{ cart: CommerceCart }>> {
  const body: Record<string, unknown> = {
    brandId: input.brandId,
    expectedGuestRevision: input.expectedGuestRevision,
    expectedCustomerRevision: input.expectedCustomerRevision,
  };
  if (input.resolution) body.resolution = input.resolution;
  const result = await commerceRequest<CartEnvelope>("/api/v1/cart/reconcile", {
    method: "POST",
    body,
    guestToken: true,
  });
  return rememberFromCartResult(input.brandId, result);
}
