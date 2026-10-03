"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { CartLineList } from "@/components/ordering/CartLineList";
import { CouponField } from "@/components/ordering/CouponField";
import { CommercialOfferStack } from "@/components/ordering/CommercialOfferStack";
import { postCommittedPresentationObservation } from "@/components/ordering/committed-presentation-observation";
import {
  canReuseCheckoutEvaluation,
  merchandiseSubtotalFromQuote,
  parseCommercialExplanation,
} from "@/components/ordering/commercial-explanation-presentation";
import { formatPaise } from "@/components/ordering/format-money";
import { IMP036J_COPY } from "@/components/ordering/imp036j-copy";
import {
  buildCartLinePresentations,
  buildCustomerMenuLookups,
  cartBundleSelectionsToInput,
  cartModifiersToInput,
  cartUnitCount,
  resolveCartPresentationEstimate,
} from "@/components/ordering/cart-presentation";
import { publishCartCount } from "@/components/ordering/cart-count-sync";
import {
  readDeliveryContext,
  subscribeToDeliveryContext,
  useDeliveryContext,
  type DeliveryContext,
} from "@/lib/customer-location/delivery-context";
import { commerceErrorCopy } from "@/components/ordering/error-copy";
import { MenuItemCustomizationDialog } from "@/components/ordering/MenuItemCustomizationDialog";
import {
  cartEvaluationCustomerCopy,
  isCartCheckoutBlocked,
} from "@/components/ordering/serviceability-copy";
import {
  applyCartCoupon,
  clearCart,
  evaluateCart,
  getActiveCart,
  getActiveCheckout,
  getCustomerMenu,
  recordCartCheckoutActivation,
  removeCartCoupon,
  removeCartLine,
  setCartLineQuantity,
  updateCartLineConfiguration,
  type CommerceCart,
  type CommerceCartEvaluation,
  type CommerceCartLine,
  type CommerceCheckout,
} from "@/lib/customer-commerce";
import {
  menuOutletIdFromOrderingContext,
  resolveCustomerOrderingOutletContext,
} from "@/lib/customer-commerce/ordering-outlet-context";
import { loginUrlWithReturn } from "@/lib/customer-auth/return-to";
import { fetchCustomerSession } from "@/lib/customer-auth/client";
import type { CartModifierSelectionInput } from "@/shared/cart/types";
import type { CustomerMenuItem, CustomerMenuProjection } from "@/shared/customer-menu/types";

type EditTarget = Readonly<{
  line: CommerceCartLine;
  item: CustomerMenuItem;
}>;

