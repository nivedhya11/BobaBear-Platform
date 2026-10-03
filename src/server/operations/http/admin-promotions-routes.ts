/**
 * Promotions / Coupons commercial authoring Admin HTTP routes (IMP-036F F5).
 *
 * Thin transport: trusted workforce session → Brand-scoped Promotions domain.
 * Path brandId is a locator only. Material mutations consume
 * expectedPromotionRevision / expectedCouponRevision.
 */
import "server-only";

import type { IncomingMessage } from "node:http";

import type { WorkforcePrincipal } from "../../access-control";
import type { WorkforceAuthRuntime } from "../../auth/workforce";
import type { Persistence } from "../../persistence";
import type {
  PersistenceQueryContext,
  PersistenceTransactionContext,
} from "../../persistence/types";
import {
  PromotionValidationError,
  activateCoupon,
  activatePromotion,
  createCouponDraft,
  createPromotionDraft,
  disableCoupon,
  enableCoupon,
  inspectBrandCoupon,
  inspectBrandPromotion,
  listBrandPromotionAuditEvents,
  listBrandPromotions,
  listPromotionCoupons,
  previewCouponConsequence,
  previewPromotionConsequence,
  retireCoupon,
  retirePromotion,
  setPromotionBenefit,
  setPromotionTargets,
  updateCouponDraft,
  updatePromotionDraft,
} from "../../promotions";
import {
  COUPON_ORIGINS,
  COUPON_STATUSES,
  PROMOTION_BENEFIT_TYPES,
  PROMOTION_SCOPE_TYPES,
  PROMOTION_STACKING_POLICIES,
  PROMOTION_STATUSES,
  PROMOTION_TARGET_ROLES,
  PROMOTION_TARGET_TYPES,
  PROMOTION_TRIGGER_TYPES,
  FULFILMENT_MODES,
  FULFILMENT_TIMINGS,
  type CouponOrigin,
  type CouponStatus,
  type PromotionBenefitConfig,
  type PromotionBenefitType,
  type PromotionScopeType,
  type PromotionStackingPolicy,
  type PromotionStatus,
  type PromotionTargetConfig,
  type PromotionTargetRole,
  type PromotionTargetType,
  type PromotionTriggerType,
  type FulfilmentMode,
  type FulfilmentTiming,
} from "../../../shared/promotions";
import { resolveOperationsWorkforcePrincipal } from "./auth";
import { readOperationsJsonObjectBody } from "./body";
import { mapPromotionsAdminError } from "./admin-promotions-error-map";

export type AdminPromotionsRouteKind =
  | "list_promotions"
  | "create_promotion"
  | "get_promotion"
  | "update_promotion_draft"
  | "set_benefit"
  | "set_targets"
  | "promotion_consequence_preview"
  | "activate_promotion"
  | "retire_promotion"
  | "list_promotion_audit"
  | "list_coupons"
  | "create_coupon"
  | "get_coupon"
  | "update_coupon_draft"
  | "coupon_consequence_preview"
  | "activate_coupon"
  | "disable_coupon"
  | "enable_coupon"
  | "retire_coupon";

export type AdminPromotionsRoute = Readonly<{
  kind: AdminPromotionsRouteKind;
  brandId: string;
  promotionId?: string;
  couponId?: string;
}>;

const FORBIDDEN_BODY_KEYS = new Set([
  "actor",
  "actorId",
  "principal",
  "permission",
  "permissions",
  "role",
  "roles",
  "scope",
  "scopeApproved",
  "authorized",
  "workforceUserId",
  "workforceUserIdAuthority",
  "brandId",
]);

const PG_BIGINT_MAX = BigInt("9223372036854775807");

function rejectForgedBody(body: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(body)) {
    if (FORBIDDEN_BODY_KEYS.has(key)) {
      throw new PromotionValidationError("Caller-supplied authority fields are not accepted.");
    }
  }
}

