"use client";

import { formatPaise } from "@/components/ordering/format-money";
import { IMP036J_COPY } from "@/components/ordering/imp036j-copy";
import type { WireCommercialExplanation } from "@/components/ordering/commercial-explanation-presentation";
import {
  automaticStatusCopy,
  couponStatusCopy,
  thresholdCopy,
} from "@/components/ordering/commercial-explanation-presentation";

export function CommercialOfferStack(props: {
  explanation: WireCommercialExplanation | null;
  payableLabel: string;
  payablePaise: string;
  deliveryChargePaise?: string | null;
  fulfilmentMode?: "DELIVERY" | "PICKUP" | null;
  complimentaryName?: string | null;
  showGiftConflict?: boolean;
  giftGone?: boolean;
  stale?: boolean;
  dropped?: boolean;
  waitingText?: string | null;
  retainedAutomaticOffer?: boolean;
}) {
  const explanation = props.explanation;
  const orderSaving = explanation ? BigInt(explanation.merchandiseOrOrderSavingPaise) : BigInt(0);
  const deliverySaving = explanation ? BigInt(explanation.deliverySavingPaise) : BigInt(0);
  const totalSaved = explanation ? BigInt(explanation.totalSavedPaise) : BigInt(0);
  const couponStatus = couponStatusCopy({
    explanation,
    fulfilmentMode: props.fulfilmentMode,
    retainedAutomaticOffer: props.retainedAutomaticOffer,
  });
  const automatic = automaticStatusCopy(explanation);
  const status = couponStatus ?? automatic;
  const threshold = thresholdCopy(explanation);
  const gift =
    explanation?.complimentary?.competingOffers === "NONE"
      ? explanation.complimentary
      : null;
  const giftName = props.complimentaryName ?? gift?.itemName ?? null;
  const showConflict =
    props.showGiftConflict === true ||
    explanation?.complimentary?.competingOffers === "NONE_CHOSEN";

  return (
    <section
      aria-label={IMP036J_COPY.PRICE_SUMMARY}
      data-testid="price-summary"
      className="flex flex-col gap-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-section)] p-4"
    >
      <h2 className="font-body text-[15px] font-semibold text-[var(--text-primary)]">
        {IMP036J_COPY.PRICE_SUMMARY}
      </h2>
      {props.waitingText ? (
        <p role="status" aria-live="polite" className="font-body text-[13px] text-[var(--text-secondary)]">
          {props.waitingText}
        </p>
      ) : null}
      {props.stale ? (
        <p
          role="alert"
          data-testid="copy-stale"
          tabIndex={-1}
          className="font-body text-[13px] text-[var(--text-secondary)]"
        >
          {IMP036J_COPY.STALE}
        </p>
      ) : null}
      {props.giftGone ? (
        <p role="alert" data-testid="copy-gift-gone" className="font-body text-[13px] text-[var(--text-secondary)]">
          {IMP036J_COPY.GIFT_GONE}
        </p>
      ) : null}
      {props.dropped ? (
        <p role="status" className="font-body text-[13px] text-[var(--text-secondary)]">
          {IMP036J_COPY.DROPPED}
        </p>
      ) : null}
      {status ? (
        <p
          role={status.tone === "alert" ? "alert" : "status"}
          data-testid="offer-status"
          data-observed-status={status.text}
          className="font-body text-[13px] text-[var(--text-secondary)]"
        >
          {status.text}
        </p>
      ) : null}
      {orderSaving > BigInt(0) ? (
        <div
          className="flex justify-between font-body text-[14px]"
          data-offer-component="ORDER_SAVING"
          data-offer-amount={explanation?.merchandiseOrOrderSavingPaise}
          data-offer-present="true"
        >
          <span>{IMP036J_COPY.ORDER_SAVING_ROW}</span>
          <span className="tabular-nums">{formatPaise(explanation!.merchandiseOrOrderSavingPaise)}</span>
        </div>
      ) : null}
      {deliverySaving > BigInt(0) && props.fulfilmentMode !== "PICKUP" ? (
        <div
          className="flex justify-between font-body text-[14px]"
          data-offer-component="DELIVERY_SAVING"
          data-offer-amount={explanation?.deliverySavingPaise}
          data-offer-present="true"
        >
          <span>{IMP036J_COPY.DELIVERY_SAVING_ROW}</span>
          <span className="tabular-nums">{formatPaise(explanation!.deliverySavingPaise)}</span>
        </div>
      ) : null}
      {totalSaved > BigInt(0) ? (
        <div
          className="flex justify-between font-body text-[14px]"
          data-offer-component="TOTAL_SAVED"
          data-offer-amount={explanation?.totalSavedPaise}
          data-offer-present="true"
        >
          <span>{IMP036J_COPY.TOTAL_SAVED_ROW}</span>
          <span className="tabular-nums">{formatPaise(explanation!.totalSavedPaise)}</span>
        </div>
      ) : null}
      {props.deliveryChargePaise && BigInt(props.deliveryChargePaise) > BigInt(0) ? (
        <div
          className="flex justify-between font-body text-[14px]"
          data-offer-component="DELIVERY_CHARGE"
          data-offer-amount={props.deliveryChargePaise}
          data-offer-present="true"
        >
          <span>{IMP036J_COPY.DELIVERY_ROW}</span>
          <span className="tabular-nums">{formatPaise(props.deliveryChargePaise)}</span>
        </div>
      ) : null}
      {threshold ? (
        <p
          data-offer-component="PROGRESS"
          data-offer-amount={explanation?.thresholdProgress?.remainingAmountPaise ?? ""}
          data-offer-present="true"
          className="font-body text-[13px] text-[var(--text-secondary)]"
        >
          {threshold}
        </p>
      ) : null}
      {gift && giftName ? (
        <div
          data-testid="complimentary-line"
          data-complimentary-name={giftName}
          data-complimentary-included={IMP036J_COPY.INCLUDED}
          data-complimentary-amount={formatPaise(0)}
          className="flex flex-col gap-1 font-body text-[14px]"
        >
          <span>
            1 × {giftName}
          </span>
          <span>{IMP036J_COPY.INCLUDED}</span>
          <span className="tabular-nums">{formatPaise(0)}</span>
        </div>
      ) : null}
      {showConflict && !gift ? (
        <p role="status" data-testid="copy-gift-conflict" className="font-body text-[13px] text-[var(--text-secondary)]">
          {IMP036J_COPY.GIFT_CONFLICT}
        </p>
      ) : null}
      <div
        className="mt-2 flex justify-between border-t border-[var(--border-default)] pt-2 font-body text-[15px] font-semibold"
        data-offer-component={
          props.payableLabel === IMP036J_COPY.ESTIMATED_SUBTOTAL
            ? "ESTIMATED_SUBTOTAL"
            : props.payableLabel === IMP036J_COPY.CURRENT_CHECKOUT_TOTAL
              ? "CURRENT_CHECKOUT_TOTAL"
              : "TOTAL_PAYABLE"
        }
        data-offer-amount={props.payablePaise}
        data-offer-present="true"
        data-testid="price-summary-total"
      >
        <span>{props.payableLabel} </span>
        <span className="tabular-nums">{formatPaise(props.payablePaise)}</span>
      </div>
    </section>
  );
}
