"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { snapshotPayableRows } from "@/components/ordering/checkout-snapshot-presentation";
import { CommercialOfferStack } from "@/components/ordering/CommercialOfferStack";
import type { WireCommercialExplanation } from "@/components/ordering/commercial-explanation-presentation";
import { IMP036J_COPY } from "@/components/ordering/imp036j-copy";
import { commerceErrorCopy } from "@/components/ordering/error-copy";
import { formatPaise } from "@/components/ordering/format-money";
import { interpretClientAction, isZeroPayableTotal } from "@/components/ordering/client-action";
import { browserNavigate } from "@/components/ordering/browser-navigate";
import { cartChangedRecoveryPresentation } from "@/components/ordering/cart-changed-recovery-presentation";
import {
  paymentRecoveryPresentation,
  type PaymentRecoveryKind,
} from "@/components/ordering/payment-recovery-presentation";
import {
  loadRazorpayCheckoutScript,
  openRazorpayStandardCheckout,
  parseRazorpayStandardCheckoutAction,
  RAZORPAY_STANDARD_CHECKOUT_KIND,
  type RazorpayCheckoutHandlerResponse,
} from "@/lib/razorpay";
import { SITE_NAME } from "@/lib/site";
import {
  clearCart,
  clearPaymentRecovery,
  completeZeroPayableCheckout,
  getPaymentState,
  listCustomerOrders,
  readOrCreateRetryIdempotencyKey,
  readOrCreateStartIdempotencyKey,
  readOrCreateZeroPayableIdempotencyKey,
  rememberPaymentRecovery,
  retryPayment,
  startPayment,
  submitPaymentClientEvidence,
  type CommerceCheckout,
  type CommerceCheckoutSnapshot,
  type CommerceClientAction,
  type CommercePaymentMethodIntent,
  type CommercePaymentStartResult,
  type CommercePaymentState,
} from "@/lib/customer-commerce";

type PaymentScreen =
  | "idle"
  | "starting"
  | "loading_checkout"
  | "checkout_open"
  | "checking"
  | "retryable"
  | "dismissed"
  | "checkout_load_failed"
  | "error";

type CheckingKind = "processing" | "pending" | "indeterminate" | "confirming" | "generic";

/**
 * Payment-domain attempt fingerprint only — NOT a BOBA method preselect.
 * Razorpay Standard Checkout owns UPI/Card/Netbanking selection (D-361).
 * The Razorpay adapter ignores this field when creating Orders / client actions.
 * Persisted because start/retry APIs and attempt rows still require a non-empty intent.
 */
const PROVIDER_OWNED_ATTEMPT_METHOD_FINGERPRINT: CommercePaymentMethodIntent = "card";

const RAZORPAY_LOGO_SRC = "/assets/logos/boba-bear-full-logo.svg";

async function waitForCustomerOrder(): Promise<string | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const listed = await listCustomerOrders({ limit: 5 });
    if (listed.ok && listed.data.items[0]) return listed.data.items[0].orderId;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return null;
}

function latestAttempt(state: CommercePaymentState) {
  return state.attempt ?? state.attempts[state.attempts.length - 1] ?? null;
}

function unresolvedAttempt(state: CommercePaymentState): boolean {
  const attempt = latestAttempt(state);
  if (!attempt) return false;
  return attempt.status === "PENDING" || attempt.status === "INDETERMINATE" || attempt.status === "CREATED";
}

function checkingKindForState(state: CommercePaymentState): CheckingKind {
  const payment = state.payment;
  const attempt = latestAttempt(state);
  if (attempt?.status === "INDETERMINATE") return "indeterminate";
  if (attempt?.status === "PENDING") return "pending";
  if (payment?.status === "PROCESSING") return "processing";
  return "generic";
}

function integrationErrorCopy(reason: "malformed" | "secret" | "unsupported"): string {
  if (reason === "secret") return "Payment checkout is misconfigured. Please try again shortly.";
  return "Payment checkout could not start. Please try again.";
}

