import { describe, expect, it } from "vitest";

import { compareCommercialPresentation } from "./compare-presentation";

function expected(overrides?: Partial<Parameters<typeof compareCommercialPresentation>[0]["expected"]>) {
  return {
    surfaceScope: "CART" as const,
    expectedComponents: [
      { kind: "ORDER_SAVING" as const, present: true, amountPaise: "8000" },
      { kind: "DELIVERY_SAVING" as const, present: false, amountPaise: "0" },
      { kind: "TOTAL_SAVED" as const, present: true, amountPaise: "8000" },
      { kind: "ESTIMATED_SUBTOTAL" as const, present: true, amountPaise: "19900" },
      { kind: "TOTAL_PAYABLE" as const, present: false, amountPaise: "0" },
      { kind: "CURRENT_CHECKOUT_TOTAL" as const, present: false, amountPaise: "0" },
      { kind: "DELIVERY_CHARGE" as const, present: false, amountPaise: "0" },
      { kind: "PROGRESS" as const, present: false, amountPaise: "0" },
    ],
    expectedTotalSavedPaise: "8000",
    expectedProgressPresent: false,
    expectedProgressRemainingPaise: null,
    expectedCoarseShape: "ORDER_SAVING",
    projectedComplimentaryLineSha256Hex: null,
    expectedComplimentaryPresent: false,
    serverExplanationIntegrity: true,
    ...overrides,
  };
}

describe("compareCommercialPresentation", () => {
  it("matches a faithful ₹80 order-saving Cart render", () => {
    const result = compareCommercialPresentation({
      surface: "CART",
      expected: expected(),
      observed: {
        components: [
          { kind: "ORDER_SAVING", present: true, amountPaise: "8000" },
          { kind: "TOTAL_SAVED", present: true, amountPaise: "8000" },
          { kind: "ESTIMATED_SUBTOTAL", present: true, amountPaise: "19900" },
        ],
        progressPresent: false,
        progressRemainingPaise: null,
        observedCoarseShape: "ORDER_SAVING",
        observedComplimentaryPresent: false,
        observedComplimentaryLineSha256Hex: null,
      },
    });
    expect(result.mismatchFlags).toEqual([]);
    expect(result.serverPresentationMatch).toBe(true);
  });

  it("detects expected ₹80 rendered as ₹8", () => {
    const result = compareCommercialPresentation({
      surface: "CART",
      expected: expected(),
      observed: {
        components: [
          { kind: "ORDER_SAVING", present: true, amountPaise: "800" },
          { kind: "TOTAL_SAVED", present: true, amountPaise: "8000" },
          { kind: "ESTIMATED_SUBTOTAL", present: true, amountPaise: "19900" },
        ],
        progressPresent: false,
        progressRemainingPaise: null,
        observedCoarseShape: "ORDER_SAVING",
        observedComplimentaryPresent: false,
        observedComplimentaryLineSha256Hex: null,
      },
    });
    expect(result.mismatchFlags).toContain("WRONG_AMOUNT");
    expect(result.serverPresentationMatch).toBe(false);
  });

  it("detects omitted and extra saving rows", () => {
    const omitted = compareCommercialPresentation({
      surface: "CART",
      expected: expected(),
      observed: {
        components: [{ kind: "ESTIMATED_SUBTOTAL", present: true, amountPaise: "19900" }],
        progressPresent: false,
        progressRemainingPaise: null,
        observedCoarseShape: "ORDER_SAVING",
        observedComplimentaryPresent: false,
        observedComplimentaryLineSha256Hex: null,
      },
    });
    expect(omitted.mismatchFlags).toContain("OMITTED_ROW");

    const extra = compareCommercialPresentation({
      surface: "CART",
      expected: expected({
        expectedComponents: expected().expectedComponents.map((row) =>
          row.kind === "ORDER_SAVING" || row.kind === "TOTAL_SAVED"
            ? { ...row, present: false, amountPaise: "0" }
            : row,
        ),
        expectedTotalSavedPaise: "0",
        expectedCoarseShape: "NONE",
      }),
      observed: {
        components: [
          { kind: "ORDER_SAVING", present: true, amountPaise: "8000" },
          { kind: "ESTIMATED_SUBTOTAL", present: true, amountPaise: "19900" },
        ],
        progressPresent: false,
        progressRemainingPaise: null,
        observedCoarseShape: "NONE",
        observedComplimentaryPresent: false,
        observedComplimentaryLineSha256Hex: null,
      },
    });
    expect(extra.mismatchFlags).toContain("EXTRA_ROW");
  });

  it("detects wrong component, wrong total saved, and forbidden Cart Total payable", () => {
    const swapped = compareCommercialPresentation({
      surface: "CART",
      expected: expected(),
      observed: {
        components: [
          { kind: "DELIVERY_SAVING", present: true, amountPaise: "8000" },
          { kind: "TOTAL_SAVED", present: true, amountPaise: "4000" },
          { kind: "ESTIMATED_SUBTOTAL", present: true, amountPaise: "19900" },
          { kind: "TOTAL_PAYABLE", present: true, amountPaise: "19900" },
        ],
        progressPresent: false,
        progressRemainingPaise: null,
        observedCoarseShape: "ORDER_SAVING",
        observedComplimentaryPresent: false,
        observedComplimentaryLineSha256Hex: null,
      },
    });
    expect(swapped.mismatchFlags).toContain("WRONG_COMPONENT");
    expect(swapped.mismatchFlags).toContain("WRONG_TOTAL_SAVED");
  });
});
