/**
 * Customer-commerce HTTP router (IMP-024).
 *
 * Exact-path façade over accepted application operations. No new business
 * authority.
 */
import "server-only";

import type { IncomingMessage, ServerResponse } from "node:http";

import { evaluateReadiness } from "../../../platform/observability/health";
import type { WorkerHealthReporter } from "../../../platform/observability/worker-health";

import {
  addCartLine,
  applyCartCoupon,
  claimGuestCart,
  clearCart,
  decrementLatestCartVariant,
  evaluateCart,
  getActiveCart,
  reconcileGuestCartWithCustomer,
  removeCartCoupon,
  removeCartLine,
  setCartLineQuantity,
  updateCartLineConfiguration,
  type CartAccess,
} from "../../cart";
import {
  clearCheckoutDestination,
  evaluateCheckout,
  getActiveCheckout,
  listCheckoutPickupOptions,
  listCheckoutScheduledWindows,
  setCheckoutDestination,
  setCheckoutFulfilment,
  setCustomerCheckoutFulfilmentTiming,
  startCheckout,
} from "../../checkout";
import {
  clearDefaultOwnAddress,
  createOwnAddress,
  deleteOwnAddress,
  getOwnAddress,
  listOwnAddresses,
  setDefaultOwnAddress,
  updateOwnAddress,
} from "../../customer-addresses";
import {
  createOwnCustomerProfile,
  deleteOwnCustomerProfile,
  getOwnCustomerProfile,
  updateOwnCustomerProfile,
} from "../../customer-profiles";
import { parseCancelCustomerScheduledOrderInput } from "../../../shared/order";
import {
  cancelCustomerScheduledOrder,
  getCustomerOrder,
  listCustomerOrders,
} from "../../order";
import {
  completeZeroPayableCheckout,
  getPayment,
  getPaymentState,
  retryPayment,
  startPayment,
  submitPaymentClientEvidence,
} from "../../payment";
import {
  generateCustomerFinancialDocumentArtifact,
  listFinancialDocumentsForCustomerOrder,
} from "../../financial-document";
import type { CustomerAuthRuntime } from "../../auth/customer";
import type { Persistence } from "../../persistence";
import {
  CUSTOMER_COMMERCE_CART_POLICY,
  CUSTOMER_COMMERCE_CHECKOUT_POLICY,
} from "../config";
import { CartError } from "../../../shared/cart";
import {
  requireTrustedIdentity,
  resolveOptionalTrustedIdentity,
  toAddressCustomerActor,
  toCartCustomerActor,
  toProfileCustomerActor,
} from "./auth";
import { mapCommerceError, mapInvalidRequest } from "./error-map";
import { extractGuestCartToken } from "./guest-token";
import { readJsonObjectBody, readOptionalJsonObjectBody } from "./request";
import { handleRazorpayWebhook, RAZORPAY_WEBHOOK_PATH } from "./razorpay-webhook";
import {
  handleMetaWhatsAppWebhook,
  META_WHATSAPP_WEBHOOK_PATH,
} from "./meta-whatsapp-webhook";
import { coerceRevisionFields } from "./revisions";
import { evaluateServiceability } from "../../serviceability";
import type { ServiceabilityDecision } from "../../../shared/serviceability";
import { projectCustomerMenu } from "../menu/project-customer-menu";
import type { LocationSearchProvider } from "../location/google-maps-provider";
import type { LocationRateLimiter } from "../location/rate-limit";
import {
  handleLocationAutocomplete,
  handleLocationPlace,
  handleLocationReverseGeocode,
  handleLocationStatus,
} from "../location/http";
import {
  CART_CHECKOUT_ACTIVATION_FIELDS,
  COMMERCE_OBSERVATION_FIELDS,
  persistCommerceObservation,
  recordCartCheckoutActivationForAccess,
} from "../measurement/observe-presentation";

import {
  sendJson,
  sendMethodNotAllowed,
  sendNoContent,
  sendNotFound,
  sendPdf,
} from "./response";

export type CustomerCommerceRouteDependencies = Readonly<{
  runtime: CustomerAuthRuntime;
  persistence: Persistence;
  /** Test/runtime override — production omits this (disabled provider). */
  paymentProvider?: import("../../payment/provider").PaymentProvider;
  /** Meta WhatsApp secrets when BOBA_BEAR_WHATSAPP_PROVIDER=meta_cloud_api. */
  metaWhatsApp?: import("../../notifications/provider/meta-whatsapp").MetaWhatsAppRuntimeSecrets | null;
  environment?: import("../../../platform/config").AppEnvironment;
  workers?: readonly WorkerHealthReporter[];
  locationProvider?: LocationSearchProvider | null;
  locationRateLimiter?: LocationRateLimiter;
}>;

export type CustomerCommerceRouteOutcome = Readonly<{
  operation: string;
  safeOutcomeCode: string;
  httpStatus: number;
}>;

function parseUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? "/", "http://customer-commerce.local");
}

function matchPath(
  pathname: string,
  pattern: string,
): Record<string, string> | null {
  const patternParts = pattern.split("/");
  const pathParts = pathname.split("/");
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const pp = patternParts[i]!;
    const vp = pathParts[i]!;
    if (pp.startsWith("{") && pp.endsWith("}")) {
      params[pp.slice(1, -1)] = vp;
      continue;
    }
    if (pp !== vp) return null;
  }
  return params;
}

async function readBody(
  req: IncomingMessage,
  requestId: string,
  res: ServerResponse,
  allowedFields?: readonly string[],
): Promise<Readonly<Record<string, unknown>> | null> {
  const result = await readJsonObjectBody(req, allowedFields);
  if (!result.ok) {
    const mapped = mapInvalidRequest(requestId);
    sendJson(res, mapped.body, { status: mapped.status, requestId });
    return null;
  }
  return coerceRevisionFields(result.value);
}

function withoutKeys(
  body: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  for (const key of keys) delete out[key];
  return out;
}

function requireBrandId(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new CartError("CART_INVALID_INPUT", "brandId is required.", {
      field: "brandId",
    });
  }
  return raw;
}

