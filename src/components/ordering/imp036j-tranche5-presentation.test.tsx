import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CommercialOfferStack } from "./CommercialOfferStack";
import { CouponField } from "./CouponField";
import { IMP036J_COPY } from "./imp036j-copy";
import {
  canReuseCheckoutEvaluation,
  couponStatusCopy,
} from "./commercial-explanation-presentation";
import { PaymentReturnClient } from "./PaymentReturnClient";
import { PaymentPanel } from "./PaymentPanel";
import type { CommerceCheckout, CommerceCheckoutSnapshot } from "@/lib/customer-commerce";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/customer-auth/client", () => ({
  fetchCustomerSession: vi.fn(async () => ({
    ok: true,
    data: { authenticated: true },
  })),
}));

vi.mock("@/lib/customer-commerce", async () => {
  const actual = await vi.importActual<typeof import("@/lib/customer-commerce")>(
    "@/lib/customer-commerce",
  );
  return {
    ...actual,
    getPaymentState: vi.fn(async () => ({
      ok: true,
      data: { state: { payment: { status: "PENDING" }, checkoutStatus: "PAYMENT_PENDING" } },
    })),
    listCustomerOrders: vi.fn(async () => ({ ok: true, data: { items: [] } })),
    startPayment: vi.fn(),
    retryPayment: vi.fn(),
    readPaymentRecovery: vi.fn(() => null),
    clearPaymentRecovery: vi.fn(),
    readOrCreateStartIdempotencyKey: vi.fn(() => "idem"),
    readOrCreateRetryIdempotencyKey: vi.fn(() => "idem"),
    readOrCreateZeroPayableIdempotencyKey: vi.fn(() => "idem"),
  };
});

vi.mock("@/lib/razorpay", () => ({
  loadRazorpayCheckoutScript: vi.fn(),
  openRazorpayStandardCheckout: vi.fn(),
  parseRazorpayStandardCheckoutAction: vi.fn(),
  RAZORPAY_STANDARD_CHECKOUT_KIND: "razorpay",
}));

