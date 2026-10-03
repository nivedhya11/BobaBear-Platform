import {
  COPY_DENIED,
  COPY_OP_CONFLICT,
  COPY_OP_GIFT_INVALID,
  COPY_OP_RACE,
  COPY_OP_SECOND,
} from "@/shared/promotions/operator-copy";
import type { AdminHttpResult } from "./http";

export const COMMERCIAL_CONFLICT_MESSAGE =
  "This commercial configuration changed since you loaded it. Reload the latest state, review the differences, and try again.";

export const MOBILE_AUTHORING_MESSAGE =
  "Commercial editing is available on tablet and desktop. Mobile supports inspection and verification.";

export function isConflictResult(result: AdminHttpResult<unknown>): boolean {
  return !result.ok && result.status === 409;
}

export function describeAdminFailure(result: AdminHttpResult<unknown>): string {
  if (result.ok) return "";
  if (result.code === "PROMOTION_STALE_REVISION" || result.code === "COUPON_STALE_REVISION") {
    return COPY_OP_CONFLICT;
  }
  if (result.code === "PROMOTION_COMPLIMENTARY_ACTIVATION_RACE") return COPY_OP_RACE;
  if (result.code === "PROMOTION_COMPLIMENTARY_ACTIVE_CONFLICT") return COPY_OP_SECOND;
  if (result.code === "PROMOTION_COMPLIMENTARY_INVALID") return COPY_OP_GIFT_INVALID;
  if (result.status === 409) return COMMERCIAL_CONFLICT_MESSAGE;
  if (result.status === 401) return "Workforce sign-in is required.";
  if (result.status === 403) return COPY_DENIED;
  if (result.status === 404) return "The requested commercial resource was not found.";
  if (result.status === 0) return "Network error. Check your connection and try again.";
  if (result.message) return result.message;
  if (result.issues && result.issues.length > 0) return result.issues.join(" ");
  return `Request failed (${result.code}).`;
}

export function fieldErrorFromResult(
  result: AdminHttpResult<unknown>,
): Readonly<{ field?: string; message: string }> | null {
  if (result.ok) return null;
  return {
    ...(result.field ? { field: result.field } : {}),
    message: describeAdminFailure(result),
  };
}
