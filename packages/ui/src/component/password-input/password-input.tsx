import { cn } from "../../class-name/index.js";
import { type InputHTMLAttributes, type Ref, useState } from "../../import.js";
import { Icon } from "../icon/index.js";
import { inputClassName } from "../input/index.js";

export interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  readonly ref?: Ref<HTMLInputElement>;
  // Spoken names for the toggle: this package has no copy of its own.
  readonly showLabel: string;
  readonly hideLabel: string;
}

// A lock on the left and a show/hide button on the right, over one real input, so the
// browser's password manager and autofill treat it as the password field it is.
export function PasswordInput({ className, showLabel, hideLabel, ...rest }: PasswordInputProps) {
  const [shown, setShown] = useState(false);

  return (
    <div className="ui-password-input relative w-full">
      <Icon
        name="lock"
        size={16}
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted"
      />
      <input
        className={cn(inputClassName("pr-10 pl-9"), className)}
        type={shown ? "text" : "password"}
        {...rest}
      />
      <button
        type="button"
        className="absolute top-1/2 right-1 inline-flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent text-fg-muted transition-colors duration-(--duration-fast) hover:bg-muted hover:text-fg"
        aria-label={shown ? hideLabel : showLabel}
        aria-pressed={shown}
        onClick={() => setShown(!shown)}
      >
        <Icon name={shown ? "eye-off" : "eye"} size={16} />
      </button>
    </div>
  );
}