describe("IMP-036J Tranche 5 customer presentation", () => {
  it("renders Estimated subtotal without Total payable or invented delivery", () => {
    render(
      <CommercialOfferStack
        explanation={null}
        payableLabel={IMP036J_COPY.ESTIMATED_SUBTOTAL}
        payablePaise="19900"
      />,
    );
    expect(screen.getByText(IMP036J_COPY.ESTIMATED_SUBTOTAL)).toBeInTheDocument();
    expect(screen.queryByText(IMP036J_COPY.TOTAL_PAYABLE)).not.toBeInTheDocument();
    expect(screen.queryByText(IMP036J_COPY.DELIVERY_ROW)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: IMP036J_COPY.PRICE_SUMMARY })).toBeInTheDocument();
  });

  it("renders Current total without calling it Total payable", () => {
    render(
      <CommercialOfferStack
        explanation={null}
        payableLabel={IMP036J_COPY.CURRENT_CHECKOUT_TOTAL}
        payablePaise="24900"
        deliveryChargePaise="4000"
      />,
    );
    expect(screen.getByText(IMP036J_COPY.CURRENT_CHECKOUT_TOTAL)).toBeInTheDocument();
    expect(screen.queryByText(IMP036J_COPY.TOTAL_PAYABLE)).not.toBeInTheDocument();
  });

  it("renders Review Total payable and server threshold gap without client subtraction", () => {
    render(
      <CommercialOfferStack
        explanation={{
          couponPresentationClass: null,
          merchandiseOrOrderSavingPaise: "0",
          deliverySavingPaise: "0",
          totalSavedPaise: "0",
          grandTotalPaise: "19900",
          thresholdProgress: {
            remainingAmountPaise: "5000",
            remainingItemQuantity: null,
            displayName: "free delivery",
            benefitType: "delivery_fee_waiver",
          },
          complimentary: null,
          submittedCouponResult: null,
        }}
        payableLabel={IMP036J_COPY.TOTAL_PAYABLE}
        payablePaise="19900"
      />,
    );
    expect(screen.getByText(IMP036J_COPY.TOTAL_PAYABLE)).toBeInTheDocument();
    expect(screen.getByText("Add ₹50.00 more to unlock free delivery.")).toBeInTheDocument();
  });

  it("does not invent a delivery-saving row for standing ₹0 delivery", () => {
    render(
      <CommercialOfferStack
        explanation={{
          couponPresentationClass: null,
          merchandiseOrOrderSavingPaise: "8000",
          deliverySavingPaise: "0",
          totalSavedPaise: "8000",
          grandTotalPaise: "11900",
          thresholdProgress: null,
          complimentary: null,
          submittedCouponResult: null,
        }}
        payableLabel={IMP036J_COPY.TOTAL_PAYABLE}
        payablePaise="11900"
        deliveryChargePaise="0"
      />,
    );
    expect(screen.getByText(IMP036J_COPY.ORDER_SAVING_ROW)).toBeInTheDocument();
    expect(screen.queryByText(IMP036J_COPY.DELIVERY_SAVING_ROW)).not.toBeInTheDocument();
  });

  it("maps coupon presentation classes to locked copy and never says better price on equal payable", () => {
    expect(
      couponStatusCopy({
        explanation: {
          couponPresentationClass: "COUPON_APPLIED",
          merchandiseOrOrderSavingPaise: "8000",
          deliverySavingPaise: "0",
          totalSavedPaise: "8000",
          grandTotalPaise: "11900",
          thresholdProgress: null,
          complimentary: null,
          submittedCouponResult: { status: "APPLIED", reasonCode: "APPLIED", canonicalCode: "SAVE" },
        },
      })?.text,
    ).toBe(IMP036J_COPY.APPLIED_COUPON);
    expect(
      couponStatusCopy({
        explanation: {
          couponPresentationClass: "COUPON_VALID_NOT_SELECTED",
          merchandiseOrOrderSavingPaise: "9000",
          deliverySavingPaise: "0",
          totalSavedPaise: "9000",
          grandTotalPaise: "10900",
          thresholdProgress: null,
          complimentary: null,
          submittedCouponResult: {
            status: "VALID_BUT_NOT_SELECTED",
            reasonCode: "COUPON_VALID_BUT_NOT_SELECTED",
            canonicalCode: "SAVE",
          },
        },
      })?.text,
    ).toBe(IMP036J_COPY.STRICT_KEEP);
    const equalSelected = couponStatusCopy({
      explanation: {
        couponPresentationClass: "COUPON_EQUAL_PAYABLE_SELECTED",
        merchandiseOrOrderSavingPaise: "0",
        deliverySavingPaise: "0",
        totalSavedPaise: "0",
        grandTotalPaise: "19900",
        thresholdProgress: null,
        complimentary: {
          competingOffers: "NONE",
          productId: "p",
          variantId: "v",
          quantity: 1,
          merchandiseChargePaise: "0",
        },
        submittedCouponResult: {
          status: "VALID_BUT_NOT_SELECTED",
          reasonCode: "COUPON_VALID_BUT_NOT_SELECTED",
          canonicalCode: "GIFT",
        },
      },
    });
    expect(equalSelected?.text).toBe(IMP036J_COPY.EQUAL_SELECTED);
    expect(equalSelected?.text.toLowerCase()).not.toContain("better price");
    expect(
      couponStatusCopy({
        explanation: {
          couponPresentationClass: "COUPON_EQUAL_PAYABLE_NOT_SELECTED",
          merchandiseOrOrderSavingPaise: "0",
          deliverySavingPaise: "0",
          totalSavedPaise: "0",
          grandTotalPaise: "19900",
          thresholdProgress: null,
          complimentary: null,
          submittedCouponResult: {
            status: "VALID_BUT_NOT_SELECTED",
            reasonCode: "COUPON_VALID_BUT_NOT_SELECTED",
            canonicalCode: "SAVE",
          },
        },
      })?.text,
    ).toBe(IMP036J_COPY.EQUAL_KEPT);
  });

  it("names the coupon field Coupon and keeps pending apply visible", () => {
    render(
      <CouponField
        code="SAVE10"
        appliedCode={null}
        pending
        onCodeChange={() => undefined}
        onApply={() => undefined}
        onRemove={() => undefined}
        statusText={null}
        statusTone={null}
        returnPath="/order/cart/"
      />,
    );
    expect(screen.getByLabelText(IMP036J_COPY.COUPON_LABEL)).toBeInTheDocument();
    expect(screen.getByTestId("coupon-apply")).toBeDisabled();
    expect(screen.getAllByText(IMP036J_COPY.CHECKING).length).toBeGreaterThan(0);
  });

  it("renders complimentary included line without a picker", () => {
    render(
      <CommercialOfferStack
        explanation={{
          couponPresentationClass: "COUPON_EQUAL_PAYABLE_SELECTED",
          merchandiseOrOrderSavingPaise: "0",
          deliverySavingPaise: "0",
          totalSavedPaise: "0",
          grandTotalPaise: "19900",
          thresholdProgress: null,
          complimentary: {
            competingOffers: "NONE",
            productId: "p",
            variantId: "v",
            quantity: 1,
            merchandiseChargePaise: "0",
          },
          submittedCouponResult: null,
        }}
        payableLabel={IMP036J_COPY.TOTAL_PAYABLE}
        payablePaise="19900"
        complimentaryName="Taro Milk Tea"
      />,
    );
    expect(screen.getByTestId("complimentary-line")).toHaveTextContent("Taro Milk Tea");
    expect(screen.getByTestId("complimentary-line")).toHaveTextContent(IMP036J_COPY.INCLUDED);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/better price/i)).not.toBeInTheDocument();
  });

  it("shows NONE_CHOSEN conflict copy without selecting a gift", () => {
    render(
      <CommercialOfferStack
        explanation={{
          couponPresentationClass: null,
          merchandiseOrOrderSavingPaise: "0",
          deliverySavingPaise: "0",
          totalSavedPaise: "0",
          grandTotalPaise: "19900",
          thresholdProgress: null,
          complimentary: { competingOffers: "NONE_CHOSEN" },
          submittedCouponResult: null,
        }}
        payableLabel={IMP036J_COPY.TOTAL_PAYABLE}
        payablePaise="19900"
        showGiftConflict
      />,
    );
    expect(screen.getByTestId("copy-gift-conflict")).toHaveTextContent(IMP036J_COPY.GIFT_CONFLICT);
    expect(screen.queryByTestId("complimentary-line")).not.toBeInTheDocument();
  });

  it("renders stale and gift-gone alerts with Price summary name", () => {
    render(
      <CommercialOfferStack
        explanation={null}
        payableLabel={IMP036J_COPY.TOTAL_PAYABLE}
        payablePaise="21000"
        stale
        giftGone
      />,
    );
    expect(screen.getByTestId("copy-stale")).toHaveTextContent(IMP036J_COPY.STALE);
    expect(screen.getByTestId("copy-gift-gone")).toHaveTextContent(IMP036J_COPY.GIFT_GONE);
    expect(screen.getByRole("region", { name: IMP036J_COPY.PRICE_SUMMARY })).toBeInTheDocument();
  });

  it("reuses Checkout evaluation only when fulfilment, revision, and snapshot match", () => {
    expect(
      canReuseCheckoutEvaluation({
        checkout: {
          fulfilmentMode: "DELIVERY",
          sourceCartRevision: "3",
          activeSnapshot: { grandTotalPaise: "24900" },
        },
        cartRevision: "3",
      }),
    ).toBe(true);
    expect(
      canReuseCheckoutEvaluation({
        checkout: {
          fulfilmentMode: "DELIVERY",
          sourceCartRevision: "2",
          activeSnapshot: { grandTotalPaise: "24900" },
        },
        cartRevision: "3",
      }),
    ).toBe(false);
    expect(
      canReuseCheckoutEvaluation({
        checkout: { fulfilmentMode: "DELIVERY", sourceCartRevision: "3", activeSnapshot: null },
        cartRevision: "3",
      }),
    ).toBe(false);
  });
});

