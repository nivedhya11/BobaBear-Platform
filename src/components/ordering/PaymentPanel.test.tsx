import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PaymentPanel } from "./PaymentPanel";
import type { CommerceCheckout, CommerceCheckoutSnapshot } from "@/lib/customer-commerce";

const startPayment = vi.fn<(...args: unknown[]) => unknown>();
const retryPayment = vi.fn<(...args: unknown[]) => unknown>();
const getPaymentState = vi.fn<(...args: unknown[]) => unknown>();
const submitPaymentClientEvidence = vi.fn<(...args: unknown[]) => unknown>();
const completeZeroPayableCheckout = vi.fn<(...args: unknown[]) => unknown>();
const listCustomerOrders = vi.fn<(...args: unknown[]) => unknown>();
const rememberPaymentRecovery = vi.fn<(...args: unknown[]) => unknown>();
const clearPaymentRecovery = vi.fn<(...args: unknown[]) => unknown>();
const clearCart = vi.fn<(...args: unknown[]) => unknown>();
const browserNavigate = vi.fn<(...args: unknown[]) => unknown>();
const readOrCreateStartIdempotencyKey = vi.fn<(...args: unknown[]) => unknown>(() => "idem-start");
const readOrCreateRetryIdempotencyKey = vi.fn<(...args: unknown[]) => unknown>(() => "idem-retry");
const readOrCreateZeroPayableIdempotencyKey = vi.fn<(...args: unknown[]) => unknown>(() => "idem-zero");
const loadRazorpayCheckoutScript = vi.fn<(...args: unknown[]) => unknown>();
const openRazorpayStandardCheckout = vi.fn<(...args: unknown[]) => unknown>();

vi.mock("@/components/ordering/browser-navigate", () => ({
  browserNavigate: (...args: unknown[]) => browserNavigate(...args),
}));

vi.mock("@/lib/customer-commerce", async () => {
  const actual = await vi.importActual<typeof import("@/lib/customer-commerce")>(
    "@/lib/customer-commerce",
  );
  return {
    ...actual,
    startPayment: (...args: unknown[]) => startPayment(...args),
    retryPayment: (...args: unknown[]) => retryPayment(...args),
    getPaymentState: (...args: unknown[]) => getPaymentState(...args),
    submitPaymentClientEvidence: (...args: unknown[]) => submitPaymentClientEvidence(...args),
    completeZeroPayableCheckout: (...args: unknown[]) => completeZeroPayableCheckout(...args),
    listCustomerOrders: (...args: unknown[]) => listCustomerOrders(...args),
    rememberPaymentRecovery: (...args: unknown[]) => rememberPaymentRecovery(...args),
    clearPaymentRecovery: (...args: unknown[]) => clearPaymentRecovery(...args),
    clearCart: (...args: unknown[]) => clearCart(...args),
    readOrCreateStartIdempotencyKey: (...args: unknown[]) => readOrCreateStartIdempotencyKey(...args),
    readOrCreateRetryIdempotencyKey: (...args: unknown[]) => readOrCreateRetryIdempotencyKey(...args),
    readOrCreateZeroPayableIdempotencyKey: (...args: unknown[]) =>
      readOrCreateZeroPayableIdempotencyKey(...args),
  };
});

vi.mock("@/lib/razorpay", async () => {
  const actual = await vi.importActual<typeof import("@/lib/razorpay")>("@/lib/razorpay");
  return {
    ...actual,
    loadRazorpayCheckoutScript: (...args: unknown[]) => loadRazorpayCheckoutScript(...args),
    openRazorpayStandardCheckout: (...args: unknown[]) => openRazorpayStandardCheckout(...args),
  };
});

const snapshotBase: CommerceCheckoutSnapshot = {
  id: "snap-1",
  checkoutId: "chk-1",
  checkoutRevision: "3",
  sourceCartRevision: "2",
  selectedOutletId: "outlet-1",
  evaluatedAt: "2026-08-13T00:10:00.000Z",
  fulfilmentMode: "DELIVERY",
  serviceabilityEvaluatedAt: "2026-08-13T00:10:00.000Z",
  currency: "INR",
  basePaise: "19900",
  chargesPaise: "6000",
  prePromotionSubtotalPaise: "25900",
  promotionDiscountPaise: "0",
  taxablePaise: "25900",
  taxPaise: "1295",
  grandTotalPaise: "27195",
  taxInclusionMode: "exclusive",
  destination: {
    destinationKind: "ONE_TIME_ADDRESS",
    sourceSavedAddressId: null,
    recipientName: "A",
    recipientPhone: "+919876543210",
    addressLine1: "1 Mall Road",
    addressLine2: null,
    landmark: null,
    locality: null,
    city: "Dehradun",
    stateCode: "IN-UT",
    postalCode: "248001",
    coordinates: null,
    label: null,
  },
  pickupLocation: null,
  lines: [],
  charges: [
    { chargeCode: "packaging", amountPaise: "2000", name: "Packaging" },
    { chargeCode: "delivery", amountPaise: "4000", name: "Delivery" },
  ],
  promotionEffects: [],
  taxComponents: [],
};

const checkout: CommerceCheckout = {
  id: "chk-1",
  customerAuthUserId: "user-1",
  brandId: "brand-1",
  cartId: "cart-1",
  sourceCartRevision: "2",
  revision: "3",
  status: "READY_FOR_PAYMENT",
  expiresAt: "2026-08-13T01:00:00.000Z",
  fulfilmentMode: "DELIVERY",
  pickupOutletId: null,
  activeSnapshotId: "snap-1",
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:10:00.000Z",
  destination: snapshotBase.destination,
  activeSnapshot: snapshotBase,
};

