import type { ButtonHTMLAttributes, ReactNode, Ref } from "../import.js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly ref?: Ref<HTMLButtonElement>;
  readonly children: ReactNode;
}

// An unset `type` inside a form is `submit`, so every icon button would submit it.
// Defaulted here rather than remembered at each call site.
export function Button({ variant = "primary", type = "button", className, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={["ui-button", `ui-button--${variant}`, className].filter(Boolean).join(" ")}
      {...rest}
    />
  );
}
