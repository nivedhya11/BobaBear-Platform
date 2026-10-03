"use client";

import { useCallback, useEffect, useState } from "react";

import { Alert } from "@/components/enterprise/Alert";
import { EmptyState } from "@/components/enterprise/EmptyState";
import { LoadingState } from "@/components/enterprise/LoadingState";
import { StatusBadge } from "@/components/enterprise/StatusBadge";
import {
  enterpriseFieldClass,
  enterprisePanelClass,
} from "@/components/enterprise/enterprise-tokens";
import { Button } from "@/components/ui/Button";
import {
  activateCoupon,
  activatePromotion,
  createCoupon,
  createPromotion,
  disableCoupon,
  enableCoupon,
  getPromotion,
  listCoupons,
  listPromotions,
  previewCouponConsequence,
  previewPromotionConsequence,
  retireCoupon,
  retirePromotion,
  savePromotionBenefit,
  savePromotionDraft,
  setPromotionTargets,
  type Coupon,
  type CouponStatus,
  type Promotion,
  type PromotionStatus,
  type PromotionTarget,
} from "@/lib/administration/commercial-promotions";
import {
  describeAdminFailure,
  fieldErrorFromResult,
  MOBILE_AUTHORING_MESSAGE,
} from "@/lib/administration/commercial-errors";
import { parseInrToPaise } from "@/lib/administration/commercial-money";
import { cn } from "@/lib/utils";
import {
  COPY_CANCEL,
  COPY_OP_AUTO,
  COPY_OP_COUPON,
  COPY_OP_DELIVERY,
  COPY_OP_DRAFT,
  COPY_OP_GIFT,
  COPY_OP_LIVE,
  COPY_OP_ORDER,
  COPY_OP_RETIRED,
  COPY_RETIRE_BODY,
  COPY_RETIRE_CONFIRM,
  COPY_RETIRE_TITLE,
} from "@/shared/promotions/operator-copy";

import { ConsequenceReviewDialog } from "./ConsequenceReviewDialog";
import type { CommercialCapabilities, CommercialContext } from "./commercial-types";

type PromotionsEditorProps = Readonly<{
  context: CommercialContext;
  capabilities: CommercialCapabilities;
  authoringAllowed: boolean;
  onStatus: (message: string) => void;
}>;

type OfferBenefitType =
  | "percentage_discount"
  | "fixed_amount_discount"
  | "delivery_fee_waiver"
  | "complimentary_item";

type RedemptionCounts = Readonly<{
  reservedCount: number;
  consumedCount: number;
  releasedCount: number;
  applicationCount: number;
}>;

type ReviewState = Readonly<{
  kind: "promotion" | "coupon";
  id: string;
  expectedRevision: string;
  proposedStatus: string;
  couponAction?: "activate" | "disable" | "enable" | "retire";
  draftLabel: string;
  effectiveLabel: string;
  dimensions: readonly Readonly<{ label: string; value: string }>[];
}>;

