"use client";

import { useEffect, useId, useRef } from "react";

import { Button } from "@/components/ui/Button";
import { enterpriseFocusRingClass } from "@/components/enterprise/enterprise-tokens";
import { cn } from "@/lib/utils";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type ConsequenceReviewDialogProps = Readonly<{
  open: boolean;
  title: string;
  draftLabel: string;
  effectiveLabel: string;
  dimensions: readonly Readonly<{ label: string; value: string }>[];
  revisionLabel: string;
  revisionValue: string;
  blockers?: readonly string[];
  wouldChange?: boolean;
  noOpHint?: string;
  busy?: boolean;
  error?: string | null;
  confirmLabel?: string;
  cancelLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}>;

export function ConsequenceReviewDialog(props: ConsequenceReviewDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(props.busy === true);
  const confirmLabel = props.confirmLabel ?? "Confirm effect";
  const cancelLabel = props.cancelLabel ?? "Cancel";

  useEffect(() => {
    busyRef.current = props.busy === true;
  }, [props.busy]);

  useEffect(() => {
    if (!props.open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusables = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const initial = focusables();
    const preferred =
      initial.find((el) => el.getAttribute("data-dialog-primary") === "true") ?? initial[0];
    preferred?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (busyRef.current) return;
        props.onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreFocusRef.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open-scoped focus trap
  }, [props.open]);

  if (!props.open) return null;

  const blockers = props.blockers ?? [];
  const blocked = blockers.length > 0;
  const wouldChange = props.wouldChange !== false;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-lg border border-[var(--enterprise-border,#3D6026)] bg-[var(--enterprise-bg-panel,#22361A)] p-6 shadow-xl"
        data-testid="consequence-review-dialog"
      >
        <h2
          id={titleId}
          className="text-xl font-semibold text-[var(--enterprise-text-primary,#FAF3E2)]"
        >
          {props.title}
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-[var(--enterprise-border,#3D6026)] bg-[var(--bg-surface,#2E4720)] px-3 py-2">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--enterprise-muted,#C4D4A8)]">
              Draft
            </p>
            <p className="mt-1 text-sm text-[var(--enterprise-text-primary,#FAF3E2)]">
              {props.draftLabel}
            </p>
          </div>
          <div className="rounded-md border border-[var(--enterprise-border,#3D6026)] bg-[var(--bg-surface,#2E4720)] px-3 py-2">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--enterprise-muted,#C4D4A8)]">
              Effective (customer)
            </p>
            <p className="mt-1 text-sm text-[var(--enterprise-text-primary,#FAF3E2)]">
              {props.effectiveLabel}
            </p>
          </div>
        </div>

        {props.dimensions.length > 0 ? (
          <dl className="space-y-2 text-sm">
            {props.dimensions.map((dim) => (
              <div key={dim.label} className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
                <dt className="text-[var(--enterprise-text-secondary,#EBD9A6)]">{dim.label}</dt>
                <dd className="font-medium text-[var(--enterprise-text-primary,#FAF3E2)]">
                  {dim.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        <p className="text-sm text-[var(--enterprise-text-secondary,#EBD9A6)]">
          <span className="font-semibold text-[var(--enterprise-text-primary,#FAF3E2)]">
            {props.revisionLabel}:
          </span>{" "}
          <code className="text-xs">{props.revisionValue}</code>
        </p>

        {blocked ? (
          <div role="alert" className="space-y-1 rounded-md border border-rose-500/50 bg-rose-950/45 px-3 py-2 text-sm text-rose-100">
            <p className="font-semibold">Cannot proceed</p>
            <ul className="list-disc pl-5">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {!blocked && !wouldChange && props.noOpHint ? (
          <p className="text-sm text-[var(--enterprise-muted,#C4D4A8)]">{props.noOpHint}</p>
        ) : null}

        {props.error ? (
          <p role="alert" className="rounded-md border border-rose-500/50 bg-rose-950/45 px-3 py-2 text-sm text-rose-100">
            {props.error}
          </p>
        ) : null}

        {props.busy ? (
          <p aria-live="polite" className="text-sm text-[var(--enterprise-muted,#C4D4A8)]">
            Applying…
          </p>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={props.busy}
            className={cn(enterpriseFocusRingClass)}
            onClick={props.onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={props.busy || blocked}
            aria-busy={props.busy}
            data-dialog-primary="true"
            className={cn(enterpriseFocusRingClass)}
            onClick={props.onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