function dateJson(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === "bigint") return v.toString(10);
      if (v instanceof Date) return v.toISOString();
      return v;
    }),
  );
}

function requireString(body: Readonly<Record<string, unknown>>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new PromotionValidationError(`${field} must be a non-empty string.`);
  }
  return value;
}

function optionalString(
  body: Readonly<Record<string, unknown>>,
  field: string,
): string | null | undefined {
  if (!(field in body)) return undefined;
  const value = body[field];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new PromotionValidationError(`${field} must be a string or null.`);
  }
  return value;
}

function optionalNumber(body: Readonly<Record<string, unknown>>, field: string): number | undefined {
  if (!(field in body)) return undefined;
  const value = body[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new PromotionValidationError(`${field} must be a safe integer.`);
  }
  return value;
}

function optionalPaise(
  body: Readonly<Record<string, unknown>>,
  field: string,
): bigint | null | undefined {
  if (!(field in body)) return undefined;
  if (body[field] === null) return null;
  const value = body[field];
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new PromotionValidationError(`${field} must be a non-negative integer paise amount.`);
    }
    return BigInt(value);
  }
  if (typeof value === "string") {
    if (!/^(0|[1-9]\d*)$/.test(value)) {
      throw new PromotionValidationError(`${field} must be a non-negative integer paise decimal string.`);
    }
    const parsed = BigInt(value);
    if (parsed > PG_BIGINT_MAX) {
      throw new PromotionValidationError(`${field} exceeds integer paise range.`);
    }
    return parsed;
  }
  throw new PromotionValidationError(`${field} must be an integer paise amount.`);
}

function requireExpectedRevision(body: Readonly<Record<string, unknown>>, field: string): string {
  const value = body[field];
  if (typeof value === "string" && /^\d+$/.test(value) && value !== "0" && !/^0\d+/.test(value)) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  throw new PromotionValidationError(
    `${field} must be a non-empty positive decimal string or safe positive integer.`,
  );
}

function requireIsoDate(body: Readonly<Record<string, unknown>>, field: string): Date {
  const value = requireString(body, field);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new PromotionValidationError(`${field} must be an ISO-8601 timestamp.`);
  }
  return date;
}

function optionalIsoDate(
  body: Readonly<Record<string, unknown>>,
  field: string,
): Date | null | undefined {
  if (!(field in body)) return undefined;
  if (body[field] === null) return null;
  return requireIsoDate(body, field);
}

function optionalBoolean(
  body: Readonly<Record<string, unknown>>,
  field: string,
): boolean | undefined {
  if (!(field in body)) return undefined;
  const value = body[field];
  if (typeof value !== "boolean") {
    throw new PromotionValidationError(`${field} must be a boolean.`);
  }
  return value;
}

function optionalStringList(
  body: Readonly<Record<string, unknown>>,
  field: string,
  allowed: readonly string[],
): string[] | null | undefined {
  if (!(field in body)) return undefined;
  if (body[field] === null) return null;
  const value = body[field];
  if (!Array.isArray(value) || value.length === 0) {
    throw new PromotionValidationError(`${field} must be null or a non-empty array.`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || !allowed.includes(entry)) {
      throw new PromotionValidationError(`${field}[${index}] is invalid.`);
    }
    return entry;
  });
}

function parseBenefit(body: Readonly<Record<string, unknown>>): PromotionBenefitConfig {
  const benefitType = requireString(body, "benefitType");
  if (!(PROMOTION_BENEFIT_TYPES as readonly string[]).includes(benefitType)) {
    throw new PromotionValidationError("Invalid benefitType.");
  }
  return {
    benefitType: benefitType as PromotionBenefitType,
    percentageBps: optionalNumber(body, "percentageBps") ?? null,
    fixedAmountPaise: optionalPaise(body, "fixedAmountPaise") ?? null,
    maximumDiscountPaise: optionalPaise(body, "maximumDiscountPaise") ?? null,
    buyQuantity: optionalNumber(body, "buyQuantity") ?? null,
    getQuantity: optionalNumber(body, "getQuantity") ?? null,
    repeatable: typeof body.repeatable === "boolean" ? body.repeatable : null,
    maximumRewardQuantity: optionalNumber(body, "maximumRewardQuantity") ?? null,
    includeModifiers: body.includeModifiers === true,
    includeBundleDeltas: body.includeBundleDeltas === true,
    complimentaryProductId: optionalString(body, "complimentaryProductId") ?? null,
    complimentaryVariantId: optionalString(body, "complimentaryVariantId") ?? null,
  };
}

