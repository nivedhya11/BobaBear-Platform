import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CartClient } from "./CartClient";
import { writeDeliveryContext } from "@/lib/customer-location/delivery-context";
import {
  STALE_MODIFIER_OPTION_LABEL,
} from "./cart-presentation";
import type { CustomerMenuProjection } from "@/shared/customer-menu/types";

const getActiveCart = vi.fn<(...args: unknown[]) => unknown>();
const getCustomerMenu = vi.fn<(...args: unknown[]) => unknown>();
const setCartLineQuantity = vi.fn<(...args: unknown[]) => unknown>();
const removeCartLine = vi.fn<(...args: unknown[]) => unknown>();
const updateCartLineConfiguration = vi.fn<(...args: unknown[]) => unknown>();
const evaluateCart = vi.fn<(...args: unknown[]) => unknown>();
const clearCart = vi.fn<(...args: unknown[]) => unknown>();

vi.mock("@/lib/customer-commerce", async () => {
  const actual = await vi.importActual<typeof import("@/lib/customer-commerce")>(
    "@/lib/customer-commerce",
  );
  return {
    ...actual,
    getActiveCart: (...args: unknown[]) => getActiveCart(...args),
    getCustomerMenu: (...args: unknown[]) => getCustomerMenu(...args),
    setCartLineQuantity: (...args: unknown[]) => setCartLineQuantity(...args),
    removeCartLine: (...args: unknown[]) => removeCartLine(...args),
    updateCartLineConfiguration: (...args: unknown[]) =>
      updateCartLineConfiguration(...args),
    evaluateCart: (...args: unknown[]) => evaluateCart(...args),
    clearCart: (...args: unknown[]) => clearCart(...args),
  };
});

vi.mock("@/lib/customer-commerce/ordering-outlet-context", () => ({
  resolveCustomerOrderingOutletContext: vi.fn(async (input: { coordinates?: unknown }) =>
    input.coordinates ? { kind: "indeterminate" as const } : { kind: "no_location" as const },
  ),
  menuOutletIdFromOrderingContext: (context: { kind: string; outletId?: string }) =>
    context.kind === "serviceable" ? context.outletId : undefined,
}));

const brandId = "brand-1";
const variantId = "var-1";
const bindingId = "binding-1";
const optionFree = "option-free";
const optionPaid = "option-paid";

const baseMenu: CustomerMenuProjection = {
  brandId,
  menuId: "menu-1",
  name: "Primary Menu",
  sections: [{ id: "sec-1", parentSectionId: null, name: "Drinks", position: 1 }],
  items: [
    {
      productId: "prod-1",
      variantId,
      sectionId: "sec-1",
      name: "Classic Milk Tea",
      description: null,
      imagePath: null,
      displayPricePaise: 19900,
      currency: "INR",
    },
  ],
};

function customizedMenu(): CustomerMenuProjection {
  return {
    ...baseMenu,
    items: [
      {
        ...baseMenu.items[0]!,
        modifierGroups: [
          {
            modifierGroupId: "group-1",
            variantModifierGroupId: bindingId,
            name: "Toppings",
            required: true,
            minTotalQuantity: 1,
            maxTotalQuantity: 3,
            position: 0,
            options: [
              {
                modifierOptionId: "free",
                modifierGroupOptionId: optionFree,
                name: "Regular ice",
                minQuantity: 0,
                maxQuantity: 1,
                defaultQuantity: 1,
                position: 0,
                displayPriceDeltaPaise: 0,
                currency: "INR",
              },
              {
                modifierOptionId: "paid",
                modifierGroupOptionId: optionPaid,
                name: "Pearl",
                minQuantity: 0,
                maxQuantity: 3,
                defaultQuantity: 1,
                position: 1,
                displayPriceDeltaPaise: 2000,
                currency: "INR",
              },
            ],
          },
        ],
      },
    ],
  };
}

