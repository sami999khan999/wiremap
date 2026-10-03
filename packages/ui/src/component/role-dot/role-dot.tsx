import { cn } from "../../class-name/index.js";

// Six tones, each one of the twelve or a mix of two, so every theme recolours them.
export type RoleTone = "primary" | "cool" | "warm" | "success" | "warning" | "neutral";

const TONES: Readonly<Record<RoleTone, string>> = Object.freeze({
  primary: "bg-primary",
  cool: "bg-[color-mix(in_oklch,var(--success)_50%,var(--primary))]",
  warm: "bg-[color-mix(in_oklch,var(--danger)_60%,var(--primary))]",
  success: "bg-success",
  warning: "bg-warning",
  neutral: "bg-fg-muted",
});

export interface RoleDotProps {
  readonly tone: RoleTone;
  readonly className?: string;
}

// A small square marking a file's role, beside text that names it: decoration, so hidden
// from assistive technology. The role's name is the label next to it.
export function RoleDot({ tone, className }: RoleDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "ui-role-dot inline-block size-2.5 shrink-0 rounded-[2px]",
        TONES[tone],
        className,
      )}
    />
  );
}

RoleDot.tones = Object.freeze(Object.keys(TONES)) as readonly RoleTone[];
