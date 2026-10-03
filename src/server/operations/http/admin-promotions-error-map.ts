/** Promotions / Coupons commercial Admin HTTP error → safe envelope (IMP-036F F5). */
import "server-only";

import { AuthorizationError } from "../../access-control";
import { OrganizationNotFoundError } from "../../organization";
import {
  PromotionAdminError,
  PromotionNotFoundError,
  PromotionValidationError,
} from "../../promotions";

export type PromotionsAdminErrorBody = Readonly<{
  ok: false;
  code: string;
  requestId: string;
  field?: string;
  message?: string;
  issues?: readonly string[];
}>;

export type MappedPromotionsAdminError = Readonly<{
  status: number;
  body: PromotionsAdminErrorBody;
}>;

export function mapPromotionsAdminError(error: unknown, requestId: string): MappedPromotionsAdminError {
  if (error instanceof AuthorizationError) {
    return { status: 403, body: { ok: false, code: "PROMOTIONS_UNAUTHORIZED", requestId } };
  }

  if (error instanceof PromotionNotFoundError || error instanceof OrganizationNotFoundError) {
    return { status: 404, body: { ok: false, code: "PROMOTIONS_NOT_FOUND", requestId } };
  }

  if (error instanceof PromotionValidationError) {
    return {
      status: 400,
      body: {
        ok: false,
        code: "PROMOTIONS_REQUEST_INVALID",
        requestId,
        message: error.message,
        issues: [error.message],
      },
    };
  }

  if (error instanceof PromotionAdminError) {
    if (error.code === "PROMOTION_STALE_REVISION") {
      return {
        status: 409,
        body: { ok: false, code: "PROMOTION_STALE_REVISION", requestId, message: error.message },
      };
    }
    if (error.code === "PROMOTION_COMPLIMENTARY_ACTIVATION_RACE") {
      return {
        status: 409,
        body: {
          ok: false,
          code: "PROMOTION_COMPLIMENTARY_ACTIVATION_RACE",
          requestId,
          message: error.message,
        },
      };
    }
    if (error.code === "PROMOTION_COMPLIMENTARY_ACTIVE_CONFLICT") {
      return {
        status: 409,
        body: {
          ok: false,
          code: "PROMOTION_COMPLIMENTARY_ACTIVE_CONFLICT",
          requestId,
          message: error.message,
        },
      };
    }
    if (error.code === "PROMOTION_COMPLIMENTARY_INVALID") {
      return {
        status: 400,
        body: {
          ok: false,
          code: "PROMOTION_COMPLIMENTARY_INVALID",
          requestId,
          message: error.message,
          field: error.field,
          issues: [error.message],
        },
      };
    }
    if (error.code === "COUPON_STALE_REVISION") {
      return {
        status: 409,
        body: { ok: false, code: "COUPON_STALE_REVISION", requestId, message: error.message },
      };
    }
    if (error.code === "not_found") {
      return { status: 404, body: { ok: false, code: "PROMOTIONS_NOT_FOUND", requestId } };
    }
    if (error.code === "conflict" || error.code === "COUPON_CODE_CONFLICT") {
      return {
        status: 409,
        body: { ok: false, code: "PROMOTIONS_CONFLICT", requestId, message: error.message },
      };
    }
    if (error.code === "invalid_state" || error.code === "PROMOTION_ALREADY_ACTIVE" || error.code === "PROMOTION_RETIRED") {
      return {
        status: 409,
        body: { ok: false, code: "PROMOTIONS_INVALID_STATE", requestId, message: error.message },
      };
    }
    if (error.code === "validation") {
      return {
        status: 400,
        body: {
          ok: false,
          code: "PROMOTIONS_REQUEST_INVALID",
          requestId,
          message: error.message,
          issues: [error.message],
        },
      };
    }
    return {
      status: 400,
      body: {
        ok: false,
        code: "PROMOTIONS_REQUEST_INVALID",
        requestId,
        message: error.message,
        issues: [error.message],
      },
    };
  }

  return { status: 500, body: { ok: false, code: "INTERNAL_ERROR", requestId } };
}