export function CartClient(props: { brandId: string }) {
  const { brandId } = props;
  const [menu, setMenu] = useState<CustomerMenuProjection | null>(null);
  const [cart, setCart] = useState<CommerceCart | null>(null);
  const [evaluation, setEvaluation] = useState<CommerceCartEvaluation | null>(null);
  const deliveryContext = useDeliveryContext();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [couponDraft, setCouponDraft] = useState("");
  const [couponPending, setCouponPending] = useState(false);
  const [couponRetry, setCouponRetry] = useState(false);
  const [activeCheckout, setActiveCheckout] = useState<CommerceCheckout | null>(null);
  const priceSummaryRef = useRef<HTMLDivElement | null>(null);
  /** One delivery-context surface generation for outlet/menu → cart eval. */
  const surfaceGenerationRef = useRef(0);
  /** Latest cart-evaluation epoch within (and across) a delivery generation. */
  const evaluationEpochRef = useRef(0);
  const cartRef = useRef<CommerceCart | null>(null);

  const menuLookups = useMemo(
    () => (menu ? buildCustomerMenuLookups(menu) : null),
    [menu],
  );

  const linePresentations = useMemo(
    () =>
      buildCartLinePresentations(
        cart,
        menuLookups ?? buildCustomerMenuLookups(emptyMenu(brandId)),
      ),
    [cart, menuLookups, brandId],
  );

  const publishEvaluationIfCurrent = useCallback(
    async (generation: number, context: DeliveryContext, currentCart: CommerceCart | null) => {
      const evaluationEpoch = ++evaluationEpochRef.current;
      const publishIfCurrent = (next: CommerceCartEvaluation | null) => {
        if (generation !== surfaceGenerationRef.current) return;
        if (evaluationEpoch !== evaluationEpochRef.current) return;
        setEvaluation(next);
      };
      if (!currentCart || currentCart.lines.length === 0) {
        publishIfCurrent(null);
        return;
      }
      const evaluated = await evaluateCart(
        context.coordinates
          ? {
              brandId,
              location: {
                coordinates: context.coordinates,
                ...(context.postalCode.length === 6 ? { postalCode: context.postalCode } : {}),
              },
            }
          : { brandId },
      );
      if (evaluated.ok) publishIfCurrent(evaluated.data);
      else publishIfCurrent(null);
    },
    [brandId],
  );

  const refreshOrderingSurface = useCallback(
    async (
      context: DeliveryContext,
      options?: Readonly<{ evaluate?: boolean }>,
    ) => {
      const generation = ++surfaceGenerationRef.current;
      const orderingContext = await resolveCustomerOrderingOutletContext({
        brandId,
        coordinates: context.coordinates,
        postalCode: context.postalCode.length === 6 ? context.postalCode : null,
      });
      if (generation !== surfaceGenerationRef.current) return;
      const outletId = menuOutletIdFromOrderingContext(orderingContext);
      const menuResult = await getCustomerMenu({
        brandId,
        ...(outletId ? { outletId } : {}),
      });
      if (generation !== surfaceGenerationRef.current) return;
      if (!menuResult.ok) {
        setMenu(null);
        setError(commerceErrorCopy(menuResult.code));
      } else {
        setMenu(menuResult.data.menu);
      }
      if (options?.evaluate === false) return;
      void publishEvaluationIfCurrent(generation, context, cartRef.current);
    },
    [brandId, publishEvaluationIfCurrent],
  );

  /** Active cart acquisition is independent of delivery-surface generation. */
  const refreshCart = useCallback(async (): Promise<CommerceCart | null> => {
    const cartResult = await getActiveCart(brandId, { guestToken: true });
    if (!cartResult.ok) {
      setError(commerceErrorCopy(cartResult.code));
      setCart(null);
      cartRef.current = null;
      return null;
    }
    setCart(cartResult.data.cart);
    cartRef.current = cartResult.data.cart;
    if (cartResult.data.cart?.manualCouponCode) {
      setCouponDraft(cartResult.data.cart.manualCouponCode);
    }
    return cartResult.data.cart;
  }, [brandId]);

  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [, acquiredCart] = await Promise.all([
        refreshOrderingSurface(readDeliveryContext(), { evaluate: false }),
        refreshCart(),
      ]);
      if (cancelled) return;
      // Cart acquisition must not be aborted by surface generation, and loading
      // must not wait on evaluation. Publish one evaluation after both settle.
      void publishEvaluationIfCurrent(
        surfaceGenerationRef.current,
        readDeliveryContext(),
        acquiredCart ?? cartRef.current,
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // Initial load only — subsequent refreshes use delivery/visibility subscriptions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId]);

  useEffect(() => {
    return subscribeToDeliveryContext((nextContext) => {
      void refreshOrderingSurface(nextContext);
    });
  }, [refreshOrderingSurface]);

  useEffect(() => {
    function onVisibilityOrFocus(): void {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void refreshOrderingSurface(readDeliveryContext());
    }
    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    window.addEventListener("focus", onVisibilityOrFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      window.removeEventListener("focus", onVisibilityOrFocus);
    };
  }, [refreshOrderingSurface]);

  async function applyCartMutation(nextCart: CommerceCart): Promise<void> {
    setCart(nextCart);
    cartRef.current = nextCart;
    if (nextCart.manualCouponCode) setCouponDraft(nextCart.manualCouponCode);
    publishCartCount(cartUnitCount(nextCart));
    // Evaluate against live delivery authority, not a stale render/async closure.
    const generation = surfaceGenerationRef.current;
    await publishEvaluationIfCurrent(generation, readDeliveryContext(), nextCart);
  }

  async function withPending(work: () => Promise<void>): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await work();
    } finally {
      setPending(false);
    }
  }

  async function changeQuantity(lineId: string, quantity: number): Promise<void> {
    if (!cart) return;
    await withPending(async () => {
      if (quantity < 1) {
        const result = await removeCartLine({
          brandId,
          cartLineId: lineId,
          expectedRevision: cart.revision,
        });
        if (!result.ok) {
          setError(commerceErrorCopy(result.code));
          return;
        }
        await applyCartMutation(result.data.cart);
        return;
      }
      const result = await setCartLineQuantity({
        brandId,
        cartLineId: lineId,
        quantity,
        expectedRevision: cart.revision,
      });
      if (!result.ok) {
        setError(commerceErrorCopy(result.code));
        return;
      }
      await applyCartMutation(result.data.cart);
    });
  }

  async function handleClear(): Promise<void> {
    if (!cart) return;
    await withPending(async () => {
      const result = await clearCart({
        brandId,
        expectedRevision: cart.revision,
      });
      if (!result.ok) {
        setError(commerceErrorCopy(result.code));
        return;
      }
      await applyCartMutation(result.data.cart);
      setEvaluation(null);
    });
  }

  const checkoutBlocked = isCartCheckoutBlocked(evaluation);

  async function mutateCoupon(
    work: () => Promise<{ ok: true; data: { cart: CommerceCart } } | { ok: false; code: string }>,
  ): Promise<void> {
    if (!cart || couponPending) return;
    setCouponPending(true);
    setCouponRetry(false);
    const result = await work();
    setCouponPending(false);
    if (!result.ok) {
      setCouponRetry(true);
      setError(IMP036J_COPY.RETRY);
      return;
    }
    setCouponDraft(result.data.cart.manualCouponCode ?? "");
    await applyCartMutation(result.data.cart);
  }

  async function handleApplyCoupon(): Promise<void> {
    if (!cart) return;
    await mutateCoupon(() =>
      applyCartCoupon({
        brandId,
        couponCode: couponDraft,
        expectedRevision: cart.revision,
        sourceCommandId: crypto.randomUUID(),
      }),
    );
  }

  async function handleRemoveCoupon(): Promise<void> {
    if (!cart) return;
    await mutateCoupon(() =>
      removeCartCoupon({
        brandId,
        expectedRevision: cart.revision,
        sourceCommandId: crypto.randomUUID(),
      }),
    );
  }

  async function handleCheckout(): Promise<void> {
    if (pending || checkoutBlocked || couponPending || !cart || cart.lines.length === 0) return;
    setPending(true);
    const session = await fetchCustomerSession();
    if (!session.ok || !session.data.authenticated) {
      setPending(false);
      window.location.assign(loginUrlWithReturn("/order/checkout/"));
      return;
    }
    const activationId = crypto.randomUUID();
    window.sessionStorage.setItem("boba.cartActivationId", activationId);
    await recordCartCheckoutActivation({ brandId, activationId });
    setPending(false);
    window.location.assign("/order/checkout/");
  }

  function openEdit(lineId: string): void {
    if (!menuLookups || !cart) return;
    const line = cart.lines.find((entry) => entry.id === lineId);
    if (!line) return;
    const item = menuLookups.itemByVariant.get(line.variantId);
    if (!item) return;
    const presentation = linePresentations.find((entry) => entry.lineId === line.id);
    if (!presentation?.editEligible) return;
    setDialogError(null);
    setEditTarget({ line, item });
  }

  async function saveEditConfiguration(
    modifiers: readonly CartModifierSelectionInput[],
  ): Promise<void> {
    if (!editTarget || !cart || pending) return;
    setPending(true);
    setDialogError(null);
    try {
      const result = await updateCartLineConfiguration({
        brandId,
        cartLineId: editTarget.line.id,
        variantId: editTarget.line.variantId,
        modifiers,
        bundleSelections: cartBundleSelectionsToInput(editTarget.line.bundleSelections),
        expectedRevision: cart.revision,
      });
      if (!result.ok) {
        setDialogError(commerceErrorCopy(result.code));
        return;
      }
      await applyCartMutation(result.data.cart);
      setEditTarget(null);
      setDialogError(null);
    } finally {
      setPending(false);
    }
  }

  const empty = !loading && (!cart || cart.lines.length === 0);
  const lineCount = cartUnitCount(cart);
  const presentationEstimate = menuLookups
    ? resolveCartPresentationEstimate(cart, menuLookups)
    : { complete: false as const, totalPaise: BigInt(0) };
  const explanation = parseCommercialExplanation(evaluation?.quote);
  const reuseCheckout =
    cart != null &&
    canReuseCheckoutEvaluation({
      checkout: activeCheckout,
      cartRevision: cart.revision,
    });
  const serverMerchandise = merchandiseSubtotalFromQuote(evaluation?.quote);
  const estimatedPaise =
    serverMerchandise ??
    (presentationEstimate.complete ? presentationEstimate.totalPaise.toString() : "0");
  const reusedTotal = reuseCheckout
    ? activeCheckout?.activeSnapshot?.grandTotalPaise ?? null
    : null;
  const amountKind = reusedTotal ? "current-checkout-total" : "estimated-subtotal";
  const amountLabel =
    amountKind === "current-checkout-total"
      ? IMP036J_COPY.CURRENT_CHECKOUT_TOTAL
      : IMP036J_COPY.ESTIMATED_SUBTOTAL;
  const amountPaise = reusedTotal ?? estimatedPaise;
  const deliveryChargePaise =
    reuseCheckout && activeCheckout?.activeSnapshot
      ? snapshotDeliveryChargePaise(activeCheckout.activeSnapshot)
      : null;
  const serviceabilityNote = cartEvaluationCustomerCopy(
    evaluation,
    Boolean(deliveryContext.coordinates),
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const session = await fetchCustomerSession();
      if (!session.ok || !session.data.authenticated || !cart) return;
      const active = await getActiveCheckout({ cartId: cart.id });
      if (cancelled || !active.ok) return;
      setActiveCheckout(active.data.checkout);
    })();
    return () => {
      cancelled = true;
    };
  }, [cart]);

  useEffect(() => {
    if (!evaluation?.evaluationId || couponPending) return;
    void postCommittedPresentationObservation(priceSummaryRef.current, {
      evaluationId: evaluation.evaluationId,
    });
  }, [evaluation?.evaluationId, amountPaise, couponPending]);

  if (loading) {
    return (
      <main id="main-content" tabIndex={-1} className="bg-[var(--bg-page)] focus:outline-none">
        <div className="mx-auto max-w-[720px] px-5 py-12 md:py-16">
          <p className="font-body text-[15px] text-[var(--text-secondary)]">Loading cart…</p>
        </div>
      </main>
    );
  }

  if (!menu) {
    return (
      <main id="main-content" tabIndex={-1} className="bg-[var(--bg-page)] focus:outline-none">
        <div className="mx-auto max-w-[720px] px-5 py-12 md:py-16">
          <p role="status" className="font-body text-[15px] text-[var(--text-secondary)]">
            {error ?? "Menu is unavailable right now."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" tabIndex={-1} className="bg-[var(--bg-page)] focus:outline-none">
      <div className="mx-auto grid max-w-[1440px] gap-8 px-5 py-8 pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:px-8 md:py-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:pb-10">
        <section className="flex min-w-0 flex-col gap-6">
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-3 sm:gap-y-1">
            <h1 className="font-display text-[clamp(36px,8vw,56px)] leading-[0.95] text-[var(--text-primary)]">
              YOUR CART
            </h1>
            {!empty ? (
              <p
                data-testid="cart-item-count"
                className="font-body text-[15px] text-[var(--interactive-primary)] sm:text-[var(--text-secondary)]"
              >
                {lineCount} item{lineCount === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
          {!empty ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => void handleClear()}
              className="shrink-0 font-body text-[13px] font-semibold text-[var(--interactive-secondary)] underline-offset-2 hover:underline focus-ring"
            >
              Clear cart
            </button>
          ) : null}
        </header>

        {error ? (
          <p role="alert" className="font-body text-[14px] text-[var(--text-secondary)]">
            {error}
          </p>
        ) : null}

        {empty ? (
          <div className="flex flex-col gap-4">
            <p className="font-body text-[15px] text-[var(--text-secondary)]">
              Your cart is empty. Browse the menu to add something.
            </p>
            <Button asChild variant="primary">
              <a href="/order/">Back to menu</a>
            </Button>
          </div>
        ) : null}

        {cart && cart.lines.length > 0 ? (
          <CartLineList
            lines={linePresentations}
            pending={pending}
            onChangeQuantity={(lineId, quantity) => void changeQuantity(lineId, quantity)}
            onEdit={openEdit}
            onRemove={(lineId) => void changeQuantity(lineId, 0)}
          />
        ) : null}

        {serviceabilityNote ? (
          <p role="status" className="font-body text-[13px] text-[var(--text-secondary)]">
            {serviceabilityNote}
          </p>
        ) : null}

        {evaluation?.problems && evaluation.problems.length > 0 ? (
          <ul
            className="flex flex-col gap-2 rounded-lg border border-[var(--border-warning)] bg-[var(--bg-section)] p-3"
            data-testid="cart-evaluation-problems"
            role="alert"
          >
            {evaluation.problems.map((problem) => (
              <li key={`${problem.cartLineId}-${problem.code}`} className="font-body text-[13px] text-[var(--text-secondary)]">
                {commerceErrorCopy(problem.code)}
              </li>
            ))}
          </ul>
        ) : null}

        {cart && cart.lines.length > 0 ? (
          <CouponField
            code={couponDraft}
            appliedCode={cart.manualCouponCode}
            pending={couponPending}
            disabled={pending}
            onCodeChange={setCouponDraft}
            onApply={() => void handleApplyCoupon()}
            onRemove={() => void handleRemoveCoupon()}
            statusText={couponRetry ? IMP036J_COPY.RETRY : null}
            statusTone={couponRetry ? "alert" : null}
            retryVisible={couponRetry}
            onRetry={() => void handleApplyCoupon()}
            showSignIn={explanation?.submittedCouponResult?.status === "CUSTOMER_IDENTITY_REQUIRED"}
            returnPath="/order/cart/"
          />
        ) : null}

        </section>

        {cart && cart.lines.length > 0 ? (
          <aside
            data-testid="cart-order-summary"
            className="hidden lg:block lg:sticky lg:top-20 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-section)] p-5 shadow-[0_14px_36px_rgba(0,0,0,0.18)]"
          >
            <h2 className="font-display text-[24px] uppercase tracking-wide text-[var(--text-primary)]">
              Order summary
            </h2>
            <div className="mt-5" ref={priceSummaryRef}>
              <CommercialOfferStack
                explanation={explanation}
                payableLabel={amountLabel}
                payablePaise={amountPaise}
                deliveryChargePaise={deliveryChargePaise}
                fulfilmentMode={reuseCheckout ? activeCheckout?.fulfilmentMode ?? null : null}
                waitingText={
                  couponPending
                    ? IMP036J_COPY.CHECKING
                    : evaluation == null
                      ? IMP036J_COPY.CHECKING_TOTAL
                      : null
                }
              />
              {amountKind === "estimated-subtotal" ? (
                <p className="mt-2 font-body text-[12px] text-[var(--text-tertiary)]">
                  {IMP036J_COPY.CART_NOT_FINAL}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="mt-6 min-h-[52px] w-full rounded-lg"
              disabled={pending || couponPending || checkoutBlocked}
              onClick={() => void handleCheckout()}
            >
              {pending ? "Continuing…" : "Checkout"}
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="mt-2 min-h-[44px] w-full rounded-lg border-[var(--interactive-primary)] text-[var(--interactive-primary)] hover:text-[var(--interactive-primary)]"
            >
              <a href="/order/">Keep browsing</a>
            </Button>
          </aside>
        ) : null}
      </div>

      {cart && cart.lines.length > 0 ? (
        <div
          data-testid="cart-mobile-checkout"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border-strong)] bg-[var(--bg-surface-sunken)]/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-10px_28px_rgba(0,0,0,0.24)] backdrop-blur-[12px] lg:hidden"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-body text-[11px] text-[var(--text-tertiary)]">{amountLabel}</p>
              <p className="font-body text-[18px] font-bold text-[var(--text-primary)]">
                {formatPaise(amountPaise)}
              </p>
              {amountKind === "estimated-subtotal" ? (
                <p className="font-body text-[11px] text-[var(--text-tertiary)]">
                  {IMP036J_COPY.CART_NOT_FINAL}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="min-h-[48px] shrink-0 rounded-lg px-6"
              disabled={pending || couponPending || checkoutBlocked}
              onClick={() => void handleCheckout()}
            >
              {pending ? "Continuing…" : "Checkout"}
            </Button>
          </div>
        </div>
      ) : null}

      {editTarget ? (
        <MenuItemCustomizationDialog
          item={editTarget.item}
          mode="edit"
          initialModifiers={cartModifiersToInput(editTarget.line.modifiers)}
          pending={pending}
          error={dialogError}
          onClose={() => {
            if (!pending) {
              setEditTarget(null);
              setDialogError(null);
            }
          }}
          onSave={(modifiers) => void saveEditConfiguration(modifiers)}
        />
      ) : null}
    </main>
  );
}

function emptyMenu(brandId: string): CustomerMenuProjection {
  return {
    brandId,
    menuId: "empty",
    name: "Empty",
    sections: [],
    items: [],
  };
}

function snapshotDeliveryChargePaise(snapshot: CommerceCheckout["activeSnapshot"]): string | null {
  if (!snapshot || !Array.isArray(snapshot.charges)) return null;
  for (const raw of snapshot.charges) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as Record<string, unknown>;
    if (row.chargeCode === "delivery" && typeof row.amountPaise === "string") {
      return BigInt(row.amountPaise) > BigInt(0) ? row.amountPaise : null;
    }
  }
  return null;
}