const payment = {
  id: "pay-1",
  checkoutId: "chk-1",
  checkoutSnapshotId: "snap-1",
  expectedAmountPaise: "27195",
  currency: "INR",
  status: "PROCESSING",
  createdAt: "2026-08-13T00:11:00.000Z",
  updatedAt: "2026-08-13T00:11:00.000Z",
  succeededAt: null,
  cancelledAt: null,
  expiredAt: null,
  supersededAt: null,
};

const attempt = {
  id: "att-1",
  paymentId: "pay-1",
  attemptOrdinal: "1",
  provider: "fake",
  methodIntent: "upi",
  providerExecutionIdentity: "payexec_1",
  status: "PENDING",
  createdAt: "2026-08-13T00:11:00.000Z",
  updatedAt: "2026-08-13T00:11:00.000Z",
  pendingAt: "2026-08-13T00:11:00.000Z",
  indeterminateAt: null,
  succeededAt: null,
  failedAt: null,
  cancelledAt: null,
};

const razorpayAction = {
  kind: "razorpay_standard_checkout" as const,
  payload: {
    keyId: "rzp_test_key",
    razorpayOrderId: "order_abc",
    amountPaise: "27195",
    currency: "INR",
    paymentId: "pay-1",
    attemptId: "att-1",
  },
};

beforeEach(() => {
  startPayment.mockReset();
  retryPayment.mockReset();
  getPaymentState.mockReset();
  submitPaymentClientEvidence.mockReset();
  completeZeroPayableCheckout.mockReset();
  listCustomerOrders.mockReset();
  rememberPaymentRecovery.mockReset();
  clearPaymentRecovery.mockReset();
  clearCart.mockReset();
  browserNavigate.mockReset();
  loadRazorpayCheckoutScript.mockReset();
  openRazorpayStandardCheckout.mockReset();
  readOrCreateStartIdempotencyKey.mockClear();
  readOrCreateRetryIdempotencyKey.mockClear();
  readOrCreateZeroPayableIdempotencyKey.mockClear();
  loadRazorpayCheckoutScript.mockResolvedValue({});
  getPaymentState.mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      state: {
        payment,
        attempt,
        attempts: [attempt],
        checkoutId: "chk-1",
        checkoutStatus: "PAYMENT_PENDING",
        checkoutRevision: "4",
        zeroPayableCompleted: false,
      },
    },
  });
  listCustomerOrders.mockResolvedValue({
    ok: true,
    status: 200,
    data: { items: [{ orderId: "ord-1" }], nextCursor: null },
  });
});

