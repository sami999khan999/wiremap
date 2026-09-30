import { cn } from "../class-name/index.js";
import type { ReactNode } from "../import.js";

// Named after what they mean rather than what colour they are — `danger`, not `red`.
// See `CalloutTone`, which is the same decision.
export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

export interface StatusBadgeProps {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
  readonly className?: string;
}

// Tinted, never solid: --success (3.54:1) and --warning (2.62:1) are not text colours, so
// the tone is mixed into --surface and the text stays --fg, above 13:1 everywhere.
const TONE: Readonly<Record<BadgeTone, string>> = Object.freeze({
  neutral: "border-border bg-muted",
  accent:
    "border-[color-mix(in_oklch,var(--primary)_32%,var(--border))] bg-[color-mix(in_oklch,var(--primary)_14%,var(--surface))]",
  success:
    "border-[color-mix(in_oklch,var(--success)_32%,var(--border))] bg-[color-mix(in_oklch,var(--success)_14%,var(--surface))]",
  warning:
    "border-[color-mix(in_oklch,var(--warning)_32%,var(--border))] bg-[color-mix(in_oklch,var(--warning)_14%,var(--surface))]",
  danger:
    "border-[color-mix(in_oklch,var(--danger)_32%,var(--border))] bg-[color-mix(in_oklch,var(--danger)_14%,var(--surface))]",
});

// No status vocabulary of its own: a caller maps its state to a tone, which is what
// keeps the domain-named wrapper in `feature`.
export function StatusBadge({ tone = "neutral", children, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "ui-status-badge",
        `ui-status-badge--${tone}`,
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-transparent px-2 py-1 font-medium text-fg text-xs leading-tight",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
