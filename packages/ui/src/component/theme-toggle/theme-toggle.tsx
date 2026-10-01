import { cn } from "../../class-name/index.js";
import { BaseRadio, BaseRadioGroup } from "../../import.js";
import type { ModeKey } from "../../theme/index.js";
import { Icon } from "../icon/index.js";

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

// Light and dark as two segments of a radio group, so the arrow keys move between them.
// The chosen one is --muted, not --primary: this control is chrome, and chrome should not shout.
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
    <BaseRadioGroup
      aria-label={label}
      value={mode}
      onValueChange={(next) => {
        if (next === "light" || next === "dark") onModeChange(next);
      }}
      className={cn(
        "ui-theme-toggle inline-flex gap-1 rounded-full border border-border bg-surface p-1",
        className,
      )}
    >
      {MODES.map(({ key, icon }) => (
        <BaseRadio.Root
          key={key}
          value={key}
          aria-label={key === "light" ? lightLabel : darkLabel}
          disabled={disabledModes.includes(key)}
          className="ui-theme-toggle__option inline-flex size-(--control-height-sm) cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-fg-muted transition-colors duration-(--duration-fast) hover:text-fg data-checked:bg-muted data-checked:text-fg data-disabled:cursor-not-allowed data-disabled:opacity-40 data-disabled:hover:text-fg-muted"
        >
          <Icon name={icon} size={16} />
        </BaseRadio.Root>
      ))}
    </BaseRadioGroup>
  );
}