describe("PaymentPanel", () => {
  it("shows starting then success for a paid start", async () => {
    const onOrderReady = vi.fn();
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment: { ...payment, status: "SUCCEEDED" },
        attempt: { ...attempt, status: "SUCCEEDED" },
        checkoutId: "chk-1",
        checkoutRevision: "4",
      },
    });
    render(
      <PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={onOrderReady} />,
    );
    await userEvent.click(screen.getByTestId("payment-start"));
    expect(screen.getByTestId("payment-starting")).toBeInTheDocument();
    await waitFor(() => expect(onOrderReady).toHaveBeenCalledWith("ord-1"));
    expect(startPayment).toHaveBeenCalledWith({
      checkoutId: "chk-1",
      expectedCheckoutRevision: "3",
      paymentMethodIntent: "card",
      idempotencyKey: "idem-start",
    });
    expect(readOrCreateStartIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it("shows checking while payment remains unresolved", async () => {
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment,
        attempt,
        checkoutId: "chk-1",
        checkoutRevision: "4",
      },
    });
    getPaymentState.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        state: {
          payment,
          attempt,
          attempts: [attempt],
          checkoutId: "chk-1",
          checkoutStatus: "PAYMENT_PENDING",
          checkoutRevision: "4",
          zeroPayableCompleted: false,
        },
      },
    });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={vi.fn()} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(screen.getByTestId("payment-checking")).toBeInTheDocument());
  });

  it("offers retry when the attempt failed and payment remains OPEN", async () => {
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment: { ...payment, status: "OPEN" },
        attempt: { ...attempt, status: "FAILED" },
        checkoutId: "chk-1",
        checkoutRevision: "4",
      },
    });
    retryPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment: { ...payment, status: "SUCCEEDED" },
        attempt: { ...attempt, id: "att-2", status: "SUCCEEDED" },
        checkoutId: "chk-1",
        checkoutRevision: "5",
      },
    });
    const onOrderReady = vi.fn();
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={onOrderReady} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(screen.getByTestId("payment-retry")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("payment-retry"));
    await waitFor(() => expect(onOrderReady).toHaveBeenCalledWith("ord-1"));
    expect(retryPayment).toHaveBeenCalledWith({
      paymentId: "pay-1",
      expectedCheckoutRevision: "4",
      paymentMethodIntent: "card",
      idempotencyKey: "idem-retry",
    });
  });

  it("shows a clear error for transport failure", async () => {
    startPayment.mockResolvedValue({ ok: false, code: "NETWORK_ERROR", status: 0 });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={vi.fn()} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/network problem/i),
    );
  });

  it("follows a provider-neutral redirect clientAction", async () => {
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment,
        attempt,
        checkoutId: "chk-1",
        checkoutRevision: "4",
        clientAction: { kind: "redirect", payload: { url: "https://fake-payments.test/pay/1" } },
      },
    });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={vi.fn()} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() =>
      expect(browserNavigate).toHaveBeenCalledWith("https://fake-payments.test/pay/1"),
    );
    expect(rememberPaymentRecovery).toHaveBeenCalledWith({
      paymentId: "pay-1",
      checkoutId: "chk-1",
      checkoutRevision: "4",
    });
  });

  it("completes zero-payable without starting a Payment", async () => {
    const onOrderReady = vi.fn();
    completeZeroPayableCheckout.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "zero_payable_completed",
        checkoutId: "chk-1",
        checkoutRevision: "4",
        snapshotId: "snap-1",
      },
    });
    render(
      <PaymentPanel
        checkout={checkout}
        snapshot={{ ...snapshotBase, grandTotalPaise: "0" }}
        onOrderReady={onOrderReady}
      />,
    );
    expect(screen.queryByTestId("payment-start")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /complete order/i }));
    await waitFor(() => expect(onOrderReady).toHaveBeenCalledWith("ord-1"));
    expect(startPayment).not.toHaveBeenCalled();
    expect(completeZeroPayableCheckout).toHaveBeenCalledWith({
      checkoutId: "chk-1",
      expectedCheckoutRevision: "3",
      idempotencyKey: "idem-zero",
    });
  });

  it("reuses the same start key when the customer clicks Pay twice quickly", async () => {
    let resolveStart: ((value: unknown) => void) | undefined;
    startPayment.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve;
        }),
    );
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={vi.fn()} />);
    const button = screen.getByTestId("payment-start");
    await userEvent.click(button);
    await userEvent.click(button);
    expect(startPayment).toHaveBeenCalledTimes(1);
    resolveStart?.({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment: { ...payment, status: "SUCCEEDED" },
        attempt: { ...attempt, status: "SUCCEEDED" },
        checkoutId: "chk-1",
        checkoutRevision: "4",
      },
    });
    await waitFor(() => expect(readOrCreateStartIdempotencyKey).toHaveBeenCalledTimes(1));
  });

  it("opens Razorpay Checkout only after an explicit Pay click", async () => {
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment,
        attempt,
        checkoutId: "chk-1",
        checkoutRevision: "4",
        clientAction: razorpayAction,
      },
    });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={vi.fn()} />);
    expect(openRazorpayStandardCheckout).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(loadRazorpayCheckoutScript).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(openRazorpayStandardCheckout).toHaveBeenCalledTimes(1));
    const opened = openRazorpayStandardCheckout.mock.calls[0]?.[0] as {
      action: { keyId: string; razorpayOrderId: string; amountPaise: string };
      onHandler: (evidence: unknown) => void;
    };
    expect(opened.action.keyId).toBe("rzp_test_key");
    expect(opened.action.razorpayOrderId).toBe("order_abc");
    expect(opened.action.amountPaise).toBe("27195");
    expect(screen.getByTestId("payment-checkout-open")).toBeInTheDocument();
  });

  it("rejects malformed or secret-bearing Razorpay clientAction without opening Checkout", async () => {
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment,
        attempt,
        checkoutId: "chk-1",
        checkoutRevision: "4",
        clientAction: {
          kind: "razorpay_standard_checkout",
          payload: { ...razorpayAction.payload, keySecret: "nope", amountPaise: "" },
        },
      },
    });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={vi.fn()} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(openRazorpayStandardCheckout).not.toHaveBeenCalled();
  });

  it("surfaces script load failure without treating Payment as failed", async () => {
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment,
        attempt,
        checkoutId: "chk-1",
        checkoutRevision: "4",
        clientAction: razorpayAction,
      },
    });
    loadRazorpayCheckoutScript.mockRejectedValue(new Error("cdn down"));
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={vi.fn()} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load/i),
    );
    expect(screen.getByTestId("payment-reopen-checkout")).toBeInTheDocument();
    expect(openRazorpayStandardCheckout).not.toHaveBeenCalled();
    expect(submitPaymentClientEvidence).not.toHaveBeenCalled();
  });

  it("submits handler evidence, shows checking, and continues only after server success", async () => {
    const onOrderReady = vi.fn();
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment,
        attempt,
        checkoutId: "chk-1",
        checkoutRevision: "4",
        clientAction: razorpayAction,
      },
    });
    submitPaymentClientEvidence.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        state: {
          payment: { ...payment, status: "SUCCEEDED" },
          attempt: { ...attempt, status: "SUCCEEDED" },
          attempts: [{ ...attempt, status: "SUCCEEDED" }],
          checkoutId: "chk-1",
          checkoutStatus: "COMPLETED",
          checkoutRevision: "5",
          zeroPayableCompleted: false,
        },
      },
    });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={onOrderReady} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(openRazorpayStandardCheckout).toHaveBeenCalledTimes(1));
    const opened = openRazorpayStandardCheckout.mock.calls[0]?.[0] as {
      action: { retry?: unknown };
      onHandler: (evidence: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
      }) => void;
    };
    opened.onHandler({
      razorpay_payment_id: "pay_rzp_1",
      razorpay_order_id: "order_abc",
      razorpay_signature: "sig_rzp_1",
    });
    await waitFor(() => expect(onOrderReady).toHaveBeenCalledWith("ord-1"));
    expect(submitPaymentClientEvidence).toHaveBeenCalledWith({
      paymentId: "pay-1",
      kind: "razorpay_standard_checkout",
      payload: {
        razorpay_payment_id: "pay_rzp_1",
        razorpay_order_id: "order_abc",
        razorpay_signature: "sig_rzp_1",
      },
    });
  });

  it("does not confirm an Order from the browser handler alone", async () => {
    const onOrderReady = vi.fn();
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment,
        attempt,
        checkoutId: "chk-1",
        checkoutRevision: "4",
        clientAction: razorpayAction,
      },
    });
    submitPaymentClientEvidence.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        state: {
          payment,
          attempt,
          attempts: [attempt],
          checkoutId: "chk-1",
          checkoutStatus: "PAYMENT_PENDING",
          checkoutRevision: "4",
          zeroPayableCompleted: false,
        },
      },
    });
    getPaymentState.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        state: {
          payment,
          attempt,
          attempts: [attempt],
          checkoutId: "chk-1",
          checkoutStatus: "PAYMENT_PENDING",
          checkoutRevision: "4",
          zeroPayableCompleted: false,
        },
      },
    });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={onOrderReady} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(openRazorpayStandardCheckout).toHaveBeenCalledTimes(1));
    const opened = openRazorpayStandardCheckout.mock.calls[0]?.[0] as {
      onHandler: (evidence: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
      }) => void;
    };
    opened.onHandler({
      razorpay_payment_id: "pay_rzp_1",
      razorpay_order_id: "order_abc",
      razorpay_signature: "sig_rzp_1",
    });
    await waitFor(() => expect(submitPaymentClientEvidence).toHaveBeenCalledTimes(1));
    expect(onOrderReady).not.toHaveBeenCalled();
    expect(screen.getByTestId("payment-checking")).toBeInTheDocument();
  });

  it("ignores duplicate handler invocation", async () => {
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment,
        attempt,
        checkoutId: "chk-1",
        checkoutRevision: "4",
        clientAction: razorpayAction,
      },
    });
    submitPaymentClientEvidence.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        state: {
          payment,
          attempt,
          attempts: [attempt],
          checkoutId: "chk-1",
          checkoutStatus: "PAYMENT_PENDING",
          checkoutRevision: "4",
          zeroPayableCompleted: false,
        },
      },
    });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={vi.fn()} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(openRazorpayStandardCheckout).toHaveBeenCalledTimes(1));
    const opened = openRazorpayStandardCheckout.mock.calls[0]?.[0] as {
      onHandler: (evidence: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
      }) => void;
    };
    const evidence = {
      razorpay_payment_id: "pay_rzp_1",
      razorpay_order_id: "order_abc",
      razorpay_signature: "sig_rzp_1",
    };
    opened.onHandler(evidence);
    opened.onHandler(evidence);
    await waitFor(() => expect(submitPaymentClientEvidence).toHaveBeenCalledTimes(1));
  });

  it("recovers via Payment state when client evidence is rejected or uncertain", async () => {
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment,
        attempt,
        checkoutId: "chk-1",
        checkoutRevision: "4",
        clientAction: razorpayAction,
      },
    });
    submitPaymentClientEvidence.mockResolvedValue({
      ok: false,
      code: "PAYMENT_PROVIDER_EVIDENCE_INVALID",
      status: 400,
    });
    getPaymentState.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        state: {
          payment,
          attempt,
          attempts: [attempt],
          checkoutId: "chk-1",
          checkoutStatus: "PAYMENT_PENDING",
          checkoutRevision: "4",
          zeroPayableCompleted: false,
        },
      },
    });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={vi.fn()} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(openRazorpayStandardCheckout).toHaveBeenCalledTimes(1));
    const opened = openRazorpayStandardCheckout.mock.calls[0]?.[0] as {
      onHandler: (evidence: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
      }) => void;
    };
    opened.onHandler({
      razorpay_payment_id: "pay_rzp_1",
      razorpay_order_id: "order_abc",
      razorpay_signature: "bad",
    });
    await waitFor(() => expect(screen.getByTestId("payment-checking")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be verified/i);
  });

  it("treats dismissal as non-terminal and reopens the existing clientAction", async () => {
    const onOrderReady = vi.fn();
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment,
        attempt,
        checkoutId: "chk-1",
        checkoutRevision: "4",
        clientAction: razorpayAction,
      },
    });
    getPaymentState.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        state: {
          payment,
          attempt,
          attempts: [attempt],
          checkoutId: "chk-1",
          checkoutStatus: "PAYMENT_PENDING",
          checkoutRevision: "4",
          zeroPayableCompleted: false,
        },
      },
    });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={onOrderReady} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(openRazorpayStandardCheckout).toHaveBeenCalledTimes(1));
    const opened = openRazorpayStandardCheckout.mock.calls[0]?.[0] as {
      onDismiss: () => void;
      action: { razorpayOrderId: string; amountPaise: string };
    };
    opened.onDismiss();
    await waitFor(() => expect(getPaymentState).toHaveBeenCalledWith("pay-1"));
    await waitFor(() => expect(screen.getByTestId("payment-recovery-dismissed")).toBeInTheDocument());
    expect(screen.getByTestId("payment-recovery-dismissed")).toHaveTextContent("Payment not completed");
    expect(screen.getByTestId("payment-recovery-dismissed")).toHaveTextContent(
      /closed the payment window/i,
    );
    expect(screen.queryByText(/window closed/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-retry")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-start")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("payment-continue"));
    await waitFor(() => expect(openRazorpayStandardCheckout).toHaveBeenCalledTimes(2));
    const reopened = openRazorpayStandardCheckout.mock.calls[1]?.[0] as {
      action: { razorpayOrderId: string; amountPaise: string; paymentId: string; attemptId: string };
    };
    expect(reopened.action.razorpayOrderId).toBe(opened.action.razorpayOrderId);
    expect(reopened.action.amountPaise).toBe(opened.action.amountPaise);
    expect(reopened.action.paymentId).toBe("pay-1");
    expect(reopened.action.attemptId).toBe("att-1");
    expect(startPayment).toHaveBeenCalledTimes(1);
    expect(retryPayment).not.toHaveBeenCalled();
    expect(onOrderReady).not.toHaveBeenCalled();
    expect(submitPaymentClientEvidence).not.toHaveBeenCalled();
  });

  it("shows checking after provider failure when authoritative state remains unresolved", async () => {
    const onOrderReady = vi.fn();
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment,
        attempt,
        checkoutId: "chk-1",
        checkoutRevision: "4",
        clientAction: razorpayAction,
      },
    });
    getPaymentState.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        state: {
          payment,
          attempt,
          attempts: [attempt],
          checkoutId: "chk-1",
          checkoutStatus: "PAYMENT_PENDING",
          checkoutRevision: "4",
          zeroPayableCompleted: false,
        },
      },
    });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={onOrderReady} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(openRazorpayStandardCheckout).toHaveBeenCalledTimes(1));
    const opened = openRazorpayStandardCheckout.mock.calls[0]?.[0] as {
      onProviderFailure: () => void;
    };
    opened.onProviderFailure();
    await waitFor(() => expect(screen.getByTestId("payment-checking")).toBeInTheDocument());
    expect(screen.getByTestId("payment-checking")).toHaveTextContent(/Checking your payment/i);
    expect(screen.getByTestId("payment-checking")).toHaveTextContent(/don't pay again yet/i);
    // Browser failure triggers server state read (reconcile authority), never client FAILED.
    await waitFor(() => expect(getPaymentState).toHaveBeenCalled());
    expect(submitPaymentClientEvidence).not.toHaveBeenCalled();
    expect(screen.queryByTestId("payment-retry")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-continue")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start a new order/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/window closed/i)).not.toBeInTheDocument();
    expect(onOrderReady).not.toHaveBeenCalled();
    expect(submitPaymentClientEvidence).not.toHaveBeenCalled();
  });

  it("does not let modal ondismiss overwrite payment.failed recovery", async () => {
    const callOrder: string[] = [];
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment: { ...payment, status: "OPEN" },
        attempt: { ...attempt, status: "FAILED" },
        checkoutId: "chk-1",
        checkoutRevision: "4",
        clientAction: razorpayAction,
      },
    });
    getPaymentState.mockImplementation(async () => {
      callOrder.push("getPaymentState");
      return {
        ok: true,
        status: 200,
        data: {
          state: {
            payment: { ...payment, status: "OPEN" },
            attempt: { ...attempt, status: "FAILED" },
            attempts: [{ ...attempt, status: "FAILED" }],
            checkoutId: "chk-1",
            checkoutStatus: "PAYMENT_PENDING",
            checkoutRevision: "4",
            zeroPayableCompleted: false,
          },
        },
      };
    });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={vi.fn()} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(openRazorpayStandardCheckout).toHaveBeenCalledTimes(1));
    const opened = openRazorpayStandardCheckout.mock.calls[0]?.[0] as {
      onProviderFailure: () => void;
      onDismiss: () => void;
    };
    callOrder.push("payment.failed");
    opened.onProviderFailure();
    callOrder.push("modal.ondismiss");
    opened.onDismiss();
    await waitFor(() => expect(screen.getByTestId("payment-recovery-failed")).toBeInTheDocument());
    expect(callOrder[0]).toBe("payment.failed");
    expect(callOrder).toContain("modal.ondismiss");
    expect(callOrder).toContain("getPaymentState");
    expect(callOrder.indexOf("payment.failed")).toBeLessThan(callOrder.indexOf("modal.ondismiss"));
    expect(getPaymentState).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("payment-recovery-failed")).toHaveTextContent("Payment unsuccessful");
    expect(screen.getByTestId("payment-retry")).toBeInTheDocument();
    expect(screen.queryByTestId("payment-recovery-dismissed")).not.toBeInTheDocument();
    expect(screen.queryByText(/window closed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Payment not completed/i)).not.toBeInTheDocument();
  });

  it("shows Payment unsuccessful with retry when payment.failed maps to authoritative FAILED", async () => {
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment,
        attempt,
        checkoutId: "chk-1",
        checkoutRevision: "4",
        clientAction: razorpayAction,
      },
    });
    getPaymentState.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        state: {
          payment: { ...payment, status: "OPEN" },
          attempt: { ...attempt, status: "FAILED" },
          attempts: [{ ...attempt, status: "FAILED" }],
          checkoutId: "chk-1",
          checkoutStatus: "PAYMENT_PENDING",
          checkoutRevision: "4",
          zeroPayableCompleted: false,
        },
      },
    });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={vi.fn()} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(openRazorpayStandardCheckout).toHaveBeenCalledTimes(1));
    const opened = openRazorpayStandardCheckout.mock.calls[0]?.[0] as {
      onProviderFailure: () => void;
    };
    opened.onProviderFailure();
    await waitFor(() => expect(screen.getByTestId("payment-recovery-failed")).toBeInTheDocument());
    expect(screen.getByTestId("payment-recovery-failed")).toHaveTextContent(
      /wasn't completed\. No order has been placed/i,
    );
    expect(screen.getByTestId("payment-retry")).toHaveTextContent("Try payment again · ₹271.95");
    expect(screen.queryByTestId("payment-start-new-order")).not.toBeInTheDocument();
  });

  it("offers Start a new order after authoritative FAILED and clears cart via existing clearCart", async () => {
    getPaymentState.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        state: {
          payment: { ...payment, status: "OPEN" },
          attempt: { ...attempt, status: "FAILED" },
          attempts: [{ ...attempt, status: "FAILED" }],
          checkoutId: "chk-1",
          checkoutStatus: "READY_FOR_PAYMENT",
          checkoutRevision: "4",
          zeroPayableCompleted: false,
        },
      },
    });
    clearCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: { cart: { id: "cart-1", revision: "3", lines: [] } },
    });
    render(
      <PaymentPanel
        checkout={checkout}
        snapshot={snapshotBase}
        brandId="brand-1"
        activeCartRevision="2"
        onOrderReady={vi.fn()}
        resumePaymentId="pay-1"
      />,
    );
    await waitFor(() => expect(screen.getByTestId("payment-start-new-order")).toBeInTheDocument());
    expect(screen.getByTestId("payment-retry")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("payment-start-new-order"));
    await waitFor(() => expect(clearCart).toHaveBeenCalledWith({ brandId: "brand-1", expectedRevision: "2" }));
    expect(clearPaymentRecovery).toHaveBeenCalled();
    expect(browserNavigate).toHaveBeenCalledWith("/order/");
  });

  it("hides Start a new order while payment remains unresolved", async () => {
    getPaymentState.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        state: {
          payment: { ...payment, status: "PROCESSING" },
          attempt: { ...attempt, status: "PENDING" },
          attempts: [{ ...attempt, status: "PENDING" }],
          checkoutId: "chk-1",
          checkoutStatus: "PAYMENT_PENDING",
          checkoutRevision: "4",
          zeroPayableCompleted: false,
        },
      },
    });
    render(
      <PaymentPanel
        checkout={checkout}
        snapshot={snapshotBase}
        brandId="brand-1"
        activeCartRevision="2"
        onOrderReady={vi.fn()}
        resumePaymentId="pay-1"
      />,
    );
    await waitFor(() => expect(screen.getByTestId("payment-checking")).toBeInTheDocument());
    expect(screen.queryByTestId("payment-start-new-order")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-retry")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-start")).not.toBeInTheDocument();
  });

  it("does not let dismiss overwrite a successful handler confirmation path", async () => {
    const onOrderReady = vi.fn();
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment,
        attempt,
        checkoutId: "chk-1",
        checkoutRevision: "4",
        clientAction: razorpayAction,
      },
    });
    submitPaymentClientEvidence.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        state: {
          payment: { ...payment, status: "SUCCEEDED" },
          attempt: { ...attempt, status: "SUCCEEDED" },
          attempts: [{ ...attempt, status: "SUCCEEDED" }],
          checkoutId: "chk-1",
          checkoutStatus: "COMPLETED",
          checkoutRevision: "5",
          zeroPayableCompleted: false,
        },
      },
    });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={onOrderReady} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(openRazorpayStandardCheckout).toHaveBeenCalledTimes(1));
    const opened = openRazorpayStandardCheckout.mock.calls[0]?.[0] as {
      onHandler: (evidence: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
      }) => void;
      onDismiss: () => void;
    };
    opened.onHandler({
      razorpay_payment_id: "pay_rzp_1",
      razorpay_order_id: "order_abc",
      razorpay_signature: "sig_rzp_1",
    });
    opened.onDismiss();
    await waitFor(() => expect(onOrderReady).toHaveBeenCalledWith("ord-1"));
    expect(screen.queryByTestId("payment-recovery-dismissed")).not.toBeInTheDocument();
    expect(screen.queryByText(/window closed/i)).not.toBeInTheDocument();
  });

  it("hides retry for PROCESSING payment state", async () => {
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment: { ...payment, status: "PROCESSING" },
        attempt: { ...attempt, status: "PENDING" },
        checkoutId: "chk-1",
        checkoutRevision: "4",
      },
    });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={vi.fn()} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(screen.getByTestId("payment-checking")).toBeInTheDocument());
    expect(screen.queryByTestId("payment-retry")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-continue")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-start")).not.toBeInTheDocument();
  });

  it("hides retry for PENDING attempts while checking", async () => {
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment,
        attempt: { ...attempt, status: "PENDING" },
        checkoutId: "chk-1",
        checkoutRevision: "4",
      },
    });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={vi.fn()} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(screen.getByTestId("payment-checking")).toBeInTheDocument());
    expect(screen.getByTestId("payment-checking")).toHaveTextContent(/don't pay again yet/i);
    expect(screen.queryByTestId("payment-retry")).not.toBeInTheDocument();
  });

  it("does not offer retry for terminal payments", async () => {
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment: { ...payment, status: "EXPIRED" },
        attempt: { ...attempt, status: "FAILED" },
        checkoutId: "chk-1",
        checkoutRevision: "4",
      },
    });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={vi.fn()} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByTestId("payment-retry")).not.toBeInTheDocument();
  });

  it("keeps retry available after retry network uncertainty without starting a new payment", async () => {
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment: { ...payment, status: "OPEN" },
        attempt: { ...attempt, status: "FAILED" },
        checkoutId: "chk-1",
        checkoutRevision: "4",
      },
    });
    retryPayment.mockResolvedValue({ ok: false, code: "NETWORK_ERROR", status: 0 });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={vi.fn()} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(screen.getByTestId("payment-retry")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("payment-retry"));
    await waitFor(() => expect(retryPayment).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/network problem/i)).toBeInTheDocument();
    expect(screen.getByTestId("payment-retry")).toBeInTheDocument();
    expect(screen.getByTestId("payment-recovery-failed")).toBeInTheDocument();
    expect(startPayment).toHaveBeenCalledTimes(1);
  });

  it("offers BOBA retry only after server state allows it, with a new Checkout action", async () => {
    const onOrderReady = vi.fn();
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment: { ...payment, status: "OPEN" },
        attempt: { ...attempt, status: "FAILED" },
        checkoutId: "chk-1",
        checkoutRevision: "4",
      },
    });
    retryPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment,
        attempt: { ...attempt, id: "att-2", providerExecutionIdentity: "payexec_2" },
        checkoutId: "chk-1",
        checkoutRevision: "5",
        clientAction: {
          kind: "razorpay_standard_checkout",
          payload: {
            ...razorpayAction.payload,
            razorpayOrderId: "order_new",
            attemptId: "att-2",
          },
        },
      },
    });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={onOrderReady} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(screen.getByTestId("payment-retry")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("payment-retry"));
    await waitFor(() => expect(openRazorpayStandardCheckout).toHaveBeenCalledTimes(1));
    const opened = openRazorpayStandardCheckout.mock.calls[0]?.[0] as {
      action: { razorpayOrderId: string; attemptId: string };
    };
    expect(opened.action.razorpayOrderId).toBe("order_new");
    expect(opened.action.attemptId).toBe("att-2");
    expect(opened.action.razorpayOrderId).not.toBe("order_abc");
  });

  it("shows itemized snapshot charges and pay amount equal to grand total", () => {
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={vi.fn()} />);
    expect(screen.getByTestId("checkout-fee-breakdown")).toHaveTextContent("Packaging");
    expect(screen.getByTestId("checkout-fee-breakdown")).toHaveTextContent("Delivery");
    expect(screen.getByTestId("checkout-fee-breakdown")).toHaveTextContent("Subtotal");
    expect(screen.getByTestId("checkout-fee-breakdown")).toHaveTextContent("₹199.00");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByTestId("payment-provider-owned-note")).toBeInTheDocument();
    expect(screen.getByTestId("payment-start")).toHaveTextContent(
      "Pay securely with Razorpay · ₹271.95",
    );
  });

  it("blocks a second pay while payment is processing", async () => {
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment,
        attempt,
        checkoutId: "chk-1",
        checkoutRevision: "4",
      },
    });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={vi.fn()} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(screen.getByTestId("payment-checking")).toBeInTheDocument());
    expect(screen.queryByTestId("payment-start")).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-retry")).not.toBeInTheDocument();
    expect(startPayment).toHaveBeenCalledTimes(1);
  });

  it("shows explicit don't-pay-again copy for indeterminate attempts", async () => {
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment,
        attempt: { ...attempt, status: "INDETERMINATE" },
        checkoutId: "chk-1",
        checkoutRevision: "4",
      },
    });
    getPaymentState.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        state: {
          payment,
          attempt: { ...attempt, status: "INDETERMINATE" },
          attempts: [{ ...attempt, status: "INDETERMINATE" }],
          checkoutId: "chk-1",
          checkoutStatus: "PAYMENT_PENDING",
          checkoutRevision: "4",
          zeroPayableCompleted: false,
        },
      },
    });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={vi.fn()} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() =>
      expect(screen.getByTestId("payment-checking")).toHaveTextContent(/don't pay again yet/i),
    );
    expect(screen.getByTestId("payment-checking")).toHaveTextContent(/Checking your payment/i);
    expect(screen.queryByTestId("payment-retry")).not.toBeInTheDocument();
  });

  it("offers retry with failure recovery copy when start returns FAILED+OPEN", async () => {
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment: { ...payment, status: "OPEN" },
        attempt: { ...attempt, status: "FAILED" },
        checkoutId: "chk-1",
        checkoutRevision: "4",
      },
    });
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={vi.fn()} />);
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(screen.getByTestId("payment-recovery-failed")).toBeInTheDocument());
    expect(screen.getByTestId("payment-retry")).toHaveTextContent("Try payment again · ₹271.95");
    expect(screen.getByTestId("payment-recovery-failed")).toHaveTextContent("Payment unsuccessful");
  });

  it("preserves back-to-review on dismissed recovery", async () => {
    const onBackToReview = vi.fn();
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment,
        attempt,
        checkoutId: "chk-1",
        checkoutRevision: "9",
        clientAction: razorpayAction,
      },
    });
    getPaymentState.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        state: {
          payment,
          attempt,
          attempts: [attempt],
          checkoutId: "chk-1",
          checkoutStatus: "PAYMENT_PENDING",
          checkoutRevision: "9",
          zeroPayableCompleted: false,
        },
      },
    });
    render(
      <PaymentPanel
        checkout={checkout}
        snapshot={snapshotBase}
        onOrderReady={vi.fn()}
        onBackToReview={onBackToReview}
      />,
    );
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(openRazorpayStandardCheckout).toHaveBeenCalledTimes(1));
    const opened = openRazorpayStandardCheckout.mock.calls[0]?.[0] as { onDismiss: () => void };
    opened.onDismiss();
    await waitFor(() => expect(screen.getByTestId("payment-continue")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("payment-back-to-review"));
    expect(onBackToReview).toHaveBeenCalledWith("9");
  });

  it("notifies parent of checkout revision on start and back-to-review", async () => {
    const onCheckoutRevisionChange = vi.fn();
    const onBackToReview = vi.fn();
    startPayment.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        kind: "payment_started",
        payment: { ...payment, status: "OPEN" },
        attempt: { ...attempt, status: "FAILED" },
        checkoutId: "chk-1",
        checkoutRevision: "11",
      },
    });
    render(
      <PaymentPanel
        checkout={checkout}
        snapshot={snapshotBase}
        onOrderReady={vi.fn()}
        onCheckoutRevisionChange={onCheckoutRevisionChange}
        onBackToReview={onBackToReview}
      />,
    );
    await userEvent.click(screen.getByTestId("payment-start"));
    await waitFor(() => expect(screen.getByTestId("payment-retry")).toBeInTheDocument());
    expect(onCheckoutRevisionChange).toHaveBeenCalledWith("11");
    await userEvent.click(screen.getByTestId("payment-back-to-review"));
    expect(onBackToReview).toHaveBeenCalledWith("11");
  });

  it("resumes unresolved checking for cart-changed PAYMENT_PENDING without Pay CTA", async () => {
    getPaymentState.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        state: {
          payment,
          attempt,
          attempts: [attempt],
          checkoutId: "chk-1",
          checkoutStatus: "PAYMENT_PENDING",
          checkoutRevision: "4",
          zeroPayableCompleted: false,
        },
      },
    });
    render(
      <PaymentPanel
        checkout={checkout}
        snapshot={snapshotBase}
        onOrderReady={vi.fn()}
        resumePaymentId="pay-1"
        cartChangedWhilePending
      />,
    );
    await waitFor(() => expect(screen.getByTestId("payment-checking")).toBeInTheDocument());
    expect(screen.getByText("Previous payment is being checked")).toBeInTheDocument();
    expect(screen.queryByTestId("payment-start")).not.toBeInTheDocument();
    expect(startPayment).not.toHaveBeenCalled();
    expect(getPaymentState).toHaveBeenCalledWith("pay-1");
  });

  it("notifies parent when resumed cart-changed payment is terminal", async () => {
    const onTerminal = vi.fn();
    getPaymentState.mockImplementation(async () => ({
      ok: true,
      status: 200,
      data: {
        state: {
          payment: { ...payment, status: "CANCELLED" },
          attempt: { ...attempt, status: "FAILED" },
          attempts: [{ ...attempt, status: "FAILED" }],
          checkoutId: "chk-1",
          checkoutStatus: "DRAFT",
          checkoutRevision: "5",
          zeroPayableCompleted: false,
        },
      },
    }));
    render(
      <PaymentPanel
        checkout={checkout}
        snapshot={snapshotBase}
        onOrderReady={vi.fn()}
        resumePaymentId="pay-1"
        cartChangedWhilePending
        onPaymentTerminalForCartChange={onTerminal}
      />,
    );
    await waitFor(() => expect(onTerminal).toHaveBeenCalled());
    expect(screen.queryByTestId("payment-start")).not.toBeInTheDocument();
  });

  it("keeps previous-checkout retry for FAILED+OPEN when cart changed (no public abandon)", async () => {
    getPaymentState.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        state: {
          payment: { ...payment, status: "OPEN" },
          attempt: { ...attempt, status: "FAILED" },
          attempts: [{ ...attempt, status: "FAILED" }],
          checkoutId: "chk-1",
          checkoutStatus: "PAYMENT_PENDING",
          checkoutRevision: "4",
          zeroPayableCompleted: false,
        },
      },
    });
    render(
      <PaymentPanel
        checkout={checkout}
        snapshot={snapshotBase}
        brandId="brand-1"
        activeCartRevision="2"
        onOrderReady={vi.fn()}
        resumePaymentId="pay-1"
        cartChangedWhilePending
        embeddedInPreviousPaymentRecovery
      />,
    );
    await waitFor(() => expect(screen.getByTestId("payment-retry")).toBeInTheDocument());
    expect(screen.getByTestId("payment-recovery-failed")).toBeInTheDocument();
    expect(screen.getByTestId("payment-start-new-order")).toBeInTheDocument();
    expect(screen.queryByTestId("payment-start")).not.toBeInTheDocument();
  });

  it("PaymentPanel has a price summary and no coupon mutation controls", () => {
    render(<PaymentPanel checkout={checkout} snapshot={snapshotBase} onOrderReady={vi.fn()} />);
    expect(screen.getByTestId("price-summary")).toBeInTheDocument();
    expect(screen.queryByLabelText("Coupon")).not.toBeInTheDocument();
    expect(screen.queryByTestId("coupon-apply")).not.toBeInTheDocument();
    expect(screen.queryByTestId("coupon-change")).not.toBeInTheDocument();
    expect(screen.queryByTestId("coupon-remove")).not.toBeInTheDocument();
    expect(screen.queryByTestId("coupon-input")).not.toBeInTheDocument();
  });
});
