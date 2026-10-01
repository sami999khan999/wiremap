import { cn } from "../../class-name/index.js";
import type { InputHTMLAttributes, Ref } from "../../import.js";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly ref?: Ref<HTMLInputElement>;
}

// The placeholder is --fg-muted on --muted, the pairing that fixed --fg-muted at 0.535.
// Invalid is read from the enclosing `Field`, so the control never needs to be told.
const CONTROL =
  "w-full rounded-md border border-border bg-muted text-fg text-sm [font-family:inherit] transition-colors duration-(--duration-fast) placeholder:text-fg-muted placeholder:opacity-100 enabled:hover:border-[color-mix(in_oklch,var(--border)_70%,var(--fg))] disabled:cursor-not-allowed disabled:opacity-50 in-data-[invalid=true]:border-danger in-data-[invalid=true]:focus-visible:shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--danger)]";

// For a control that is not an `Input` but must look like one: a native `<select>`.
export function inputClassName(className?: string): string {
  return cn("ui-input h-(--control-height) px-3", CONTROL, className);
}

// The same values as `Input` but the height, which a textarea sets in rows.
export function textareaClassName(className?: string): string {
  return cn("ui-textarea resize-y px-3 py-2 leading-normal", CONTROL, className);
}

// Spreads everything through, which is the point: `autoComplete`, `required`, `pattern`
// and `inputMode` are the caller's decisions and this component must not intercept them.
export function Input({ className, ...rest }: InputProps) {
  return <input className={inputClassName(className)} {...rest} />;
}
