import { Icon } from "../icon/index.js";
import type { ModeKey } from "../theme/index.js";

export interface ThemeToggleProps {
  // The group's accessible name; each half is named by its own label.
  readonly label: string;
  readonly mode: ModeKey;
  readonly onModeChange: (mode: ModeKey) => void;
  readonly lightLabel: string;
  readonly darkLabel: string;
  // A dark-only palette offers no light half. Disabled rather than hidden, so the control
  // keeps its shape when the palette changes under it.
  readonly disabledModes?: readonly ModeKey[];
  readonly className?: string;
}

const MODES = [
  { key: "light", icon: "sun" },
  { key: "dark", icon: "moon" },
] as const;

// Light and dark as two segments. The palette is a separate choice, made elsewhere, which
// is the same split `ThemeRegistry` and `ModeRegistry` keep.
export function ThemeToggle({
  label,
  mode,
  onModeChange,
  lightLabel,
  darkLabel,
  disabledModes = [],
  className,
}: ThemeToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={["ui-theme-toggle", className].filter(Boolean).join(" ")}
    >
      {MODES.map(({ key, icon }) => (
        // biome-ignore lint/a11y/useSemanticElements: a segment, which a radio input cannot style.
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={mode === key}
          aria-label={key === "light" ? lightLabel : darkLabel}
          disabled={disabledModes.includes(key)}
          className="ui-theme-toggle__option"
          onClick={() => onModeChange(key)}
        >
          <Icon name={icon} size={16} />
        </button>
      ))}
    </div>
  );
}
