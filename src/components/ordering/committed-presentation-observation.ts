/**
 * Read committed presentation nodes and POST an observation.
 * Failed POST must not roll back commerce.
 */

import { observedCoarseShapeFromCommitted } from "@/components/ordering/commercial-explanation-presentation";
import { IMP036J_COPY } from "@/components/ordering/imp036j-copy";
import { formatPaise } from "@/components/ordering/format-money";
import { commerceRequest } from "@/lib/customer-commerce/http";

export type CommittedObservation = Readonly<{
  evaluationId: string;
  reviewSurfaceToken?: string | null;
  sourceCommandId?: string | null;
  cartActivationId?: string | null;
}>;

function sha256HexUtf8(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return crypto.subtle.digest("SHA-256", bytes).then((buffer) => {
    const view = new Uint8Array(buffer);
    return [...view].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  });
}

export function readCommittedPresentation(root: ParentNode): {
  components: Array<{ kind: string; present: boolean; amountPaise: string }>;
  progressPresent: boolean;
  progressRemainingPaise: string | null;
  observedCoarseShape: string;
  observedComplimentaryPresent: boolean;
  observedComplimentaryLineSha256: string | null;
  complimentaryCanonical: string | null;
} {
  const nodes = [...root.querySelectorAll("[data-offer-component]")];
  const components: Array<{ kind: string; present: boolean; amountPaise: string }> = [];
  for (const node of nodes) {
    const kind = node.getAttribute("data-offer-component");
    const amount = node.getAttribute("data-offer-amount") ?? "0";
    const present = node.getAttribute("data-offer-present") === "true";
    if (!kind) continue;
    components.push({ kind, present, amountPaise: amount });
  }
  const progress = nodes.find((node) => node.getAttribute("data-offer-component") === "PROGRESS");
  const gift = root.querySelector("[data-complimentary-name]");
  const name = gift?.getAttribute("data-complimentary-name")?.trim() ?? "";
  const included = gift?.getAttribute("data-complimentary-included")?.trim() ?? "";
  const amountText = gift?.getAttribute("data-complimentary-amount")?.trim() ?? "";
  const complimentaryCanonical =
    name && included && amountText ? `${name}\n${included}\n${amountText}` : null;
  const status = root.querySelector("[data-observed-status]")?.getAttribute("data-observed-status") ?? null;
  return {
    components,
    progressPresent: Boolean(progress),
    progressRemainingPaise: progress?.getAttribute("data-offer-amount") || null,
    observedCoarseShape: observedCoarseShapeFromCommitted({
      complimentaryPresent: Boolean(gift),
      statusText: status,
      orderSavingPresent: components.some((row) => row.kind === "ORDER_SAVING" && row.present),
      deliverySavingPresent: components.some((row) => row.kind === "DELIVERY_SAVING" && row.present),
      thresholdPresent: Boolean(progress),
    }),
    observedComplimentaryPresent: Boolean(gift),
    observedComplimentaryLineSha256: null,
    complimentaryCanonical,
  };
}

export async function postCommittedPresentationObservation(
  root: ParentNode | null,
  input: CommittedObservation,
): Promise<void> {
  if (!root || !input.evaluationId) return;
  const committed = readCommittedPresentation(root);
  let digest = committed.observedComplimentaryLineSha256;
  if (committed.complimentaryCanonical) {
    digest = await sha256HexUtf8(committed.complimentaryCanonical);
  }
  const body: Record<string, unknown> = {
    evaluationId: input.evaluationId,
    components: committed.components,
    progressPresent: committed.progressPresent,
    progressRemainingPaise: committed.progressPresent ? committed.progressRemainingPaise : null,
    observedCoarseShape: committed.observedCoarseShape,
    observedComplimentaryPresent: committed.observedComplimentaryPresent,
    observedComplimentaryLineSha256: digest,
  };
  if (input.reviewSurfaceToken) body.reviewSurfaceToken = input.reviewSurfaceToken;
  if (input.sourceCommandId) body.sourceCommandId = input.sourceCommandId;
  if (input.cartActivationId) body.cartActivationId = input.cartActivationId;
  try {
    await commerceRequest("/api/v1/commerce-observations", {
      method: "POST",
      body,
      guestToken: true,
    });
  } catch {
    // Observation must not block commerce.
  }
}

export function complimentaryDigestPartsMatchFormatPaiseZero(): string {
  return formatPaise(0);
}

export { IMP036J_COPY };
