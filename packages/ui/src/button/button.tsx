import { cn } from "../class-name/index.js";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "../import.js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly ref?: Ref<HTMLButtonElement>;
  readonly children: ReactNode;
}

const BASE =
  "inline-flex h-(--control-height) cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent px-4 [font-family:inherit] font-medium text-sm leading-tight transition-colors duration-(--duration-fast) disabled:cursor-not-allowed disabled:opacity-50";

// Hover and active are mixed from the role colour, not named: twelve names is the contract.
// --danger ships a verified foreground (4.62:1 light, 5.32:1 dark); --success and --warning do not.
const VARIANT: Readonly<Record<ButtonVariant, string>> = Object.freeze({
  primary:
    "bg-primary text-primary-fg enabled:hover:bg-[color-mix(in_oklch,var(--primary)_88%,var(--fg))] enabled:active:bg-[color-mix(in_oklch,var(--primary)_78%,var(--fg))]",
  secondary: "border-border bg-surface text-fg enabled:hover:bg-muted",
  ghost: "bg-transparent text-fg enabled:hover:bg-muted",
  danger:
    "bg-danger text-primary-fg enabled:hover:bg-[color-mix(in_oklch,var(--danger)_88%,var(--fg))]",
});

// For an element that must look like a button and cannot be one: a router link, or the
// label that opens a file picker.
export function buttonClassName(variant: ButtonVariant = "primary", className?: string): string {
  return cn("ui-button", `ui-button--${variant}`, BASE, VARIANT[variant], className);
}

// An unset `type` inside a form is `submit`, so every icon button would submit it.
// Defaulted here rather than remembered at each call site.
export function Button({ variant = "primary", type = "button", className, ...rest }: ButtonProps) {
  return <button type={type} className={buttonClassName(variant, className)} {...rest} />;
}