function guestCart(
  revision: string,
  lines: ReadonlyArray<{
    id: string;
    variantId: string;
    quantity: number;
    modifiers?: ReadonlyArray<{
      variantModifierGroupId: string;
      modifierGroupOptionId: string;
      quantity: number;
    }>;
    bundleSelections?: ReadonlyArray<{
      id: string;
      bundleGroupOptionId: string;
      quantity: number;
      modifiers: readonly [];
    }>;
  }>,
) {
  return {
    id: "cart-1",
    brandId,
    ownerMode: "guest" as const,
    revision,
    manualCouponCode: null,
    expiresAt: null,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    lines: lines.map((line) => ({
      modifiers: [],
      bundleSelections: [],
      ...line,
    })),
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  getActiveCart.mockReset();
  getCustomerMenu.mockReset();
  setCartLineQuantity.mockReset();
  removeCartLine.mockReset();
  updateCartLineConfiguration.mockReset();
  evaluateCart.mockReset();
  clearCart.mockReset();
  getCustomerMenu.mockResolvedValue({ ok: true, status: 200, data: { menu: baseMenu } });
  getActiveCart.mockResolvedValue({ ok: true, status: 200, data: { cart: null } });
  evaluateCart.mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      cartId: "cart-1",
      cartRevision: "1",
      evaluatedAt: "2026-08-13T00:00:00.000Z",
      status: "REQUIRES_FULFILMENT_CONTEXT",
    },
  });
});

