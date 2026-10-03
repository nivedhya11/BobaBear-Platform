/**
 * Server comparison of expected vs observed commercial presentation.
 * Does not set payable. Browser cannot write match flags.
 */

export const OBSERVED_COMPONENT_KINDS = [
  "ORDER_SAVING",
  "DELIVERY_SAVING",
  "TOTAL_SAVED",
  "ESTIMATED_SUBTOTAL",
  "TOTAL_PAYABLE",
  "CURRENT_CHECKOUT_TOTAL",
  "DELIVERY_CHARGE",
  "PROGRESS",
] as const;

export type ObservedComponentKind = (typeof OBSERVED_COMPONENT_KINDS)[number];

export type ObservedComponent = Readonly<{
  kind: ObservedComponentKind;
  present: boolean;
  amountPaise: string;
}>;

export type PresentationSurface = "CART" | "CHECKOUT_REVIEW";

export type ExpectedPresentation = Readonly<{
  surfaceScope: "CART" | "CHECKOUT";
  expectedComponents: readonly ObservedComponent[];
  expectedTotalSavedPaise: string;
  expectedProgressPresent: boolean;
  expectedProgressRemainingPaise: string | null;
  expectedCoarseShape: string;
  projectedComplimentaryLineSha256Hex: string | null;
  expectedComplimentaryPresent: boolean;
  serverExplanationIntegrity: boolean;
}>;

export type ObservedPresentation = Readonly<{
  components: readonly ObservedComponent[];
  progressPresent: boolean;
  progressRemainingPaise: string | null;
  observedCoarseShape: string;
  observedComplimentaryPresent: boolean;
  observedComplimentaryLineSha256Hex: string | null;
}>;

export type MismatchFlag =
  | "WRONG_AMOUNT"
  | "OMITTED_ROW"
  | "EXTRA_ROW"
  | "WRONG_COMPONENT"
  | "WRONG_COMPLIMENTARY_ITEM"
  | "WRONG_TOTAL_SAVED"
  | "WRONG_ZERO_STATE"
  | "WRONG_SHAPE"
  | "PROGRESS_MISMATCH";

const SAVING_KINDS = ["ORDER_SAVING", "DELIVERY_SAVING", "TOTAL_SAVED"] as const;

function presentMap(
  rows: readonly ObservedComponent[],
): Map<ObservedComponentKind, ObservedComponent> {
  const map = new Map<ObservedComponentKind, ObservedComponent>();
  for (const row of rows) {
    map.set(row.kind, row);
  }
  return map;
}

function isPresent(row: ObservedComponent | undefined): boolean {
  return row?.present === true;
}

function paiseOf(row: ObservedComponent | undefined): string {
  return row?.amountPaise ?? "0";
}

export function compareCommercialPresentation(input: {
  surface: PresentationSurface;
  expected: ExpectedPresentation;
  observed: ObservedPresentation;
}): Readonly<{
  mismatchFlags: readonly MismatchFlag[];
  serverPresentationMatch: boolean;
}> {
  const flags = new Set<MismatchFlag>();
  const expected = presentMap(input.expected.expectedComponents);
  const observed = presentMap(input.observed.components);

  const requiredLabel: ObservedComponentKind =
    input.surface === "CHECKOUT_REVIEW"
      ? "TOTAL_PAYABLE"
      : input.expected.surfaceScope === "CHECKOUT"
        ? "CURRENT_CHECKOUT_TOTAL"
        : "ESTIMATED_SUBTOTAL";
  const forbiddenLabels: readonly ObservedComponentKind[] =
    input.surface === "CHECKOUT_REVIEW"
      ? ["ESTIMATED_SUBTOTAL", "CURRENT_CHECKOUT_TOTAL"]
      : input.expected.surfaceScope === "CHECKOUT"
        ? ["ESTIMATED_SUBTOTAL", "TOTAL_PAYABLE"]
        : ["CURRENT_CHECKOUT_TOTAL", "TOTAL_PAYABLE"];

  if (!isPresent(observed.get(requiredLabel))) {
    flags.add("OMITTED_ROW");
  } else if (paiseOf(observed.get(requiredLabel)) !== paiseOf(expected.get(requiredLabel))) {
    flags.add("WRONG_AMOUNT");
  }
  for (const kind of forbiddenLabels) {
    if (isPresent(observed.get(kind))) flags.add("WRONG_COMPONENT");
  }

  const expectedOrder = isPresent(expected.get("ORDER_SAVING"));
  const expectedDelivery = isPresent(expected.get("DELIVERY_SAVING"));
  const observedOrder = isPresent(observed.get("ORDER_SAVING"));
  const observedDelivery = isPresent(observed.get("DELIVERY_SAVING"));
  if (
    (expectedOrder && !observedOrder && observedDelivery && !expectedDelivery) ||
    (expectedDelivery && !observedDelivery && observedOrder && !expectedOrder)
  ) {
    flags.add("WRONG_COMPONENT");
  }

  for (const kind of SAVING_KINDS) {
    const exp = expected.get(kind);
    const obs = observed.get(kind);
    if (isPresent(exp) && !isPresent(obs)) flags.add("OMITTED_ROW");
    if (!isPresent(exp) && isPresent(obs)) flags.add("EXTRA_ROW");
    if (isPresent(exp) && isPresent(obs) && paiseOf(exp) !== paiseOf(obs)) {
      flags.add(kind === "TOTAL_SAVED" ? "WRONG_TOTAL_SAVED" : "WRONG_AMOUNT");
    }
  }

  const expectedSavedPositive = BigInt(input.expected.expectedTotalSavedPaise || "0") > BigInt(0);
  const observedSavingRow =
    observedOrder || observedDelivery || isPresent(observed.get("TOTAL_SAVED"));
  if (
    (!expectedSavedPositive && observedSavingRow) ||
    (expectedSavedPositive && !observedSavingRow)
  ) {
    flags.add("WRONG_ZERO_STATE");
  }

  if (input.expected.expectedCoarseShape !== input.observed.observedCoarseShape) {
    flags.add("WRONG_SHAPE");
  }

  if (
    input.expected.expectedProgressPresent !== input.observed.progressPresent ||
    (input.expected.expectedProgressPresent &&
      input.observed.progressPresent &&
      (input.expected.expectedProgressRemainingPaise ?? null) !==
        (input.observed.progressRemainingPaise ?? null))
  ) {
    flags.add("PROGRESS_MISMATCH");
  }

  if (
    input.expected.expectedComplimentaryPresent !==
      input.observed.observedComplimentaryPresent ||
    (input.expected.projectedComplimentaryLineSha256Hex ?? null) !==
      (input.observed.observedComplimentaryLineSha256Hex ?? null)
  ) {
    flags.add("WRONG_COMPLIMENTARY_ITEM");
  }

  const mismatchFlags = Object.freeze([...flags]);
  return Object.freeze({
    mismatchFlags,
    serverPresentationMatch:
      mismatchFlags.length === 0 && input.expected.serverExplanationIntegrity === true,
  });
}
