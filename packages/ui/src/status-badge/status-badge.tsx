import type { ReactNode } from "../import.js";

// Named after what they mean rather than what colour they are — `danger`, not `red`.
// See `CalloutTone`, which is the same decision.
export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

export interface StatusBadgeProps {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
  readonly className?: string;
}

// No status vocabulary of its own: a caller maps its state to a tone, which is what
// keeps the domain-named wrapper in `feature`.
export function StatusBadge({ tone = "neutral", children, className }: StatusBadgeProps) {
  return (
    <span
      className={["ui-status-badge", `ui-status-badge--${tone}`, className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}