describe("CartClient", () => {
  it("keeps its delivery result synchronized with delivery location context", async () => {
    getActiveCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: { cart: guestCart("1", [{ id: "line-1", variantId, quantity: 1 }]) },
    });
    let resolveWithoutLocation: ((value: unknown) => void) | undefined;
    let resolveWithLocation: ((value: unknown) => void) | undefined;
    evaluateCart
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveWithoutLocation = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveWithLocation = resolve;
          }),
      );

    render(<CartClient brandId={brandId} />);
    await waitFor(() => expect(evaluateCart).toHaveBeenCalledTimes(1));
    expect(evaluateCart).toHaveBeenLastCalledWith({ brandId });

    writeDeliveryContext({
      displayLabel: "Rajpur Road, Dehradun",
      coordinates: { latitude: "30.3256000", longitude: "78.0436000" },
      source: "location_search",
    });

    await waitFor(() => expect(evaluateCart).toHaveBeenCalledTimes(2));
    expect(evaluateCart).toHaveBeenLastCalledWith({
      brandId,
      location: {
        coordinates: { latitude: "30.3256000", longitude: "78.0436000" },
      },
    });

    // Newer delivery-context evaluation completes first.
    await act(async () => {
      resolveWithLocation?.({
        ok: true,
        status: 200,
        data: {
          cartId: "cart-1",
          cartRevision: "1",
          evaluatedAt: "2026-08-13T00:00:00.000Z",
          status: "COMPLETE",
        },
      });
    });

    // Older no-location evaluation resolves later and must not overwrite.
    await act(async () => {
      resolveWithoutLocation?.({
        ok: true,
        status: 200,
        data: {
          cartId: "cart-1",
          cartRevision: "1",
          evaluatedAt: "2026-08-13T00:00:00.000Z",
          status: "REQUIRES_FULFILMENT_CONTEXT",
        },
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("Loading cart…")).not.toBeInTheDocument();
      expect(screen.getByText("This location looks deliverable.")).toBeInTheDocument();
      expect(screen.queryByText("Choose your delivery location to check availability.")).not.toBeInTheDocument();
    });
  });

  it("post-mutation evaluation uses the current delivery context, not a stale mutation closure", async () => {
    getActiveCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: { cart: guestCart("1", [{ id: "line-1", variantId, quantity: 1 }]) },
    });

    let resolveMutation: ((value: unknown) => void) | undefined;
    setCartLineQuantity.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMutation = resolve;
        }),
    );

    const evaluateResolvers: Array<(value: unknown) => void> = [];
    evaluateCart.mockImplementation(
      () =>
        new Promise((resolve) => {
          evaluateResolvers.push(resolve);
        }),
    );

    render(<CartClient brandId={brandId} />);
    await waitFor(() => expect(evaluateCart).toHaveBeenCalledTimes(1));
    expect(evaluateCart).toHaveBeenLastCalledWith({ brandId });

    await act(async () => {
      evaluateResolvers[0]!({
        ok: true,
        status: 200,
        data: {
          cartId: "cart-1",
          cartRevision: "1",
          evaluatedAt: "2026-08-13T00:00:00.000Z",
          status: "REQUIRES_FULFILMENT_CONTEXT",
        },
      });
    });

    await waitFor(() => {
      expect(
        screen.getByText("Choose your delivery location to check availability."),
      ).toBeInTheDocument();
    });

    // Mutation starts while context A (no location) is current.
    await userEvent.click(
      await screen.findByRole("button", { name: /increase classic milk tea quantity/i }),
    );
    await waitFor(() => expect(setCartLineQuantity).toHaveBeenCalled());

    // Location changes to B while the mutation is still pending.
    writeDeliveryContext({
      displayLabel: "Rajpur Road, Dehradun",
      coordinates: { latitude: "30.3256000", longitude: "78.0436000" },
      source: "location_search",
    });

    await waitFor(() => expect(evaluateCart).toHaveBeenCalledTimes(2));
    expect(evaluateCart).toHaveBeenLastCalledWith({
      brandId,
      location: {
        coordinates: { latitude: "30.3256000", longitude: "78.0436000" },
      },
    });

    // Mutation resolves later; post-mutation evaluation must use B, not A.
    await act(async () => {
      resolveMutation?.({
        ok: true,
        status: 200,
        data: { cart: guestCart("2", [{ id: "line-1", variantId, quantity: 2 }]) },
      });
    });

    await waitFor(() => expect(evaluateCart).toHaveBeenCalledTimes(3));
    expect(evaluateCart).toHaveBeenLastCalledWith({
      brandId,
      location: {
        coordinates: { latitude: "30.3256000", longitude: "78.0436000" },
      },
    });
    expect(evaluateCart.mock.calls[2]).not.toEqual([{ brandId }]);

    // B subscription result completes first.
    await act(async () => {
      evaluateResolvers[1]!({
        ok: true,
        status: 200,
        data: {
          cartId: "cart-1",
          cartRevision: "1",
          evaluatedAt: "2026-08-13T00:00:00.000Z",
          status: "COMPLETE",
        },
      });
    });

    // Newer post-mutation evaluation (also B) completes last and must keep B semantics.
    // Under the stale-closure bug this call used A and would restore REQUIRES_FULFILMENT_CONTEXT.
    await act(async () => {
      evaluateResolvers[2]!({
        ok: true,
        status: 200,
        data: {
          cartId: "cart-1",
          cartRevision: "2",
          evaluatedAt: "2026-08-13T00:00:01.000Z",
          status: "COMPLETE",
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("This location looks deliverable.")).toBeInTheDocument();
      expect(
        screen.queryByText("Choose your delivery location to check availability."),
      ).not.toBeInTheDocument();
    });
  });

  it("keeps the server cart when delivery-context generation B supersedes initial surface load A", async () => {
    const { resolveCustomerOrderingOutletContext } = await import(
      "@/lib/customer-commerce/ordering-outlet-context"
    );
    const {
      writeDeliveryContext,
      resetDeliveryContextSnapshotForTests,
    } = await import("@/lib/customer-location/delivery-context");
    window.sessionStorage.clear();
    resetDeliveryContextSnapshotForTests();

    getActiveCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: { cart: guestCart("1", [{ id: "line-1", variantId, quantity: 2 }]) },
    });

    const outletResolvers: Array<(value: unknown) => void> = [];
    vi.mocked(resolveCustomerOrderingOutletContext).mockImplementation(
      () =>
        new Promise((resolve) => {
          outletResolvers.push(resolve);
        }) as never,
    );

    writeDeliveryContext({
      displayLabel: "Context A",
      coordinates: { latitude: "30.3256000", longitude: "78.0436000" },
      source: "location_search",
    });
    render(<CartClient brandId={brandId} />);

    await waitFor(() => expect(outletResolvers.length).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(getActiveCart).toHaveBeenCalled());

    writeDeliveryContext({
      displayLabel: "Context B",
      coordinates: { latitude: "30.3300000", longitude: "78.0500000" },
      source: "location_search",
    });
    await waitFor(() => expect(outletResolvers.length).toBeGreaterThanOrEqual(2));

    // Complete B first; A is stale and must not cancel cart acquisition.
    outletResolvers[outletResolvers.length - 1]!({ kind: "indeterminate" });
    outletResolvers[0]!({ kind: "indeterminate" });

    await waitFor(() => {
      expect(screen.queryByText("Loading cart…")).not.toBeInTheDocument();
      expect(screen.getByText("Classic Milk Tea")).toBeInTheDocument();
      expect(screen.getByTestId("cart-item-count")).toHaveTextContent("2 items");
      expect(
        screen.queryByText("Your cart is empty. Browse the menu to add something."),
      ).not.toBeInTheDocument();
    });

    window.sessionStorage.clear();
    resetDeliveryContextSnapshotForTests();
    vi.mocked(resolveCustomerOrderingOutletContext).mockImplementation(async (input: {
      coordinates?: unknown;
    }) => (input.coordinates ? { kind: "indeterminate" as const } : { kind: "no_location" as const }));
  });

  it("same delivery-context generation: older cart evaluation cannot overwrite a newer one", async () => {
    getActiveCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: { cart: guestCart("1", [{ id: "line-1", variantId, quantity: 1 }]) },
    });
    setCartLineQuantity.mockResolvedValue({
      ok: true,
      status: 200,
      data: { cart: guestCart("2", [{ id: "line-1", variantId, quantity: 2 }]) },
    });

    writeDeliveryContext({
      displayLabel: "Rajpur Road, Dehradun",
      coordinates: { latitude: "30.3256000", longitude: "78.0436000" },
      source: "location_search",
    });

    const evaluateResolvers: Array<(value: unknown) => void> = [];
    evaluateCart.mockImplementation(
      () =>
        new Promise((resolve) => {
          evaluateResolvers.push(resolve);
        }),
    );

    render(<CartClient brandId={brandId} />);
    await waitFor(() => expect(evaluateResolvers.length).toBeGreaterThanOrEqual(1));
    const olderEval = evaluateResolvers[0]!;

    await userEvent.click(
      await screen.findByRole("button", { name: /increase classic milk tea quantity/i }),
    );
    await waitFor(() => expect(setCartLineQuantity).toHaveBeenCalled());
    await waitFor(() => expect(evaluateResolvers.length).toBeGreaterThanOrEqual(2));
    const newerEval = evaluateResolvers[evaluateResolvers.length - 1]!;

    await act(async () => {
      newerEval({
        ok: true,
        status: 200,
        data: {
          cartId: "cart-1",
          cartRevision: "2",
          evaluatedAt: "2026-08-13T00:00:01.000Z",
          status: "COMPLETE",
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText("This location looks deliverable.")).toBeInTheDocument();
    });

    await act(async () => {
      olderEval({
        ok: true,
        status: 200,
        data: {
          cartId: "cart-1",
          cartRevision: "1",
          evaluatedAt: "2026-08-13T00:00:00.000Z",
          status: "CART_INVALID",
          failures: [{ code: "CART_INVALID", message: "stale older cart" }],
        },
      });
    });

    expect(screen.getByText("This location looks deliverable.")).toBeInTheDocument();
    expect(screen.queryByText(/stale older cart/i)).not.toBeInTheDocument();
  });

  it("loads Customer Menu instead of static ordering catalog for presentation", async () => {
    getActiveCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        cart: guestCart("1", [{ id: "line-1", variantId, quantity: 1 }]),
      },
    });
    render(<CartClient brandId={brandId} />);
    await waitFor(() => expect(getCustomerMenu).toHaveBeenCalledWith({ brandId }));
    expect(screen.getByText("Classic Milk Tea")).toBeInTheDocument();
    expect(screen.getByText(/₹199\.00 each/i)).toBeInTheDocument();
    expect(screen.queryByText(/menu price/i)).not.toBeInTheDocument();
  });

  it("renders the Customer Menu thumbnail when present and safely retains a placeholder when absent", async () => {
    getCustomerMenu.mockResolvedValue({
      ok: true,
      status: 200,
      data: { menu: { ...baseMenu, items: [{ ...baseMenu.items[0]!, imagePath: "/items/milk-tea.jpg" }] } },
    });
    getActiveCart.mockResolvedValue({
      ok: true, status: 200, data: { cart: guestCart("1", [{ id: "line-1", variantId, quantity: 1 }]) },
    });
    const { rerender } = render(<CartClient brandId={brandId} />);
    await waitFor(() => expect(document.querySelector('img[src="/items/milk-tea.jpg"]')).toBeInTheDocument());
    getCustomerMenu.mockResolvedValue({ ok: true, status: 200, data: { menu: baseMenu } });
    rerender(<CartClient brandId={`${brandId}-other`} />);
    await waitFor(() => expect(screen.getByText("Classic Milk Tea")).toBeInTheDocument());
    expect(document.querySelector('img[src="/items/milk-tea.jpg"]')).not.toBeInTheDocument();
  });

  it("shows one Estimated subtotal label in the mobile sticky checkout region", async () => {
    getActiveCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: { cart: guestCart("1", [{ id: "line-1", variantId, quantity: 2 }]) },
    });
    render(<CartClient brandId={brandId} />);
    await waitFor(() => expect(screen.getByText("Classic Milk Tea")).toBeInTheDocument());

    const mobileCheckout = screen.getByTestId("cart-mobile-checkout");
    expect(within(mobileCheckout).getAllByText(/^Estimated subtotal$/i)).toHaveLength(1);
    expect(within(mobileCheckout).getByText("₹398.00")).toBeInTheDocument();
    expect(within(mobileCheckout).queryByText(/Estimated subtotal ₹398\.00/i)).not.toBeInTheDocument();
  });

  it("renders plain non-customizable cart item from Customer Menu", async () => {
    getActiveCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: { cart: guestCart("1", [{ id: "line-1", variantId, quantity: 2 }]) },
    });
    render(<CartClient brandId={brandId} />);
    await waitFor(() => expect(screen.getByText("Classic Milk Tea")).toBeInTheDocument());
    expect(screen.getByTestId("cart-item-count")).toHaveTextContent("2 items");
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getAllByText(/^Estimated subtotal$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("₹398.00").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Total payable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/2 items · Estimated subtotal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/menu prices/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cart total \(menu prices\)/i)).not.toBeInTheDocument();
  });

  it("clears the full cart from its header through the existing clearCart mutation", async () => {
    getActiveCart.mockResolvedValue({
      ok: true, status: 200, data: { cart: guestCart("1", [{ id: "line-1", variantId, quantity: 1 }]) },
    });
    clearCart.mockResolvedValue({ ok: true, status: 200, data: { cart: guestCart("2", []) } });
    render(<CartClient brandId={brandId} />);
    await userEvent.click(await screen.findByRole("button", { name: "Clear cart" }));
    await waitFor(() => expect(clearCart).toHaveBeenCalledWith({ brandId, expectedRevision: "1" }));
    expect(screen.getByText("Your cart is empty. Browse the menu to add something.")).toBeInTheDocument();
  });

  it("shows Estimated subtotal when base menu item is missing", async () => {
    getActiveCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        cart: guestCart("1", [{ id: "line-1", variantId: "missing-variant", quantity: 1 }]),
      },
    });
    render(<CartClient brandId={brandId} />);
    await waitFor(() =>
      expect(
        within(screen.getByTestId("cart-order-summary")).getByText(/Estimated subtotal/i),
      ).toBeInTheDocument(),
    );
    expect(
      within(screen.getByTestId("cart-order-summary")).queryByText(/Total payable/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Total shown at checkout")).not.toBeInTheDocument();
  });

  it("renders configured modifier group and option with quantity and price delta", async () => {
    getCustomerMenu.mockResolvedValue({
      ok: true,
      status: 200,
      data: { menu: customizedMenu() },
    });
    getActiveCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        cart: guestCart("1", [
          {
            id: "line-1",
            variantId,
            quantity: 1,
            modifiers: [
              { variantModifierGroupId: bindingId, modifierGroupOptionId: optionPaid, quantity: 2 },
            ],
          },
        ]),
      },
    });
    render(<CartClient brandId={brandId} />);
    await waitFor(() => expect(screen.getByText("Toppings")).toBeInTheDocument());
    expect(screen.getByText(/Pearl × 2/i)).toBeInTheDocument();
    expect(screen.getByText("+₹40.00")).toBeInTheDocument();
  });

  it("keeps same-variant configured lines distinct and keyed by cartLineId", async () => {
    getCustomerMenu.mockResolvedValue({
      ok: true,
      status: 200,
      data: { menu: customizedMenu() },
    });
    getActiveCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        cart: guestCart("1", [
          {
            id: "line-a",
            variantId,
            quantity: 1,
            modifiers: [
              { variantModifierGroupId: bindingId, modifierGroupOptionId: optionPaid, quantity: 1 },
            ],
          },
          {
            id: "line-b",
            variantId,
            quantity: 1,
            modifiers: [
              { variantModifierGroupId: bindingId, modifierGroupOptionId: optionFree, quantity: 1 },
            ],
          },
        ]),
      },
    });
    render(<CartClient brandId={brandId} />);
    await waitFor(() => expect(screen.getAllByText("Classic Milk Tea")).toHaveLength(2));
    expect(screen.getByText("Pearl")).toBeInTheDocument();
    expect(screen.getByText("Regular ice")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /decrease classic milk tea quantity/i })).toHaveLength(
      2,
    );
  });

  it("exposes edit for fully resolved customizable lines and opens customization dialog", async () => {
    getCustomerMenu.mockResolvedValue({
      ok: true,
      status: 200,
      data: { menu: customizedMenu() },
    });
    getActiveCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        cart: guestCart("1", [
          {
            id: "line-1",
            variantId,
            quantity: 1,
            modifiers: [
              { variantModifierGroupId: bindingId, modifierGroupOptionId: optionPaid, quantity: 1 },
            ],
          },
        ]),
      },
    });
    render(<CartClient brandId={brandId} />);
    await userEvent.click(await screen.findByRole("button", { name: /edit customization for classic milk tea/i }));
    const dialog = screen.getByRole("dialog", { name: /edit customization for classic milk tea/i });
    expect(within(dialog).getByRole("button", { name: "Increase Pearl" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Decrease Pearl" })).toBeEnabled();
  });

  it("initializes edit mode from persisted cart intent without paid catalog defaults", async () => {
    getCustomerMenu.mockResolvedValue({
      ok: true,
      status: 200,
      data: { menu: customizedMenu() },
    });
    getActiveCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        cart: guestCart("1", [
          {
            id: "line-1",
            variantId,
            quantity: 1,
            modifiers: [
              { variantModifierGroupId: bindingId, modifierGroupOptionId: optionFree, quantity: 1 },
            ],
          },
        ]),
      },
    });
    render(<CartClient brandId={brandId} />);
    await userEvent.click(await screen.findByRole("button", { name: /edit customization for classic milk tea/i }));
    const dialog = screen.getByRole("dialog", { name: /edit customization for classic milk tea/i });
    expect(within(dialog).getByRole("button", { name: "Increase Pearl" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Decrease Pearl" })).toBeDisabled();
    expect(within(dialog).getByRole("checkbox", { name: /regular ice/i })).toBeChecked();
  });

  it("does not apply zero-price catalog defaults absent from persisted cart intent in edit mode", async () => {
    const menuWithoutPersistedFree: CustomerMenuProjection = {
      ...customizedMenu(),
      items: [
        {
          ...customizedMenu().items[0]!,
          modifierGroups: [
            {
              ...customizedMenu().items[0]!.modifierGroups![0]!,
              options: customizedMenu().items[0]!.modifierGroups![0]!.options.map((option) =>
                option.modifierGroupOptionId === optionFree
                  ? { ...option, defaultQuantity: 1 }
                  : option,
              ),
            },
          ],
        },
      ],
    };
    getCustomerMenu.mockResolvedValue({
      ok: true,
      status: 200,
      data: { menu: menuWithoutPersistedFree },
    });
    getActiveCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        cart: guestCart("1", [
          {
            id: "line-1",
            variantId,
            quantity: 1,
            modifiers: [],
          },
        ]),
      },
    });
    render(<CartClient brandId={brandId} />);
    await userEvent.click(await screen.findByRole("button", { name: /edit customization for classic milk tea/i }));
    expect(screen.getByRole("checkbox", { name: /regular ice/i })).not.toBeChecked();
  });

  it("preserves bundleSelections in modifier-only edit submission", async () => {
    getCustomerMenu.mockResolvedValue({
      ok: true,
      status: 200,
      data: { menu: customizedMenu() },
    });
    getActiveCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        cart: guestCart("1", [
          {
            id: "line-1",
            variantId,
            quantity: 1,
            modifiers: [
              { variantModifierGroupId: bindingId, modifierGroupOptionId: optionFree, quantity: 1 },
            ],
            bundleSelections: [
              {
                id: "bundle-child-id",
                bundleGroupOptionId: "bundle-opt-1",
                quantity: 1,
                modifiers: [],
              },
            ],
          },
        ]),
      },
    });
    render(<CartClient brandId={brandId} />);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /edit customization for classic milk tea/i }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/bundle configuration preserved/i)).toBeInTheDocument();
  });

  it("saves edited configuration, updates cart from response, and closes dialog", async () => {
    getCustomerMenu.mockResolvedValue({
      ok: true,
      status: 200,
      data: { menu: customizedMenu() },
    });
    getActiveCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        cart: guestCart("1", [
          {
            id: "line-1",
            variantId,
            quantity: 1,
            modifiers: [
              { variantModifierGroupId: bindingId, modifierGroupOptionId: optionFree, quantity: 1 },
            ],
          },
        ]),
      },
    });
    updateCartLineConfiguration.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        cart: guestCart("2", [
          {
            id: "line-1",
            variantId,
            quantity: 1,
            modifiers: [
              { variantModifierGroupId: bindingId, modifierGroupOptionId: optionPaid, quantity: 1 },
              { variantModifierGroupId: bindingId, modifierGroupOptionId: optionFree, quantity: 1 },
            ],
          },
        ]),
      },
    });
    render(<CartClient brandId={brandId} />);
    await userEvent.click(await screen.findByRole("button", { name: /edit customization for classic milk tea/i }));
    await userEvent.click(screen.getByRole("button", { name: "Increase Pearl" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(updateCartLineConfiguration).toHaveBeenCalledWith({
        brandId,
        cartLineId: "line-1",
        variantId,
        expectedRevision: "1",
        modifiers: [
          { variantModifierGroupId: bindingId, modifierGroupOptionId: optionFree, quantity: 1 },
          { variantModifierGroupId: bindingId, modifierGroupOptionId: optionPaid, quantity: 1 },
        ],
        bundleSelections: [],
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("Pearl")).toBeInTheDocument();
  });

  it("keeps dialog open with local edits after failed save", async () => {
    getCustomerMenu.mockResolvedValue({
      ok: true,
      status: 200,
      data: { menu: customizedMenu() },
    });
    getActiveCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        cart: guestCart("1", [
          {
            id: "line-1",
            variantId,
            quantity: 1,
            modifiers: [
              { variantModifierGroupId: bindingId, modifierGroupOptionId: optionFree, quantity: 1 },
            ],
          },
        ]),
      },
    });
    updateCartLineConfiguration.mockResolvedValueOnce({
      ok: false,
      code: "CART_REVISION_CONFLICT",
      status: 409,
    });
    render(<CartClient brandId={brandId} />);
    await userEvent.click(await screen.findByRole("button", { name: /edit customization for classic milk tea/i }));
    await userEvent.click(screen.getByRole("button", { name: "Increase Pearl" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /edit customization for classic milk tea/i })).toBeInTheDocument(),
    );
    const dialog = screen.getByRole("dialog", { name: /edit customization for classic milk tea/i });
    expect(within(dialog).getByRole("button", { name: "Increase Pearl" })).toBeEnabled();
  });

  it("handles coalesced edit response without assuming edited line id survives", async () => {
    getCustomerMenu.mockResolvedValue({
      ok: true,
      status: 200,
      data: { menu: customizedMenu() },
    });
    getActiveCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        cart: guestCart("1", [
          {
            id: "line-edit",
            variantId,
            quantity: 1,
            modifiers: [
              { variantModifierGroupId: bindingId, modifierGroupOptionId: optionPaid, quantity: 1 },
            ],
          },
          {
            id: "line-existing",
            variantId,
            quantity: 2,
            modifiers: [
              { variantModifierGroupId: bindingId, modifierGroupOptionId: optionPaid, quantity: 1 },
            ],
          },
        ]),
      },
    });
    updateCartLineConfiguration.mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: {
        cart: guestCart("2", [
          {
            id: "line-existing",
            variantId,
            quantity: 3,
            modifiers: [
              { variantModifierGroupId: bindingId, modifierGroupOptionId: optionPaid, quantity: 1 },
            ],
          },
        ]),
      },
    });
    render(<CartClient brandId={brandId} />);
    const editButtons = await screen.findAllByRole("button", {
      name: /edit customization for classic milk tea/i,
    });
    await userEvent.click(editButtons[0]!);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByText("line-edit")).not.toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("uses quantity mutation without configuration replacement", async () => {
    getActiveCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        cart: guestCart("1", [{ id: "line-1", variantId, quantity: 1 }]),
      },
    });
    setCartLineQuantity.mockResolvedValue({
      ok: true,
      status: 200,
      data: { cart: guestCart("2", [{ id: "line-1", variantId, quantity: 2 }]) },
    });
    render(<CartClient brandId={brandId} />);
    await userEvent.click(await screen.findByRole("button", { name: /increase classic milk tea quantity/i }));
    await waitFor(() =>
      expect(setCartLineQuantity).toHaveBeenCalledWith({
        brandId,
        cartLineId: "line-1",
        quantity: 2,
        expectedRevision: "1",
      }),
    );
    expect(updateCartLineConfiguration).not.toHaveBeenCalled();
  });

  it("shows stale modifier presentation and offers edit recovery", async () => {
    getCustomerMenu.mockResolvedValue({
      ok: true,
      status: 200,
      data: { menu: customizedMenu() },
    });
    getActiveCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        cart: guestCart("1", [
          {
            id: "line-stale",
            variantId,
            quantity: 1,
            modifiers: [
              {
                variantModifierGroupId: "00000000-0000-4000-8000-000000000001",
                modifierGroupOptionId: "00000000-0000-4000-8000-000000000002",
                quantity: 2,
              },
            ],
          },
        ]),
      },
    });
    render(<CartClient brandId={brandId} />);
    expect(
      await screen.findByText(/Previously selected option is no longer available/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Previously selected option is no longer available × 2/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /edit customization for classic milk tea/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove classic milk tea from cart/i })).toBeInTheDocument();
  });

  it("disables checkout when evaluation is CART_INVALID and shows non-location copy", async () => {
    getActiveCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: { cart: guestCart("1", [{ id: "line-1", variantId, quantity: 1 }]) },
    });
    evaluateCart.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        cartId: "cart-1",
        cartRevision: "1",
        evaluatedAt: "2026-08-13T00:00:00.000Z",
        status: "CART_INVALID",
        problems: [{ cartLineId: "line-1", code: "LINE_VARIANT_UNAVAILABLE" }],
      },
    });
    writeDeliveryContext({
      displayLabel: "Rajpur Road",
      coordinates: { latitude: "30.3256000", longitude: "78.0436000" },
      source: "location_search",
    });

    render(<CartClient brandId={brandId} />);
    expect(
      await screen.findByText(/Some items in your cart aren't available right now/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("cart-evaluation-problems")).toHaveTextContent(
      "That item can't be ordered right now.",
    );
    const checkoutButtons = screen.getAllByRole("button", { name: "Checkout" });
    for (const button of checkoutButtons) {
      expect(button).toBeDisabled();
    }
  });
});