function parseTargets(body: Readonly<Record<string, unknown>>): {
  targetRole: PromotionTargetRole;
  targets: readonly PromotionTargetConfig[];
} {
  const targetRole = requireString(body, "targetRole");
  if (!(PROMOTION_TARGET_ROLES as readonly string[]).includes(targetRole)) {
    throw new PromotionValidationError("Invalid targetRole.");
  }
  const raw = body.targets;
  if (!Array.isArray(raw)) {
    throw new PromotionValidationError("targets must be an array.");
  }
  const targets: PromotionTargetConfig[] = raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new PromotionValidationError(`targets[${index}] must be an object.`);
    }
    const item = entry as Record<string, unknown>;
    const targetType = item.targetType;
    if (typeof targetType !== "string" || !(PROMOTION_TARGET_TYPES as readonly string[]).includes(targetType)) {
      throw new PromotionValidationError(`targets[${index}].targetType is invalid.`);
    }
    return {
      targetRole: targetRole as PromotionTargetRole,
      targetType: targetType as PromotionTargetType,
      productId: typeof item.productId === "string" ? item.productId : null,
      variantId: typeof item.variantId === "string" ? item.variantId : null,
      chargeDefinitionId: typeof item.chargeDefinitionId === "string" ? item.chargeDefinitionId : null,
    };
  });
  return { targetRole: targetRole as PromotionTargetRole, targets };
}

export function classifyAdminPromotionsRoute(pathname: string): AdminPromotionsRoute | null {
  const segments = pathname.split("/").filter(Boolean);
  if (
    segments.length < 6 ||
    segments[0] !== "api" ||
    segments[1] !== "admin" ||
    segments[2] !== "v1" ||
    segments[3] !== "brands" ||
    !segments[4]
  ) {
    return null;
  }
  const brandId = segments[4];
  const rest = segments.slice(5);
  if (rest.length === 1 && rest[0] === "promotions") {
    return { kind: "list_promotions", brandId };
  }
  if (rest.length === 2 && rest[0] === "promotions" && rest[1]) {
    return { kind: "get_promotion", brandId, promotionId: rest[1] };
  }
  if (rest.length === 3 && rest[0] === "promotions" && rest[1] && rest[2] === "draft") {
    return { kind: "update_promotion_draft", brandId, promotionId: rest[1] };
  }
  if (rest.length === 3 && rest[0] === "promotions" && rest[1] && rest[2] === "benefit") {
    return { kind: "set_benefit", brandId, promotionId: rest[1] };
  }
  if (rest.length === 3 && rest[0] === "promotions" && rest[1] && rest[2] === "targets") {
    return { kind: "set_targets", brandId, promotionId: rest[1] };
  }
  if (rest.length === 3 && rest[0] === "promotions" && rest[1] && rest[2] === "consequence-preview") {
    return { kind: "promotion_consequence_preview", brandId, promotionId: rest[1] };
  }
  if (rest.length === 3 && rest[0] === "promotions" && rest[1] && rest[2] === "activate") {
    return { kind: "activate_promotion", brandId, promotionId: rest[1] };
  }
  if (rest.length === 3 && rest[0] === "promotions" && rest[1] && rest[2] === "retire") {
    return { kind: "retire_promotion", brandId, promotionId: rest[1] };
  }
  if (rest.length === 3 && rest[0] === "promotions" && rest[1] && rest[2] === "audit") {
    return { kind: "list_promotion_audit", brandId, promotionId: rest[1] };
  }
  if (rest.length === 3 && rest[0] === "promotions" && rest[1] && rest[2] === "coupons") {
    return { kind: "list_coupons", brandId, promotionId: rest[1] };
  }
  if (rest.length === 2 && rest[0] === "coupons" && rest[1]) {
    return { kind: "get_coupon", brandId, couponId: rest[1] };
  }
  if (rest.length === 3 && rest[0] === "coupons" && rest[1] && rest[2] === "draft") {
    return { kind: "update_coupon_draft", brandId, couponId: rest[1] };
  }
  if (rest.length === 3 && rest[0] === "coupons" && rest[1] && rest[2] === "consequence-preview") {
    return { kind: "coupon_consequence_preview", brandId, couponId: rest[1] };
  }
  if (rest.length === 3 && rest[0] === "coupons" && rest[1] && rest[2] === "activate") {
    return { kind: "activate_coupon", brandId, couponId: rest[1] };
  }
  if (rest.length === 3 && rest[0] === "coupons" && rest[1] && rest[2] === "disable") {
    return { kind: "disable_coupon", brandId, couponId: rest[1] };
  }
  if (rest.length === 3 && rest[0] === "coupons" && rest[1] && rest[2] === "enable") {
    return { kind: "enable_coupon", brandId, couponId: rest[1] };
  }
  if (rest.length === 3 && rest[0] === "coupons" && rest[1] && rest[2] === "retire") {
    return { kind: "retire_coupon", brandId, couponId: rest[1] };
  }
  return null;
}

