import type { InputHTMLAttributes, Ref } from "../import.js";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly ref?: Ref<HTMLInputElement>;
}

// Spreads everything through, which is the point: `autoComplete`, `required`, `pattern`
// and `inputMode` are the caller's decisions and this component must not intercept them.
export function Input({ className, ...rest }: InputProps) {
  return <input className={["ui-input", className].filter(Boolean).join(" ")} {...rest} />;
}
