import {
  type ModePreference,
  ThemeRegistry,
  ThemeToggle,
  useMessages,
  useState,
} from "~/import.js";
import type { AppearanceSnapshot, AppearanceStore } from "~/store/appearance.store.js";

export interface ModeSwitcherProps {
  readonly appearance: AppearanceStore;
  readonly snapshot: AppearanceSnapshot;
}

// The top bar's system, light and dark control. It lives here rather than in `feature`
// because only this app owns the appearance cookie, as with `-locale.tsx`.
export function ModeSwitcher({ appearance, snapshot }: ModeSwitcherProps) {
  const { t } = useMessages("nav");
  const [preference, setPreference] = useState<ModePreference>(snapshot.preference);
  const current = appearance.current;

  const choose = (next: ModePreference): void => {
    const prefersDark =
      typeof matchMedia === "function" && matchMedia("(prefers-color-scheme:dark)").matches;
    appearance.choose(current.theme, next, prefersDark);
    setPreference(next);
  };

  return (
    <ThemeToggle
      label={t("nav.mode")}
      variant="icons"
      mode={current.mode}
      onModeChange={choose}
      lightLabel={t("nav.modeLight")}
      darkLabel={t("nav.modeDark")}
      system={{ label: t("nav.modeSystem"), preference, onPreferenceChange: choose }}
      disabledModes={ThemeRegistry.meta(current.theme).modes.length < 2 ? ["light"] : []}
    />
  );
}
