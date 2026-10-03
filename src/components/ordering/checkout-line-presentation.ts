/**
 * Safe narrowing for checkout snapshot line rows (client presentation).
 */

export type CheckoutSnapshotLineRow = Readonly<{
  productName: string;
  variantName: string;
  quantity: number;
  lineTotalPaise: string;
  lineOrigin?: "cart" | "complimentary_offer";
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function narrowCheckoutSnapshotLines(
  lines: readonly unknown[],
): readonly CheckoutSnapshotLineRow[] {
  const rows: CheckoutSnapshotLineRow[] = [];
  for (const raw of lines) {
    if (!isRecord(raw)) continue;
    const productName = typeof raw.productName === "string" ? raw.productName : null;
    const variantName = typeof raw.variantName === "string" ? raw.variantName : "";
    const quantity = typeof raw.quantity === "number" ? raw.quantity : null;
    const lineTotalPaise =
      typeof raw.lineTotalPaise === "string"
        ? raw.lineTotalPaise
        : typeof raw.lineTotalMinor === "string"
          ? raw.lineTotalMinor
          : null;
    if (!productName || quantity === null || !lineTotalPaise) continue;
    rows.push(
      Object.freeze({
        productName,
        variantName,
        quantity,
        lineTotalPaise,
        lineOrigin:
          raw.lineOrigin === "complimentary_offer" ? "complimentary_offer" : "cart",
      }),
    );
  }
  return Object.freeze(rows);
}