async function buildCartAccess(
  deps: CustomerCommerceRouteDependencies,
  req: IncomingMessage,
  brandId: string,
): Promise<CartAccess> {
  const identity = await resolveOptionalTrustedIdentity(deps.runtime, req.headers);
  const guestToken = extractGuestCartToken(req.headers);
  if (identity) {
    return {
      kind: "customer",
      actor: toCartCustomerActor(identity),
      brandId,
    };
  }
  return {
    kind: "guest",
    brandId,
    ...(guestToken !== undefined ? { guestToken } : {}),
  };
}

function outcome(
  operation: string,
  httpStatus: number,
  safeOutcomeCode: string,
): CustomerCommerceRouteOutcome {
  return { operation, safeOutcomeCode, httpStatus };
}

function projectServiceabilityDecision(
  decision: ServiceabilityDecision,
): Readonly<Record<string, unknown>> {
  const base = {
    status: decision.status,
    evaluatedAt: decision.evaluatedAt.toISOString(),
  };
  if (decision.status === "SERVICEABLE") {
    return { ...base, selectedOutletId: decision.selectedOutletId };
  }
  if (decision.status === "INDETERMINATE") {
    return { ...base, reason: decision.reason };
  }
  return base;
}

async function handleCaught(
  error: unknown,
  res: ServerResponse,
  requestId: string,
  operation: string,
): Promise<CustomerCommerceRouteOutcome> {
  const mapped = mapCommerceError(error, requestId);
  sendJson(res, mapped.body, { status: mapped.status, requestId });
  return outcome(operation, mapped.status, mapped.body.code);
}

/**
 * Route one customer-commerce request.
 */