describe("PaymentPanel and payment return boundaries", () => {
  const checkout = {
    id: "chk-1",
    customerAuthUserId: "user-1",
    brandId: "brand-1",
    cartId: "cart-1",
    sourceCartRevision: "1",
    revision: "1",
    status: "READY_FOR_PAYMENT",
    expiresAt: "2026-08-13T01:00:00.000Z",
    fulfilmentMode: "DELIVERY",
    pickupOutletId: null,
    activeSnapshotId: "snap-1",
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    destination: null,
    activeSnapshot: null,
  } as unknown as CommerceCheckout;

  const snapshot = {
    id: "snap-1",
    checkoutId: "chk-1",
    checkoutRevision: "1",
    sourceCartRevision: "1",
    selectedOutletId: "outlet-1",
    evaluatedAt: "2026-08-13T00:00:00.000Z",
    fulfilmentMode: "DELIVERY",
    currency: "INR",
    basePaise: "19900",
    chargesPaise: "0",
    prePromotionSubtotalPaise: "19900",
    promotionDiscountPaise: "0",
    taxablePaise: "19900",
    taxPaise: "0",
    grandTotalPaise: "19900",
    taxInclusionMode: "exclusive",
    destination: null,
    pickupLocation: null,
    lines: [],
    charges: [],
    promotionEffects: [],
    taxComponents: [],
    serviceabilityEvaluatedAt: null,
  } as unknown as CommerceCheckoutSnapshot;

  it("PaymentPanel is a read-only commercial summary without coupon mutation controls", () => {
    render(
      <PaymentPanel
        checkout={checkout}
        snapshot={snapshot}
        onOrderReady={() => undefined}
      />,
    );
    expect(screen.getByTestId("price-summary")).toBeInTheDocument();
    expect(screen.queryByLabelText(IMP036J_COPY.COUPON_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByTestId("coupon-apply")).not.toBeInTheDocument();
    expect(screen.queryByTestId("coupon-change")).not.toBeInTheDocument();
    expect(screen.queryByTestId("coupon-remove")).not.toBeInTheDocument();
    expect(screen.queryByTestId("coupon-input")).not.toBeInTheDocument();
  });

  it("/order/payment return client has no offer breakdown or coupon controls", () => {
    render(<PaymentReturnClient />);
    expect(screen.queryByTestId("price-summary")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(IMP036J_COPY.COUPON_LABEL)).not.toBeInTheDocument();
    expect(screen.queryByText(IMP036J_COPY.ORDER_SAVING_ROW)).not.toBeInTheDocument();
  });
});