function resolveRouteForMethod(route: AdminPromotionsRoute, method: string): AdminPromotionsRoute {
  if (method === "POST" && route.kind === "list_promotions") {
    return { kind: "create_promotion", brandId: route.brandId };
  }
  if (method === "POST" && route.kind === "list_coupons") {
    return { kind: "create_coupon", brandId: route.brandId, promotionId: route.promotionId };
  }
  return route;
}

function allowedMethodFor(kind: AdminPromotionsRouteKind): "GET" | "POST" {
  switch (kind) {
    case "list_promotions":
    case "get_promotion":
    case "list_promotion_audit":
    case "list_coupons":
    case "get_coupon":
      return "GET";
    default:
      return "POST";
  }
}

function isMutationKind(kind: AdminPromotionsRouteKind): boolean {
  return allowedMethodFor(kind) === "POST";
}

async function dispatchRead(
  context: PersistenceQueryContext,
  principal: WorkforcePrincipal,
  route: AdminPromotionsRoute,
): Promise<Record<string, unknown>> {
  switch (route.kind) {
    case "list_promotions":
      return listBrandPromotions(context, { actor: principal, brandId: route.brandId });
    case "get_promotion":
      return inspectBrandPromotion(context, {
        actor: principal,
        brandId: route.brandId,
        promotionId: route.promotionId!,
      });
    case "list_promotion_audit":
      return listBrandPromotionAuditEvents(context, {
        actor: principal,
        brandId: route.brandId,
        resourceId: route.promotionId,
      });
    case "list_coupons":
      return listPromotionCoupons(context, {
        actor: principal,
        brandId: route.brandId,
        promotionId: route.promotionId!,
      });
    case "get_coupon":
      return inspectBrandCoupon(context, {
        actor: principal,
        brandId: route.brandId,
        couponId: route.couponId!,
      });
    default:
      throw new PromotionValidationError("Unsupported promotions read route.");
  }
}