export async function routeCustomerCommerceRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: CustomerCommerceRouteDependencies,
  requestId: string,
): Promise<CustomerCommerceRouteOutcome> {
  const method = (req.method ?? "GET").toUpperCase();
  const url = parseUrl(req);
  const pathname = url.pathname;

  if (pathname === "/health/live") {
    if (method !== "GET") {
      sendMethodNotAllowed(res, ["GET"], requestId);
      return outcome("health_live", 405, "METHOD_NOT_ALLOWED");
    }
    sendJson(res, { ok: true }, { status: 200, requestId });
    return outcome("health_live", 200, "OK");
  }

  if (pathname === "/health/ready") {
    if (method !== "GET") {
      sendMethodNotAllowed(res, ["GET"], requestId);
      return outcome("health_ready", 405, "METHOD_NOT_ALLOWED");
    }
    const readiness = await evaluateReadiness({
      persistence: deps.persistence,
      workers: deps.workers,
    });
    sendJson(
      res,
      { ok: readiness.ok, checks: readiness.checks },
      { status: readiness.ok ? 200 : 503, requestId },
    );
    return outcome("health_ready", readiness.ok ? 200 : 503, readiness.ok ? "OK" : "NOT_READY");
  }

  if (pathname === "/api/v1/cart" && method === "POST") {
    sendNotFound(res, requestId);
    return outcome("forbidden_create_cart", 404, "NOT_FOUND");
  }
  if (pathname.startsWith("/api/v1/menu/")) {
    sendNotFound(res, requestId);
    return outcome("forbidden_menu_subpath", 404, "NOT_FOUND");
  }
  if (pathname.startsWith("/api/auth/")) {
    sendNotFound(res, requestId);
    return outcome("forbidden_api_auth", 404, "NOT_FOUND");
  }

  if (pathname === RAZORPAY_WEBHOOK_PATH) {
    if (method !== "POST") {
      sendMethodNotAllowed(res, ["POST"], requestId);
      return outcome("razorpay_webhook", 405, "METHOD_NOT_ALLOWED");
    }
    return handleRazorpayWebhook(req, res, deps, requestId);
  }

  if (pathname === META_WHATSAPP_WEBHOOK_PATH) {
    if (method !== "GET" && method !== "POST") {
      sendMethodNotAllowed(res, ["GET", "POST"], requestId);
      return outcome("meta_whatsapp_webhook", 405, "METHOD_NOT_ALLOWED");
    }
    return handleMetaWhatsAppWebhook(
      req,
      res,
      {
        persistence: deps.persistence,
        environment: deps.environment ?? "local",
        metaWhatsApp: deps.metaWhatsApp,
      },
      requestId,
    );
  }

  try {

    if (pathname === "/api/v1/menu") {
      if (method !== "GET") {
        sendMethodNotAllowed(res, ["GET"], requestId);
        return outcome("get_menu", 405, "METHOD_NOT_ALLOWED");
      }
      const brandId = url.searchParams.get("brandId");
      if (!brandId) {
        throw new CartError("CART_INVALID_INPUT", "brandId is required.", {
          field: "brandId",
        });
      }
      const outletId = url.searchParams.get("outletId");
      const menu = await deps.persistence.withContext((context) =>
        projectCustomerMenu(context, {
          brandId,
          outletId,
        }),
      );
      sendJson(res, { ok: true, menu }, { status: 200, requestId });
      return outcome("get_menu", 200, "OK");
    }

    if (pathname === "/api/v1/location/status") {
      return handleLocationStatus(req, res, deps, requestId);
    }
    if (pathname === "/api/v1/location/autocomplete") {
      return handleLocationAutocomplete(req, res, deps, requestId);
    }
    if (pathname === "/api/v1/location/place") {
      return handleLocationPlace(req, res, deps, requestId);
    }
    if (pathname === "/api/v1/location/reverse-geocode") {
      return handleLocationReverseGeocode(req, res, deps, requestId);
    }

    if (pathname === "/api/v1/serviceability/evaluate") {
      if (method !== "POST") {
        sendMethodNotAllowed(res, ["POST"], requestId);
        return outcome("evaluate_serviceability", 405, "METHOD_NOT_ALLOWED");
      }
      const body = await readBody(req, requestId, res, ["brandId", "location"]);
      if (!body) return outcome("evaluate_serviceability", 400, "INVALID_REQUEST");
      const decision = await evaluateServiceability(deps.persistence, body);
      sendJson(
        res,
        { ok: true, decision: projectServiceabilityDecision(decision) },
        { status: 200, requestId },
      );
      return outcome("evaluate_serviceability", 200, "OK");
    }

    // Profile
    if (pathname === "/api/v1/me/profile") {
      const identity = await requireTrustedIdentity(deps.runtime, req.headers);
      const actor = toProfileCustomerActor(identity);
      if (method === "GET") {
        const profile = await getOwnCustomerProfile(deps.persistence, actor);
        sendJson(res, { ok: true, profile }, { status: 200, requestId });
        return outcome("get_profile", 200, "OK");
      }
      if (method === "POST") {
        const body = await readBody(req, requestId, res);
        if (!body) return outcome("create_profile", 400, "INVALID_REQUEST");
        const profile = await createOwnCustomerProfile(deps.persistence, actor, body);
        sendJson(res, { ok: true, profile }, { status: 201, requestId });
        return outcome("create_profile", 201, "OK");
      }
      if (method === "PATCH") {
        const body = await readBody(req, requestId, res);
        if (!body) return outcome("update_profile", 400, "INVALID_REQUEST");
        const profile = await updateOwnCustomerProfile(deps.persistence, actor, body);
        sendJson(res, { ok: true, profile }, { status: 200, requestId });
        return outcome("update_profile", 200, "OK");
      }
      if (method === "DELETE") {
        await deleteOwnCustomerProfile(deps.persistence, actor);
        sendNoContent(res, requestId);
        return outcome("delete_profile", 204, "OK");
      }
      sendMethodNotAllowed(res, ["GET", "POST", "PATCH", "DELETE"], requestId);
      return outcome("profile", 405, "METHOD_NOT_ALLOWED");
    }

    // Addresses
    if (pathname === "/api/v1/me/addresses") {
      const identity = await requireTrustedIdentity(deps.runtime, req.headers);
      const actor = toAddressCustomerActor(identity);
      if (method === "GET") {
        const addresses = await listOwnAddresses(deps.persistence, actor);
        sendJson(res, { ok: true, addresses }, { status: 200, requestId });
        return outcome("list_addresses", 200, "OK");
      }
      if (method === "POST") {
        const body = await readBody(req, requestId, res);
        if (!body) return outcome("create_address", 400, "INVALID_REQUEST");
        const address = await createOwnAddress(deps.persistence, actor, body);
        sendJson(res, { ok: true, address }, { status: 201, requestId });
        return outcome("create_address", 201, "OK");
      }
      sendMethodNotAllowed(res, ["GET", "POST"], requestId);
      return outcome("addresses", 405, "METHOD_NOT_ALLOWED");
    }

    if (pathname === "/api/v1/me/addresses/default") {
      const identity = await requireTrustedIdentity(deps.runtime, req.headers);
      const actor = toAddressCustomerActor(identity);
      if (method === "DELETE") {
        await clearDefaultOwnAddress(deps.persistence, actor);
        sendNoContent(res, requestId);
        return outcome("clear_default_address", 204, "OK");
      }
      sendMethodNotAllowed(res, ["DELETE"], requestId);
      return outcome("clear_default_address", 405, "METHOD_NOT_ALLOWED");
    }

    {
      const addressParams = matchPath(pathname, "/api/v1/me/addresses/{addressId}/default");
      if (addressParams) {
        const identity = await requireTrustedIdentity(deps.runtime, req.headers);
        const actor = toAddressCustomerActor(identity);
        if (method === "POST") {
          const address = await setDefaultOwnAddress(
            deps.persistence,
            actor,
            addressParams.addressId!,
          );
          sendJson(res, { ok: true, address }, { status: 200, requestId });
          return outcome("set_default_address", 200, "OK");
        }
        sendMethodNotAllowed(res, ["POST"], requestId);
        return outcome("set_default_address", 405, "METHOD_NOT_ALLOWED");
      }
    }

    {
      const addressParams = matchPath(pathname, "/api/v1/me/addresses/{addressId}");
      if (addressParams) {
        const identity = await requireTrustedIdentity(deps.runtime, req.headers);
        const actor = toAddressCustomerActor(identity);
        const addressId = addressParams.addressId!;
        if (method === "GET") {
          const address = await getOwnAddress(deps.persistence, actor, addressId);
          sendJson(res, { ok: true, address }, { status: 200, requestId });
          return outcome("get_address", 200, "OK");
        }
        if (method === "PATCH") {
          const body = await readBody(req, requestId, res);
          if (!body) return outcome("update_address", 400, "INVALID_REQUEST");
          const address = await updateOwnAddress(deps.persistence, actor, addressId, body);
          sendJson(res, { ok: true, address }, { status: 200, requestId });
          return outcome("update_address", 200, "OK");
        }
        if (method === "DELETE") {
          await deleteOwnAddress(deps.persistence, actor, addressId);
          sendNoContent(res, requestId);
          return outcome("delete_address", 204, "OK");
        }
        sendMethodNotAllowed(res, ["GET", "PATCH", "DELETE"], requestId);
        return outcome("address", 405, "METHOD_NOT_ALLOWED");
      }
    }

    // Cart
    if (pathname === "/api/v1/cart") {
      if (method === "GET") {
        const brandId = url.searchParams.get("brandId");
        if (!brandId) {
          throw new CartError("CART_INVALID_INPUT", "brandId is required.", {
            field: "brandId",
          });
        }
        const access = await buildCartAccess(deps, req, brandId);
        const cart = await getActiveCart(deps.persistence, access, {
          policy: CUSTOMER_COMMERCE_CART_POLICY,
        });
        sendJson(res, { ok: true, cart }, { status: 200, requestId });
        return outcome("get_active_cart", 200, "OK");
      }
      sendMethodNotAllowed(res, ["GET"], requestId);
      return outcome("cart", 405, "METHOD_NOT_ALLOWED");
    }

    if (pathname === "/api/v1/cart/lines" && method === "POST") {
      const body = await readBody(req, requestId, res);
      if (!body) return outcome("add_cart_line", 400, "INVALID_REQUEST");
      const brandId = requireBrandId(body.brandId);
      const access = await buildCartAccess(deps, req, brandId);
      const result = await addCartLine(
        deps.persistence,
        access,
        withoutKeys(body, ["brandId"]),
        { policy: CUSTOMER_COMMERCE_CART_POLICY },
      );
      sendJson(
        res,
        result.guestToken
          ? { ok: true, cart: result.cart, guestToken: result.guestToken }
          : { ok: true, cart: result.cart },
        { status: 200, requestId },
      );
      return outcome("add_cart_line", 200, "OK");
    }

    {
      const variantParams = matchPath(pathname, "/api/v1/cart/variants/{variantId}/decrement");
      if (variantParams && method === "POST") {
        const body = await readBody(req, requestId, res);
        if (!body) return outcome("decrement_latest_cart_variant", 400, "INVALID_REQUEST");
        const brandId = requireBrandId(body.brandId);
        const access = await buildCartAccess(deps, req, brandId);
        const cart = await decrementLatestCartVariant(deps.persistence, access, {
          ...withoutKeys(body, ["brandId"]),
          variantId: variantParams.variantId,
        }, { policy: CUSTOMER_COMMERCE_CART_POLICY });
        sendJson(res, { ok: true, cart }, { status: 200, requestId });
        return outcome("decrement_latest_cart_variant", 200, "OK");
      }
      if (variantParams) {
        sendMethodNotAllowed(res, ["POST"], requestId);
        return outcome("decrement_latest_cart_variant", 405, "METHOD_NOT_ALLOWED");
      }
    }

    {
      const qtyParams = matchPath(pathname, "/api/v1/cart/lines/{cartLineId}/quantity");
      if (qtyParams && method === "PATCH") {
        const body = await readBody(req, requestId, res);
        if (!body) return outcome("set_cart_line_quantity", 400, "INVALID_REQUEST");
        const brandId = requireBrandId(body.brandId);
        const access = await buildCartAccess(deps, req, brandId);
        const cart = await setCartLineQuantity(
          deps.persistence,
          access,
          { ...withoutKeys(body, ["brandId"]), cartLineId: qtyParams.cartLineId },
          { policy: CUSTOMER_COMMERCE_CART_POLICY },
        );
        sendJson(res, { ok: true, cart }, { status: 200, requestId });
        return outcome("set_cart_line_quantity", 200, "OK");
      }
      if (qtyParams) {
        sendMethodNotAllowed(res, ["PATCH"], requestId);
        return outcome("set_cart_line_quantity", 405, "METHOD_NOT_ALLOWED");
      }
    }

    {
      const cfgParams = matchPath(pathname, "/api/v1/cart/lines/{cartLineId}/configuration");
      if (cfgParams && method === "PUT") {
        const body = await readBody(req, requestId, res);
        if (!body) return outcome("update_cart_line_configuration", 400, "INVALID_REQUEST");
        const brandId = requireBrandId(body.brandId);
        const access = await buildCartAccess(deps, req, brandId);
        const cart = await updateCartLineConfiguration(
          deps.persistence,
          access,
          { ...withoutKeys(body, ["brandId"]), cartLineId: cfgParams.cartLineId },
          { policy: CUSTOMER_COMMERCE_CART_POLICY },
        );
        sendJson(res, { ok: true, cart }, { status: 200, requestId });
        return outcome("update_cart_line_configuration", 200, "OK");
      }
      if (cfgParams) {
        sendMethodNotAllowed(res, ["PUT"], requestId);
        return outcome("update_cart_line_configuration", 405, "METHOD_NOT_ALLOWED");
      }
    }

    {
      const remParams = matchPath(pathname, "/api/v1/cart/lines/{cartLineId}/remove");
      if (remParams && method === "POST") {
        const body = await readBody(req, requestId, res);
        if (!body) return outcome("remove_cart_line", 400, "INVALID_REQUEST");
        const brandId = requireBrandId(body.brandId);
        const access = await buildCartAccess(deps, req, brandId);
        const cart = await removeCartLine(
          deps.persistence,
          access,
          { ...withoutKeys(body, ["brandId"]), cartLineId: remParams.cartLineId },
          { policy: CUSTOMER_COMMERCE_CART_POLICY },
        );
        sendJson(res, { ok: true, cart }, { status: 200, requestId });
        return outcome("remove_cart_line", 200, "OK");
      }
      if (remParams) {
        sendMethodNotAllowed(res, ["POST"], requestId);
        return outcome("remove_cart_line", 405, "METHOD_NOT_ALLOWED");
      }
    }

    if (pathname === "/api/v1/cart/clear" && method === "POST") {
      const body = await readBody(req, requestId, res);
      if (!body) return outcome("clear_cart", 400, "INVALID_REQUEST");
      const brandId = requireBrandId(body.brandId);
      const access = await buildCartAccess(deps, req, brandId);
      const cart = await clearCart(
        deps.persistence,
        access,
        withoutKeys(body, ["brandId"]),
        { policy: CUSTOMER_COMMERCE_CART_POLICY },
      );
      sendJson(res, { ok: true, cart }, { status: 200, requestId });
      return outcome("clear_cart", 200, "OK");
    }

    if (pathname === "/api/v1/cart/coupon" && method === "POST") {
      const body = await readBody(req, requestId, res);
      if (!body) return outcome("apply_cart_coupon", 400, "INVALID_REQUEST");
      const brandId = requireBrandId(body.brandId);
      const access = await buildCartAccess(deps, req, brandId);
      const cart = await applyCartCoupon(
        deps.persistence,
        access,
        withoutKeys(body, ["brandId"]),
        { policy: CUSTOMER_COMMERCE_CART_POLICY },
      );
      sendJson(res, { ok: true, cart }, { status: 200, requestId });
      return outcome("apply_cart_coupon", 200, "OK");
    }

    if (pathname === "/api/v1/cart/coupon/remove" && method === "POST") {
      const body = await readBody(req, requestId, res);
      if (!body) return outcome("remove_cart_coupon", 400, "INVALID_REQUEST");
      const brandId = requireBrandId(body.brandId);
      const access = await buildCartAccess(deps, req, brandId);
      const cart = await removeCartCoupon(
        deps.persistence,
        access,
        withoutKeys(body, ["brandId"]),
        { policy: CUSTOMER_COMMERCE_CART_POLICY },
      );
      sendJson(res, { ok: true, cart }, { status: 200, requestId });
      return outcome("remove_cart_coupon", 200, "OK");
    }

    if (pathname === "/api/v1/cart/checkout-activations") {
      if (method !== "POST") {
        sendMethodNotAllowed(res, ["POST"], requestId);
        return outcome("record_cart_checkout_activation", 405, "METHOD_NOT_ALLOWED");
      }
      const body = await readBody(req, requestId, res, CART_CHECKOUT_ACTIVATION_FIELDS);
      if (!body) return outcome("record_cart_checkout_activation", 400, "INVALID_REQUEST");
      const brandId = requireBrandId(body.brandId);
      const access = await buildCartAccess(deps, req, brandId);
      if (typeof body.activationId !== "string") {
        throw new CartError("CART_INVALID_INPUT", "activationId is required.", {
          field: "activationId",
        });
      }
      await recordCartCheckoutActivationForAccess(
        deps.persistence,
        access,
        body.activationId,
      );
      sendJson(res, { ok: true }, { status: 200, requestId });
      return outcome("record_cart_checkout_activation", 200, "OK");
    }

    if (pathname === "/api/v1/commerce-observations") {
      if (method !== "POST") {
        sendMethodNotAllowed(res, ["POST"], requestId);
        return outcome("post_commerce_observation", 405, "METHOD_NOT_ALLOWED");
      }
      const body = await readBody(req, requestId, res, COMMERCE_OBSERVATION_FIELDS);
      if (!body) return outcome("post_commerce_observation", 400, "INVALID_REQUEST");
      const identity = await resolveOptionalTrustedIdentity(deps.runtime, req.headers);
      const guestToken = extractGuestCartToken(req.headers);
      const access = identity
        ? {
            kind: "customer" as const,
            actor: toCartCustomerActor(identity),
            brandId: "00000000-0000-4000-8000-000000000001",
          }
        : {
            kind: "guest" as const,
            brandId: "00000000-0000-4000-8000-000000000001",
            ...(guestToken !== undefined ? { guestToken } : {}),
          };
      const observation = await persistCommerceObservation(
        deps.persistence,
        access,
        body,
      );
      sendJson(res, { ok: true, observation }, { status: 200, requestId });
      return outcome("post_commerce_observation", 200, "OK");
    }

    if (pathname === "/api/v1/cart/evaluate" && method === "POST") {
      const bodyResult = await readOptionalJsonObjectBody(req, ["location", "brandId"]);
      if (!bodyResult.ok) {
        const mapped = mapInvalidRequest(requestId);
        sendJson(res, mapped.body, { status: mapped.status, requestId });
        return outcome("evaluate_cart", 400, "INVALID_REQUEST");
      }
      const body = (bodyResult.value ?? {}) as Record<string, unknown>;
      const brandId = requireBrandId(body.brandId ?? url.searchParams.get("brandId"));
      const access = await buildCartAccess(deps, req, brandId);
      const evaluation = await evaluateCart(
        deps.persistence,
        access,
        withoutKeys(body, ["brandId"]),
      );
      sendJson(res, { ok: true, ...evaluation }, { status: 200, requestId });
      return outcome("evaluate_cart", 200, "OK");
    }

    if (pathname === "/api/v1/cart/claim" && method === "POST") {
      const body = await readBody(req, requestId, res, [
        "brandId",
        "expectedGuestRevision",
      ]);
      if (!body) return outcome("claim_guest_cart", 400, "INVALID_REQUEST");
      const identity = await requireTrustedIdentity(deps.runtime, req.headers);
      const actor = toCartCustomerActor(identity);
      const guestToken = extractGuestCartToken(req.headers);
      if (!guestToken) {
        throw new CartError("CART_INVALID_INPUT", "guestToken is required.", {
          field: "guestToken",
        });
      }
      const cart = await claimGuestCart(
        deps.persistence,
        actor,
        { ...body, guestToken },
        { policy: CUSTOMER_COMMERCE_CART_POLICY },
      );
      sendJson(res, { ok: true, cart }, { status: 200, requestId });
      return outcome("claim_guest_cart", 200, "OK");
    }

    if (pathname === "/api/v1/cart/reconcile" && method === "POST") {
      const body = await readBody(req, requestId, res, [
        "brandId",
        "expectedGuestRevision",
        "expectedCustomerRevision",
        "resolution",
      ]);
      if (!body) return outcome("reconcile_guest_cart", 400, "INVALID_REQUEST");
      const identity = await requireTrustedIdentity(deps.runtime, req.headers);
      const actor = toCartCustomerActor(identity);
      const guestToken = extractGuestCartToken(req.headers);
      if (!guestToken) {
        throw new CartError("CART_INVALID_INPUT", "guestToken is required.", {
          field: "guestToken",
        });
      }
      const cart = await reconcileGuestCartWithCustomer(
        deps.persistence,
        actor,
        { ...body, guestToken },
        { policy: CUSTOMER_COMMERCE_CART_POLICY },
      );
      sendJson(res, { ok: true, cart }, { status: 200, requestId });
      return outcome("reconcile_guest_cart", 200, "OK");
    }

    // Checkout
    if (pathname === "/api/v1/checkouts/active") {
      if (method !== "GET") {
        sendMethodNotAllowed(res, ["GET"], requestId);
        return outcome("get_active_checkout", 405, "METHOD_NOT_ALLOWED");
      }
      const identity = await requireTrustedIdentity(deps.runtime, req.headers);
      const actor = toCartCustomerActor(identity);
      const input: Record<string, string> = {};
      const cartId = url.searchParams.get("cartId");
      const checkoutId = url.searchParams.get("checkoutId");
      if (cartId) input.cartId = cartId;
      if (checkoutId) input.checkoutId = checkoutId;
      const checkout = await getActiveCheckout(deps.persistence, actor, input, {
        policy: CUSTOMER_COMMERCE_CHECKOUT_POLICY,
      });
      sendJson(res, { ok: true, checkout }, { status: 200, requestId });
      return outcome("get_active_checkout", 200, "OK");
    }

    if (pathname === "/api/v1/checkouts" && method === "POST") {
      const body = await readBody(req, requestId, res, ["cartId", "cartActivationId"]);
      if (!body) return outcome("start_checkout", 400, "INVALID_REQUEST");
      const identity = await requireTrustedIdentity(deps.runtime, req.headers);
      const actor = toCartCustomerActor(identity);
      const checkout = await startCheckout(deps.persistence, actor, body, {
        policy: CUSTOMER_COMMERCE_CHECKOUT_POLICY,
      });
      sendJson(res, { ok: true, checkout }, { status: 200, requestId });
      return outcome("start_checkout", 200, "OK");
    }

    {
      const destParams = matchPath(pathname, "/api/v1/checkouts/{checkoutId}/destination");
      if (destParams && method === "PUT") {
        const body = await readBody(req, requestId, res);
        if (!body) return outcome("set_checkout_destination", 400, "INVALID_REQUEST");
        const identity = await requireTrustedIdentity(deps.runtime, req.headers);
        const actor = toCartCustomerActor(identity);
        const checkout = await setCheckoutDestination(
          deps.persistence,
          actor,
          { ...body, checkoutId: destParams.checkoutId },
          { policy: CUSTOMER_COMMERCE_CHECKOUT_POLICY },
        );
        sendJson(res, { ok: true, checkout }, { status: 200, requestId });
        return outcome("set_checkout_destination", 200, "OK");
      }
      if (destParams) {
        sendMethodNotAllowed(res, ["PUT"], requestId);
        return outcome("set_checkout_destination", 405, "METHOD_NOT_ALLOWED");
      }
    }

    {
      const clearParams = matchPath(
        pathname,
        "/api/v1/checkouts/{checkoutId}/destination/clear",
      );
      if (clearParams && method === "POST") {
        const body = await readBody(req, requestId, res);
        if (!body) return outcome("clear_checkout_destination", 400, "INVALID_REQUEST");
        const identity = await requireTrustedIdentity(deps.runtime, req.headers);
        const actor = toCartCustomerActor(identity);
        const checkout = await clearCheckoutDestination(
          deps.persistence,
          actor,
          { ...body, checkoutId: clearParams.checkoutId },
          { policy: CUSTOMER_COMMERCE_CHECKOUT_POLICY },
        );
        sendJson(res, { ok: true, checkout }, { status: 200, requestId });
        return outcome("clear_checkout_destination", 200, "OK");
      }
      if (clearParams) {
        sendMethodNotAllowed(res, ["POST"], requestId);
        return outcome("clear_checkout_destination", 405, "METHOD_NOT_ALLOWED");
      }
    }

    {
      const pickupParams = matchPath(
        pathname,
        "/api/v1/checkouts/{checkoutId}/pickup-options",
      );
      if (pickupParams && method === "GET") {
        const identity = await requireTrustedIdentity(deps.runtime, req.headers);
        const actor = toCartCustomerActor(identity);
        const result = await listCheckoutPickupOptions(
          deps.persistence,
          actor,
          { checkoutId: pickupParams.checkoutId },
          { policy: CUSTOMER_COMMERCE_CHECKOUT_POLICY },
        );
        sendJson(res, { ok: true, ...result }, { status: 200, requestId });
        return outcome("list_checkout_pickup_options", 200, "OK");
      }
      if (pickupParams) {
        sendMethodNotAllowed(res, ["GET"], requestId);
        return outcome("list_checkout_pickup_options", 405, "METHOD_NOT_ALLOWED");
      }
    }

    {
      const fulfilmentParams = matchPath(
        pathname,
        "/api/v1/checkouts/{checkoutId}/fulfilment",
      );
      if (fulfilmentParams && method === "POST") {
        const body = await readBody(req, requestId, res);
        if (!body) return outcome("set_checkout_fulfilment", 400, "INVALID_REQUEST");
        const identity = await requireTrustedIdentity(deps.runtime, req.headers);
        const actor = toCartCustomerActor(identity);
        const checkout = await setCheckoutFulfilment(
          deps.persistence,
          actor,
          { ...body, checkoutId: fulfilmentParams.checkoutId },
          { policy: CUSTOMER_COMMERCE_CHECKOUT_POLICY },
        );
        sendJson(res, { ok: true, checkout }, { status: 200, requestId });
        return outcome("set_checkout_fulfilment", 200, "OK");
      }
      if (fulfilmentParams) {
        sendMethodNotAllowed(res, ["POST"], requestId);
        return outcome("set_checkout_fulfilment", 405, "METHOD_NOT_ALLOWED");
      }
    }

    {
      const windowParams = matchPath(
        pathname,
        "/api/v1/checkouts/{checkoutId}/scheduled-windows",
      );
      if (windowParams && method === "GET") {
        const identity = await requireTrustedIdentity(deps.runtime, req.headers);
        const actor = toCartCustomerActor(identity);
        const result = await listCheckoutScheduledWindows(
          deps.persistence,
          actor,
          { checkoutId: windowParams.checkoutId },
          { policy: CUSTOMER_COMMERCE_CHECKOUT_POLICY },
        );
        sendJson(res, { ok: true, ...result }, { status: 200, requestId });
        return outcome("list_checkout_scheduled_windows", 200, "OK");
      }
      if (windowParams) {
        sendMethodNotAllowed(res, ["GET"], requestId);
        return outcome("list_checkout_scheduled_windows", 405, "METHOD_NOT_ALLOWED");
      }
    }

    {
      const timingParams = matchPath(
        pathname,
        "/api/v1/checkouts/{checkoutId}/fulfilment-timing",
      );
      if (timingParams && method === "POST") {
        const body = await readBody(req, requestId, res);
        if (!body) return outcome("set_checkout_fulfilment_timing", 400, "INVALID_REQUEST");
        const identity = await requireTrustedIdentity(deps.runtime, req.headers);
        const actor = toCartCustomerActor(identity);
        const checkout = await setCustomerCheckoutFulfilmentTiming(
          deps.persistence,
          actor,
          { ...body, checkoutId: timingParams.checkoutId },
          { policy: CUSTOMER_COMMERCE_CHECKOUT_POLICY },
        );
        sendJson(res, { ok: true, checkout }, { status: 200, requestId });
        return outcome("set_checkout_fulfilment_timing", 200, "OK");
      }
      if (timingParams) {
        sendMethodNotAllowed(res, ["POST"], requestId);
        return outcome("set_checkout_fulfilment_timing", 405, "METHOD_NOT_ALLOWED");
      }
    }

    {
      const evalParams = matchPath(pathname, "/api/v1/checkouts/{checkoutId}/evaluate");
      if (evalParams && method === "POST") {
        const body = await readBody(req, requestId, res);
        if (!body) return outcome("evaluate_checkout", 400, "INVALID_REQUEST");
        const identity = await requireTrustedIdentity(deps.runtime, req.headers);
        const actor = toCartCustomerActor(identity);
        const result = await evaluateCheckout(
          deps.persistence,
          actor,
          { ...body, checkoutId: evalParams.checkoutId },
          { policy: CUSTOMER_COMMERCE_CHECKOUT_POLICY },
        );
        sendJson(res, { ok: true, ...result }, { status: 200, requestId });
        return outcome("evaluate_checkout", 200, "OK");
      }
      if (evalParams) {
        sendMethodNotAllowed(res, ["POST"], requestId);
        return outcome("evaluate_checkout", 405, "METHOD_NOT_ALLOWED");
      }
    }

    {
      const zeroParams = matchPath(
        pathname,
        "/api/v1/checkouts/{checkoutId}/complete-zero-payable",
      );
      if (zeroParams && method === "POST") {
        const body = await readBody(req, requestId, res, [
          "expectedCheckoutRevision",
          "idempotencyKey",
        ]);
        if (!body) return outcome("complete_zero_payable", 400, "INVALID_REQUEST");
        const identity = await requireTrustedIdentity(deps.runtime, req.headers);
        const actor = toCartCustomerActor(identity);
        const result = await completeZeroPayableCheckout(
          deps.persistence,
          actor,
          { ...body, checkoutId: zeroParams.checkoutId },
          {
            policy: {},
            checkoutPolicy: CUSTOMER_COMMERCE_CHECKOUT_POLICY,
            provider: deps.paymentProvider,
          },
        );
        sendJson(res, { ok: true, ...result }, { status: 200, requestId });
        return outcome("complete_zero_payable", 200, "OK");
      }
      if (zeroParams) {
        sendMethodNotAllowed(res, ["POST"], requestId);
        return outcome("complete_zero_payable", 405, "METHOD_NOT_ALLOWED");
      }
    }

    // Payment
    if (pathname === "/api/v1/payments" && method === "POST") {
      const body = await readBody(req, requestId, res, [
        "checkoutId",
        "expectedCheckoutRevision",
        "paymentMethodIntent",
        "idempotencyKey",
        "sourceCommandId",
      ]);
      if (!body) return outcome("start_payment", 400, "INVALID_REQUEST");
      const identity = await requireTrustedIdentity(deps.runtime, req.headers);
      const actor = toCartCustomerActor(identity);
      const result = await startPayment(deps.persistence, actor, body, {
        policy: {},
        checkoutPolicy: CUSTOMER_COMMERCE_CHECKOUT_POLICY,
        provider: deps.paymentProvider,
      });
      sendJson(res, { ok: true, ...result }, { status: 200, requestId });
      return outcome("start_payment", 200, "OK");
    }

    {
      const evidenceParams = matchPath(
        pathname,
        "/api/v1/payments/{paymentId}/client-evidence",
      );
      if (evidenceParams && method === "POST") {
        const body = await readBody(req, requestId, res, ["kind", "payload"]);
        if (!body) return outcome("submit_payment_client_evidence", 400, "INVALID_REQUEST");
        const identity = await requireTrustedIdentity(deps.runtime, req.headers);
        const actor = toCartCustomerActor(identity);
        const state = await submitPaymentClientEvidence(
          deps.persistence,
          actor,
          { ...body, paymentId: evidenceParams.paymentId },
          {
            policy: {},
            provider: deps.paymentProvider,
          },
        );
        sendJson(res, { ok: true, state }, { status: 200, requestId });
        return outcome("submit_payment_client_evidence", 200, "OK");
      }
      if (evidenceParams) {
        sendMethodNotAllowed(res, ["POST"], requestId);
        return outcome("submit_payment_client_evidence", 405, "METHOD_NOT_ALLOWED");
      }
    }

    {
      const retryParams = matchPath(pathname, "/api/v1/payments/{paymentId}/retry");
      if (retryParams && method === "POST") {
        const body = await readBody(req, requestId, res, [
          "expectedCheckoutRevision",
          "paymentMethodIntent",
          "idempotencyKey",
          "sourceCommandId",
        ]);
        if (!body) return outcome("retry_payment", 400, "INVALID_REQUEST");
        const identity = await requireTrustedIdentity(deps.runtime, req.headers);
        const actor = toCartCustomerActor(identity);
        const result = await retryPayment(
          deps.persistence,
          actor,
          { ...body, paymentId: retryParams.paymentId },
          {
            policy: {},
            checkoutPolicy: CUSTOMER_COMMERCE_CHECKOUT_POLICY,
            provider: deps.paymentProvider,
          },
        );
        sendJson(res, { ok: true, ...result }, { status: 200, requestId });
        return outcome("retry_payment", 200, "OK");
      }
      if (retryParams) {
        sendMethodNotAllowed(res, ["POST"], requestId);
        return outcome("retry_payment", 405, "METHOD_NOT_ALLOWED");
      }
    }

    {
      const stateParams = matchPath(pathname, "/api/v1/payments/{paymentId}/state");
      if (stateParams && method === "GET") {
        const identity = await requireTrustedIdentity(deps.runtime, req.headers);
        const actor = toCartCustomerActor(identity);
        const state = await getPaymentState(
          deps.persistence,
          actor,
          { paymentId: stateParams.paymentId },
          { provider: deps.paymentProvider },
        );
        sendJson(res, { ok: true, state }, { status: 200, requestId });
        return outcome("get_payment_state", 200, "OK");
      }
      if (stateParams) {
        sendMethodNotAllowed(res, ["GET"], requestId);
        return outcome("get_payment_state", 405, "METHOD_NOT_ALLOWED");
      }
    }

    {
      const payParams = matchPath(pathname, "/api/v1/payments/{paymentId}");
      if (payParams && method === "GET") {
        const identity = await requireTrustedIdentity(deps.runtime, req.headers);
        const actor = toCartCustomerActor(identity);
        const payment = await getPayment(deps.persistence, actor, {
          paymentId: payParams.paymentId,
        });
        sendJson(res, { ok: true, payment }, { status: 200, requestId });
        return outcome("get_payment", 200, "OK");
      }
      if (payParams) {
        sendMethodNotAllowed(res, ["GET"], requestId);
        return outcome("get_payment", 405, "METHOD_NOT_ALLOWED");
      }
    }

    // Orders
    if (pathname === "/api/v1/orders") {
      if (method !== "GET") {
        sendMethodNotAllowed(res, ["GET"], requestId);
        return outcome("list_orders", 405, "METHOD_NOT_ALLOWED");
      }
      const identity = await requireTrustedIdentity(deps.runtime, req.headers);
      const actor = toCartCustomerActor(identity);
      const input: Record<string, unknown> = {};
      const cursor = url.searchParams.get("cursor");
      const limitRaw = url.searchParams.get("limit");
      if (cursor !== null) input.cursor = cursor;
      if (limitRaw !== null) input.limit = Number.parseInt(limitRaw, 10);
      const result = await listCustomerOrders(deps.persistence, actor, input);
      sendJson(
        res,
        { ok: true, items: result.items, nextCursor: result.nextCursor },
        { status: 200, requestId },
      );
      return outcome("list_orders", 200, "OK");
    }

    {
      const cancelParams = matchPath(pathname, "/api/v1/orders/{orderId}/cancel");
      if (cancelParams && method === "POST") {
        const identity = await requireTrustedIdentity(deps.runtime, req.headers);
        const actor = toCartCustomerActor(identity);
        const body = await readBody(req, requestId, res, ["expectedOrderRevision"]);
        if (!body) return outcome("cancel_order", 400, "INVALID_REQUEST");
        const parsed = parseCancelCustomerScheduledOrderInput(cancelParams.orderId, body);
        const order = await cancelCustomerScheduledOrder(deps.persistence, actor, parsed);
        sendJson(res, { ok: true, order }, { status: 200, requestId });
        return outcome("cancel_order", 200, "OK");
      }
      if (cancelParams) {
        sendMethodNotAllowed(res, ["POST"], requestId);
        return outcome("cancel_order", 405, "METHOD_NOT_ALLOWED");
      }
    }

    {
      // IMP-028 Slice 6 — customer Financial Document listing (Slice-5 ownership).
      const orderDocsParams = matchPath(
        pathname,
        "/api/v1/orders/{orderId}/financial-documents",
      );
      if (orderDocsParams && method === "GET") {
        const identity = await requireTrustedIdentity(deps.runtime, req.headers);
        const actor = toCartCustomerActor(identity);
        const financialDocuments = await listFinancialDocumentsForCustomerOrder(
          deps.persistence,
          actor,
          { orderId: orderDocsParams.orderId },
        );
        sendJson(
          res,
          { ok: true, financialDocuments },
          { status: 200, requestId },
        );
        return outcome("list_order_financial_documents", 200, "OK");
      }
      if (orderDocsParams) {
        sendMethodNotAllowed(res, ["GET"], requestId);
        return outcome("list_order_financial_documents", 405, "METHOD_NOT_ALLOWED");
      }
    }

    {
      const orderParams = matchPath(pathname, "/api/v1/orders/{orderId}");
      if (orderParams && method === "GET") {
        const identity = await requireTrustedIdentity(deps.runtime, req.headers);
        const actor = toCartCustomerActor(identity);
        const order = await getCustomerOrder(deps.persistence, actor, {
          orderId: orderParams.orderId,
        });
        sendJson(res, { ok: true, order }, { status: 200, requestId });
        return outcome("get_order", 200, "OK");
      }
      if (orderParams) {
        sendMethodNotAllowed(res, ["GET"], requestId);
        return outcome("get_order", 405, "METHOD_NOT_ALLOWED");
      }
    }

    {
      // IMP-028 Slice 6 — authorized customer PDF download (Slice-5 artifact path).
      const pdfParams = matchPath(
        pathname,
        "/api/v1/financial-documents/{financialDocumentId}/pdf",
      );
      if (pdfParams && method === "GET") {
        const identity = await requireTrustedIdentity(deps.runtime, req.headers);
        const actor = toCartCustomerActor(identity);
        // Only the route Financial Document id is accepted — no prior authority
        // from query/body. Slice 5 resolves sealed priorFinancialDocumentId.
        const artifact = await generateCustomerFinancialDocumentArtifact(
          deps.persistence,
          actor,
          { financialDocumentId: pdfParams.financialDocumentId },
        );
        sendPdf(res, artifact, { status: 200, requestId });
        return outcome("download_financial_document_pdf", 200, "OK");
      }
      if (pdfParams) {
        sendMethodNotAllowed(res, ["GET"], requestId);
        return outcome("download_financial_document_pdf", 405, "METHOD_NOT_ALLOWED");
      }
    }

    sendNotFound(res, requestId);
    return outcome("unknown", 404, "NOT_FOUND");
  } catch (error) {
    return handleCaught(error, res, requestId, "commerce");
  }
}
