import { cn } from "../../class-name/index.js";
import { BaseRadio, BaseRadioGroup } from "../../import.js";
import type { ModeKey, ModePreference } from "../../theme/index.js";
import { Icon } from "../icon/index.js";

export interface ThemeToggleSystem {
  readonly label: string;
  // What the user stored, `system` included. Given, this is the segment shown as chosen.
  readonly preference: ModePreference;
  readonly onPreferenceChange: (preference: ModePreference) => void;
}

export interface ThemeToggleProps {
  // The group's accessible name; each segment is named by its own label.
  readonly label: string;
  readonly mode: ModeKey;
  readonly onModeChange: (mode: ModeKey) => void;
  readonly lightLabel: string;
  readonly darkLabel: string;
  // A third segment that follows the OS. The app shell has one; the docs reader does not.
  readonly system?: ThemeToggleSystem;
  // `icons` draws a sun and a moon; `labels` writes the words, as the app shell's bar does.
  readonly variant?: "icons" | "labels";
  // A dark-only palette offers no light half. Disabled rather than hidden, so the control
  // keeps its shape when the palette changes under it.
  readonly disabledModes?: readonly ModeKey[];
  readonly className?: string;
}

type Segment = { readonly key: ModePreference; readonly icon: "sun" | "moon" | "monitor" };

// Light and dark, and optionally system, as segments of a radio group, so the arrow keys
// move between them. The chosen one is --muted: this control is chrome, and should not shout.
export function ThemeToggle({
  label,
  mode,
  onModeChange,
  lightLabel,
  darkLabel,
  system,
  variant = "icons",
  disabledModes = [],
  className,
}: ThemeToggleProps) {
  const segments: readonly Segment[] = [
    ...(system ? [{ key: "system", icon: "monitor" } as const] : []),
    { key: "light", icon: "sun" },
    { key: "dark", icon: "moon" },
  ];
  const labelOf = (key: ModePreference): string =>
    key === "system" ? (system?.label ?? "") : key === "light" ? lightLabel : darkLabel;

  return (
    <BaseRadioGroup
      aria-label={label}
      value={system ? system.preference : mode}
      onValueChange={(next) => {
        if (next !== "light" && next !== "dark" && next !== "system") return;
        if (system) system.onPreferenceChange(next);
        else if (next !== "system") onModeChange(next);
      }}
      className={cn(
        "ui-theme-toggle inline-flex gap-1 border border-border bg-surface p-1",
        variant === "labels" ? "rounded-md" : "rounded-full",
        className,
      )}
    >
      {segments.map(({ key, icon }) => (
        <BaseRadio.Root
          key={key}
          value={key}
          aria-label={labelOf(key)}
          disabled={key !== "system" && disabledModes.includes(key)}
          className={cn(
            "ui-theme-toggle__option inline-flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-fg-muted transition-colors duration-(--duration-fast) hover:text-fg data-checked:bg-muted data-checked:text-fg data-disabled:cursor-not-allowed data-disabled:opacity-40 data-disabled:hover:text-fg-muted",
            variant === "labels"
              ? "h-(--control-height-sm) rounded-sm px-2 text-xs"
              : "size-(--control-height-sm) rounded-full",
          )}
        >
          {variant === "labels" ? labelOf(key) : <Icon name={icon} size={16} />}
        </BaseRadio.Root>
      ))}
    </BaseRadioGroup>
  );
}
