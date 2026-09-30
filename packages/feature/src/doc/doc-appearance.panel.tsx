import { useMessages } from "../i18n/index.js";
import {
  Menu,
  type MenuOption,
  type ModeKey,
  type ThemeKey,
  ThemeRegistry,
  ThemeToggle,
  useMemo,
} from "../import.js";

export interface DocAppearance {
  readonly theme: ThemeKey;
  readonly mode: ModeKey;
  // The shell applies and persists it. The pair arrives already resolved, so a dark-only
  // palette is never asked to draw light.
  readonly onChange: (theme: ThemeKey, mode: ModeKey) => void;
}

export interface DocAppearancePanelProps {
  readonly appearance: DocAppearance;
}

// The sidebar's footer: the palette and the mode, the two choices `ThemeRegistry` and
// `ModeRegistry` keep apart.
export function DocAppearancePanel({ appearance }: DocAppearancePanelProps) {
  const { t } = useMessages("doc");
  const { theme, mode, onChange } = appearance;

  const options = useMemo(
    () =>
      ThemeRegistry.all().map(
        (key): MenuOption => ({ value: key, label: ThemeRegistry.meta(key).label }),
      ),
    [],
  );
  const disabled = (["light", "dark"] as const).filter(
    (candidate) => !ThemeRegistry.supports(theme, candidate),
  );

  return (
    <>
      <Menu
        label={t("doc.appearance.theme")}
        placement="above"
        value={theme}
        options={options}
        onSelect={(next) => {
          if (!ThemeRegistry.isKnown(next)) return;
          onChange(next, ThemeRegistry.resolveMode(next, mode));
        }}
      />
      <ThemeToggle
        label={t("doc.appearance.mode")}
        mode={mode}
        onModeChange={(next) => onChange(theme, next)}
        lightLabel={t("doc.appearance.light")}
        darkLabel={t("doc.appearance.dark")}
        disabledModes={disabled}
      />
    </>
  );
}
