import type { Ref, TextareaHTMLAttributes } from "../import.js";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly ref?: Ref<HTMLTextAreaElement>;
}

// Spreads everything through, like `Input`: `rows`, `maxLength` and `onKeyDown` are the
// caller's decisions, and a composer that could not intercept Enter would be unusable.
export function Textarea({ className, ...rest }: TextareaProps) {
  return <textarea className={["ui-textarea", className].filter(Boolean).join(" ")} {...rest} />;
}
