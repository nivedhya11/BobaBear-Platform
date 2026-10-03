/**
 * Operator-facing copy for IMP-036J workforce authoring (Design Readiness).
 * Customer surfaces must not import this module.
 */
export const COPY_OP_AUTO = "Customers get this without a code";
export const COPY_OP_COUPON = "Customers enter a coupon";
export const COPY_OP_ORDER = "This changes the items or order total";
export const COPY_OP_DELIVERY = "This changes the delivery charge";
export const COPY_OP_GIFT = "One menu item, included, with no customer choices";
export const COPY_OP_GIFT_INVALID =
  "Choose one menu item that needs no customer choices.";
export const COPY_OP_SECOND =
  "Another included-item offer is already active. This one was not activated.";
export const COPY_OP_RACE =
  "This activation did not become the active offer. Check the offer that is active, then try again if you still need a change.";
export const COPY_OP_CONFLICT = "Someone else changed this. Reload it and try again.";
export const COPY_OP_LIVE = "Customers can receive this offer.";
export const COPY_OP_DRAFT = "Not live yet. Customers do not receive this.";
export const COPY_OP_RETIRED = "Retired. New orders will not receive it.";
export const COPY_RETIRE_TITLE = "Retire this offer?";
export const COPY_RETIRE_BODY =
  "New orders will stop receiving it. Orders already placed stay as paid.";
export const COPY_RETIRE_CONFIRM = "Retire offer";
export const COPY_CANCEL = "Cancel";
export const COPY_DENIED = "You can't change this.";

export const COMPLIMENTARY_ACTIVE_UNIQUE_INDEX =
  "promotions_one_active_complimentary_per_brand_uidx";
