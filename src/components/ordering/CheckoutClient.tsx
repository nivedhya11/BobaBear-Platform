"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { fetchCustomerSession } from "@/lib/customer-auth/client";
import { loginUrlWithReturn } from "@/lib/customer-auth/return-to";
import {
  applyCartCoupon,
  claimGuestCart,
  clearGuestCartCredential,
  createOwnAddress,
  evaluateCheckout,
  getActiveCart,
  getActiveCheckout,
  listCheckoutPickupOptions,
  listCheckoutScheduledWindows,
  listCustomerOrders,
  listOwnAddresses,
  readGuestCartCredential,
  readPaymentRecovery,
  reconcileGuestCart,
  removeCartCoupon,
  setCheckoutDestination,
  setCheckoutFulfilment,
  setCheckoutFulfilmentTiming,
  startCheckout,
  updateOwnAddress,
  type CartReconciliationResolution,
  type CommerceAddress,
  type CommerceCart,
  type CommerceCheckout,
  type CommerceCheckoutSnapshot,
  type CommercePickupOption,
  type CommerceScheduledWindows,
} from "@/lib/customer-commerce";
import { ReconcileConflictDialog } from "@/components/ordering/ReconcileConflictDialog";
import {
  CheckoutDestinationFlow,
  type CheckoutDestinationDraft,
} from "@/components/ordering/CheckoutDestinationFlow";
import {
  CheckoutFulfilmentChoice,
  type CheckoutFulfilmentChoiceMode,
} from "@/components/ordering/CheckoutFulfilmentChoice";
import { CheckoutTimingChoice } from "@/components/ordering/CheckoutTimingChoice";
import { formatOutletLocalWindowLabel } from "@/shared/scheduled-fulfilment/presentation";
import {
  CheckoutPickupOutletStep,
  type PickupSelectionPolicy,
} from "@/components/ordering/CheckoutPickupOutletStep";
import {
  CheckoutSnapshotLineList,
  CheckoutStepIndicator,
} from "@/components/ordering/CheckoutReviewSections";
import { CommercialOfferStack } from "@/components/ordering/CommercialOfferStack";
import { CouponField } from "@/components/ordering/CouponField";
import { IMP036J_COPY } from "@/components/ordering/imp036j-copy";
import { parseCommercialExplanation } from "@/components/ordering/commercial-explanation-presentation";
import { postCommittedPresentationObservation } from "@/components/ordering/committed-presentation-observation";
import { narrowCheckoutSnapshotLines } from "@/components/ordering/checkout-line-presentation";
import { PaymentPanel } from "@/components/ordering/PaymentPanel";
import { PreviousPaymentRecoveryView } from "@/components/ordering/PreviousPaymentRecoveryView";
import { cartChangedRecoveryPresentation } from "@/components/ordering/cart-changed-recovery-presentation";
import { commerceErrorCopy } from "@/components/ordering/error-copy";
import {
  fulfilmentModeLabel,
  pickupAddressLines,
} from "@/components/ordering/pickup-location-presentation";
import type { OrderingCatalog } from "@/shared/ordering-catalog";

type Screen =
  | "loading"
  | "empty"
  | "conflict"
  | "fulfilment"
  | "destination"
  | "pickup"
  | "timing"
  | "review"
  | "payment"
  | "cart_changed_unresolved"
  | "cart_changed_fresh"
  | "error";

async function waitForCustomerOrder(): Promise<string | null> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const listed = await listCustomerOrders({ limit: 5 });
    if (listed.ok && listed.data.items[0]) return listed.data.items[0].orderId;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return null;
}

function destinationSummary(snapshot: CommerceCheckoutSnapshot | null): string | null {
  const destination = snapshot?.destination;
  if (!destination) return null;
  return [destination.recipientName, destination.addressLine1, destination.city, destination.postalCode]
    .filter(Boolean)
    .join(" · ");
}

function snapshotHasDeliveryFee(snapshot: CommerceCheckoutSnapshot): boolean {
  return snapshot.charges.some((raw) => {
    if (typeof raw !== "object" || raw === null) return false;
    const code = (raw as { chargeCode?: unknown }).chargeCode;
    return code === "delivery";
  });
}