export function PaymentPanel(props: {
  checkout: CommerceCheckout;
  snapshot: CommerceCheckoutSnapshot;
  onOrderReady: (orderId: string) => void;
  /** Brand + live cart revision for FAILED → Start a new order (clearCart). */
  brandId?: string;
  activeCartRevision?: string;
  /** Parent adopts the authoritative revision when leaving payment. */
  onBackToReview?: (checkoutRevision: string) => void;
  onStaleReview?: () => void;
  explanation?: WireCommercialExplanation | null;
  /** Keep parent checkout revision current after payment mutations. */
  onCheckoutRevisionChange?: (checkoutRevision: string) => void;
  /**
   * Resume an existing Payment (session recovery) without offering a new Pay start.
   * Used when cart revision diverged under PAYMENT_PENDING — authority first.
   */
  resumePaymentId?: string | null;
  /**
   * Cart revision no longer matches checkout.sourceCartRevision while a payment
   * may still be financially open. Suppresses new Pay starts; uses cart-changed
   * unresolved copy; notifies parent when payment is safely terminal.
   */
  cartChangedWhilePending?: boolean;
  /**
   * Parent already renders previous-vs-current cart recovery chrome.
   * Suppress duplicate order framing / fee breakdown / back-to-cart link.
   */
  embeddedInPreviousPaymentRecovery?: boolean;
  /** Payment cancelled/expired/superseded — parent may offer fresh current-cart checkout. */
  onPaymentTerminalForCartChange?: () => void;
}) {
  const zeroPayable = isZeroPayableTotal(props.snapshot.grandTotalPaise);
  const payableLabel = formatPaise(props.snapshot.grandTotalPaise);
  const payableRows = snapshotPayableRows(props.snapshot);
  const resumePaymentId = props.resumePaymentId ?? null;
  const cartChangedWhilePending = props.cartChangedWhilePending === true;
  const embeddedRecovery = props.embeddedInPreviousPaymentRecovery === true;
  const canStartNewOrder =
    typeof props.brandId === "string" &&
    props.brandId.length > 0 &&
    typeof props.activeCartRevision === "string" &&
    props.activeCartRevision.length > 0;

  const [screen, setScreen] = useState<PaymentScreen>(resumePaymentId ? "checking" : "idle");
  const [checkingKind, setCheckingKind] = useState<CheckingKind>("generic");
  const [error, setError] = useState<string | null>(null);
  const [recoveryKind, setRecoveryKind] = useState<PaymentRecoveryKind | null>(
    resumePaymentId ? "unresolved" : null,
  );
  const [paymentId, setPaymentId] = useState<string | null>(resumePaymentId);
  const [checkoutRevision, setCheckoutRevision] = useState(props.checkout.revision);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [pendingCheckoutAction, setPendingCheckoutAction] = useState<CommerceClientAction | null>(null);
  const inflight = useRef(false);
  const handlerSubmitted = useRef(false);
  const finished = useRef(false);
  /** Set when Razorpay `payment.failed` is observed for the current checkout open. */
  const providerFailureObservedRef = useRef(false);
  const resumeStarted = useRef(false);
  const payButtonRef = useRef<HTMLButtonElement>(null);

  function restorePayFocus(): void {
    queueMicrotask(() => payButtonRef.current?.focus());
  }

  function adoptCheckoutRevision(revision: string): void {
    setCheckoutRevision(revision);
    props.onCheckoutRevisionChange?.(revision);
  }

  function showAuthoritativeFailed(): void {
    setRecoveryKind("failed");
    setScreen("retryable");
    restorePayFocus();
  }

  function showDismissedRecovery(): void {
    setError(null);
    setRecoveryKind("dismissed");
    setScreen("dismissed");
    restorePayFocus();
  }

  function showUnresolvedChecking(kind: CheckingKind): void {
    setRecoveryKind("unresolved");
    setCheckingKind(kind);
    setScreen("checking");
  }

  async function finishWithOrder(): Promise<void> {
    finished.current = true;
    const orderId = await waitForCustomerOrder();
    if (!orderId) {
      setError("Payment confirmed. We're finishing your order — don't pay again.");
      showUnresolvedChecking("generic");
      return;
    }
    setRecoveryKind(null);
    props.onOrderReady(orderId);
  }

  async function applyPaymentState(
    state: CommercePaymentState,
    unresolved: "checking" | "idle" | "dismissed" = "checking",
  ): Promise<void> {
    const payment = state.payment;
    const attempt = latestAttempt(state);
    if (payment) {
      setPaymentId(payment.id);
      adoptCheckoutRevision(state.checkoutRevision);
      if (attempt) setAttemptId(attempt.id);
      rememberPaymentRecovery({
        paymentId: payment.id,
        checkoutId: state.checkoutId,
        checkoutRevision: state.checkoutRevision,
      });
    }

    const interpreted = interpretClientAction(state.clientAction);
    if (interpreted?.kind === "redirect") {
      browserNavigate(interpreted.url);
      return;
    }

    if (payment?.status === "SUCCEEDED" || state.checkoutStatus === "COMPLETED") {
      await finishWithOrder();
      return;
    }
    if (
      payment?.status === "EXPIRED" ||
      payment?.status === "CANCELLED" ||
      payment?.status === "SUPERSEDED"
    ) {
      if (cartChangedWhilePending) {
        props.onPaymentTerminalForCartChange?.();
        return;
      }
      setRecoveryKind(null);
      setError(
        commerceErrorCopy(payment.status === "EXPIRED" ? "PAYMENT_EXPIRED" : "PAYMENT_TERMINAL"),
      );
      setScreen("error");
      return;
    }
    if (attempt?.status === "FAILED" && payment?.status === "OPEN" && !unresolvedAttempt(state)) {
      showAuthoritativeFailed();
      return;
    }
    if (attempt?.status === "INDETERMINATE" || payment?.status === "PROCESSING" || unresolvedAttempt(state)) {
      if (unresolved === "dismissed" && !providerFailureObservedRef.current && attempt?.status !== "INDETERMINATE") {
        // Customer closed Checkout without a confirmed failure — reopen existing clientAction.
        showDismissedRecovery();
        return;
      }
      showUnresolvedChecking(checkingKindForState(state));
      return;
    }
    if (unresolved === "dismissed") {
      showDismissedRecovery();
      return;
    }
    setRecoveryKind(null);
    setScreen(unresolved === "checking" ? "checking" : "idle");
    if (unresolved === "idle") restorePayFocus();
  }

  useEffect(() => {
    if (screen !== "checking" || !paymentId) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || finished.current) return;
      const state = await getPaymentState(paymentId);
      if (cancelled || finished.current) return;
      if (!state || !state.ok) {
        setError(commerceErrorCopy(state?.code));
        if (!state || state.code === "NETWORK_ERROR" || state.code === "INVALID_RESPONSE") return;
        if (cartChangedWhilePending) {
          // Keep unresolved checking — do not fall into a plain error dead-end.
          showUnresolvedChecking("generic");
          return;
        }
        setScreen("error");
        return;
      }
      await applyPaymentState(state.data.state, "checking");
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // applyPaymentState closes over current setters; poll key is paymentId/screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, paymentId]);

  useEffect(() => {
    if (!resumePaymentId || resumeStarted.current) return;
    resumeStarted.current = true;
    setPaymentId(resumePaymentId);
    showUnresolvedChecking(cartChangedWhilePending ? "confirming" : "generic");
    void (async () => {
      const state = await getPaymentState(resumePaymentId);
      if (!state.ok) {
        if (cartChangedWhilePending) {
          showUnresolvedChecking("generic");
          return;
        }
        setError(commerceErrorCopy(state.code));
        setScreen("error");
        return;
      }
      await applyPaymentState(state.data.state, "checking");
    })();
    // One-shot resume bootstrap keyed by resumePaymentId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumePaymentId]);

  async function launchRazorpayCheckout(action: CommerceClientAction): Promise<void> {
    const parsed = parseRazorpayStandardCheckoutAction(action);
    if (!parsed.ok) {
      setError(integrationErrorCopy(parsed.reason === "secret" ? "secret" : "malformed"));
      setRecoveryKind(null);
      setScreen("error");
      restorePayFocus();
      return;
    }

    setPendingCheckoutAction(action);
    handlerSubmitted.current = false;
    providerFailureObservedRef.current = false;
    setRecoveryKind(null);
    setScreen("loading_checkout");
    setError(null);
    try {
      await loadRazorpayCheckoutScript();
    } catch {
      setError("Payment checkout couldn't load. Check your connection. Don't start a new payment.");
      setScreen("checkout_load_failed");
      restorePayFocus();
      return;
    }

    setScreen("checkout_open");
    const prefillName = props.snapshot.destination?.recipientName?.trim();
    const prefillContact = props.snapshot.destination?.recipientPhone?.trim();
    openRazorpayStandardCheckout({
      action: parsed.value,
      display: {
        name: SITE_NAME,
        image: RAZORPAY_LOGO_SRC,
      },
      prefill: {
        ...(prefillName ? { name: prefillName } : {}),
        ...(prefillContact ? { contact: prefillContact } : {}),
      },
      onHandler: (evidence) => {
        void submitRazorpayHandlerEvidence(parsed.value.paymentId, evidence);
      },
      onDismiss: () => {
        void handleCheckoutDismiss(parsed.value.paymentId);
      },
      onProviderFailure: () => {
        void handleCheckoutProviderFailure(parsed.value.paymentId);
      },
    });
  }

  async function reopenPendingCheckout(): Promise<void> {
    if (!pendingCheckoutAction || inflight.current) return;
    await launchRazorpayCheckout(pendingCheckoutAction);
  }

  async function submitRazorpayHandlerEvidence(
    evidencePaymentId: string,
    evidence: RazorpayCheckoutHandlerResponse,
  ): Promise<void> {
    if (handlerSubmitted.current || inflight.current || finished.current) return;
    handlerSubmitted.current = true;
    inflight.current = true;
    setError(null);
    showUnresolvedChecking("confirming");
    const submitted = await submitPaymentClientEvidence({
      paymentId: evidencePaymentId,
      kind: RAZORPAY_STANDARD_CHECKOUT_KIND,
      payload: {
        razorpay_payment_id: evidence.razorpay_payment_id,
        razorpay_order_id: evidence.razorpay_order_id,
        razorpay_signature: evidence.razorpay_signature,
      },
    });
    inflight.current = false;
    if (!submitted.ok) {
      setError(commerceErrorCopy(submitted.code));
      if (
        submitted.code === "NETWORK_ERROR" ||
        submitted.code === "INVALID_RESPONSE" ||
        submitted.code === "PAYMENT_PROVIDER_EVIDENCE_INVALID" ||
        submitted.code === "PAYMENT_PROVIDER_INDETERMINATE"
      ) {
        showUnresolvedChecking(
          submitted.code === "PAYMENT_PROVIDER_INDETERMINATE" ? "indeterminate" : "confirming",
        );
        return;
      }
      setRecoveryKind(null);
      setScreen("error");
      return;
    }
    await applyPaymentState(submitted.data.state, "checking");
  }

  async function handleCheckoutDismiss(currentPaymentId: string): Promise<void> {
    if (handlerSubmitted.current || finished.current) return;
    // payment.failed commonly precedes modal.ondismiss — never downgrade failure/checking.
    if (providerFailureObservedRef.current) return;
    const state = await getPaymentState(currentPaymentId);
    if (!state.ok) {
      showDismissedRecovery();
      return;
    }
    await applyPaymentState(state.data.state, "dismissed");
  }

  async function handleCheckoutProviderFailure(currentPaymentId: string): Promise<void> {
    if (handlerSubmitted.current || finished.current) return;
    providerFailureObservedRef.current = true;
    showUnresolvedChecking("generic");
    const state = await getPaymentState(currentPaymentId);
    if (!state.ok) {
      // Keep checking — browser failure is not authoritative FAILED.
      return;
    }
    await applyPaymentState(state.data.state, "checking");
  }

  async function applyStartResult(result: CommercePaymentStartResult): Promise<void> {
    setPaymentId(result.payment.id);
    adoptCheckoutRevision(result.checkoutRevision);
    setAttemptId(result.attempt.id);
    rememberPaymentRecovery({
      paymentId: result.payment.id,
      checkoutId: result.checkoutId,
      checkoutRevision: result.checkoutRevision,
    });

    if (result.payment.status === "SUCCEEDED") {
      await finishWithOrder();
      return;
    }
    if (
      result.payment.status === "EXPIRED" ||
      result.payment.status === "CANCELLED" ||
      result.payment.status === "SUPERSEDED"
    ) {
      setRecoveryKind(null);
      setError(
        commerceErrorCopy(result.payment.status === "EXPIRED" ? "PAYMENT_EXPIRED" : "PAYMENT_TERMINAL"),
      );
      setScreen("error");
      return;
    }

    const interpreted = interpretClientAction(result.clientAction);
    if (interpreted?.kind === "redirect") {
      browserNavigate(interpreted.url);
      return;
    }
    if (interpreted?.kind === RAZORPAY_STANDARD_CHECKOUT_KIND && result.clientAction) {
      await launchRazorpayCheckout(result.clientAction);
      return;
    }

    if (result.attempt.status === "FAILED" && result.payment.status === "OPEN") {
      showAuthoritativeFailed();
      return;
    }

    showUnresolvedChecking(
      checkingKindForState({
        payment: result.payment,
        attempt: result.attempt,
        attempts: [result.attempt],
        checkoutId: result.checkoutId,
        checkoutStatus: "PAYMENT_PENDING",
        checkoutRevision: result.checkoutRevision,
        zeroPayableCompleted: false,
        clientAction: result.clientAction,
      }),
    );
  }

  async function handleStart(): Promise<void> {
    if (cartChangedWhilePending) {
      // Never start a second payment while cart-changed under unresolved authority.
      showUnresolvedChecking("generic");
      return;
    }
    if (
      inflight.current ||
      screen === "starting" ||
      screen === "checking" ||
      screen === "checkout_open" ||
      screen === "loading_checkout" ||
      screen === "dismissed"
    ) {
      return;
    }
    inflight.current = true;
    setError(null);
    setRecoveryKind(null);
    setScreen("starting");
    const idempotencyKey = readOrCreateStartIdempotencyKey({
      checkoutId: props.checkout.id,
      checkoutRevision,
      paymentMethodIntent: PROVIDER_OWNED_ATTEMPT_METHOD_FINGERPRINT,
    });
    const started = await startPayment({
      checkoutId: props.checkout.id,
      expectedCheckoutRevision: checkoutRevision,
      paymentMethodIntent: PROVIDER_OWNED_ATTEMPT_METHOD_FINGERPRINT,
      idempotencyKey,
    });
    inflight.current = false;
    if (!started.ok) {
      setError(commerceErrorCopy(started.code));
      if (
        started.code === "CHECKOUT_REPRICED" ||
        started.code === "CHECKOUT_CART_CHANGED"
      ) {
        props.onStaleReview?.();
        return;
      }
      if (started.code === "NETWORK_ERROR" || started.code === "INVALID_RESPONSE") {
        setScreen("idle");
        return;
      }
      if (started.code === "PAYMENT_ALREADY_PROCESSING" && paymentId) {
        showUnresolvedChecking("processing");
        return;
      }
      setScreen("error");
      return;
    }
    await applyStartResult(started.data);
  }

  async function handleRetry(): Promise<void> {
    if (inflight.current || !paymentId || !attemptId) return;
    inflight.current = true;
    setError(null);
    setRecoveryKind(null);
    setScreen("starting");
    const idempotencyKey = readOrCreateRetryIdempotencyKey({
      paymentId,
      attemptId,
      checkoutRevision,
      paymentMethodIntent: PROVIDER_OWNED_ATTEMPT_METHOD_FINGERPRINT,
    });
    const retried = await retryPayment({
      paymentId,
      expectedCheckoutRevision: checkoutRevision,
      paymentMethodIntent: PROVIDER_OWNED_ATTEMPT_METHOD_FINGERPRINT,
      idempotencyKey,
    });
    inflight.current = false;
    if (!retried.ok) {
      setError(commerceErrorCopy(retried.code));
      if (retried.code === "NETWORK_ERROR" || retried.code === "INVALID_RESPONSE") {
        showAuthoritativeFailed();
        return;
      }
      setScreen("error");
      return;
    }
    await applyStartResult(retried.data);
  }

  /**
   * Authoritative FAILED only. Uses existing clearCart so the live cart is empty;
   * stale READY checkout is released later by startCheckout cart-revision supersession
   * (no new lifecycle / no public cancelCheckout).
   */
  async function handleStartNewOrder(): Promise<void> {
    if (inflight.current || screen !== "retryable" || recoveryKind !== "failed") return;
    if (!canStartNewOrder || !props.brandId || !props.activeCartRevision) return;
    inflight.current = true;
    setError(null);
    const cleared = await clearCart({
      brandId: props.brandId,
      expectedRevision: props.activeCartRevision,
    });
    inflight.current = false;
    if (!cleared.ok) {
      setError(commerceErrorCopy(cleared.code));
      showAuthoritativeFailed();
      return;
    }
    clearPaymentRecovery();
    browserNavigate("/order/");
  }

  async function handleZeroPayable(): Promise<void> {
    if (inflight.current) return;
    inflight.current = true;
    setError(null);
    setScreen("starting");
    const idempotencyKey = readOrCreateZeroPayableIdempotencyKey({
      checkoutId: props.checkout.id,
      checkoutRevision,
    });
    const completed = await completeZeroPayableCheckout({
      checkoutId: props.checkout.id,
      expectedCheckoutRevision: checkoutRevision,
      idempotencyKey,
    });
    inflight.current = false;
    if (!completed.ok) {
      setError(commerceErrorCopy(completed.code));
      if (completed.code === "NETWORK_ERROR" || completed.code === "INVALID_RESPONSE") {
        setScreen("idle");
        return;
      }
      setScreen("error");
      return;
    }
    await finishWithOrder();
  }

  const payBlocked =
    screen === "starting" ||
    screen === "checking" ||
    screen === "loading_checkout" ||
    screen === "checkout_open";

  const recovery =
    recoveryKind != null ? paymentRecoveryPresentation(recoveryKind, payableLabel) : null;
  const cartChangedUnresolved =
    cartChangedWhilePending && recoveryKind === "unresolved" && !embeddedRecovery
      ? cartChangedRecoveryPresentation("unresolved")
      : null;

  const statusMessage =
    screen === "loading_checkout"
      ? "Opening secure payment…"
      : screen === "checkout_open"
        ? "Complete payment in the checkout window. Don't start another payment."
        : screen === "starting"
          ? zeroPayable
            ? "Completing order…"
            : "Starting payment…"
          : null;

  const hidePayStart =
    cartChangedWhilePending &&
    screen !== "retryable" &&
    screen !== "dismissed" &&
    screen !== "checkout_load_failed";

  return (
    <div className="flex flex-col gap-4" data-testid="checkout-payment">
      {!embeddedRecovery ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--interactive-secondary)]">
          {zeroPayable ? "No payment required" : "Pay for your order"}
        </p>
      ) : (
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--interactive-secondary)]">
          Previous payment status
        </p>
      )}
      {!embeddedRecovery ? (
        <div data-testid="checkout-fee-breakdown" className="flex flex-col gap-2">
          <dl className="grid grid-cols-2 gap-2 font-body text-[14px]">
            {payableRows
              .filter((row) => row.key !== "total" && row.key !== "discount")
              .map((row) => (
                <div key={row.key} className="contents">
                  <dt className="text-[var(--text-tertiary)]">{row.label}</dt>
                  <dd>{formatPaise(row.amountPaise)}</dd>
                </div>
              ))}
          </dl>
          <CommercialOfferStack
            explanation={props.explanation ?? null}
            payableLabel={IMP036J_COPY.TOTAL_PAYABLE}
            payablePaise={props.snapshot.grandTotalPaise}
            fulfilmentMode={props.snapshot.fulfilmentMode}
            complimentaryName={narrowComplimentaryName(props.snapshot.lines)}
          />
        </div>
      ) : null}

      {cartChangedUnresolved ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="payment-checking"
          data-checking-kind={checkingKind}
          data-cart-changed="true"
          className="flex flex-col gap-2"
        >
          <h2 className="font-body text-[18px] font-semibold text-[var(--text-primary)]">
            {cartChangedUnresolved.headline}
          </h2>
          <p className="font-body text-[14px] text-[var(--text-secondary)]">{cartChangedUnresolved.body}</p>
        </div>
      ) : recovery && !(cartChangedWhilePending && recovery.kind === "unresolved" && embeddedRecovery) ? (
        <div
          role={recovery.kind === "failed" ? "alert" : "status"}
          aria-live={recovery.kind === "failed" ? "assertive" : "polite"}
          data-testid={
            recovery.kind === "unresolved" ? "payment-checking" : `payment-recovery-${recovery.kind}`
          }
          data-checking-kind={recovery.kind === "unresolved" ? checkingKind : undefined}
          className="flex flex-col gap-2"
        >
          <h2 className="font-body text-[18px] font-semibold text-[var(--text-primary)]">
            {recovery.headline}
          </h2>
          <p className="font-body text-[14px] text-[var(--text-secondary)]">{recovery.body}</p>
        </div>
      ) : cartChangedWhilePending && recoveryKind === "unresolved" && embeddedRecovery ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="payment-checking"
          data-checking-kind={checkingKind}
          data-cart-changed="true"
          className="sr-only"
        >
          Checking previous payment status
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="font-body text-[14px] text-[var(--text-secondary)]">
          {error}
        </p>
      ) : null}

      {statusMessage ? (
        <p
          role="status"
          aria-live="polite"
          data-testid={
            screen === "loading_checkout"
              ? "payment-loading-checkout"
              : screen === "checkout_open"
                ? "payment-checkout-open"
                : "payment-starting"
          }
          className="font-body text-[15px] text-[var(--text-secondary)]"
        >
          {statusMessage}
        </p>
      ) : null}

      {!zeroPayable && (screen === "idle" || screen === "error") && !hidePayStart ? (
        <p className="font-body text-[14px] text-[var(--text-secondary)]" data-testid="payment-provider-owned-note">
          You’ll choose UPI, card, or net banking securely in Razorpay.
        </p>
      ) : null}

      {screen === "checkout_load_failed" && pendingCheckoutAction ? (
        <Button
          ref={payButtonRef}
          type="button"
          variant="primary"
          size="lg"
          data-testid="payment-reopen-checkout"
          className="min-h-[44px]"
          onClick={() => void reopenPendingCheckout()}
        >
          Retry opening checkout
        </Button>
      ) : null}

      {zeroPayable && !cartChangedWhilePending ? (
        <Button
          type="button"
          variant="primary"
          size="lg"
          className="min-h-[44px]"
          disabled={screen === "starting" || screen === "checking"}
          onClick={() => void handleZeroPayable()}
        >
          {screen === "starting" ? "Completing…" : "Complete order"}
        </Button>
      ) : screen === "retryable" ? (
        <div className="flex flex-col gap-3">
          <Button
            ref={payButtonRef}
            type="button"
            variant="primary"
            size="lg"
            data-testid="payment-retry"
            className="min-h-[44px]"
            aria-label={`Try payment again for ${payableLabel}`}
            onClick={() => void handleRetry()}
          >
            Try payment again · {payableLabel}
          </Button>
          {canStartNewOrder ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              data-testid="payment-start-new-order"
              className="min-h-[44px]"
              disabled={payBlocked}
              onClick={() => void handleStartNewOrder()}
            >
              {recovery?.secondaryActionLabel ?? "Start a new order"}
            </Button>
          ) : null}
        </div>
      ) : screen === "dismissed" && pendingCheckoutAction ? (
        <Button
          ref={payButtonRef}
          type="button"
          variant="primary"
          size="lg"
          data-testid="payment-continue"
          className="min-h-[44px]"
          aria-label={`Continue payment for ${payableLabel}`}
          onClick={() => void reopenPendingCheckout()}
        >
          Continue payment · {payableLabel}
        </Button>
      ) : !hidePayStart &&
        screen !== "checkout_load_failed" &&
        screen !== "checking" &&
        screen !== "dismissed" ? (
        <Button
          ref={payButtonRef}
          type="button"
          variant="primary"
          size="lg"
          data-testid="payment-start"
          className="min-h-[44px]"
          disabled={payBlocked}
          aria-label={`Pay ${payableLabel}`}
          onClick={() => void handleStart()}
        >
          {screen === "starting" || screen === "loading_checkout"
            ? "Starting…"
            : `Pay securely with Razorpay · ${payableLabel}`}
        </Button>
      ) : null}

      {props.onBackToReview && !cartChangedWhilePending ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-[44px]"
          data-testid="payment-back-to-review"
          disabled={payBlocked}
          onClick={() => props.onBackToReview?.(checkoutRevision)}
        >
          Back to review
        </Button>
      ) : null}

      {!embeddedRecovery ? (
        <Button asChild variant="outline" className="min-h-[44px]">
          <a href="/order/cart/" data-testid="cart-changed-back-to-cart">
            Back to cart
          </a>
        </Button>
      ) : null}
    </div>
  );
}

function narrowComplimentaryName(lines: readonly unknown[]): string | null {
  for (const raw of lines) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as Record<string, unknown>;
    if (row.lineOrigin === "complimentary_offer" && typeof row.productName === "string") {
      return row.productName;
    }
  }
  return null;
}