async function dispatchMutation(
  context: PersistenceTransactionContext,
  principal: WorkforcePrincipal,
  route: AdminPromotionsRoute,
  body: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  switch (route.kind) {
    case "create_promotion": {
      const scopeType = requireString(body, "scopeType");
      if (!(PROMOTION_SCOPE_TYPES as readonly string[]).includes(scopeType)) {
        throw new PromotionValidationError("Invalid scopeType.");
      }
      const triggerType = requireString(body, "triggerType");
      if (!(PROMOTION_TRIGGER_TYPES as readonly string[]).includes(triggerType)) {
        throw new PromotionValidationError("Invalid triggerType.");
      }
      let stackingPolicy: PromotionStackingPolicy | undefined;
      if ("stackingPolicy" in body) {
        const raw = requireString(body, "stackingPolicy");
        if (!(PROMOTION_STACKING_POLICIES as readonly string[]).includes(raw)) {
          throw new PromotionValidationError("Invalid stackingPolicy.");
        }
        stackingPolicy = raw as PromotionStackingPolicy;
      }
      const created = await createPromotionDraft(context, {
        actor: principal,
        brandId: route.brandId,
        code: requireString(body, "code"),
        displayName: requireString(body, "displayName"),
        scopeType: scopeType as PromotionScopeType,
        territoryId: optionalString(body, "territoryId") ?? null,
        organizationId: optionalString(body, "organizationId") ?? null,
        outletId: optionalString(body, "outletId") ?? null,
        triggerType: triggerType as PromotionTriggerType,
        stackingPolicy,
        priority: optionalNumber(body, "priority"),
        startsAt: requireIsoDate(body, "startsAt"),
        endsAt: optionalIsoDate(body, "endsAt") ?? null,
        minimumQualifyingAmountPaise: optionalPaise(body, "minimumQualifyingAmountPaise") ?? null,
        minimumItemQuantity: optionalNumber(body, "minimumItemQuantity") ?? null,
        firstOrderOnly: optionalBoolean(body, "firstOrderOnly"),
        eligibleFulfilmentModes: optionalStringList(
          body,
          "eligibleFulfilmentModes",
          FULFILMENT_MODES,
        ) as readonly FulfilmentMode[] | null | undefined,
        eligibleFulfilmentTimings: optionalStringList(
          body,
          "eligibleFulfilmentTimings",
          FULFILMENT_TIMINGS,
        ) as readonly FulfilmentTiming[] | null | undefined,
        maximumRedemptions: optionalNumber(body, "maximumRedemptions") ?? null,
        maximumRedemptionsPerCustomer: optionalNumber(body, "maximumRedemptionsPerCustomer") ?? null,
      });
      return { promotion: { id: created.id, revision: created.revision.toString(10) } };
    }
    case "update_promotion_draft": {
      const result = await updatePromotionDraft(context, {
        actor: principal,
        brandId: route.brandId,
        promotionId: route.promotionId!,
        expectedPromotionRevision: requireExpectedRevision(body, "expectedPromotionRevision"),
        displayName: optionalString(body, "displayName") ?? undefined,
        stackingPolicy: (() => {
          if (!("stackingPolicy" in body) || body.stackingPolicy === undefined) return undefined;
          const raw = requireString(body, "stackingPolicy");
          if (!(PROMOTION_STACKING_POLICIES as readonly string[]).includes(raw)) {
            throw new PromotionValidationError("Invalid stackingPolicy.");
          }
          return raw as PromotionStackingPolicy;
        })(),
        priority: optionalNumber(body, "priority"),
        startsAt: optionalIsoDate(body, "startsAt") ?? undefined,
        endsAt: optionalIsoDate(body, "endsAt"),
        minimumQualifyingAmountPaise: optionalPaise(body, "minimumQualifyingAmountPaise"),
        minimumItemQuantity: optionalNumber(body, "minimumItemQuantity"),
        firstOrderOnly: optionalBoolean(body, "firstOrderOnly"),
        eligibleFulfilmentModes: optionalStringList(
          body,
          "eligibleFulfilmentModes",
          FULFILMENT_MODES,
        ) as readonly FulfilmentMode[] | null | undefined,
        eligibleFulfilmentTimings: optionalStringList(
          body,
          "eligibleFulfilmentTimings",
          FULFILMENT_TIMINGS,
        ) as readonly FulfilmentTiming[] | null | undefined,
        maximumRedemptions: optionalNumber(body, "maximumRedemptions"),
        maximumRedemptionsPerCustomer: optionalNumber(body, "maximumRedemptionsPerCustomer"),
      });
      return { revision: result.revision.toString(10) };
    }
    case "set_benefit": {
      const result = await setPromotionBenefit(context, {
        actor: principal,
        brandId: route.brandId,
        promotionId: route.promotionId!,
        expectedPromotionRevision: requireExpectedRevision(body, "expectedPromotionRevision"),
        benefit: parseBenefit(body),
      });
      return { revision: result.revision.toString(10) };
    }
    case "set_targets": {
      const parsed = parseTargets(body);
      const result = await setPromotionTargets(context, {
        actor: principal,
        brandId: route.brandId,
        promotionId: route.promotionId!,
        expectedPromotionRevision: requireExpectedRevision(body, "expectedPromotionRevision"),
        targetRole: parsed.targetRole,
        targets: parsed.targets,
      });
      return { revision: result.revision.toString(10) };
    }
    case "promotion_consequence_preview": {
      const proposedRaw = requireString(body, "proposedStatus");
      if (!(PROMOTION_STATUSES as readonly string[]).includes(proposedRaw)) {
        throw new PromotionValidationError("Unsupported promotion lifecycle state.");
      }
      const preview = await previewPromotionConsequence(context, {
        actor: principal,
        brandId: route.brandId,
        promotionId: route.promotionId!,
        proposedStatus: proposedRaw as PromotionStatus,
      });
      return { preview };
    }
    case "activate_promotion": {
      const result = await activatePromotion(context, {
        actor: principal,
        brandId: route.brandId,
        promotionId: route.promotionId!,
        expectedPromotionRevision: requireExpectedRevision(body, "expectedPromotionRevision"),
      });
      return { revision: result.revision.toString(10) };
    }
    case "retire_promotion": {
      const result = await retirePromotion(context, {
        actor: principal,
        brandId: route.brandId,
        promotionId: route.promotionId!,
        expectedPromotionRevision: requireExpectedRevision(body, "expectedPromotionRevision"),
      });
      return { revision: result.revision.toString(10) };
    }
    case "create_coupon": {
      const origin = requireString(body, "origin");
      if (!(COUPON_ORIGINS as readonly string[]).includes(origin)) {
        throw new PromotionValidationError("Invalid coupon origin.");
      }
      const created = await createCouponDraft(context, {
        actor: principal,
        brandId: route.brandId,
        promotionId: route.promotionId!,
        origin: origin as CouponOrigin,
        canonicalCode: optionalString(body, "canonicalCode") ?? undefined,
        startsAt: optionalIsoDate(body, "startsAt") ?? null,
        endsAt: optionalIsoDate(body, "endsAt") ?? null,
        maximumRedemptions: optionalNumber(body, "maximumRedemptions") ?? null,
        maximumRedemptionsPerCustomer: optionalNumber(body, "maximumRedemptionsPerCustomer") ?? null,
      });
      return {
        coupon: {
          id: created.id,
          canonicalCode: created.canonicalCode,
          revision: created.revision.toString(10),
        },
      };
    }
    case "update_coupon_draft": {
      const result = await updateCouponDraft(context, {
        actor: principal,
        brandId: route.brandId,
        couponId: route.couponId!,
        expectedCouponRevision: requireExpectedRevision(body, "expectedCouponRevision"),
        startsAt: optionalIsoDate(body, "startsAt"),
        endsAt: optionalIsoDate(body, "endsAt"),
        maximumRedemptions: optionalNumber(body, "maximumRedemptions"),
        maximumRedemptionsPerCustomer: optionalNumber(body, "maximumRedemptionsPerCustomer"),
      });
      return { revision: result.revision.toString(10) };
    }
    case "coupon_consequence_preview": {
      const proposedRaw = requireString(body, "proposedStatus");
      if (!(COUPON_STATUSES as readonly string[]).includes(proposedRaw)) {
        throw new PromotionValidationError("Unsupported coupon lifecycle state.");
      }
      const preview = await previewCouponConsequence(context, {
        actor: principal,
        brandId: route.brandId,
        couponId: route.couponId!,
        proposedStatus: proposedRaw as CouponStatus,
      });
      return { preview };
    }
    case "activate_coupon": {
      const result = await activateCoupon(context, {
        actor: principal,
        brandId: route.brandId,
        couponId: route.couponId!,
        expectedCouponRevision: requireExpectedRevision(body, "expectedCouponRevision"),
      });
      return { revision: result.revision.toString(10) };
    }
    case "disable_coupon": {
      const result = await disableCoupon(context, {
        actor: principal,
        brandId: route.brandId,
        couponId: route.couponId!,
        expectedCouponRevision: requireExpectedRevision(body, "expectedCouponRevision"),
      });
      return { revision: result.revision.toString(10) };
    }
    case "enable_coupon": {
      const result = await enableCoupon(context, {
        actor: principal,
        brandId: route.brandId,
        couponId: route.couponId!,
        expectedCouponRevision: requireExpectedRevision(body, "expectedCouponRevision"),
      });
      return { revision: result.revision.toString(10) };
    }
    case "retire_coupon": {
      const result = await retireCoupon(context, {
        actor: principal,
        brandId: route.brandId,
        couponId: route.couponId!,
        expectedCouponRevision: requireExpectedRevision(body, "expectedCouponRevision"),
      });
      return { revision: result.revision.toString(10) };
    }
    default:
      throw new PromotionValidationError("Unsupported promotions mutation route.");
  }
}