export function PromotionsEditor(props: PromotionsEditorProps) {
  const { context, capabilities, authoringAllowed } = props;
  const canRead = capabilities.promotionsRead || capabilities.couponsRead;
  const canManagePromo = capabilities.promotionsManage && authoringAllowed;
  const canActivatePromo = capabilities.promotionsActivate && authoringAllowed;
  // Server activate requires promotions.manage + promotions.activate; retire requires activate only.
  const canCompletePromotionActivation = canManagePromo && canActivatePromo;
  const canRetirePromotion = canActivatePromo;
  const canManageCoupon = capabilities.couponsManage && authoringAllowed;

  const [loading, setLoading] = useState(false);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<Promotion | null>(null);
  const [benefit, setBenefit] = useState<unknown>(null);
  const [qualifierTargets, setQualifierTargets] = useState<readonly PromotionTarget[]>([]);
  const [benefitTargets, setBenefitTargets] = useState<readonly PromotionTarget[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [triggerType, setTriggerType] = useState<"automatic" | "coupon">("automatic");
  const [draftName, setDraftName] = useState("");
  const [benefitType, setBenefitType] = useState<OfferBenefitType>("percentage_discount");
  const [percentageBps, setPercentageBps] = useState("1000");
  const [fixedInr, setFixedInr] = useState("");
  const [firstOrderOnly, setFirstOrderOnly] = useState(false);
  const [modeDelivery, setModeDelivery] = useState(false);
  const [modePickup, setModePickup] = useState(false);
  const [timingAsap, setTimingAsap] = useState(false);
  const [timingScheduled, setTimingScheduled] = useState(false);
  const [stackingPolicy, setStackingPolicy] = useState("exclusive");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [minInr, setMinInr] = useState("");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [maxPerCustomer, setMaxPerCustomer] = useState("");
  const [giftProductId, setGiftProductId] = useState("");
  const [giftVariantId, setGiftVariantId] = useState("");
  const [giftFieldError, setGiftFieldError] = useState<string | null>(null);
  const [redemptionCounts, setRedemptionCounts] = useState<RedemptionCounts | null>(null);
  const [couponCode, setCouponCode] = useState("");

  const [review, setReview] = useState<ReviewState | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    if (!context.brandId || !capabilities.promotionsRead) return;
    setLoading(true);
    setError(null);
    const result = await listPromotions(context.brandId);
    setLoading(false);
    if (!result.ok) {
      setError(describeAdminFailure(result));
      return;
    }
    setPromotions(result.data.promotions);
  }, [capabilities.promotionsRead, context.brandId]);

  const loadDetail = useCallback(async () => {
    if (!context.brandId || !selectedId || !capabilities.promotionsRead) {
      setPromotion(null);
      setQualifierTargets([]);
      setBenefitTargets([]);
      setCoupons([]);
      return;
    }
    setLoading(true);
    const [promoResult, couponResult] = await Promise.all([
      getPromotion(context.brandId, selectedId),
      capabilities.couponsRead
        ? listCoupons(context.brandId, selectedId)
        : Promise.resolve(null),
    ]);
    setLoading(false);
    if (!promoResult.ok) {
      setError(describeAdminFailure(promoResult));
      return;
    }
    setPromotion(promoResult.data.promotion);
    setBenefit(promoResult.data.benefit);
    setQualifierTargets(promoResult.data.qualifierTargets);
    setBenefitTargets(promoResult.data.benefitTargets);
    setRedemptionCounts(promoResult.data.redemptionCounts);
    const loaded = promoResult.data.promotion;
    setDraftName(loaded.displayName);
    setFirstOrderOnly(loaded.firstOrderOnly === true);
    setModeDelivery(loaded.eligibleFulfilmentModes?.includes("DELIVERY") === true);
    setModePickup(loaded.eligibleFulfilmentModes?.includes("PICKUP") === true);
    setTimingAsap(loaded.eligibleFulfilmentTimings?.includes("ASAP") === true);
    setTimingScheduled(loaded.eligibleFulfilmentTimings?.includes("SCHEDULED") === true);
    setStackingPolicy(loaded.stackingPolicy);
    setStartsAt(loaded.startsAt);
    setEndsAt(loaded.endsAt ?? "");
    setMinInr(
      loaded.minimumQualifyingAmountPaise
        ? (Number(loaded.minimumQualifyingAmountPaise) / 100).toString()
        : "",
    );
    setMaxRedemptions(loaded.maximumRedemptions?.toString() ?? "");
    setMaxPerCustomer(loaded.maximumRedemptionsPerCustomer?.toString() ?? "");
    const loadedBenefit = promoResult.data.benefit as
      | {
          benefitType?: OfferBenefitType;
          complimentaryProductId?: string | null;
          complimentaryVariantId?: string | null;
        }
      | null;
    if (loadedBenefit?.benefitType === "delivery_fee_waiver") {
      setBenefitType("delivery_fee_waiver");
    } else if (loadedBenefit?.benefitType === "complimentary_item") {
      setBenefitType("complimentary_item");
    } else if (loadedBenefit?.benefitType === "fixed_amount_discount") {
      setBenefitType("fixed_amount_discount");
    } else {
      setBenefitType("percentage_discount");
    }
    setGiftProductId(loadedBenefit?.complimentaryProductId ?? "");
    setGiftVariantId(loadedBenefit?.complimentaryVariantId ?? "");
    setGiftFieldError(null);
    setActivationError(null);
    if (
      couponResult &&
      couponResult.ok &&
      promoResult.data.promotion.triggerType === "coupon"
    ) {
      setCoupons(couponResult.data.coupons);
    } else {
      setCoupons([]);
    }
  }, [capabilities.couponsRead, capabilities.promotionsRead, context.brandId, selectedId]);

  useEffect(() => {
    // Data-fetch effect: initial loading state is set inside the async loader.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external Admin HTTP sync
    void loadList();
  }, [loadList]);

  useEffect(() => {
    // Data-fetch effect: initial loading state is set inside the async loader.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external Admin HTTP sync
    void loadDetail();
  }, [loadDetail]);

  if (!canRead) {
    return (
      <Alert tone="warning" title="Promotions read required">
        You need promotions.read or coupons.read to inspect this section.
      </Alert>
    );
  }

  if (!context.brandId) {
    return (
      <Alert tone="info" title="Select a brand">
        Choose a brand to author promotions and coupons.
      </Alert>
    );
  }

  if (loading && promotions.length === 0 && !promotion) {
    return <LoadingState label="Loading promotions…" />;
  }

  async function handleCreatePromotion() {
    if (!canManagePromo || !context.brandId) return;
    setBusy(true);
    const result = await createPromotion(context.brandId, {
      code: code.trim(),
      displayName: displayName.trim(),
      scopeType: "brand",
      triggerType,
      startsAt: new Date().toISOString(),
    });
    setBusy(false);
    if (!result.ok) {
      props.onStatus(describeAdminFailure(result));
      return;
    }
    setCode("");
    setDisplayName("");
    setTriggerType("automatic");
    setSelectedId(result.data.promotion.id);
    props.onStatus("Promotion created as draft.");
    await loadList();
  }

  async function handleSetTargets(
    targetRole: "qualifier" | "benefit",
    targetType: "product" | "variant",
  ) {
    if (!canManagePromo || !context.brandId || !promotion) return;
    if (targetType === "product" && !context.productId) {
      props.onStatus("Select a product in commercial context first.");
      return;
    }
    if (targetType === "variant" && !context.variantId) {
      props.onStatus("Select a variant in commercial context first.");
      return;
    }
    setBusy(true);
    const targets =
      targetType === "product"
        ? [{ targetType: "product" as const, productId: context.productId!, variantId: null }]
        : [
            {
              targetType: "variant" as const,
              variantId: context.variantId!,
              productId: null,
            },
          ];
    const result = await setPromotionTargets(context.brandId, promotion.id, {
      expectedPromotionRevision: promotion.revision,
      targetRole,
      targets,
    });
    setBusy(false);
    if (!result.ok) {
      props.onStatus(`${result.code}: ${describeAdminFailure(result)}`);
      return;
    }
    props.onStatus(`${targetRole} targets updated.`);
    await loadDetail();
  }

  function formatTarget(target: PromotionTarget) {
    if (target.targetType === "product") {
      return `product ${target.productId ?? "—"}`;
    }
    if (target.targetType === "variant") {
      return `variant ${target.variantId ?? "—"}${
        target.productId ? ` (product ${target.productId})` : ""
      }`;
    }
    if (target.targetType === "all_merchandise") {
      return "all merchandise";
    }
    return `${target.targetType}${
      target.chargeDefinitionId ? ` ${target.chargeDefinitionId}` : ""
    }`;
  }

  async function handleSaveDraft() {
    if (!canManagePromo || !context.brandId || !promotion) return;
    setBusy(true);
    const modes = [
      ...(modeDelivery ? (["DELIVERY"] as const) : []),
      ...(modePickup ? (["PICKUP"] as const) : []),
    ];
    const timings = [
      ...(timingAsap ? (["ASAP"] as const) : []),
      ...(timingScheduled ? (["SCHEDULED"] as const) : []),
    ];
    const minPaise = minInr.trim() ? parseInrToPaise(minInr) : null;
    if (minInr.trim() && minPaise === null) {
      setBusy(false);
      props.onStatus("Enter a valid minimum INR amount.");
      return;
    }
    const result = await savePromotionDraft(context.brandId, promotion.id, {
      expectedPromotionRevision: promotion.revision,
      displayName: draftName,
      stackingPolicy,
      startsAt: startsAt || undefined,
      endsAt: endsAt ? endsAt : null,
      minimumQualifyingAmountPaise: minPaise,
      firstOrderOnly,
      eligibleFulfilmentModes: modes.length > 0 ? modes : null,
      eligibleFulfilmentTimings: timings.length > 0 ? timings : null,
      maximumRedemptions: maxRedemptions.trim() ? Number.parseInt(maxRedemptions, 10) : null,
      maximumRedemptionsPerCustomer: maxPerCustomer.trim()
        ? Number.parseInt(maxPerCustomer, 10)
        : null,
    });
    setBusy(false);
    if (!result.ok) {
      props.onStatus(describeAdminFailure(result));
      return;
    }
    props.onStatus("Promotion draft saved.");
    await loadDetail();
  }

  async function handleSaveBenefit() {
    if (!canManagePromo || !context.brandId || !promotion) return;
    setBusy(true);
    setGiftFieldError(null);
    let result;
    if (benefitType === "percentage_discount") {
      const bps = Number.parseInt(percentageBps, 10);
      if (!Number.isFinite(bps)) {
        setBusy(false);
        props.onStatus("Enter percentage in basis points (e.g. 1000 = 10%).");
        return;
      }
      result = await savePromotionBenefit(context.brandId, promotion.id, {
        expectedPromotionRevision: promotion.revision,
        benefitType: "percentage_discount",
        percentageBps: bps,
      });
    } else if (benefitType === "fixed_amount_discount") {
      const paise = parseInrToPaise(fixedInr);
      if (paise === null) {
        setBusy(false);
        props.onStatus("Enter a valid fixed INR amount.");
        return;
      }
      result = await savePromotionBenefit(context.brandId, promotion.id, {
        expectedPromotionRevision: promotion.revision,
        benefitType: "fixed_amount_discount",
        fixedAmountPaise: paise,
      });
    } else if (benefitType === "delivery_fee_waiver") {
      result = await savePromotionBenefit(context.brandId, promotion.id, {
        expectedPromotionRevision: promotion.revision,
        benefitType: "delivery_fee_waiver",
      });
    } else {
      result = await savePromotionBenefit(context.brandId, promotion.id, {
        expectedPromotionRevision: promotion.revision,
        benefitType: "complimentary_item",
        complimentaryProductId: giftProductId.trim() || context.productId || null,
        complimentaryVariantId: giftVariantId.trim() || context.variantId || null,
      });
    }
    setBusy(false);
    if (!result.ok) {
      const mapped = fieldErrorFromResult(result);
      if (result.code === "PROMOTION_COMPLIMENTARY_INVALID") {
        setGiftFieldError(mapped?.message ?? describeAdminFailure(result));
      }
      props.onStatus(`${result.code}: ${describeAdminFailure(result)}`);
      return;
    }
    props.onStatus("Benefit saved on draft.");
    await loadDetail();
  }

  async function openPromotionReview(proposedStatus: PromotionStatus) {
    if (!context.brandId || !promotion) return;
    if (proposedStatus === "active" && !canCompletePromotionActivation) return;
    if (proposedStatus === "retired" && !canRetirePromotion) return;
    const result = await previewPromotionConsequence(context.brandId, promotion.id, {
      proposedStatus,
    });
    if (!result.ok) {
      setActivationError(`${result.code}: ${describeAdminFailure(result)}`);
      props.onStatus(`${result.code}: ${describeAdminFailure(result)}`);
      return;
    }
    const preview = result.data.preview;
    setReview({
      kind: "promotion",
      id: promotion.id,
      expectedRevision: preview.expectedPromotionRevision,
      proposedStatus,
      draftLabel: `Proposed status: ${preview.proposedStatus}`,
      effectiveLabel: `Current status: ${preview.currentStatus}`,
      dimensions: [
        { label: "Customer implication", value: preview.customerVisibleImplication },
        {
          label: "Supported lifecycle",
          value: preview.supportedLifecycleStates.join(", "),
        },
      ],
    });
    setReviewError(null);
    setActivationError(null);
  }

  async function openCouponReview(
    coupon: Coupon,
    proposedStatus: CouponStatus,
    couponAction: "activate" | "disable" | "enable" | "retire",
  ) {
    if (!canManageCoupon || !context.brandId) return;
    const result = await previewCouponConsequence(context.brandId, coupon.id, { proposedStatus });
    if (!result.ok) {
      props.onStatus(`${result.code}: ${describeAdminFailure(result)}`);
      return;
    }
    const preview = result.data.preview;
    setReview({
      kind: "coupon",
      id: coupon.id,
      expectedRevision: preview.expectedCouponRevision,
      proposedStatus,
      couponAction,
      draftLabel: `Proposed: ${preview.proposedStatus}`,
      effectiveLabel: `Current: ${preview.currentStatus} (${preview.canonicalCode})`,
      dimensions: [
        { label: "Customer implication", value: preview.customerVisibleImplication },
        {
          label: "Supported lifecycle",
          value: preview.supportedLifecycleStates.join(", "),
        },
      ],
    });
    setReviewError(null);
  }

  async function confirmReview() {
    if (!review || !context.brandId) return;
    setReviewBusy(true);
    setReviewError(null);
    let result;
    if (review.kind === "promotion") {
      const body = { expectedPromotionRevision: review.expectedRevision };
      result =
        review.proposedStatus === "active"
          ? await activatePromotion(context.brandId, review.id, body)
          : await retirePromotion(context.brandId, review.id, body);
    } else {
      const body = { expectedCouponRevision: review.expectedRevision };
      const action = review.couponAction ?? "activate";
      if (action === "activate") {
        result = await activateCoupon(context.brandId, review.id, body);
      } else if (action === "disable") {
        result = await disableCoupon(context.brandId, review.id, body);
      } else if (action === "enable") {
        result = await enableCoupon(context.brandId, review.id, body);
      } else {
        result = await retireCoupon(context.brandId, review.id, body);
      }
    }
    setReviewBusy(false);
    if (!result.ok) {
      const msg = `${result.code}: ${describeAdminFailure(result)}`;
      setReviewError(msg);
      if (review.kind === "promotion" && review.proposedStatus === "active") {
        setActivationError(msg);
      }
      return;
    }
    setReview(null);
    props.onStatus(
      review.kind === "promotion" && review.proposedStatus === "retired"
        ? COPY_OP_RETIRED
        : "Lifecycle effect applied.",
    );
    await loadList();
    await loadDetail();
  }

  async function handleCreateCoupon() {
    if (!canManageCoupon || !context.brandId || !selectedId) return;
    setBusy(true);
    const result = await createCoupon(context.brandId, selectedId, {
      origin: "manual",
      ...(couponCode.trim() ? { canonicalCode: couponCode.trim() } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      props.onStatus(`${result.code}: ${describeAdminFailure(result)}`);
      return;
    }
    setCouponCode("");
    props.onStatus(`Coupon created (${result.data.coupon.canonicalCode}).`);
    await loadDetail();
  }

  function statusTone(status: string) {
    if (status === "active") return "success" as const;
    if (status === "retired" || status === "disabled") return "danger" as const;
    return "neutral" as const;
  }

  return (
    <div data-testid="promotions-editor" className="space-y-4">
      {!authoringAllowed ? (
        <Alert tone="info" title="Inspection only on this viewport">
          {MOBILE_AUTHORING_MESSAGE}
        </Alert>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}
      {activationError ? (
        <Alert tone="danger" title="Activation readiness">
          {activationError}
        </Alert>
      ) : null}

      <div className={cn(enterprisePanelClass, "space-y-3 px-4 py-4")}>
        <h3 className="text-sm font-semibold">Promotions</h3>
        <p className="text-xs text-[var(--enterprise-muted,#C4D4A8)]">
          Lifecycle states: draft, active, retired only. Coupons may also be disabled.
        </p>
        {promotions.length === 0 ? (
          <EmptyState title="No promotions" description="Create a draft promotion to begin." />
        ) : (
          <ul className="space-y-2">
            {promotions.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={cn(
                    "w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--bg-surface,#2E4720)]",
                    selectedId === p.id && "bg-[var(--bg-surface,#2E4720)] font-semibold",
                  )}
                  onClick={() => setSelectedId(p.id)}
                >
                  {p.displayName} ({p.code})
                  <StatusBadge className="ml-2" tone={statusTone(p.status)}>
                    {p.status}
                  </StatusBadge>
                </button>
              </li>
            ))}
          </ul>
        )}

        {canManagePromo ? (
          <fieldset className="grid gap-2 sm:grid-cols-4" disabled={busy}>
            <legend className="mb-1 text-sm font-semibold">Create promotion</legend>
            <input
              className={cn(enterpriseFieldClass)}
              placeholder="Code"
              aria-label="Promotion code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <input
              className={cn(enterpriseFieldClass)}
              placeholder="Display name"
              aria-label="Promotion display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <label className="flex flex-col gap-1 text-sm">
              <span>Trigger type</span>
              <select
                className={cn(enterpriseFieldClass)}
                aria-label="Trigger type"
                aria-describedby="trigger-type-help"
                value={triggerType}
                onChange={(e) => setTriggerType(e.target.value as "automatic" | "coupon")}
              >
                <option value="automatic">automatic</option>
                <option value="coupon">coupon</option>
              </select>
              <span id="trigger-type-help" className="text-xs text-[var(--enterprise-muted,#C4D4A8)]">
                {triggerType === "automatic" ? COPY_OP_AUTO : COPY_OP_COUPON}
              </span>
            </label>
            <Button type="button" onClick={() => void handleCreatePromotion()}>
              Create
            </Button>
          </fieldset>
        ) : null}
      </div>

      {promotion ? (
        <div className={cn(enterprisePanelClass, "space-y-4 px-4 py-4")}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{promotion.displayName}</h3>
            <StatusBadge tone={statusTone(promotion.status)}>{promotion.status}</StatusBadge>
            <span className="text-xs text-[var(--enterprise-muted,#C4D4A8)]">
              {promotion.status === "active"
                ? COPY_OP_LIVE
                : promotion.status === "retired"
                  ? COPY_OP_RETIRED
                  : COPY_OP_DRAFT}
            </span>
            <span className="text-xs text-[var(--enterprise-muted,#C4D4A8)]">
              Trigger: {promotion.triggerType}
            </span>
            <span className="text-xs text-[var(--enterprise-muted,#C4D4A8)]">
              Revision {promotion.revision}
            </span>
          </div>

          {canManagePromo && promotion.status === "draft" ? (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span>Display name</span>
                <input
                  className={cn(enterpriseFieldClass, "w-full")}
                  value={draftName}
                  aria-label="Display name"
                  onChange={(e) => setDraftName(e.target.value)}
                />
              </label>
              <fieldset className="grid gap-3 sm:grid-cols-2" disabled={busy}>
                <legend className="text-sm font-semibold">Eligibility</legend>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={firstOrderOnly}
                    onChange={(e) => setFirstOrderOnly(e.target.checked)}
                  />
                  First order only
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span>Stacking posture</span>
                  <select
                    className={cn(enterpriseFieldClass)}
                    aria-label="Stacking posture"
                    value={stackingPolicy}
                    onChange={(e) => setStackingPolicy(e.target.value)}
                  >
                    <option value="exclusive">exclusive</option>
                    <option value="combinable">combinable</option>
                  </select>
                </label>
                <fieldset className="space-y-1">
                  <legend className="text-sm">Fulfilment mode</legend>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={modeDelivery}
                      onChange={(e) => setModeDelivery(e.target.checked)}
                    />
                    Delivery
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={modePickup}
                      onChange={(e) => setModePickup(e.target.checked)}
                    />
                    Pickup
                  </label>
                </fieldset>
                <fieldset className="space-y-1">
                  <legend className="text-sm">Timing</legend>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={timingAsap}
                      onChange={(e) => setTimingAsap(e.target.checked)}
                    />
                    ASAP
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={timingScheduled}
                      onChange={(e) => setTimingScheduled(e.target.checked)}
                    />
                    Scheduled
                  </label>
                </fieldset>
                <label className="flex flex-col gap-1 text-sm">
                  <span>Starts at</span>
                  <input
                    className={cn(enterpriseFieldClass)}
                    aria-label="Starts at"
                    value={startsAt}
                    onChange={(e) => setStartsAt(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span>Ends at</span>
                  <input
                    className={cn(enterpriseFieldClass)}
                    aria-label="Ends at"
                    value={endsAt}
                    onChange={(e) => setEndsAt(e.target.value)}
                  />
                </label>
              </fieldset>
              <fieldset className="grid gap-3 sm:grid-cols-2" disabled={busy}>
                <legend className="text-sm font-semibold">Limits</legend>
                <label className="flex flex-col gap-1 text-sm">
                  <span>Minimum INR amount</span>
                  <input
                    className={cn(enterpriseFieldClass)}
                    aria-label="Minimum INR amount"
                    inputMode="decimal"
                    value={minInr}
                    onChange={(e) => setMinInr(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span>Maximum redemptions</span>
                  <input
                    className={cn(enterpriseFieldClass)}
                    aria-label="Maximum redemptions"
                    inputMode="numeric"
                    value={maxRedemptions}
                    onChange={(e) => setMaxRedemptions(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span>Maximum redemptions per customer</span>
                  <input
                    className={cn(enterpriseFieldClass)}
                    aria-label="Maximum redemptions per customer"
                    inputMode="numeric"
                    value={maxPerCustomer}
                    onChange={(e) => setMaxPerCustomer(e.target.value)}
                  />
                </label>
              </fieldset>
              <Button type="button" disabled={busy} onClick={() => void handleSaveDraft()}>
                Save draft
              </Button>

              <fieldset className="space-y-2" data-testid="promotion-targets" disabled={busy}>
                <legend className="text-sm font-semibold">Targets</legend>
                <div className="text-sm text-[var(--enterprise-text-secondary,#EBD9A6)]">
                  Qualifier targets:{" "}
                  {qualifierTargets.length === 0
                    ? "None configured"
                    : qualifierTargets.map(formatTarget).join("; ")}
                </div>
                <div className="text-sm text-[var(--enterprise-text-secondary,#EBD9A6)]">
                  Benefit targets:{" "}
                  {benefitTargets.length === 0
                    ? "None configured"
                    : benefitTargets.map(formatTarget).join("; ")}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!context.productId}
                    onClick={() => void handleSetTargets("qualifier", "product")}
                  >
                    Set qualifier to selected product
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!context.variantId}
                    onClick={() => void handleSetTargets("qualifier", "variant")}
                  >
                    Set qualifier to selected variant
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!context.productId}
                    onClick={() => void handleSetTargets("benefit", "product")}
                  >
                    Set benefit to selected product
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!context.variantId}
                    onClick={() => void handleSetTargets("benefit", "variant")}
                  >
                    Set benefit to selected variant
                  </Button>
                </div>
                {!context.productId && !context.variantId ? (
                  <p className="text-xs text-[var(--enterprise-muted,#C4D4A8)]">
                    Select a product or variant in commercial context to set targets.
                  </p>
                ) : null}
              </fieldset>

              <fieldset className="space-y-2" disabled={busy}>
                <legend className="text-sm font-semibold">Benefit</legend>
                <select
                  className={cn(enterpriseFieldClass)}
                  value={benefitType}
                  aria-label="Benefit type"
                  onChange={(e) => setBenefitType(e.target.value as OfferBenefitType)}
                >
                  <option value="percentage_discount">Percentage discount</option>
                  <option value="fixed_amount_discount">Fixed amount discount</option>
                  <option value="delivery_fee_waiver">Delivery fee waiver</option>
                  <option value="complimentary_item">Complimentary item</option>
                </select>
                {benefitType === "percentage_discount" ? (
                  <label className="flex flex-col gap-1 text-sm">
                    <span>Percentage (basis points, 1000 = 10%)</span>
                    <input
                      className={cn(enterpriseFieldClass)}
                      aria-label="Percentage basis points"
                      value={percentageBps}
                      onChange={(e) => setPercentageBps(e.target.value)}
                    />
                    <span className="text-xs text-[var(--enterprise-muted,#C4D4A8)]">{COPY_OP_ORDER}</span>
                  </label>
                ) : null}
                {benefitType === "fixed_amount_discount" ? (
                  <label className="flex flex-col gap-1 text-sm">
                    <span>Fixed INR amount</span>
                    <input
                      className={cn(enterpriseFieldClass)}
                      value={fixedInr}
                      inputMode="decimal"
                      aria-label="Fixed INR amount"
                      onChange={(e) => setFixedInr(e.target.value)}
                    />
                    <span className="text-xs text-[var(--enterprise-muted,#C4D4A8)]">{COPY_OP_ORDER}</span>
                  </label>
                ) : null}
                {benefitType === "delivery_fee_waiver" ? (
                  <p className="text-sm text-[var(--enterprise-text-secondary,#EBD9A6)]">{COPY_OP_DELIVERY}</p>
                ) : null}
                {benefitType === "complimentary_item" ? (
                  <fieldset className="space-y-2">
                    <legend className="text-sm">{COPY_OP_GIFT}</legend>
                    <label className="flex flex-col gap-1 text-sm">
                      <span>Complimentary product id</span>
                      <input
                        className={cn(enterpriseFieldClass)}
                        aria-label="Complimentary product id"
                        aria-invalid={giftFieldError ? true : undefined}
                        aria-describedby={giftFieldError ? "gift-invalid-reason" : undefined}
                        value={giftProductId}
                        onChange={(e) => setGiftProductId(e.target.value)}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span>Complimentary variant id</span>
                      <input
                        className={cn(enterpriseFieldClass)}
                        aria-label="Complimentary variant id"
                        aria-invalid={giftFieldError ? true : undefined}
                        aria-describedby={giftFieldError ? "gift-invalid-reason" : undefined}
                        value={giftVariantId}
                        onChange={(e) => setGiftVariantId(e.target.value)}
                      />
                    </label>
                    {giftFieldError ? (
                      <p id="gift-invalid-reason" role="alert" className="text-sm">
                        {giftFieldError}
                      </p>
                    ) : null}
                  </fieldset>
                ) : null}
                <Button type="button" disabled={busy} onClick={() => void handleSaveBenefit()}>
                  Save benefit
                </Button>
              </fieldset>
            </>
          ) : null}

          <div
            className="text-sm text-[var(--enterprise-text-secondary,#EBD9A6)]"
            data-testid="redemption-counts"
          >
            Applications: {redemptionCounts?.applicationCount ?? 0}. Reserved:{" "}
            {redemptionCounts?.reservedCount ?? 0}. Consumed: {redemptionCounts?.consumedCount ?? 0}.
            Released: {redemptionCounts?.releasedCount ?? 0}.
          </div>

          <div className="text-sm text-[var(--enterprise-text-secondary,#EBD9A6)]">
            Current benefit:{" "}
            {benefit == null
              ? "None configured"
              : typeof benefit === "object"
                ? "Configured (server)"
                : String(benefit)}
          </div>

          <div className="flex flex-wrap gap-2">
            {promotion.status === "draft" && canCompletePromotionActivation ? (
              <Button type="button" variant="secondary" onClick={() => void openPromotionReview("active")}>
                Review &amp; activate
              </Button>
            ) : null}
            {promotion.status !== "retired" && canRetirePromotion ? (
              <Button type="button" variant="outline" onClick={() => void openPromotionReview("retired")}>
                Review &amp; retire
              </Button>
            ) : null}
          </div>

          {capabilities.couponsRead ? (
            <div className="space-y-3 border-t border-[var(--enterprise-border,#3D6026)] pt-3">
              <h4 className="text-sm font-semibold">Coupons</h4>
              {promotion.triggerType === "automatic" ? (
                <Alert tone="info" title="Coupons require a coupon-triggered Promotion">
                  This promotion uses automatic trigger type. Create or select a coupon-triggered
                  promotion to author coupons. Coupons are not valid on automatic promotions.
                </Alert>
              ) : (
                <div className="space-y-3" data-testid="coupon-authoring">
                  <ul className="space-y-2 text-sm">
                    {coupons.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          {c.canonicalCode}{" "}
                          <StatusBadge tone={statusTone(c.status)}>{c.status}</StatusBadge>
                        </span>
                        {canManageCoupon ? (
                          <div className="flex flex-wrap gap-1">
                            {c.status === "draft" ? (
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => void openCouponReview(c, "active", "activate")}
                              >
                                Activate
                              </Button>
                            ) : null}
                            {c.status === "active" ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => void openCouponReview(c, "disabled", "disable")}
                              >
                                Disable
                              </Button>
                            ) : null}
                            {c.status === "disabled" ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => void openCouponReview(c, "active", "enable")}
                              >
                                Enable
                              </Button>
                            ) : null}
                            {c.status !== "retired" ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => void openCouponReview(c, "retired", "retire")}
                              >
                                Retire
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </li>
                    ))}
                    {coupons.length === 0 ? (
                      <li className="text-[var(--enterprise-muted,#C4D4A8)]">No coupons.</li>
                    ) : null}
                  </ul>
                  {canManageCoupon ? (
                    <fieldset className="flex flex-wrap gap-2" disabled={busy}>
                      <legend className="sr-only">Create coupon</legend>
                      <input
                        className={cn(enterpriseFieldClass)}
                        placeholder="Canonical code (optional)"
                        aria-label="Coupon code"
                        value={couponCode}
                        onChange={(e) => setCouponCode(e.target.value)}
                      />
                      <Button type="button" onClick={() => void handleCreateCoupon()}>
                        Create coupon
                      </Button>
                    </fieldset>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <ConsequenceReviewDialog
        open={review !== null}
        title={
          review?.kind === "promotion" && review.proposedStatus === "retired"
            ? COPY_RETIRE_TITLE
            : "Review lifecycle effect"
        }
        draftLabel={
          review?.kind === "promotion" && review.proposedStatus === "retired"
            ? COPY_RETIRE_BODY
            : (review?.draftLabel ?? "")
        }
        effectiveLabel={review?.effectiveLabel ?? ""}
        dimensions={review?.dimensions ?? []}
        revisionLabel="Expected revision"
        revisionValue={review?.expectedRevision ?? ""}
        busy={reviewBusy}
        error={reviewError}
        confirmLabel={
          review?.kind === "promotion" && review.proposedStatus === "retired"
            ? COPY_RETIRE_CONFIRM
            : "Confirm effect"
        }
        cancelLabel={COPY_CANCEL}
        onCancel={() => {
          if (reviewBusy) return;
          const retiring = review?.kind === "promotion" && review.proposedStatus === "retired";
          setReview(null);
          props.onStatus(
            retiring ? "Retirement cancelled. The offer is still active." : "No effect — draft work remains.",
          );
        }}
        onConfirm={() => void confirmReview()}
      />
    </div>
  );
}
