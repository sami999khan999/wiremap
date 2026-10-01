import { type IconName, spriteUrl } from "../../import.js";

export interface IconProps {
  readonly name: IconName;
  readonly size?: number;
  // Supplying one makes the icon its own accessible name. Leaving it off hides the icon
  // from assistive tech, which is right when adjacent text already says what it means.
  readonly label?: string;
  readonly className?: string;
}

export function Icon({ name, size = 20, label, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      fill="currentColor"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      // Older engines put SVGs in the tab order. Cheap insurance.
      focusable="false"
    >
      <use href={`${spriteUrl}#${name}`} />
    </svg>
  );
}