export function CheckoutClient(props: { catalog: OrderingCatalog }) {
  const brandId = props.catalog.brandId;
  const [screen, setScreen] = useState<Screen>("loading");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CommerceCart | null>(null);
  const [checkout, setCheckout] = useState<CommerceCheckout | null>(null);
  const [snapshot, setSnapshot] = useState<CommerceCheckoutSnapshot | null>(null);
  const [evaluationId, setEvaluationId] = useState<string | null>(null);
  const [reviewSurfaceToken, setReviewSurfaceToken] = useState<string | null>(null);
  const [reviewQuote, setReviewQuote] = useState<{ commercialExplanation?: unknown } | null>(
    null,
  );
  const [cartActivationId, setCartActivationId] = useState<string | null>(null);
  const [couponDraft, setCouponDraft] = useState("");
  const [couponPending, setCouponPending] = useState(false);
  const [couponRetry, setCouponRetry] = useState(false);
  const [staleReview, setStaleReview] = useState(false);
  const [giftGone, setGiftGone] = useState(false);
  const reviewSummaryRef = useRef<HTMLDivElement | null>(null);
  const [addresses, setAddresses] = useState<readonly CommerceAddress[]>([]);
  const [guestRevision, setGuestRevision] = useState<string | null>(null);
  const [customerRevision, setCustomerRevision] = useState<string | null>(null);
  const [resumePaymentId, setResumePaymentId] = useState<string | null>(null);
  const [cartChangedWhilePending, setCartChangedWhilePending] = useState(false);
  const [chosenMode, setChosenMode] = useState<CheckoutFulfilmentChoiceMode | null>(null);
  const [pickupLoading, setPickupLoading] = useState(false);
  const [pickupPolicy, setPickupPolicy] = useState<PickupSelectionPolicy | null>(null);
  const [pickupOutlets, setPickupOutlets] = useState<readonly CommercePickupOption[]>([]);
  const [selectedPickupOutletId, setSelectedPickupOutletId] = useState<string | null>(null);
  const [timingLoading, setTimingLoading] = useState(false);
  const [scheduledWindows, setScheduledWindows] = useState<CommerceScheduledWindows | null>(null);
  const [selectedWindowStart, setSelectedWindowStart] = useState<string | null>(null);
  const reviewExplanation = parseCommercialExplanation(reviewQuote);

  function adoptEvaluated(evaluated: {
    checkout: CommerceCheckout;
    snapshot: CommerceCheckoutSnapshot;
    evaluationId?: string;
    reviewSurfaceToken?: string;
    quote?: { commercialExplanation?: unknown };
  }): void {
    const hadGift = snapshot?.lines.some((line) => {
      return (
        typeof line === "object" &&
        line !== null &&
        "lineOrigin" in line &&
        (line as { lineOrigin?: string }).lineOrigin === "complimentary_offer"
      );
    });
    const hasGift = evaluated.snapshot.lines.some((line) => {
      return (
        typeof line === "object" &&
        line !== null &&
        "lineOrigin" in line &&
        (line as { lineOrigin?: string }).lineOrigin === "complimentary_offer"
      );
    });
    if (hadGift && !hasGift) setGiftGone(true);
    setCheckout(evaluated.checkout);
    setSnapshot(evaluated.snapshot);
    setEvaluationId(evaluated.evaluationId ?? null);
    setReviewSurfaceToken(evaluated.reviewSurfaceToken ?? null);
    setReviewQuote(evaluated.quote ?? null);
  }

  useEffect(() => {
    if (screen !== "review" || !evaluationId || couponPending) return;
    void postCommittedPresentationObservation(reviewSummaryRef.current, {
      evaluationId,
      reviewSurfaceToken,
      cartActivationId,
    });
  }, [screen, evaluationId, reviewSurfaceToken, cartActivationId, snapshot?.id, couponPending]);

  async function recoverStaleReview(): Promise<void> {
    setStaleReview(true);
    setScreen("review");
    const current = checkout
      ? await getActiveCheckout({ checkoutId: checkout.id, cartId: cart?.id })
      : cart
        ? await getActiveCheckout({ cartId: cart.id })
        : null;
    if (!current || !current.ok || !current.data.checkout) {
      queueMicrotask(() => {
        document.querySelector<HTMLElement>("[data-testid='copy-stale']")?.focus();
      });
      return;
    }
    const next = current.data.checkout;
    setCheckout(next);
    const evaluated = await evaluateCheckout({
      checkoutId: next.id,
      expectedCheckoutRevision: next.revision,
    });
    if (evaluated.ok) {
      adoptEvaluated(evaluated.data);
    }
    queueMicrotask(() => {
      document.querySelector<HTMLElement>("[data-testid='copy-stale']")?.focus();
    });
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await fetchCustomerSession();
      if (cancelled) return;
      if (!session.ok || !session.data.authenticated) {
        window.location.assign(loginUrlWithReturn("/order/checkout/"));
        return;
      }
      await bootstrap();
    })();
    return () => {
      cancelled = true;
    };
    // bootstrap is intentionally invoked once on mount after auth check
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootstrap(): Promise<void> {
    setError(null);
    const guest = readGuestCartCredential();
    const customerCartResult = await getActiveCart(brandId, { guestToken: false });
    if (!customerCartResult.ok && customerCartResult.code !== "CART_NOT_FOUND") {
      if (customerCartResult.code === "NETWORK_ERROR") {
        setScreen("error");
        setError(commerceErrorCopy(customerCartResult.code));
        return;
      }
      if (customerCartResult.code === "CUSTOMER_AUTH_REQUIRED") {
        window.location.assign(loginUrlWithReturn("/order/checkout/"));
        return;
      }
    }
    const customerCart = customerCartResult.ok ? customerCartResult.data.cart : null;

    if (guest && !customerCart) {
      const claimed = await claimGuestCart({
        brandId,
        expectedGuestRevision: guest.revision,
      });
      if (!claimed.ok) {
        if (claimed.code === "CART_RECONCILIATION_CONFLICT") {
          const again = await getActiveCart(brandId, { guestToken: false });
          const existing = again.ok ? again.data.cart : null;
          if (existing) {
            setGuestRevision(guest.revision);
            setCustomerRevision(existing.revision);
            setScreen("conflict");
            return;
          }
        }
        if (claimed.code === "CART_EXPIRED" || claimed.code === "CART_NOT_FOUND") {
          clearGuestCartCredential();
        } else {
          setScreen("error");
          setError(commerceErrorCopy(claimed.code));
          return;
        }
      } else {
        clearGuestCartCredential();
        setCart(claimed.data.cart);
        await continueWithCart(claimed.data.cart);
        return;
      }
    }

    if (guest && customerCart) {
      setGuestRevision(guest.revision);
      setCustomerRevision(customerCart.revision);
      const reconciled = await reconcileGuestCart({
        brandId,
        expectedGuestRevision: guest.revision,
        expectedCustomerRevision: customerCart.revision,
      });
      if (!reconciled.ok) {
        if (reconciled.code === "CART_RECONCILIATION_CONFLICT") {
          setScreen("conflict");
          return;
        }
        setScreen("error");
        setError(commerceErrorCopy(reconciled.code));
        return;
      }
      clearGuestCartCredential();
      setCart(reconciled.data.cart);
      await continueWithCart(reconciled.data.cart);
      return;
    }

    if (!customerCart || customerCart.lines.length === 0) {
      setCart(customerCart);
      setScreen("empty");
      return;
    }
    setCart(customerCart);
    await continueWithCart(customerCart);
  }

  async function continueWithCart(ownedCart: CommerceCart): Promise<void> {
    const active = await getActiveCheckout({ cartId: ownedCart.id });
    if (!active.ok) {
      setScreen("error");
      setError(commerceErrorCopy(active.code));
      return;
    }
    let current = active.data.checkout;
    if (
      current &&
      current.sourceCartRevision !== ownedCart.revision &&
      (current.status === "DRAFT" || current.status === "READY_FOR_PAYMENT")
    ) {
      // Server getActiveCheckout should already hide these; belt-and-braces.
      current = null;
    }
    if (
      current &&
      current.sourceCartRevision !== ownedCart.revision &&
      current.status === "PAYMENT_PENDING"
    ) {
      // Payment authority first — never present the old snapshot as current checkout.
      setCheckout(current);
      setSnapshot(current.activeSnapshot);
      setCartChangedWhilePending(true);
      setError(null);
      const recovery = readPaymentRecovery();
      setResumePaymentId(recovery?.checkoutId === current.id ? recovery.paymentId : null);
      setScreen("cart_changed_unresolved");
      return;
    }
    setCartChangedWhilePending(false);
    setResumePaymentId(null);
    if (!current) {
      const activationId = window.sessionStorage.getItem("boba.cartActivationId");
      if (activationId) {
        window.sessionStorage.removeItem("boba.cartActivationId");
        setCartActivationId(activationId);
      }
      const started = await startCheckout({
        cartId: ownedCart.id,
        ...(activationId ? { cartActivationId: activationId } : {}),
      });
      if (!started.ok) {
        setScreen("error");
        setError(commerceErrorCopy(started.code));
        return;
      }
      current = started.data.checkout;
    }
    setCheckout(current);

    const listed = await listOwnAddresses();
    if (listed.ok) setAddresses(listed.data.addresses);

    if (
      current.status === "READY_FOR_PAYMENT" &&
      current.activeSnapshot &&
      current.sourceCartRevision === ownedCart.revision
    ) {
      setSnapshot(current.activeSnapshot);
      setChosenMode(current.activeSnapshot.fulfilmentMode);
      setScreen("payment");
      return;
    }
    setSnapshot(current.activeSnapshot);
    setChosenMode(null);
    setScreen("fulfilment");
  }

  async function startFreshCheckoutFromCurrentCart(): Promise<void> {
    if (pending || !cart) return;
    setPending(true);
    setError(null);
    setCartChangedWhilePending(false);
    setResumePaymentId(null);
    const started = await startCheckout({ cartId: cart.id });
    setPending(false);
    if (!started.ok) {
      // Domain may still hold PAYMENT_PENDING — keep unresolved recovery, never plain dead-end.
      if (started.code === "CHECKOUT_STATE_CONFLICT" || started.code === "CHECKOUT_CONFLICT") {
        setScreen("cart_changed_unresolved");
        return;
      }
      setScreen("error");
      setError(commerceErrorCopy(started.code));
      return;
    }
    const fresh = started.data.checkout;
    if (
      fresh.status === "PAYMENT_PENDING" &&
      fresh.sourceCartRevision !== cart.revision
    ) {
      setCheckout(fresh);
      setSnapshot(fresh.activeSnapshot);
      setCartChangedWhilePending(true);
      const recovery = readPaymentRecovery();
      setResumePaymentId(recovery?.checkoutId === fresh.id ? recovery.paymentId : null);
      setScreen("cart_changed_unresolved");
      return;
    }
    await continueWithCart(cart);
  }

  async function chooseResolution(resolution: CartReconciliationResolution): Promise<void> {
    if (pending || !guestRevision || !customerRevision) return;
    setPending(true);
    setError(null);
    const reconciled = await reconcileGuestCart({
      brandId,
      expectedGuestRevision: guestRevision,
      expectedCustomerRevision: customerRevision,
      resolution,
    });
    setPending(false);
    if (!reconciled.ok) {
      setError(commerceErrorCopy(reconciled.code));
      return;
    }
    clearGuestCartCredential();
    setCart(reconciled.data.cart);
    await continueWithCart(reconciled.data.cart);
  }

  async function chooseFulfilmentMode(mode: CheckoutFulfilmentChoiceMode): Promise<void> {
    if (pending || !checkout) return;
    setPending(true);
    setError(null);
    setChosenMode(mode);
    const fulfilled = await setCheckoutFulfilment({
      checkoutId: checkout.id,
      expectedCheckoutRevision: checkout.revision,
      fulfilmentMode: mode,
      ...(mode === "DELIVERY" ? { pickupOutletId: null } : {}),
    });
    setPending(false);
    if (!fulfilled.ok) {
      setError(commerceErrorCopy(fulfilled.code));
      return;
    }
    setCheckout(fulfilled.data.checkout);
    setSnapshot(fulfilled.data.checkout.activeSnapshot);
    if (mode === "DELIVERY") {
      setPickupOutlets([]);
      setPickupPolicy(null);
      setSelectedPickupOutletId(null);
      setScreen("destination");
      return;
    }
    await loadPickupOptions(fulfilled.data.checkout);
  }

  async function loadPickupOptions(currentCheckout: CommerceCheckout): Promise<void> {
    setPickupLoading(true);
    setError(null);
    setScreen("pickup");
    const options = await listCheckoutPickupOptions({ checkoutId: currentCheckout.id });
    setPickupLoading(false);
    if (!options.ok) {
      setError(commerceErrorCopy(options.code));
      setPickupPolicy("UNAVAILABLE");
      setPickupOutlets([]);
      setSelectedPickupOutletId(null);
      return;
    }
    setPickupPolicy(options.data.selectionPolicy);
    setPickupOutlets(options.data.outlets);
    if (options.data.selectionPolicy === "AUTO_SELECT" && options.data.outlets.length === 1) {
      setSelectedPickupOutletId(options.data.outlets[0]!.outletId);
    } else if (
      currentCheckout.pickupOutletId &&
      options.data.outlets.some((o) => o.outletId === currentCheckout.pickupOutletId)
    ) {
      setSelectedPickupOutletId(currentCheckout.pickupOutletId);
    } else {
      setSelectedPickupOutletId(null);
    }
  }

  async function continuePickupWithOutlet(): Promise<void> {
    if (pending || !checkout || !selectedPickupOutletId) return;
    setPending(true);
    setError(null);
    const fulfilled = await setCheckoutFulfilment({
      checkoutId: checkout.id,
      expectedCheckoutRevision: checkout.revision,
      fulfilmentMode: "PICKUP",
      pickupOutletId: selectedPickupOutletId,
    });
    if (!fulfilled.ok) {
      setPending(false);
      setError(commerceErrorCopy(fulfilled.code));
      return;
    }
    const nextCheckout = fulfilled.data.checkout;
    setCheckout(nextCheckout);
    const evaluated = await evaluateCheckout({
      checkoutId: nextCheckout.id,
      expectedCheckoutRevision: nextCheckout.revision,
    });
    setPending(false);
    if (!evaluated.ok) {
      setError(commerceErrorCopy(evaluated.code));
      return;
    }
    adoptEvaluated(evaluated.data);
    setChosenMode("PICKUP");
    await openTiming(evaluated.data.checkout);
  }

  async function openTiming(current: CommerceCheckout): Promise<void> {
    setScreen("timing");
    setTimingLoading(true);
    setError(null);
    const listed = await listCheckoutScheduledWindows({ checkoutId: current.id });
    setTimingLoading(false);
    if (!listed.ok) {
      setScheduledWindows(null);
      setError(commerceErrorCopy(listed.code));
      return;
    }
    setScheduledWindows(listed.data);
    setSelectedWindowStart(current.scheduledWindowStartAt ?? null);
  }

  async function confirmTiming(
    choice:
      | Readonly<{ timing: "ASAP" }>
      | Readonly<{ timing: "SCHEDULED"; startAt: string; endAt: string }>,
  ): Promise<void> {
    if (pending || !checkout) return;
    setPending(true);
    setError(null);
    let current = checkout;
    const saved = await setCheckoutFulfilmentTiming({
      checkoutId: current.id,
      expectedCheckoutRevision: current.revision,
      fulfilmentTiming: choice.timing,
      ...(choice.timing === "SCHEDULED"
        ? { scheduledWindowStartAt: choice.startAt, scheduledWindowEndAt: choice.endAt }
        : {}),
    });
    if (!saved.ok) {
      setPending(false);
      setError(commerceErrorCopy(saved.code));
      if (saved.code === "CHECKOUT_STATE_CONFLICT" || saved.code === "CHECKOUT_REPRICED") {
        await openTiming(current);
      }
      return;
    }
    current = saved.data.checkout;
    setCheckout(current);
    const evaluated = await evaluateCheckout({
      checkoutId: current.id,
      expectedCheckoutRevision: current.revision,
    });
    setPending(false);
    if (!evaluated.ok) {
      setError(commerceErrorCopy(evaluated.code));
      if (evaluated.code === "CHECKOUT_STATE_CONFLICT" || evaluated.code === "CHECKOUT_REPRICED") {
        await openTiming(evaluated.ok ? current : current);
      }
      return;
    }
    adoptEvaluated(evaluated.data);
    setScreen("review");
  }

  async function applyDestinationDraft(draft: CheckoutDestinationDraft): Promise<void> {
    if (pending || !checkout) return;
    setPending(true);
    setError(null);

    let destinationCheckout = checkout;

    if (draft.kind === "UPDATE_SAVED_COORDINATES") {
      const updated = await updateOwnAddress(draft.savedAddressId, { coordinates: draft.coordinates });
      if (!updated.ok) {
        setPending(false);
        setError(commerceErrorCopy(updated.code));
        return;
      }
      const dest = await setCheckoutDestination({
        checkoutId: checkout.id,
        expectedCheckoutRevision: checkout.revision,
        destination: { kind: "SAVED_ADDRESS", savedAddressId: draft.savedAddressId },
      });
      if (!dest.ok) {
        setPending(false);
        setError(commerceErrorCopy(dest.code));
        return;
      }
      destinationCheckout = dest.data.checkout;
    } else if (draft.kind === "SAVED_ADDRESS") {
      const dest = await setCheckoutDestination({
        checkoutId: checkout.id,
        expectedCheckoutRevision: checkout.revision,
        destination: { kind: "SAVED_ADDRESS", savedAddressId: draft.savedAddressId },
      });
      if (!dest.ok) {
        setPending(false);
        setError(commerceErrorCopy(dest.code));
        return;
      }
      destinationCheckout = dest.data.checkout;
    } else if (draft.kind === "NEW_SAVED_ADDRESS") {
      const created = await createOwnAddress({
        ...draft.createInput,
        makeDefault: addresses.length === 0,
      });
      if (!created.ok) {
        setPending(false);
        setError(commerceErrorCopy(created.code));
        return;
      }
      setAddresses((current) => [...current, created.data.address]);
      const dest = await setCheckoutDestination({
        checkoutId: checkout.id,
        expectedCheckoutRevision: checkout.revision,
        destination: { kind: "SAVED_ADDRESS", savedAddressId: created.data.address.id },
      });
      if (!dest.ok) {
        setPending(false);
        setError(commerceErrorCopy(dest.code));
        return;
      }
      destinationCheckout = dest.data.checkout;
    } else {
      const dest = await setCheckoutDestination({
        checkoutId: checkout.id,
        expectedCheckoutRevision: checkout.revision,
        destination: {
          kind: "ONE_TIME_ADDRESS",
          recipientName: draft.recipientName,
          recipientPhone: draft.recipientPhone,
          addressLine1: draft.addressLine1,
          addressLine2: draft.addressLine2,
          landmark: draft.landmark,
          locality: draft.locality,
          city: draft.city,
          stateCode: draft.stateCode,
          postalCode: draft.postalCode,
          coordinates: draft.coordinates,
          label: draft.label,
        },
      });
      if (!dest.ok) {
        setPending(false);
        setError(commerceErrorCopy(dest.code));
        return;
      }
      destinationCheckout = dest.data.checkout;
    }

    setCheckout(destinationCheckout);
    const evaluated = await evaluateCheckout({
      checkoutId: destinationCheckout.id,
      expectedCheckoutRevision: destinationCheckout.revision,
    });
    setPending(false);
    if (!evaluated.ok) {
      setError(commerceErrorCopy(evaluated.code));
      return;
    }
    adoptEvaluated(evaluated.data);
    setChosenMode("DELIVERY");
    await openTiming(evaluated.data.checkout);
  }

  function adoptCheckoutRevision(revision: string): void {
    setCheckout((current) => (current ? { ...current, revision } : current));
  }

  /**
   * Back-nav into fulfilment must use authoritative server checkout revision.
   * Payment start/failure advances revision inside PaymentPanel; parent state
   * must not keep a pre-payment expectedCheckoutRevision.
   */
  async function returnToFulfilment(): Promise<void> {
    if (pending || !checkout || !cart) return;
    setPending(true);
    setError(null);
    const active = await getActiveCheckout({ cartId: cart.id });
    if (!active.ok) {
      setPending(false);
      setError(commerceErrorCopy(active.code));
      return;
    }
    const current = active.data.checkout;
    if (!current || current.id !== checkout.id) {
      setPending(false);
      setError(commerceErrorCopy("CHECKOUT_NOT_FOUND"));
      return;
    }
    setCheckout(current);
    if (current.activeSnapshot) {
      setSnapshot(current.activeSnapshot);
    }
    setPending(false);
    if (current.status === "PAYMENT_PENDING") {
      // Existing domain forbids fulfilment mutation while PAYMENT_PENDING.
      setError(commerceErrorCopy("CHECKOUT_STATE_CONFLICT"));
      return;
    }
    setChosenMode(null);
    setPickupOutlets([]);
    setPickupPolicy(null);
    setSelectedPickupOutletId(null);
    setScreen("fulfilment");
  }

  useEffect(() => {
    if (screen !== "cart_changed_unresolved" || !cart) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const recovery = readPaymentRecovery();
      const active = await getActiveCheckout({ cartId: cart.id });
      if (cancelled) return;
      if (!active.ok) return;
      const current = active.data.checkout;
      if (current?.status === "COMPLETED") {
        const orderId = await waitForCustomerOrder();
        if (cancelled) return;
        if (orderId) {
          window.location.assign(`/order/confirmation/?orderId=${encodeURIComponent(orderId)}`);
        }
        return;
      }
      if (!current) {
        setCartChangedWhilePending(false);
        setScreen("cart_changed_fresh");
        return;
      }
      if (
        current.status === "PAYMENT_PENDING" &&
        current.sourceCartRevision !== cart.revision
      ) {
        setCheckout(current);
        setSnapshot(current.activeSnapshot);
        setCartChangedWhilePending(true);
        setResumePaymentId(recovery?.checkoutId === current.id ? recovery.paymentId : null);
        setScreen("cart_changed_unresolved");
        return;
      }
      if (current.sourceCartRevision !== cart.revision) {
        // READY/DRAFT after payment resolved to non-pending — safe to offer fresh checkout.
        setCartChangedWhilePending(false);
        setScreen("cart_changed_fresh");
        return;
      }
      setCartChangedWhilePending(false);
      setResumePaymentId(null);
      await continueWithCart(cart);
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [screen, cart]);

  const recoveryScreens = screen === "cart_changed_unresolved" || screen === "cart_changed_fresh";
  // Prefer explicit customer choice / sealed snapshot. Do not use Checkout's
  // historical DELIVERY default to label the first step before selection.
  const reviewMode = chosenMode ?? snapshot?.fulfilmentMode ?? null;
  const activeStep =
    screen === "fulfilment" || screen === "destination" || screen === "pickup" || screen === "timing"
      ? "fulfilment"
      : screen === "review"
        ? "review"
        : "payment";

  const freshPresentation = cartChangedRecoveryPresentation("fresh_checkout");
  const pickupLocation = snapshot?.pickupLocation ?? null;

  return (
    <main id="main-content" tabIndex={-1} className="bg-[var(--bg-page)] focus:outline-none">
      {screen === "conflict" ? (
        <ReconcileConflictDialog pending={pending} onChoose={(choice) => void chooseResolution(choice)} />
      ) : null}

      <div className="mx-auto max-w-[640px] px-5 py-12 md:py-16 flex flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            Boba Bear · Checkout
          </p>
          <h1 className="font-display text-[clamp(36px,8vw,56px)] leading-[0.95] text-[var(--text-primary)]">
            Checkout
          </h1>
          {!recoveryScreens ? (
            <CheckoutStepIndicator activeStep={activeStep} fulfilmentMode={reviewMode} />
          ) : null}
        </header>

        {screen === "loading" ? (
          <p className="font-body text-[15px] text-[var(--text-secondary)]">Preparing checkout…</p>
        ) : null}

        {error &&
        screen !== "cart_changed_unresolved" &&
        screen !== "cart_changed_fresh" &&
        screen !== "fulfilment" &&
        screen !== "pickup" ? (
          <p role="alert" className="font-body text-[14px] text-[var(--text-secondary)]">
            {error}
          </p>
        ) : null}

        {screen === "empty" ? (
          <div className="flex flex-col gap-4">
            <p className="font-body text-[15px] text-[var(--text-secondary)]">
              Your cart is empty. Add something before checkout.
            </p>
            <Button asChild variant="primary">
              <a href="/order/">Back to menu</a>
            </Button>
          </div>
        ) : null}

        {screen === "cart_changed_unresolved" && cart ? (
          <PreviousPaymentRecoveryView
            cart={cart}
            catalog={props.catalog}
            previousSnapshot={snapshot}
            paymentSlot={
              checkout && snapshot ? (
                <PaymentPanel
                  checkout={checkout}
                  snapshot={snapshot}
                  brandId={brandId}
                  activeCartRevision={cart.revision}
                  resumePaymentId={resumePaymentId}
                  cartChangedWhilePending
                  embeddedInPreviousPaymentRecovery
                  onCheckoutRevisionChange={adoptCheckoutRevision}
                  onPaymentTerminalForCartChange={() => {
                    setCartChangedWhilePending(false);
                    setResumePaymentId(null);
                    setScreen("cart_changed_fresh");
                  }}
                  onOrderReady={(orderId) => {
                    window.location.assign(
                      `/order/confirmation/?orderId=${encodeURIComponent(orderId)}`,
                    );
                  }}
                />
              ) : null
            }
          />
        ) : null}

        {screen === "cart_changed_fresh" ? (
          <div className="flex flex-col gap-4" data-testid="cart-changed-fresh">
            <h2 className="font-body text-[18px] font-semibold text-[var(--text-primary)]">
              {freshPresentation.headline}
            </h2>
            <p className="font-body text-[14px] text-[var(--text-secondary)]">{freshPresentation.body}</p>
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="min-h-[44px]"
              data-testid={freshPresentation.primaryTestId ?? "cart-changed-start-fresh"}
              disabled={pending}
              onClick={() => void startFreshCheckoutFromCurrentCart()}
            >
              {freshPresentation.primaryActionLabel}
            </Button>
            <Button asChild variant="outline" className="min-h-[44px]">
              <a
                href={freshPresentation.secondaryHref ?? "/order/cart/"}
                data-testid={freshPresentation.secondaryTestId ?? "cart-changed-review-cart"}
              >
                {freshPresentation.secondaryActionLabel}
              </a>
            </Button>
          </div>
        ) : null}

        {screen === "fulfilment" && checkout ? (
          <CheckoutFulfilmentChoice
            pending={pending}
            selectedMode={chosenMode}
            errorId="checkout-fulfilment-error"
            errorMessage={error}
            onSelect={(mode) => void chooseFulfilmentMode(mode)}
          />
        ) : null}

        {screen === "destination" && checkout ? (
          <div className="flex flex-col gap-4" data-testid="checkout-delivery-path">
            <CheckoutDestinationFlow
              brandId={brandId}
              addresses={addresses}
              pending={pending}
              onComplete={(draft) => void applyDestinationDraft(draft)}
            />
            <Button
              type="button"
              variant="outline"
              className="min-h-[44px]"
              disabled={pending}
              data-testid="checkout-back-to-fulfilment"
              onClick={() => void returnToFulfilment()}
            >
              Change fulfilment
            </Button>
          </div>
        ) : null}

        {screen === "pickup" && checkout ? (
          <CheckoutPickupOutletStep
            pending={pending}
            loading={pickupLoading}
            selectionPolicy={pickupPolicy}
            outlets={pickupOutlets}
            selectedOutletId={selectedPickupOutletId}
            errorId="checkout-pickup-error"
            errorMessage={error}
            onSelectOutlet={setSelectedPickupOutletId}
            onContinue={() => void continuePickupWithOutlet()}
            onChooseDelivery={() => void chooseFulfilmentMode("DELIVERY")}
            onBackToMode={() => {
              setError(null);
              setChosenMode(null);
              setScreen("fulfilment");
            }}
          />
        ) : null}

        {screen === "timing" && checkout ? (
          <div className="flex flex-col gap-4">
            <CheckoutTimingChoice
              pending={pending}
              loading={timingLoading}
              mode={chosenMode === "PICKUP" ? "PICKUP" : "DELIVERY"}
              selectedTiming={
                selectedWindowStart
                  ? "SCHEDULED"
                  : checkout.fulfilmentTiming === "SCHEDULED"
                    ? "SCHEDULED"
                    : "ASAP"
              }
              selectedWindowStart={selectedWindowStart}
              windows={scheduledWindows?.windows ?? []}
              availability={scheduledWindows?.availability ?? null}
              message={scheduledWindows?.message ?? null}
              timeZone={scheduledWindows?.timeZone ?? null}
              cancellationCutoffMinutes={
                selectedWindowStart ? (scheduledWindows?.cancellationCutoffMinutes ?? null) : null
              }
              errorId="checkout-timing-error"
              errorMessage={error}
              onSelectAsap={() => {
                setSelectedWindowStart(null);
                void confirmTiming({ timing: "ASAP" });
              }}
              onSelectWindow={(window) => {
                setSelectedWindowStart(window.startAt);
                void confirmTiming({
                  timing: "SCHEDULED",
                  startAt: window.startAt,
                  endAt: window.endAt,
                });
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={pending}
              data-testid="checkout-timing-back"
              onClick={() => {
                setError(null);
                setScreen(chosenMode === "PICKUP" ? "pickup" : "destination");
              }}
            >
              Back
            </Button>
          </div>
        ) : null}

        {screen === "review" && snapshot && checkout ? (
          <div className="flex flex-col gap-4" data-testid="checkout-review">
            <section className="rounded-xl border border-[var(--border-strong)] bg-[var(--bg-section)] p-4">
              <h2 className="mb-2 font-body text-[15px] font-semibold text-[var(--text-primary)]">
                {snapshot.fulfilmentMode === "PICKUP" ? "Pickup" : "Delivery destination"}
              </h2>
              <p data-testid="checkout-review-timing" className="mb-2 font-body text-[14px] text-[var(--text-secondary)]">
                {snapshot.fulfilmentTiming === "SCHEDULED" &&
                snapshot.scheduledWindowStartAt &&
                snapshot.scheduledWindowEndAt &&
                snapshot.scheduledTimezone
                  ? snapshot.fulfilmentMode === "DELIVERY"
                    ? `Arrival / fulfilment window ${formatOutletLocalWindowLabel(
                        new Date(snapshot.scheduledWindowStartAt),
                        new Date(snapshot.scheduledWindowEndAt),
                        snapshot.scheduledTimezone,
                      )} (${snapshot.scheduledTimezone})`
                    : `Pickup window ${formatOutletLocalWindowLabel(
                        new Date(snapshot.scheduledWindowStartAt),
                        new Date(snapshot.scheduledWindowEndAt),
                        snapshot.scheduledTimezone,
                      )} (${snapshot.scheduledTimezone})`
                  : "As soon as possible"}
              </p>
              {snapshot.fulfilmentMode === "PICKUP" && pickupLocation ? (
                <div data-testid="checkout-review-pickup" className="flex flex-col gap-1">
                  <p className="font-body text-[14px] font-semibold text-[var(--text-primary)]">
                    {fulfilmentModeLabel("PICKUP")} · {pickupLocation.displayName}
                  </p>
                  {pickupAddressLines(pickupLocation).map((line) => (
                    <p key={line} className="font-body text-[14px] text-[var(--text-secondary)]">
                      {line}
                    </p>
                  ))}
                  {pickupLocation.instructions ? (
                    <p className="mt-1 font-body text-[14px] text-[var(--text-primary)]">
                      <span className="font-semibold">Instructions: </span>
                      {pickupLocation.instructions}
                    </p>
                  ) : null}
                  {!snapshotHasDeliveryFee(snapshot) ? (
                    <p
                      data-testid="checkout-review-no-delivery-fee"
                      className="mt-2 font-body text-[13px] text-[var(--text-secondary)]"
                    >
                      No delivery fee
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="font-body text-[14px] text-[var(--text-secondary)]">
                  {destinationSummary(snapshot) ?? "Delivery destination confirmed"}
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                className="mt-3 min-h-[44px]"
                data-testid="checkout-back-to-delivery"
                disabled={pending}
                onClick={() => void returnToFulfilment()}
              >
                {snapshot.fulfilmentMode === "PICKUP" ? "Change fulfilment" : "Edit delivery"}
              </Button>
            </section>
            <CheckoutSnapshotLineList
              title="Your items"
              lines={narrowCheckoutSnapshotLines(snapshot.lines)}
            />
            <div ref={reviewSummaryRef}>
              <CommercialOfferStack
                explanation={reviewExplanation}
                payableLabel={IMP036J_COPY.TOTAL_PAYABLE}
                payablePaise={snapshot.grandTotalPaise}
                fulfilmentMode={snapshot.fulfilmentMode}
                stale={staleReview}
                giftGone={giftGone}
                complimentaryName={
                  narrowCheckoutSnapshotLines(snapshot.lines).find(
                    (line) => line.lineOrigin === "complimentary_offer",
                  )?.productName ?? null
                }
                waitingText={couponPending ? IMP036J_COPY.CHECKING : null}
              />
            </div>
            <CouponField
              code={couponDraft || cart?.manualCouponCode || ""}
              appliedCode={cart?.manualCouponCode ?? null}
              pending={couponPending}
              disabled={pending}
              onCodeChange={setCouponDraft}
              onApply={() => {
                if (!cart) return;
                void (async () => {
                  setCouponPending(true);
                  setCouponRetry(false);
                  const result = await applyCartCoupon({
                    brandId,
                    couponCode: couponDraft,
                    expectedRevision: cart.revision,
                    sourceCommandId: crypto.randomUUID(),
                    reviewSurfaceToken,
                  });
                  setCouponPending(false);
                  if (!result.ok) {
                    setCouponRetry(true);
                    return;
                  }
                  setCart(result.data.cart);
                  if (!checkout) return;
                  const evaluated = await evaluateCheckout({
                    checkoutId: checkout.id,
                    expectedCheckoutRevision: checkout.revision,
                  });
                  if (evaluated.ok) {
                    adoptEvaluated(evaluated.data);
                  }
                })();
              }}
              onRemove={() => {
                if (!cart) return;
                void (async () => {
                  setCouponPending(true);
                  const result = await removeCartCoupon({
                    brandId,
                    expectedRevision: cart.revision,
                    sourceCommandId: crypto.randomUUID(),
                    reviewSurfaceToken,
                  });
                  setCouponPending(false);
                  if (!result.ok) {
                    setCouponRetry(true);
                    return;
                  }
                  setCart(result.data.cart);
                  if (!checkout) return;
                  const evaluated = await evaluateCheckout({
                    checkoutId: checkout.id,
                    expectedCheckoutRevision: checkout.revision,
                  });
                  if (evaluated.ok) {
                    adoptEvaluated(evaluated.data);
                  }
                })();
              }}
              statusText={couponRetry ? IMP036J_COPY.RETRY : null}
              statusTone={couponRetry ? "alert" : null}
              retryVisible={couponRetry}
              returnPath="/order/checkout/"
              showSignIn={false}
            />
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={() => setScreen("payment")}
            >
              Continue to payment
            </Button>
          </div>
        ) : null}

        {screen === "payment" && snapshot && checkout && !cartChangedWhilePending ? (
          <div className="flex flex-col gap-4" data-testid="checkout-ready">
            <CheckoutSnapshotLineList
              title="Your items"
              lines={narrowCheckoutSnapshotLines(snapshot.lines)}
            />
            <PaymentPanel
              checkout={checkout}
              snapshot={snapshot}
              explanation={reviewExplanation}
              brandId={brandId}
              activeCartRevision={cart?.revision}
              resumePaymentId={resumePaymentId}
              onCheckoutRevisionChange={adoptCheckoutRevision}
              onBackToReview={(revision) => {
                adoptCheckoutRevision(revision);
                setScreen("review");
              }}
              onStaleReview={() => {
                void recoverStaleReview();
              }}
              onOrderReady={(orderId) => {
                window.location.assign(`/order/confirmation/?orderId=${encodeURIComponent(orderId)}`);
              }}
            />
          </div>
        ) : null}
      </div>
    </main>
  );
}
