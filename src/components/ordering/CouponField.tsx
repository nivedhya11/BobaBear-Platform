"use client";

import { IMP036J_COPY } from "@/components/ordering/imp036j-copy";
import { loginUrlWithReturn } from "@/lib/customer-auth/return-to";

export function CouponField(props: {
  code: string;
  appliedCode: string | null;
  pending: boolean;
  disabled?: boolean;
  onCodeChange: (value: string) => void;
  onApply: () => void;
  onRemove: () => void;
  statusText: string | null;
  statusTone: "polite" | "alert" | null;
  showSignIn?: boolean;
  returnPath: string;
  retryVisible?: boolean;
  onRetry?: () => void;
}) {
  const hasApplied = Boolean(props.appliedCode);
  const busy = props.pending || props.disabled === true;
  return (
    <section className="flex flex-col gap-2" data-testid="coupon-field">
      <label className="flex flex-col gap-1">
        <span className="font-body text-[13px] font-semibold text-[var(--text-primary)]">
          {IMP036J_COPY.COUPON_LABEL}
        </span>
        <span className="font-body text-[12px] text-[var(--text-tertiary)]">
          {IMP036J_COPY.COUPON_HINT}
        </span>
        <input
          name="coupon"
          autoComplete="off"
          value={props.code}
          disabled={busy}
          onChange={(event) => props.onCodeChange(event.target.value)}
          aria-label={IMP036J_COPY.COUPON_LABEL}
          data-testid="coupon-input"
          className="min-h-[44px] rounded-lg border border-[var(--border-strong)] bg-[var(--bg-page)] px-3 font-body text-[15px] text-[var(--text-primary)]"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {!hasApplied ? (
          <button
            type="button"
            disabled={busy || props.code.trim().length === 0}
            onClick={() => props.onApply()}
            data-testid="coupon-apply"
            className="min-h-[44px] rounded-lg bg-[var(--interactive-primary)] px-4 font-body text-[14px] font-semibold text-[var(--text-on-primary)] disabled:opacity-60"
          >
            {props.pending ? IMP036J_COPY.CHECKING : IMP036J_COPY.APPLY}
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy || props.code.trim().length === 0}
              onClick={() => props.onApply()}
              data-testid="coupon-change"
              className="min-h-[44px] rounded-lg border border-[var(--border-strong)] px-4 font-body text-[14px] font-semibold"
            >
              {props.pending ? IMP036J_COPY.CHECKING : IMP036J_COPY.CHANGE}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => props.onRemove()}
              data-testid="coupon-remove"
              className="min-h-[44px] rounded-lg border border-[var(--border-strong)] px-4 font-body text-[14px] font-semibold"
            >
              {IMP036J_COPY.REMOVE}
            </button>
          </>
        )}
      </div>
      {props.pending ? (
        <p role="status" aria-live="polite" className="font-body text-[13px] text-[var(--text-secondary)]">
          {IMP036J_COPY.CHECKING}
        </p>
      ) : null}
      {props.statusText && !props.pending ? (
        <p
          role={props.statusTone === "alert" ? "alert" : "status"}
          aria-live={props.statusTone === "alert" ? "assertive" : "polite"}
          data-testid="coupon-result"
          tabIndex={-1}
          className="font-body text-[13px] text-[var(--text-secondary)]"
        >
          {props.statusText}
        </p>
      ) : null}
      {props.showSignIn ? (
        <a
          href={loginUrlWithReturn(props.returnPath)}
          className="font-body text-[14px] font-semibold text-[var(--interactive-primary)] underline-offset-2 hover:underline"
        >
          {IMP036J_COPY.SIGN_IN_ACTION}
        </a>
      ) : null}
      {props.retryVisible ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => props.onRetry?.()}
          data-testid="coupon-retry"
          className="min-h-[44px] self-start rounded-lg border border-[var(--border-strong)] px-4 font-body text-[14px] font-semibold"
        >
          {IMP036J_COPY.RETRY_ACTION}
        </button>
      ) : null}
    </section>
  );
}