export async function handleAdminPromotionsRoute(
  req: IncomingMessage,
  route: AdminPromotionsRoute,
  deps: Readonly<{ runtime: WorkforceAuthRuntime; persistence: Persistence }>,
  requestId: string,
): Promise<{ status: number; body: Record<string, unknown>; operation: string; code: string }> {
  const method = (req.method ?? "GET").toUpperCase();
  const effective = resolveRouteForMethod(route, method);
  const operation = effective.kind;
  const allowed = allowedMethodFor(effective.kind);
  if (method !== allowed) {
    return {
      status: 405,
      operation,
      code: "METHOD_NOT_ALLOWED",
      body: { ok: false, code: "PROMOTIONS_REQUEST_INVALID", requestId },
    };
  }

  try {
    const principal = await resolveOperationsWorkforcePrincipal(deps.runtime, req.headers);
    if (!principal) {
      return {
        status: 401,
        operation,
        code: "WORKFORCE_AUTH_REQUIRED",
        body: { ok: false, code: "WORKFORCE_AUTH_REQUIRED", requestId },
      };
    }

    if (isMutationKind(effective.kind)) {
      const body = await readOperationsJsonObjectBody(req);
      if (!body.ok) {
        return {
          status: 400,
          operation,
          code: "PROMOTIONS_REQUEST_INVALID",
          body: { ok: false, code: "PROMOTIONS_REQUEST_INVALID", requestId },
        };
      }
      rejectForgedBody(body.value);
      const result = await deps.persistence.transaction((tx) =>
        dispatchMutation(tx, principal, effective, body.value),
      );
      return {
        status: 200,
        operation,
        code: "OK",
        body: { ok: true, ...(dateJson(result) as Record<string, unknown>) },
      };
    }

    const result = await deps.persistence.withContext((ctx) =>
      dispatchRead(ctx, principal, effective),
    );
    return {
      status: 200,
      operation,
      code: "OK",
      body: { ok: true, ...(dateJson(result) as Record<string, unknown>) },
    };
  } catch (error) {
    const mapped = mapPromotionsAdminError(error, requestId);
    return {
      status: mapped.status,
      operation,
      code: mapped.body.code,
      body: mapped.body as Record<string, unknown>,
    };
  }
}
